import { constants } from 'node:fs';
import { access, mkdir, readFile, unlink, utimes, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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
}

export type LineEndings = 'platform' | 'lf' | 'crlf';

export interface WorkingTreeOptions {
  readonly notices: Notices;
  readonly encoding?: string;
  readonly lineEndings?: LineEndings;
  readonly dryRun?: boolean;
}

const WRITE_ATTEMPTS = 5;
const FIRST_RETRY_DELAY_MS = 100;

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

async function writeWithRetries(path: string, bytes: string, encoding: BufferEncoding, notices: Notices): Promise<void> {
  let delay = FIRST_RETRY_DELAY_MS;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await writeFile(path, bytes, { encoding });
      return;
    } catch (error) {
      const permission = errorCode(error) === 'EACCES' || errorCode(error) === 'EPERM';
      if (permission && attempt < WRITE_ATTEMPTS) {
        await sleep(delay);
        delay *= 2;
        continue;
      }
      const reason = error instanceof Error ? error.message : String(error);
      notices.error(permission ? `Unable to write file ${path} after ${WRITE_ATTEMPTS} attempts: ${reason}` : `Unable to write file ${path}: ${reason}`);
      throw error;
    }
  }
}

function nodeEncoding(encoding: string): BufferEncoding {
  const normalized = encoding.toLowerCase().replace(/_/g, '-');
  if (normalized === 'utf-8' || normalized === 'utf8') return 'utf8';
  if (normalized === 'latin-1' || normalized === 'latin1' || normalized === 'iso-8859-1') return 'latin1';
  if (normalized === 'ascii') return 'ascii';
  if (normalized === 'utf-16le' || normalized === 'utf16le') return 'utf16le';
  throw new TypeError(`unknown encoding: ${encoding}`);
}

export function createWorkingTree(options: WorkingTreeOptions): WorkingTree {
  const { notices } = options;
  const encoding = options.encoding ?? 'utf-8';
  const separator = lineSeparator(options.lineEndings ?? 'platform');
  const dryRun = options.dryRun ?? false;
  return {
    dryRun,
    async read(path) {
      try {
        const bytes = await readFile(path);
        const decoder = new TextDecoder(nodeEncoding(encoding) === 'latin1' ? 'iso-8859-1' : encoding, { fatal: true, ignoreBOM: true });
        return universalNewlines(decoder.decode(bytes));
      } catch (error) {
        return readFailure(path, error, notices);
      }
    },
    async write(path, content) {
      if (dryRun) return;
      const bytes = separator === '\n' ? content : content.replace(/\n/g, separator);
      await withFileMutationQueue(path, () => writeWithRetries(path, bytes, nodeEncoding(encoding), notices));
    },
    async exists(path) {
      try {
        await access(path, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    async touch(path) {
      if (dryRun) return true;
      try {
        await mkdir(dirname(path), { recursive: true });
        const now = new Date();
        await utimes(path, now, now).catch(() => writeFile(path, '', { flag: 'a' }));
        return true;
      } catch {
        return false;
      }
    },
    async remove(path) {
      if (dryRun) return;
      await withFileMutationQueue(path, () => unlink(path));
    },
  };
}
