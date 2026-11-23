import { open, readFile, stat } from 'node:fs/promises';

import { MAX_READ_CHARS } from '../constants.ts';
import type { FileFingerprint, FileMetadata } from '../types.ts';
import { countLines, looksBinary, sha256Hex } from './text.ts';

/** Read up to `maxBytes` from the start of a file. */
export async function readHead(target: string, maxBytes: number): Promise<Uint8Array> {
  const handle = await open(target, 'r');
  try {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export interface MetadataOptions {
  /** Include a content digest. The bytes are already loaded for the line count. */
  readonly digest?: boolean;
}

/** Stat plus line count and optional digest for one file. */
export async function fileMetadata(target: string, options: MetadataOptions = {}): Promise<FileMetadata> {
  const stats = await stat(target);
  let lines = 0;
  let sha256: string | undefined;
  if (stats.isFile()) {
    const buffer = await readFile(target);
    lines = countLines(buffer.toString('utf-8'));
    if (options.digest !== false) {
      sha256 = sha256Hex(buffer);
    }
  }
  return {
    path: target,
    bytes: stats.size,
    lines,
    mtimeMs: stats.mtimeMs,
    ...(sha256 === undefined ? {} : { sha256 }),
  };
}

/** Fingerprint used for stale-write detection, or undefined when the file is missing or binary. */
export async function fingerprintFile(target: string): Promise<FileFingerprint | undefined> {
  const size = await fileSize(target);
  if (size === undefined) {
    return undefined;
  }
  const buffer = await readFile(target);
  if (looksBinary(buffer)) {
    return undefined;
  }
  return { sha256: sha256Hex(buffer), bytes: buffer.byteLength };
}

export async function fileSize(target: string): Promise<number | undefined> {
  try {
    const stats = await stat(target);
    return stats.isFile() ? stats.size : undefined;
  } catch {
    return undefined;
  }
}

/** True when a file is small enough to load as text in full. */
export function isTextReadableSize(bytes: number): boolean {
  return bytes <= MAX_READ_CHARS;
}
