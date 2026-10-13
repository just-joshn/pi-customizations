import { createHash } from 'node:crypto';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { digestDirectory, digestOf } from './canonical.mjs';
import { invalidInput } from './errors.mjs';

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const EMPTY_ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const MACH_O_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'utf8');

export const FILE_FORMATS = new Set(['asar', 'zip', 'apk', 'ipa', 'msix', 'dmg', 'mach-o', 'elf', 'pe', 'har', 'wasm', 'sqlite', 'gzip', 'tar', '7z', 'unknown']);

/** Content first, extension second: a renamed file must not be able to redirect the route. */
export function detectFormatFromBytes(bytes, name = '') {
  if (bytes.length >= 4) {
    const magic = bytes.readUInt32BE(0);
    const little = bytes.readUInt32LE(0);
    if (bytes.subarray(0, 4).equals(ELF_MAGIC)) return { format: 'elf', mismatchedExtension: false };
    if (bytes.subarray(0, 4).equals(ZIP_MAGIC) || bytes.subarray(0, 4).equals(EMPTY_ZIP_MAGIC)) return { format: zipFlavor(name, bytes), mismatchedExtension: false };
    if (bytes.subarray(0, 4).equals(WASM_MAGIC)) return { format: 'wasm', mismatchedExtension: false };
    if (bytes.subarray(0, 4).equals(GZIP_MAGIC)) return { format: 'gzip', mismatchedExtension: false };
    if (MACH_O_MAGICS.has(magic) || MACH_O_MAGICS.has(little)) return { format: 'mach-o', mismatchedExtension: false };
    if (bytes[0] === 0x4d && bytes[1] === 0x5a) return { format: 'pe', mismatchedExtension: false };
    if (bytes.subarray(0, 4).equals(SQLITE_MAGIC.subarray(0, 4))) return { format: 'sqlite', mismatchedExtension: false };
    if (bytes.length >= 16 && bytes.readUInt32LE(0) === 4 && looksLikeAsarHeader(bytes)) return { format: 'asar', mismatchedExtension: false };
    if (bytes.length >= 512 && bytes.subarray(0, 4).equals(Buffer.from('koly'))) return { format: 'dmg', mismatchedExtension: false };
  }
  if (name.toLowerCase().endsWith('.har')) return { format: 'har', mismatchedExtension: false };
  if (name.toLowerCase().endsWith('.7z')) return { format: '7z', mismatchedExtension: false };
  if (name.toLowerCase().endsWith('.tar')) return { format: 'tar', mismatchedExtension: false };
  return { format: 'unknown', mismatchedExtension: false };
}

function zipFlavor(name, _bytes) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.apk')) return 'apk';
  if (lower.endsWith('.ipa')) return 'ipa';
  if (lower.endsWith('.appx') || lower.endsWith('.msix')) return 'msix';
  return 'zip';
}

function looksLikeAsarHeader(bytes) {
  const headerLength = bytes.readUInt32LE(4);
  if (headerLength < 2 || headerLength > bytes.length) return false;
  const jsonSize = bytes.readUInt32LE(8);
  if (jsonSize > headerLength) return false;
  const json = bytes.subarray(16, 16 + (jsonSize - 8));
  try {
    const parsed = JSON.parse(json.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && typeof parsed.files === 'object';
  } catch {
    return false;
  }
}

export async function digestFile(path) {
  const bytes = await readFile(path);
  return digestOf(bytes);
}

/** A directory subject digests its canonical tree, so the same content at a new path keeps its identity. */
export async function digestTree(root) {
  const entries = [];
  const walk = async (directory, prefix) => {
    const names = (await readdir(directory, { withFileTypes: true })).sort((left, right) => (left.name < right.name ? -1 : 1));
    for (const entry of names) {
      const path = join(directory, entry.name);
      const logical = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path, logical);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(path);
      entries.push({ path: logical, mode: info.mode & 0o777, size: info.size, content: await readFile(path) });
    }
  };
  await walk(resolve(root), '');
  return digestDirectory(root, entries);
}

export async function listTree(root) {
  const files = [];
  const walk = async (directory, prefix) => {
    const names = (await readdir(directory, { withFileTypes: true })).sort((left, right) => (left.name < right.name ? -1 : 1));
    for (const entry of names) {
      const path = join(directory, entry.name);
      const logical = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(path, logical);
      else if (entry.isFile()) files.push({ path: logical, absolute: path, size: (await stat(path)).size });
    }
  };
  await walk(resolve(root), '');
  return files;
}

export async function readPrefix(path, length = 4096) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * The subject every envelope cites. Format is decided from bytes, and a
 * disagreement between the supplied name and the bytes is reported rather than
 * silently resolved.
 */
export async function describeSubject(path, { formatHint = null } = {}) {
  const resolved = resolve(path);
  let info;
  try {
    info = await stat(resolved);
  } catch {
    throw invalidInput('No file or directory exists at the selected input path.', [{ path: ['path'], reason: 'invalid_value', message: `ENOENT: ${resolved}` }]);
  }
  if (info.isDirectory()) {
    return {
      name: resolved.split('/').pop() ?? resolved,
      digest: { sha256: await digestTree(resolved) },
      format: 'directory',
      architecture: null,
      local_path: resolved,
      bytes: null,
    };
  }
  const prefix = await readPrefix(resolved, 65536);
  const detected = detectFormatFromBytes(prefix, resolved);
  const extensionMismatch = formatHint !== null && formatHint !== 'auto' && formatHint !== detected.format;
  return {
    name: resolved.split('/').pop() ?? resolved,
    digest: { sha256: digestOf(await readFile(resolved)) },
    format: formatHint && formatHint !== 'auto' ? formatHint : detected.format,
    architecture: null,
    local_path: resolved,
    bytes: info.size,
    detected_format: detected.format,
    ...(extensionMismatch ? { format_mismatch: { requested: formatHint, detected: detected.format } } : {}),
  };
}

/** SHA-256 of a byte range, used wherever a location must be tied to bytes. */
export function digestRange(bytes, start, end) {
  return createHash('sha256').update(bytes.subarray(start, end)).digest('hex');
}
