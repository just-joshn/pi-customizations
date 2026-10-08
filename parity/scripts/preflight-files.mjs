import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export function diagnostic(code, file, locator, message, section = '§9') {
  return { code, file, locator, contractLocator: `contract.md ${section}`, message };
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function parityDirectory(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return undefined;
  try {
    const root = await realpath(value);
    return (await lstat(root)).isDirectory() ? root : undefined;
  } catch {
    return undefined;
  }
}

export function isUnsafeArtifactPath(path) {
  return typeof path !== 'string' || !path || isAbsolute(path) || /^[a-z]:/i.test(path) || /[\\\0]/.test(path) || path.split('/').some((part) => part === '..' || !part);
}

function readFailure(error, path) {
  const code = error?.code;
  if (code === 'ENOENT') return diagnostic('ARTIFACT_MISSING', path, '', 'Required artifact is missing.');
  if (code === 'ELOOP') return diagnostic('ARTIFACT_SYMLINK_REFUSED', path, '', 'Symlink artifacts are not inspected.');
  return diagnostic('ARTIFACT_UNREADABLE', path, '', 'Required artifact could not be read.');
}

export async function readArtifact(root, path) {
  if (isUnsafeArtifactPath(path)) return { ok: false, blocker: diagnostic('UNSAFE_ARTIFACT_PATH', String(path), '', 'Artifact paths must be relative, without traversal, backslashes, or null bytes.') };
  try {
    const segments = path.split('/');
    for (const index of segments.keys()) {
      const stat = await lstat(join(root, ...segments.slice(0, index + 1)));
      if (stat.isSymbolicLink()) return { ok: false, blocker: diagnostic('ARTIFACT_SYMLINK_REFUSED', path, '', 'Symlink artifacts are not inspected.') };
      if (index === segments.length - 1 && !stat.isFile()) return { ok: false, blocker: diagnostic('ARTIFACT_NOT_FILE', path, '', 'Required artifact is not a regular file.') };
    }
    const handle = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return { ok: true, bytes: await handle.readFile() };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return { ok: false, blocker: readFailure(error, path) };
  }
}

export async function readJson(root, path, validate) {
  const artifact = await readArtifact(root, path);
  if (!artifact.ok) return artifact;
  let value;
  try {
    value = JSON.parse(artifact.bytes.toString('utf8'));
  } catch {
    return { ok: false, blocker: diagnostic('ARTIFACT_INVALID_JSON', path, '', 'Required artifact is not valid JSON.') };
  }
  if (!isRecord(value)) return { ok: false, blocker: diagnostic('ARTIFACT_INVALID_SHAPE', path, '', 'Required artifact must be a JSON object.') };
  if (value.schemaVersion !== 1) return { ok: false, blocker: diagnostic('ARTIFACT_UNSUPPORTED_SCHEMA', path, 'schemaVersion', 'Only schema version 1 is understood by this preflight.') };
  if (!validate(value)) return { ok: false, blocker: diagnostic('ARTIFACT_INVALID_SHAPE', path, '', 'Required artifact has invalid or missing fields.') };
  return { ok: true, value };
}
