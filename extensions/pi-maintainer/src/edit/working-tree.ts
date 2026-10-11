import { constants } from 'node:fs';
import { access, lstat, mkdir, readFile, readlink, realpath, unlink, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { withFileMutationQueue } from '@earendil-works/pi-coding-agent';

/** Where Aider's InputOutput prints a line for the user. */
export interface Notices {
  output(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

/**
 * The working-tree operations Aider's coders perform, with `io.read_text` and `io.write_text`
 * semantics. Paths are absolute. A dry run performs no mutation at all.
 */
export interface WorkingTree {
  readonly dryRun: boolean;
  /** Decoded text with universal newlines, or null after reporting why it could not be read. */
  read(path: string): Promise<string | null>;
  /** Writes text with the configured line endings. Throws after reporting a failure. */
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Creates missing parent directories and an empty file. False when the OS refuses. */
  touch(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  /** Creates a directory and its missing parents, as `Path.mkdir(parents=True, exist_ok=True)` does. */
  mkdir(path: string): Promise<void>;
  mutate<T>(paths: readonly string[], operation: (tree: WorkingTree) => Promise<T>, signal?: AbortSignal): Promise<T>;
}

const LINE_ENDINGS = ['platform', 'lf', 'crlf'] as const;

export type LineEndings = (typeof LINE_ENDINGS)[number];

export interface WorkingTreeOptions {
  readonly notices: Notices;
  readonly encoding?: string;
  readonly lineEndings?: string;
  readonly dryRun?: boolean;
}

const WRITE_ATTEMPTS = 5;
const FIRST_RETRY_DELAY_MS = 100;

function resolveLineEndings(value: string | undefined): LineEndings {
  const lineEndings = value ?? 'platform';
  if (lineEndings === 'platform' || lineEndings === 'lf' || lineEndings === 'crlf') return lineEndings;
  throw new Error(`Invalid line_endings value: ${lineEndings}. Must be one of: ${LINE_ENDINGS.join(', ')}`);
}

function lineSeparator(lineEndings: LineEndings): string {
  if (lineEndings === 'lf') return '\n';
  if (lineEndings === 'crlf') return '\r\n';
  return process.platform === 'win32' ? '\r\n' : '\n';
}

const universalNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function readFailure(path: string, error: unknown, notices: Notices): null {
  const code = errorCode(error);
  if (code === 'ENOENT') notices.error(`${path}: file not found error`);
  else if (code === 'EISDIR') notices.error(`${path}: is a directory`);
  else if (error instanceof TypeError) {
    notices.error(`${path}: ${error.message}`);
    notices.error('Use --encoding to set the unicode encoding.');
  } else notices.error(`${path}: unable to read: ${error instanceof Error ? error.message : String(error)}`);
  return null;
}

async function writeWithRetries(path: string, bytes: string, encoding: BufferEncoding, notices: Notices, signal?: AbortSignal): Promise<void> {
  let delay = FIRST_RETRY_DELAY_MS;
  for (let attempt = 1; ; attempt += 1) {
    try {
      signal?.throwIfAborted();
      await writeFile(path, bytes, { encoding, ...(signal ? { signal } : {}) });
      return;
    } catch (error) {
      const permission = errorCode(error) === 'EACCES' || errorCode(error) === 'EPERM';
      if (permission && attempt < WRITE_ATTEMPTS) {
        await sleep(delay, undefined, { signal });
        delay *= 2;
        continue;
      }
      const reason = error instanceof Error ? error.message : String(error);
      notices.error(permission ? `Unable to write file ${path} after ${WRITE_ATTEMPTS} attempts: ${reason}` : `Unable to write file ${path}: ${reason}`);
      throw error;
    }
  }
}

const LATIN1_ALIASES = new Set(['latin-1', 'latin1', 'iso-8859-1']);

const normalizeEncoding = (encoding: string): string => encoding.toLowerCase().replace(/_/g, '-');

function nodeEncoding(encoding: string): BufferEncoding {
  const normalized = normalizeEncoding(encoding);
  if (normalized === 'utf-8' || normalized === 'utf8') return 'utf8';
  if (LATIN1_ALIASES.has(normalized)) return 'latin1';
  if (normalized === 'ascii') return 'ascii';
  if (normalized === 'utf-16le' || normalized === 'utf16le') return 'utf16le';
  throw new TypeError(`unknown encoding: ${encoding}`);
}

/** The symlink target, or null when the path is not a readable symlink. */
async function symlinkTarget(path: string): Promise<string | null> {
  try {
    return (await lstat(path)).isSymbolicLink() ? await readlink(path) : null;
  } catch {
    return null;
  }
}

async function mutationPath(path: string, seen: ReadonlySet<string> = new Set()): Promise<string> {
  const absolute = isAbsolute(path) ? path : `${process.cwd()}/${path}`;
  try {
    return await realpath(absolute);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT' && errorCode(error) !== 'ENOTDIR') throw error;
    const link = seen.has(absolute) ? null : await symlinkTarget(absolute);
    if (link !== null) return mutationPath(isAbsolute(link) ? link : join(dirname(absolute), link), new Set([...seen, absolute]));
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(await mutationPath(parent, seen), basename(absolute));
  }
}

async function lockPaths<T>(paths: readonly string[], operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const [head, ...rest] = paths;
  if (head === undefined) return operation();
  return withFileMutationQueue(head, () => lockPaths(rest, operation, signal));
}

async function touchFile(path: string): Promise<boolean> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const now = new Date();
    await utimes(path, now, now).catch(() => writeFile(path, '', { flag: 'a' }));
    return true;
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readText(path: string, encoding: string, notices: Notices): Promise<string | null> {
  try {
    const bytes = await readFile(path);
    const latin1 = LATIN1_ALIASES.has(normalizeEncoding(encoding));
    return universalNewlines(latin1 ? bytes.toString('latin1') : new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch (error) {
    return readFailure(path, error, notices);
  }
}

function workingTree(options: WorkingTreeOptions, held: ReadonlySet<string> | null, signal?: AbortSignal, dryTouched: Set<string> = new Set()): WorkingTree {
  const encoding = options.encoding ?? 'utf-8';
  const separator = lineSeparator(resolveLineEndings(options.lineEndings));
  const dryRun = options.dryRun ?? false;
  const mutation = async <T>(path: string, operation: () => Promise<T>): Promise<T> => {
    signal?.throwIfAborted();
    if (held === null) return withFileMutationQueue(await mutationPath(path), operation);
    if (!held.has(await mutationPath(path))) throw new Error(`Mutation target was not locked: ${path}`);
    return operation();
  };
  return {
    dryRun,
    async exists(path) {
      return (dryRun && dryTouched.has(await mutationPath(path))) || exists(path);
    },
    async read(path) {
      if (dryRun && dryTouched.has(await mutationPath(path)) && !(await exists(path))) return '';
      return readText(path, encoding, options.notices);
    },
    async write(path, content) {
      if (dryRun) return;
      const bytes = separator === '\n' ? content : content.replace(/\n/g, separator);
      await mutation(path, () => writeWithRetries(path, bytes, nodeEncoding(encoding), options.notices, signal));
    },
    async touch(path) {
      if (!dryRun) return mutation(path, () => touchFile(path));
      if (!(await exists(path))) dryTouched.add(await mutationPath(path));
      return true;
    },
    async remove(path) {
      if (!dryRun) await mutation(path, () => unlink(path));
    },
    async mutate(paths, operation, operationSignal) {
      if (held !== null) throw new Error('A file mutation transaction cannot be reentered');
      const keys = [...new Set(await Promise.all(paths.map((path) => mutationPath(path))))].sort();
      return lockPaths(keys, () => operation(workingTree(options, new Set(keys), operationSignal, dryTouched)), operationSignal);
    },
    async mkdir(path) {
      if (!dryRun) await mkdir(path, { recursive: true });
    },
  };
}

export const createWorkingTree = (options: WorkingTreeOptions): WorkingTree => workingTree(options, null);
