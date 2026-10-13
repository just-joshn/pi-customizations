import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const EOCD64_SIGNATURE = 0x06064b50;
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_COMMENT = 65_557;
const SENTINEL_32 = 0xffffffff;
/** A member may not decompress beyond this, so a hostile archive cannot exhaust memory. */
export const MAX_MEMBER_BYTES = 256 * 1024 * 1024;

let crcTable = null;

export function crc32(buffer) {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A member path is data, not a destination. Absolute paths, drive letters and
 * `..` segments are refused so a hostile archive cannot describe a write
 * outside its own root — the analysis never extracts members anyway.
 */
export function normalizeMemberPath(name) {
  const path = String(name);
  if (path.startsWith('/') || path.startsWith('\\')) return { safe: false, path, reason: 'absolute-path' };
  if (/^[A-Za-z]:/.test(path)) return { safe: false, path, reason: 'drive-letter' };
  const segments = path.split(/[/\\]+/);
  if (segments.includes('..')) return { safe: false, path, reason: 'parent-traversal' };
  return { safe: true, path: segments.filter((segment) => segment !== '' && segment !== '.').join('/'), reason: null };
}

export function findEndOfCentralDirectory(bytes) {
  const start = Math.max(0, bytes.length - MAX_COMMENT - 22);
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/** Read the central directory. Members are described, never extracted. */
export function readZipDirectory(bytes) {
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw new ZipError('malformed', 'No ZIP end-of-central-directory record was found.');
  let entryCount = bytes.readUInt16LE(eocd + 10);
  let directorySize = bytes.readUInt32LE(eocd + 12);
  let directoryOffset = bytes.readUInt32LE(eocd + 16);
  let zip64 = false;
  if (entryCount === 0xffff || directoryOffset === SENTINEL_32 || directorySize === SENTINEL_32) {
    const located = readZip64Locator(bytes, eocd);
    if (located !== null) {
      entryCount = located.entryCount;
      directoryOffset = located.directoryOffset;
      directorySize = located.directorySize;
      zip64 = true;
    }
  }
  if (directoryOffset + directorySize > bytes.length) throw new ZipError('malformed', 'The central directory extends past the end of the file.', directoryOffset);
  const entries = [];
  let offset = directoryOffset;
  let truncated = false;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      truncated = true;
      break;
    }
    const entry = readCentralEntry(bytes, offset);
    entries.push(entry);
    offset += 46 + entry.nameLength + entry.extraLength + entry.commentLength;
  }
  return {
    entries,
    zip64,
    comment: bytes.subarray(eocd + 22, eocd + 22 + bytes.readUInt16LE(eocd + 20)).toString('utf8'),
    coverage: {
      status: truncated ? 'partial' : 'complete',
      truncated,
      omitted_count: truncated ? entryCount - entries.length : 0,
      limits: truncated ? ['The central directory ended before every declared entry was read.'] : [],
    },
  };
}

function readZip64Locator(bytes, eocd) {
  const locatorOffset = eocd - 20;
  if (locatorOffset < 0 || bytes.readUInt32LE(locatorOffset) !== EOCD64_LOCATOR_SIGNATURE) return null;
  const recordOffset = Number(bytes.readBigUInt64LE(locatorOffset + 8));
  if (recordOffset + 56 > bytes.length || bytes.readUInt32LE(recordOffset) !== EOCD64_SIGNATURE) return null;
  return {
    entryCount: Number(bytes.readBigUInt64LE(recordOffset + 32)),
    directorySize: Number(bytes.readBigUInt64LE(recordOffset + 40)),
    directoryOffset: Number(bytes.readBigUInt64LE(recordOffset + 48)),
  };
}

function readCentralEntry(bytes, offset) {
  const flags = bytes.readUInt16LE(offset + 8);
  const method = bytes.readUInt16LE(offset + 10);
  const declaredCrc = bytes.readUInt32LE(offset + 16);
  let compressedSize = bytes.readUInt32LE(offset + 20);
  let uncompressedSize = bytes.readUInt32LE(offset + 24);
  const nameLength = bytes.readUInt16LE(offset + 28);
  const extraLength = bytes.readUInt16LE(offset + 30);
  const commentLength = bytes.readUInt16LE(offset + 32);
  const externalAttributes = bytes.readUInt32LE(offset + 38);
  let localHeaderOffset = bytes.readUInt32LE(offset + 42);
  const nameStart = offset + 46;
  const rawName = bytes.subarray(nameStart, nameStart + nameLength);
  const extra = bytes.subarray(nameStart + nameLength, nameStart + nameLength + extraLength);
  if (uncompressedSize === SENTINEL_32 || compressedSize === SENTINEL_32 || localHeaderOffset === SENTINEL_32) {
    const zip64Extra = readZip64Extra(extra, { uncompressed: uncompressedSize === SENTINEL_32, compressed: compressedSize === SENTINEL_32, offset: localHeaderOffset === SENTINEL_32 });
    if (zip64Extra.uncompressedSize !== null) uncompressedSize = zip64Extra.uncompressedSize;
    if (zip64Extra.compressedSize !== null) compressedSize = zip64Extra.compressedSize;
    if (zip64Extra.localHeaderOffset !== null) localHeaderOffset = zip64Extra.localHeaderOffset;
  }
  const name = decodeZipName(rawName, flags);
  const safety = normalizeMemberPath(name);
  return {
    logical_path: name,
    safe_path: safety.safe,
    unsafe_reason: safety.reason,
    compression_method: method,
    flags,
    declared_crc32: declaredCrc,
    compressed_size: compressedSize,
    uncompressed_size: uncompressedSize,
    local_header_offset: localHeaderOffset,
    external_attributes: externalAttributes,
    is_directory: name.endsWith('/') || (externalAttributes & 0x10) !== 0,
    nameLength,
    extraLength,
    commentLength,
  };
}

function readZip64Extra(extra, wanted) {
  const result = { uncompressedSize: null, compressedSize: null, localHeaderOffset: null };
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const id = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    const body = extra.subarray(offset + 4, offset + 4 + size);
    if (id === 0x0001) {
      let cursor = 0;
      if (wanted.uncompressed && cursor + 8 <= body.length) {
        result.uncompressedSize = Number(body.readBigUInt64LE(cursor));
        cursor += 8;
      }
      if (wanted.compressed && cursor + 8 <= body.length) {
        result.compressedSize = Number(body.readBigUInt64LE(cursor));
        cursor += 8;
      }
      if (wanted.offset && cursor + 8 <= body.length) result.localHeaderOffset = Number(body.readBigUInt64LE(cursor));
      return result;
    }
    offset += 4 + size;
  }
  return result;
}

function decodeZipName(rawName, flags) {
  const utf8 = (flags & 0x800) !== 0;
  if (!utf8) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(rawName);
    } catch {
      return rawName.toString('latin1');
    }
  }
  return rawName.toString('utf8');
}

export function assertMemberWithinLimits(entry) {
  if (entry.uncompressed_size > MAX_MEMBER_BYTES) {
    throw new ZipError('member_too_large', `Member ${entry.logical_path} declares ${entry.uncompressed_size} bytes, over the ${MAX_MEMBER_BYTES} byte member limit.`, entry.local_header_offset);
  }
}

/** Read one member's bytes, verifying the stored CRC-32 when the archive declares one. */
export function readZipMember(bytes, entry) {
  assertMemberWithinLimits(entry);
  const offset = entry.local_header_offset;
  if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
    throw new ZipError('malformed', `No local header for ${entry.logical_path}.`, offset);
  }
  const nameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressed_size;
  if (end > bytes.length) throw new ZipError('truncated', `Member ${entry.logical_path} extends past the end of the file.`, start);
  const compressed = bytes.subarray(start, end);
  const content = entry.compression_method === 0 ? Buffer.from(compressed) : entry.compression_method === 8 ? inflateRawSync(compressed, { maxOutputLength: MAX_MEMBER_BYTES }) : null;
  if (content === null) throw new ZipError('unsupported_method', `Compression method ${entry.compression_method} is not supported for ${entry.logical_path}.`, start);
  return { bytes: content, crc32: crc32(content), crc_ok: entry.declared_crc32 === 0 || entry.declared_crc32 === crc32(content) };
}

export class ZipError extends Error {
  constructor(code, message, offset = null) {
    super(message);
    this.name = 'ZipError';
    this.code = code;
    this.offset = offset;
  }
}
