import { createHash } from 'node:crypto';

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

export function normalizeQuestion(question) {
  return String(question).trim().replace(/\s+/g, ' ').toLowerCase();
}

export function artifactIdForContent(sha256) {
  return `art_${digestOf(canonicalJson({ sha256 }))}`;
}

export async function digestDirectory(_root, entries) {
  const files = [...entries].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const occurrences = [];
  for (const file of files) {
    const sha256 = digestOf(file.content);
    occurrences.push({
      logical_path: file.path,
      entry_kind: 'file',
      artifact_id: artifactIdForContent(sha256),
      parent_path: parentLogicalPath(file.path),
    });
  }
  const directoryPaths = [...new Set(files.flatMap((file) => ancestorDirectoryPaths(file.path)))].sort((left, right) => depth(right) - depth(left) || (left < right ? -1 : left > right ? 1 : 0));
  for (const directoryPath of directoryPaths) {
    const children = occurrences
      .filter((occurrence) => occurrence.parent_path === directoryPath)
      .map((occurrence) => ({
        name: occurrence.logical_path.slice(directoryPath.length + 1),
        artifact_id: occurrence.artifact_id,
        entry_kind: occurrence.entry_kind,
      }))
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    const sha256 = digestOf(canonicalJson({ kind: 'directory', children }));
    occurrences.push({
      logical_path: directoryPath,
      entry_kind: 'directory',
      artifact_id: artifactIdForContent(sha256),
      parent_path: parentLogicalPath(directoryPath),
    });
  }
  const children = [...occurrences].map(({ logical_path, artifact_id }) => ({ logical_path, artifact_id })).sort((left, right) => (left.logical_path < right.logical_path ? -1 : left.logical_path > right.logical_path ? 1 : 0));
  return digestOf(canonicalJson({ kind: 'directory-root', children }));
}

function parentLogicalPath(path) {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? null : path.slice(0, slash);
}

function ancestorDirectoryPaths(path) {
  const parts = path.split('/');
  const directories = [];
  for (let index = 1; index < parts.length; index += 1) directories.push(parts.slice(0, index).join('/'));
  return directories;
}

function depth(path) {
  return path.split('/').length;
}
