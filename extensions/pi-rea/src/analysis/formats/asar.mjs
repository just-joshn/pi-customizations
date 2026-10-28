import { createHash } from 'node:crypto';

const HEADER_FIXED = 16;
const MAX_HEADER_DEPTH = 64;

export class AsarError extends Error {
  constructor(code, message, offset = null) {
    super(message);
    this.name = 'AsarError';
    this.code = code;
    this.offset = offset;
  }
}

export function looksLikeAsar(bytes) {
  if (bytes.length < HEADER_FIXED) return false;
  if (bytes.readUInt32LE(0) !== 4) return false;
  const headerSize = bytes.readUInt32LE(4);
  const jsonSize = bytes.readUInt32LE(12);
  if (jsonSize <= 0 || jsonSize > headerSize || headerSize > bytes.length) return false;
  return bytes.subarray(HEADER_FIXED, HEADER_FIXED + 1).includes(0x7b);
}

export function readAsarDirectory(bytes) {
  if (!looksLikeAsar(bytes)) throw new AsarError('malformed', 'The file does not begin with an ASAR header.', 0);
  const headerSize = bytes.readUInt32LE(4);
  const jsonSize = bytes.readUInt32LE(12);
  const jsonEnd = HEADER_FIXED + jsonSize;
  if (jsonEnd > bytes.length) throw new AsarError('truncated', 'The ASAR header extends past the end of the file.', jsonSize);
  const alignment = (4 - (jsonSize % 4)) % 4;
  const dataOffset = jsonEnd + alignment;
  const pickleArithmetic = 4 + headerSize + 4;
  let header;
  try {
    header = JSON.parse(bytes.subarray(HEADER_FIXED, jsonEnd).toString('utf8'));
  } catch {
    throw new AsarError('malformed', 'The ASAR header is not valid JSON.', HEADER_FIXED);
  }
  const collected = collectEntries(header, '', 0, dataOffset);
  return {
    entries: collected.entries,
    dataOffset,
    headerBytes: jsonSize,
    alignment,
    arithmetic_agrees: dataOffset === pickleArithmetic,
    coverage: {
      status: collected.truncated ? 'partial' : 'complete',
      truncated: collected.truncated,
      omitted_count: collected.truncated ? 1 : 0,
      limits: collected.truncated ? [`The ASAR header nests deeper than ${MAX_HEADER_DEPTH} levels; deeper entries were not read.`] : [],
    },
  };
}

function collectEntries(node, prefix, depth, dataOffset) {
  if (depth > MAX_HEADER_DEPTH) return { entries: [], truncated: true };
  const entries = [];
  let truncated = false;
  for (const [name, value] of Object.entries(node.files ?? {})) {
    const logical = prefix === '' ? name : `${prefix}/${name}`;
    if (value.files) {
      const nested = collectEntries(value, logical, depth + 1, dataOffset);
      entries.push(...nested.entries);
      truncated ||= nested.truncated;
      continue;
    }
    entries.push({
      logical_path: logical,
      size: value.size ?? 0,
      offset: value.offset ?? null,
      unpacked: value.unpacked === true,
      executable: value.executable === true,
      link: value.link ?? null,
      integrity: value.integrity ?? null,
      absolute_offset: value.offset === undefined || value.unpacked === true ? null : dataOffset + value.offset,
    });
  }
  return { entries, truncated };
}

export function readAsarMember(bytes, entry) {
  if (entry.unpacked) return { bytes: null, available: false, reason: 'unpacked', integrity: null };
  if (entry.absolute_offset === null) return { bytes: null, available: false, reason: 'no-offset', integrity: null };
  const end = entry.absolute_offset + entry.size;
  if (end > bytes.length) throw new AsarError('truncated', `Member ${entry.logical_path} extends past the end of the file.`, entry.absolute_offset);
  const content = bytes.subarray(entry.absolute_offset, end);
  return { bytes: content, available: true, reason: null, integrity: verifyIntegrity(content, entry.integrity) };
}

export function verifyIntegrity(content, integrity) {
  if (integrity === null || typeof integrity !== 'object') return null;
  const algorithm = integrity.algorithm ?? 'SHA256';
  const declared = integrity.hash ?? null;
  const calculated = createHash(algorithm.toLowerCase().replace('-', '')).update(content).digest('base64');
  const blocks = Array.isArray(integrity.blocks) ? integrity.blocks : null;
  const blockSize = integrity.blockSize ?? null;
  let blocksMatch = null;
  if (blocks !== null && Number.isInteger(blockSize) && blockSize > 0) {
    blocksMatch = blocks.every((declaredBlock, index) => {
      const start = index * blockSize;
      const block = content.subarray(start, Math.min(start + blockSize, content.length));
      return createHash(algorithm.toLowerCase().replace('-', '')).update(block).digest('base64') === declaredBlock;
    });
  }
  return {
    declared_hash: declared,
    calculated_hash: calculated,
    hash_matches: declared === null ? null : declared === calculated,
    block_count: blocks === null ? null : blocks.length,
    blocks_match: blocksMatch,
  };
}
