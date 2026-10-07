import { randomBytes } from 'node:crypto';
import type { Stats } from 'node:fs';
import { chmod, lstat, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { countOccurrences } from './py.ts';

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/** Python Path.resolve(strict=False): a path realpath cannot resolve (missing, unreadable) resolves lexically. */
export async function resolvePath(filepath: string): Promise<string> {
  try {
    return await realpath(filepath);
  } catch {
    return resolve(filepath);
  }
}

/** Any lstat failure (missing path, permission) means "no entry to inspect", so false/undefined. */
export async function lstatOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch {
    return undefined;
  }
}

export async function isSymlink(path: string): Promise<boolean> {
  return (await lstatOrUndefined(path))?.isSymbolicLink() === true;
}

export async function exists(path: string): Promise<boolean> {
  return (await lstatOrUndefined(path)) !== undefined;
}

/** Best-effort removal: an already-missing or undeletable file leaves nothing more for the caller to undo. */
export async function removeQuietly(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    return;
  }
}

type Utf8Lead = { need: number; min: number };

function utf8Lead(b: number): Utf8Lead | undefined {
  if (b >= 0xc2 && b <= 0xdf) return { need: 1, min: 0x80 };
  if (b >= 0xe0 && b <= 0xef) return { need: 2, min: 0x800 };
  if (b >= 0xf0 && b <= 0xf4) return { need: 3, min: 0x10000 };
  return undefined;
}

/** Length of the valid multi-byte sequence at `i`, or 0 when it is invalid. */
function utf8SequenceLength(bytes: Uint8Array, i: number, lead: Utf8Lead): number {
  let cp = (bytes[i] ?? 0) & (0x3f >> lead.need);
  for (let k = 1; k <= lead.need; k++) {
    const c = bytes[i + k];
    if (c === undefined || (c & 0xc0) !== 0x80) return 0;
    cp = (cp << 6) | (c & 0x3f);
  }
  if (cp < lead.min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return 0;
  return lead.need + 1;
}

/** Byte offset of the first invalid UTF-8 sequence, or -1. */
export function firstInvalidUtf8Offset(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i] ?? 0;
    if (b < 0x80) {
      i++;
      continue;
    }
    const lead = utf8Lead(b);
    const length = lead === undefined ? 0 : utf8SequenceLength(bytes, i, lead);
    if (length === 0) return i;
    i += length;
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

async function writeTempFile(tmpPath: string, data: Uint8Array): Promise<void> {
  const handle = await open(tmpPath, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeBytesAtomic(path: string, data: Uint8Array): Promise<void> {
  const tmpPath = join(dirname(path), `${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeTempFile(tmpPath, data);
    // A missing target is a fresh write: keep the temp file's 0600 mode.
    const existing = await stat(path).catch(() => undefined);
    if (existing !== undefined) await chmod(tmpPath, existing.mode & 0o7777);
    await rename(tmpPath, path);
  } catch (error) {
    await removeQuietly(tmpPath);
    throw error;
  }
}

export function renderText(text: string, newline: '\n' | '\r\n'): Buffer {
  // Normalise first: model output may already carry CRLF.
  const rendered = newline === '\n' ? text : text.replaceAll('\r\n', '\n').replaceAll('\n', newline);
  return Buffer.from(rendered, 'utf8');
}
