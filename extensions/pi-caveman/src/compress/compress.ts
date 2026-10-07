import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import { withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import { shouldCompress } from './detect.ts';
import { exists, readSource, removeQuietly, renderText, resolvePath, writeBytesAtomic } from './io.ts';
import { withFileLock } from './lock.ts';
import { backupPathFor, isSensitivePath } from './paths.ts';
import { pyStrip } from './py.ts';
import { buildCompressPrompt, buildFixPrompt, firstNonblankLine, isSmallerThanBody, maskCodeBlocks, notSmallerMessage, restoreCodeBlocks, splitFrontmatter, stripLlmWrapper } from './text.ts';
import { validate } from './validate.ts';

export const MAX_RETRIES = 2;
export const MAX_FILE_SIZE = 500_000;

export type CompressOutcome = { kind: 'compressed'; path: string; backupPath: string; originalBytes: number; compressedBytes: number } | { kind: 'skipped'; reason: string } | { kind: 'failed'; errors: string[] };

export type Complete = (prompt: string, signal?: AbortSignal) => Promise<string>;

function preflight(filepath: string, size: number | undefined): CompressOutcome | undefined {
  if (size === undefined) return { kind: 'failed', errors: [`File not found: ${filepath}`] };
  if (size > MAX_FILE_SIZE) return { kind: 'failed', errors: [`File too large to compress safely (max 500KB): ${filepath}`] };
  if (!isSensitivePath(filepath)) return undefined;
  return {
    kind: 'failed',
    errors: [`Refusing to compress ${filepath}: filename looks sensitive (credentials, keys, secrets, or known private paths). Compression sends file contents to the model provider. Rename the file if this is a false positive.`],
  };
}

export async function compressFile(args: { path: string; complete: Complete; signal?: AbortSignal }): Promise<CompressOutcome> {
  const { complete, signal } = args;
  const filepath = await resolvePath(isAbsolute(args.path) ? args.path : resolve(args.path));
  // Any stat failure (missing, unreadable parent) is reported as "File not found", matching upstream.
  const info = await stat(filepath).catch(() => undefined);
  const refused = preflight(filepath, info?.size);
  if (refused !== undefined) return refused;
  // The queue serializes in-process Pi tools; the lock file serializes separate processes as upstream does.
  return withFileMutationQueue(filepath, () => withFileLock(filepath, signal, () => compressFileLocked(filepath, complete, signal)));
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
  readonly finalNewline: boolean;
  readonly raw: Buffer;
  readonly backupPath: string;
  readonly frontmatter: string;
  readonly body: string;
}

async function prepare(filepath: string): Promise<Prepared | CompressOutcome> {
  if (basename(filepath).endsWith('.original.md')) return { kind: 'skipped', reason: 'Skipping (backup file)' };
  if (!shouldCompress(filepath)) return { kind: 'skipped', reason: 'Skipping (not natural language)' };
  // A read or decode failure is reported to the caller as a failed outcome, not thrown.
  const source = await readSource(filepath).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  if (source instanceof Error) return { kind: 'failed', errors: [source.message] };
  if (pyStrip(source.text) === '') return { kind: 'skipped', reason: 'Refusing to compress: file is empty or whitespace-only.' };
  const backupPath = backupPathFor(filepath);
  if (await exists(backupPath)) {
    return { kind: 'skipped', reason: `Backup file already exists: ${backupPath}. Aborting to prevent data loss. Please remove or rename the backup file if you want to proceed.` };
  }
  const { frontmatter, body } = splitFrontmatter(source.text);
  if (pyStrip(body) === '') return { kind: 'skipped', reason: 'Refusing to compress: body is empty after frontmatter removal.' };
  return { filepath, originalText: source.text, newline: source.newline, finalNewline: source.finalNewline, raw: source.raw, backupPath, frontmatter, body };
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
  await removeQuietly(backupPath);
  return false;
}

async function validateAndCommit(prepared: Prepared, first: string, complete: Complete, signal: AbortSignal | undefined): Promise<CompressOutcome> {
  const { filepath, raw, backupPath, originalText, body, newline, finalNewline } = prepared;
  // Upstream decodes the backup with universal newlines for validation.
  const backupText = raw.toString('utf8');
  const anchor = firstNonblankLine(originalText);
  let compressed = first;
  let lastErrors: readonly string[] = [];
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const rendered = renderText(compressed, newline, finalNewline);
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
  await removeQuietly(backupPath);
  return { kind: 'failed', errors: [...lastErrors] };
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
    if (!(error instanceof TargetWriteError)) await removeQuietly(prepared.backupPath);
    throw error;
  }
}
