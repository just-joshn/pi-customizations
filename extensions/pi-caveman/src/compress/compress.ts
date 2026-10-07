import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { shouldCompress } from './detect.ts';
import { countOccurrences, pyLen, pySplitlines, pySplitlinesKeepends, pyStem, pyStrip, replaceFirst, S } from './py.ts';
import { validate } from './validate.ts';

export const MAX_RETRIES = 2;
export const MAX_FILE_SIZE = 500_000;
// Must outlast a legitimate holder's worst case (MAX_RETRIES+1 model calls).
export const LOCK_WAIT_SECONDS = 900;
export const LOCK_POLL_INTERVAL = 1.0;

export type CompressOutcome = { kind: 'compressed'; path: string; backupPath: string; originalBytes: number; compressedBytes: number } | { kind: 'skipped'; reason: string } | { kind: 'failed'; errors: string[] };

export type Complete = (prompt: string, signal?: AbortSignal) => Promise<string>;

const FENCE_LINE_REGEX = new RegExp(`^${S}{0,3}(\`{3,}|~{3,})`, 'u');
const FRONTMATTER_REGEX = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/;

export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  const m = FRONTMATTER_REGEX.exec(text);
  if (m === null) return { frontmatter: '', body: text };
  return { frontmatter: m[1] ?? '', body: m[2] ?? '' };
}

// Compressing ships raw bytes to a third-party model, so likely secrets are a
// hard refuse before read.
const SENSITIVE_BASENAME_REGEX = /^(\.env(\..+)?|\.netrc|credentials(\..+)?|secrets?(\..+)?|passwords?(\..+)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|authorized_keys|known_hosts|.*\.(pem|key|p12|pfx|crt|cer|jks|keystore|asc|gpg))$/i;

const SENSITIVE_PATH_COMPONENTS: ReadonlySet<string> = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker', 'credential', 'credentials', 'secret', 'secrets']);

const SENSITIVE_NAME_TOKENS: readonly string[] = ['secret', 'credential', 'password', 'passwd', 'apikey', 'accesskey', 'token', 'privatekey'];

const IS_WINDOWS = process.platform === 'win32';

function pathParts(filepath: string): string[] {
  const parts = filepath.split(IS_WINDOWS ? /[\\/]/ : /\//).filter((p) => p !== '');
  return filepath.startsWith('/') ? ['/', ...parts] : parts;
}

export function isSensitivePath(filepath: string): boolean {
  const parts = pathParts(filepath);
  const name = parts.at(-1) ?? '';
  if (SENSITIVE_BASENAME_REGEX.test(name)) return true;
  const normalized = new Set(parts.map((part) => part.toLowerCase().replace(/[_\-\s.]/g, '')));
  for (const part of normalized) {
    if (SENSITIVE_PATH_COMPONENTS.has(part)) return true;
    if (SENSITIVE_NAME_TOKENS.some((token) => part.includes(token))) return true;
  }
  return false;
}

function stateBaseDir(kind: 'backups' | 'locks'): string {
  let base: string;
  if (IS_WINDOWS) {
    const localAppData = process.env['LOCALAPPDATA'];
    base = localAppData !== undefined && localAppData !== '' ? localAppData : join(homedir(), 'AppData', 'Local');
  } else {
    const xdg = process.env['XDG_DATA_HOME'];
    base = xdg !== undefined && xdg !== '' ? xdg : join(homedir(), '.local', 'share');
  }
  return join(base, 'caveman-compress', kind);
}

/** Out-of-tree so skill auto-loaders don't re-ingest `.original.md` backups. */
export function backupDirFor(filepath: string): string {
  return join(stateBaseDir('backups'), basename(dirname(filepath)));
}

export function backupPathFor(filepath: string): string {
  return join(backupDirFor(filepath), `${pyStem(basename(filepath))}.original.md`);
}

async function resolvePath(filepath: string): Promise<string> {
  try {
    return await realpath(filepath);
  } catch {
    return resolve(filepath);
  }
}

/** Keyed on the backup path so two sources sharing a backup also share a lock. */
export async function lockPathFor(filepath: string): Promise<string> {
  const backup = backupPathFor(await resolvePath(filepath));
  const digest = createHash('sha256').update(backup, 'utf8').digest('hex').slice(0, 16);
  return join(stateBaseDir('locks'), `${digest}.lock`);
}

export class LockTimeoutError extends Error {
  override name = 'LockTimeoutError';
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasCode(error, 'ESRCH');
  }
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolveSleep, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolveSleep();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Exclusive-create lock file. Unlike upstream's flock, a crashed holder leaves
 * the file behind, so a lock whose recorded pid is dead is reclaimed.
 */
async function withFileLock<T>(filepath: string, signal: AbortSignal | undefined, body: () => Promise<T>): Promise<T> {
  const lockPath = await lockPathFor(filepath);
  const lockDir = dirname(lockPath);
  if (await isSymlink(lockDir)) throw new Error(`Refusing to use lock directory through a symlink: ${lockDir}`);
  await mkdir(lockDir, { recursive: true });
  if (!IS_WINDOWS) await chmod(lockDir, 0o700).catch(() => undefined);
  if (await isSymlink(lockPath)) throw new Error(`Refusing to open lock file through a symlink: ${lockPath}`);

  const deadline = Date.now() + LOCK_WAIT_SECONDS * 1000;
  for (;;) {
    try {
      const handle = await open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
      try {
        await handle.writeFile(String(process.pid));
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
    const holder = Number.parseInt(await readFile(lockPath, 'utf8').catch(() => ''), 10);
    if (Number.isInteger(holder) && holder > 0 && !isProcessAlive(holder)) {
      await unlink(lockPath).catch(() => undefined);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new LockTimeoutError(`Another caveman-compress run appears to be compressing ${filepath} (lock: ${lockPath}). Giving up after ${LOCK_WAIT_SECONDS}s — retry once it finishes.`);
    }
    await sleep(LOCK_POLL_INTERVAL * 1000, signal);
  }
  try {
    return await body();
  } finally {
    await unlink(lockPath).catch(() => undefined);
  }
}

/** Strip an outer fence only when the first and last fence lines are one block. */
export function stripLlmWrapper(text: string): string {
  const lines = text.split('\n');
  let first = 0;
  let last = lines.length - 1;
  while (first < lines.length && pyStrip(lines[first] ?? '') === '') first++;
  while (last > first && pyStrip(lines[last] ?? '') === '') last--;
  if (first >= last) return text;
  const opener = FENCE_LINE_REGEX.exec(lines[first] ?? '')?.[1];
  const closer = FENCE_LINE_REGEX.exec(lines[last] ?? '')?.[1];
  if (opener === undefined || closer === undefined) return text;
  if (closer.charAt(0) !== opener.charAt(0) || closer.length < opener.length) return text;
  if (pyStrip(lines[last] ?? '') !== closer) return text;
  for (const line of lines.slice(first + 1, last)) {
    const inner = FENCE_LINE_REGEX.exec(line)?.[1];
    if (inner !== undefined && inner.charAt(0) === opener.charAt(0) && inner.length >= opener.length) return text;
  }
  return lines.slice(first + 1, last).join('\n');
}

export function buildCompressPrompt(original: string): string {
  return `
Compress this markdown into caveman format.

STRICT RULES:
- Do NOT modify anything inside \`\`\` code blocks
- Do NOT modify anything inside a 4-space-indented code block either — those are code too, and they are validated
- Do NOT modify anything inside inline backticks
- Preserve ALL URLs exactly
- Preserve ALL headings exactly
- Preserve file paths and commands
- Return ONLY the compressed markdown body — do NOT wrap the entire output in a \`\`\`markdown fence or any other fence. Inner code blocks from the original stay as-is; do not add a new outer fence around the whole file.

Only compress natural language.

TEXT:
${original}
`;
}

export function buildFixPrompt(original: string, compressed: string, errors: readonly string[]): string {
  const errorsStr = errors.map((e) => `- ${e}`).join('\n');
  return `You are fixing a caveman-compressed markdown file. Specific validation errors were found.

CRITICAL RULES:
- DO NOT recompress or rephrase the file
- ONLY fix the listed errors — leave everything else exactly as-is
- The ORIGINAL is provided as reference only (to restore missing content)
- Preserve caveman style in all untouched sections

ERRORS TO FIX:
${errorsStr}

HOW TO FIX:
- Missing URL: find it in ORIGINAL, restore it exactly where it belongs in COMPRESSED
- Code block mismatch: find the exact code block in ORIGINAL, restore it in COMPRESSED
- Heading mismatch: restore the exact heading text from ORIGINAL into COMPRESSED
- Do not touch any section not mentioned in the errors

ORIGINAL (reference only):
${original}

COMPRESSED (fix this):
${compressed}

Return ONLY the fixed compressed file. No explanation.
`;
}

export const CODE_MARKER_PREFIX = '@@CAVEMAN_PRESERVED_CODE_';
const FENCE_OPEN_RE = /^[ ]{0,3}(`{3,}|~{3,})(?:[^\r\n]*)$/;

export type CodeBlock = { marker: string; block: string };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isIndentedLine(line: string): boolean {
  return line.startsWith('    ') || line.startsWith('\t');
}

/** Replace fenced and four-space-indented code with opaque line markers. */
export function maskCodeBlocks(text: string): { masked: string; blocks: CodeBlock[] } {
  if (text.includes(CODE_MARKER_PREFIX)) throw new Error('Input contains reserved Caveman code-preservation marker');
  const lines = pySplitlinesKeepends(text);
  const stripEol = (line: string): string => line.replace(/[\r\n]+$/, '');
  const out: string[] = [];
  const blocks: CodeBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const current = stripEol(lines[i] ?? '');
    const fence = FENCE_OPEN_RE.exec(current)?.[1];
    const indented = current !== '' && isIndentedLine(current);
    if (fence === undefined && !indented) {
      out.push(lines[i] ?? '');
      i++;
      continue;
    }
    const start = i;
    i++;
    if (fence !== undefined) {
      const closeRe = new RegExp(`^[ ]{0,3}${escapeRegExp(fence.charAt(0))}{${fence.length},}[ \\t]*$`);
      while (i < lines.length) {
        const matched = closeRe.test(stripEol(lines[i] ?? ''));
        i++;
        if (matched) break;
      }
    } else {
      while (i < lines.length) {
        const candidate = stripEol(lines[i] ?? '');
        if (candidate !== '' && !isIndentedLine(candidate)) break;
        i++;
      }
    }
    const block = lines.slice(start, i).join('');
    const digest = createHash('sha256').update(block, 'utf8').digest('hex').slice(0, 16);
    const marker = `${CODE_MARKER_PREFIX}${blocks.length}_${digest}@@`;
    blocks.push({ marker, block });
    const newline = block.endsWith('\r\n') ? '\r\n' : block.endsWith('\n') ? '\n' : '';
    out.push(marker + newline);
  }
  return { masked: out.join(''), blocks };
}

/** Restore markers exactly; fail closed if the model removed, copied, or altered one. */
export function restoreCodeBlocks(text: string, blocks: readonly CodeBlock[]): string {
  let restored = text;
  for (const { marker, block } of blocks) {
    if (countOccurrences(restored, marker) !== 1) {
      throw new Error(`Claude changed preserved code marker ${marker}; refusing to write`);
    }
    // The marker carries its own transport newline; consume it so a block
    // that already ends in a newline does not gain a blank line.
    if (restored.includes(`${marker}\r\n`)) restored = replaceFirst(restored, `${marker}\r\n`, block);
    else if (restored.includes(`${marker}\n`)) restored = replaceFirst(restored, `${marker}\n`, block);
    else restored = replaceFirst(restored, marker, block);
  }
  if (restored.includes(CODE_MARKER_PREFIX)) throw new Error('the model returned an unknown Caveman code-preservation marker');
  return restored;
}

/** Non-expansion invariant; must hold for every candidate, retries included. */
export function isSmallerThanBody(candidateBody: string, body: string): boolean {
  return pyLen(pyStrip(candidateBody)) < pyLen(pyStrip(body));
}

function notSmallerMessage(candidateBody: string, body: string): string {
  return `Compression aborted: output is not smaller than input (${pyLen(pyStrip(candidateBody))} >= ${pyLen(pyStrip(body))} chars).`;
}

export function firstNonblankLine(text: string): string {
  for (const line of pySplitlines(text)) {
    const stripped = pyStrip(line);
    if (stripped !== '') return stripped;
  }
  return '';
}

/** Byte offset of the first invalid UTF-8 sequence, or -1. */
function firstInvalidUtf8Offset(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i] ?? 0;
    let need: number;
    let min: number;
    if (b < 0x80) {
      i++;
      continue;
    } else if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      min = 0x10000;
    } else return i;
    let cp = b & (0x3f >> need);
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return i;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return i;
    i += need + 1;
  }
  return -1;
}

export type SourceText = { text: string; newline: '\n' | '\r\n'; raw: Buffer };

/**
 * Strict UTF-8 decode (any undecodable byte would be destroyed by the round
 * trip). The majority line terminator is kept so the write can restore it.
 */
export async function readSource(filepath: string): Promise<SourceText> {
  const raw = await readFile(filepath);
  const bad = firstInvalidUtf8Offset(raw);
  if (bad !== -1) {
    const byte = (raw[bad] ?? 0).toString(16).padStart(2, '0');
    throw new Error(
      `Refusing to compress ${filepath}: not valid UTF-8 (byte 0x${byte} at offset ${bad}). Compression rewrites the file in place, and any byte this tool cannot decode would be destroyed by the round trip. Convert the file to UTF-8 first.`,
    );
  }
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  const crlf = countOccurrences(text, '\r\n');
  const newline = crlf * 2 > countOccurrences(text, '\n') ? '\r\n' : '\n';
  return { text: text.replaceAll('\r\n', '\n').replaceAll('\r', '\n'), newline, raw };
}

export async function writeBytesAtomic(path: string, data: Uint8Array): Promise<void> {
  const tmpPath = join(dirname(path), `${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await open(tmpPath, 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const existing = await stat(path).catch(() => undefined);
    if (existing !== undefined) await chmod(tmpPath, existing.mode & 0o7777);
    await rename(tmpPath, path);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

export function renderText(text: string, newline: '\n' | '\r\n'): Buffer {
  // Normalise first: model output may already carry CRLF.
  const rendered = newline === '\n' ? text : text.replaceAll('\r\n', '\n').replaceAll('\n', newline);
  return Buffer.from(rendered, 'utf8');
}

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined)) !== undefined;
}

export async function compressFile(args: { path: string; complete: Complete; signal?: AbortSignal }): Promise<CompressOutcome> {
  const { complete, signal } = args;
  const filepath = await resolvePath(isAbsolute(args.path) ? args.path : resolve(args.path));

  const info = await stat(filepath).catch(() => undefined);
  if (info === undefined) return { kind: 'failed', errors: [`File not found: ${filepath}`] };
  if (info.size > MAX_FILE_SIZE) {
    return { kind: 'failed', errors: [`File too large to compress safely (max 500KB): ${filepath}`] };
  }
  if (isSensitivePath(filepath)) {
    return {
      kind: 'failed',
      errors: [`Refusing to compress ${filepath}: filename looks sensitive (credentials, keys, secrets, or known private paths). Compression sends file contents to the model provider. Rename the file if this is a false positive.`],
    };
  }

  return withFileLock(filepath, signal, () => compressFileLocked(filepath, complete, signal));
}

async function callModel(complete: Complete, prompt: string, signal: AbortSignal | undefined): Promise<string> {
  const output = signal === undefined ? await complete(prompt) : await complete(prompt, signal);
  return stripLlmWrapper(pyStrip(output));
}

/** The target write failed after the backup landed, so the backup must stay. */
class TargetWriteError extends Error {}

interface Prepared {
  readonly filepath: string;
  readonly originalText: string;
  readonly newline: '\n' | '\r\n';
  readonly raw: Buffer;
  readonly backupPath: string;
  readonly frontmatter: string;
  readonly body: string;
}

async function prepare(filepath: string): Promise<Prepared | CompressOutcome> {
  if (basename(filepath).endsWith('.original.md')) return { kind: 'skipped', reason: 'Skipping (backup file)' };
  if (!shouldCompress(filepath)) return { kind: 'skipped', reason: 'Skipping (not natural language)' };
  const source = await readSource(filepath).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  if (source instanceof Error) return { kind: 'failed', errors: [source.message] };
  if (pyStrip(source.text) === '') return { kind: 'skipped', reason: 'Refusing to compress: file is empty or whitespace-only.' };
  const backupPath = backupPathFor(filepath);
  if (await exists(backupPath)) {
    return { kind: 'skipped', reason: `Backup file already exists: ${backupPath}. Aborting to prevent data loss. Please remove or rename the backup file if you want to proceed.` };
  }
  const { frontmatter, body } = splitFrontmatter(source.text);
  if (pyStrip(body) === '') return { kind: 'skipped', reason: 'Refusing to compress: body is empty after frontmatter removal.' };
  return { filepath, originalText: source.text, newline: source.newline, raw: source.raw, backupPath, frontmatter, body };
}

async function draft(prepared: Prepared, complete: Complete, signal: AbortSignal | undefined): Promise<string | CompressOutcome> {
  const { body } = prepared;
  const { masked, blocks } = maskCodeBlocks(body);
  const maskedCompressed = await callModel(complete, buildCompressPrompt(masked), signal);
  let compressedBody: string;
  try {
    compressedBody = restoreCodeBlocks(maskedCompressed, blocks);
  } catch (error) {
    return { kind: 'failed', errors: [`Compression aborted: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (pyStrip(compressedBody) === '') return { kind: 'failed', errors: ['Compression aborted: the model returned an empty response.'] };
  if (pyStrip(compressedBody) === pyStrip(body)) return { kind: 'failed', errors: ['Compression aborted: output is identical to input.'] };
  if (!isSmallerThanBody(compressedBody, body)) return { kind: 'failed', errors: [notSmallerMessage(compressedBody, body)] };
  return prepared.frontmatter + compressedBody;
}

/** Writes the backup before the target is touched and verifies it by readback. */
async function writeVerifiedBackup(backupPath: string, raw: Buffer): Promise<boolean> {
  await mkdir(dirname(backupPath), { recursive: true });
  await writeBytesAtomic(backupPath, raw);
  if ((await readFile(backupPath)).equals(raw)) return true;
  await unlink(backupPath).catch(() => undefined);
  return false;
}

async function validateAndCommit(prepared: Prepared, first: string, complete: Complete, signal: AbortSignal | undefined): Promise<CompressOutcome> {
  const { filepath, raw, backupPath, originalText, body, newline } = prepared;
  // Upstream decodes the backup with universal newlines for validation.
  const backupText = raw.toString('utf8');
  const anchor = firstNonblankLine(originalText);
  let compressed = first;
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const rendered = renderText(compressed, newline);
    const result = validate(backupText, rendered.toString('utf8'));
    if (result.isValid) {
      await writeBytesAtomic(filepath, rendered).catch((error: unknown) => {
        throw new TargetWriteError(`Write to ${filepath} failed. Original preserved at backup: ${backupPath}`, { cause: error });
      });
      return { kind: 'compressed', path: filepath, backupPath, originalBytes: raw.length, compressedBytes: rendered.length };
    }
    lastErrors = result.errors;
    if (attempt === MAX_RETRIES - 1) break;
    const fixed = await callModel(complete, buildFixPrompt(originalText, compressed, result.errors), signal);
    // Only enforced for structural anchors: plain-prose first lines are
    // legitimately rewritten, but a changed `---`/heading means a preamble leaked.
    const anchorBroken = (anchor.startsWith('---') || anchor.startsWith('#')) && firstNonblankLine(fixed) !== anchor;
    if (pyStrip(fixed) !== '' && !anchorBroken && isSmallerThanBody(splitFrontmatter(fixed).body, body)) compressed = fixed;
  }
  await unlink(backupPath).catch(() => undefined);
  return { kind: 'failed', errors: lastErrors };
}

async function compressFileLocked(filepath: string, complete: Complete, signal: AbortSignal | undefined): Promise<CompressOutcome> {
  const prepared = await prepare(filepath);
  if ('kind' in prepared) return prepared;
  const compressed = await draft(prepared, complete, signal);
  if (typeof compressed !== 'string') return compressed;
  if (!(await writeVerifiedBackup(prepared.backupPath, prepared.raw))) {
    return {
      kind: 'failed',
      errors: [`Backup write verification failed: ${prepared.backupPath}. In-memory original differs from on-disk backup. Aborting before touching the input file.`],
    };
  }
  try {
    return await validateAndCommit(prepared, compressed, complete, signal);
  } catch (error) {
    if (!(error instanceof TargetWriteError)) await unlink(prepared.backupPath).catch(() => undefined);
    throw error;
  }
}
