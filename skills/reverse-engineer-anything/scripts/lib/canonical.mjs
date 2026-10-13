import { createHash } from 'node:crypto';

/**
 * Stable stringify: object keys sorted by code point, arrays in order, no
 * whitespace. Two structurally equal values always produce the same string, so
 * every identifier in the port is a function of content rather than of object
 * construction order.
 */
const MAX_DEPTH = 64;

export function canonicalJson(value) {
  return canonicalAt(value, 0);
}

function canonicalAt(value, depth) {
  if (depth > MAX_DEPTH) throw new Error(`canonicalJson refused a structure nested deeper than ${MAX_DEPTH} levels`);
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalAt(item, depth + 1)).join(',')}]`;
  const keys = Object.keys(value).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalAt(value[key], depth + 1)}`);
  return `{${members.join(',')}}`;
}

export function sha256Hex(input) {
  const hash = createHash('sha256');
  hash.update(input);
  return hash.digest('hex');
}

export function digestOf(input) {
  return sha256Hex(typeof input === 'string' ? Buffer.from(input, 'utf8') : input);
}

/** Content-addressed evidence identity: `ev_` plus 64 hex, as the reference shape. */
export function evidenceId({ operation, parameters, subjectSha256, normalizedResult }) {
  return `ev_${sha256Hex(canonicalJson({ operation, parameters, subjectSha256, normalizedResult }))}`;
}

export function nodeId(prefix, parts) {
  return `${prefix}_node_${sha256Hex(canonicalJson(parts))}`;
}

export function observationId(prefix, parts) {
  return `${prefix}_observation_${sha256Hex(canonicalJson(parts))}`;
}

export function unknownId(question) {
  return `unk_${sha256Hex(canonicalJson({ question: normalizeQuestion(question) }))}`;
}

/** Duplicate detection is on the question's meaning, not its spacing or case. */
export function normalizeQuestion(question) {
  return String(question).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Digest of a directory tree: paths sorted by code point, each entry digested over mode, size and bytes. */
export async function digestDirectory(_root, entries) {
  const hash = createHash('sha256');
  const files = [...entries].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  for (const file of files) {
    hash.update(canonicalJson({ path: file.path, mode: file.mode, size: file.size }));
    hash.update(file.content);
  }
  return hash.digest('hex');
}
