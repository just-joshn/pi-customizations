import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listTree } from '../target.mjs';
import { readAsarDirectory, readAsarMember } from './asar.mjs';

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.html', '.htm', '.map', '.css', '.txt', '.md', '.yml', '.yaml']);
const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);

export const extensionOf = (logicalPath) => {
  const dot = logicalPath.lastIndexOf('.');
  return dot <= 0 ? '' : logicalPath.slice(dot).toLowerCase();
};

export const isJavaScriptFile = (logicalPath) => JAVASCRIPT_EXTENSIONS.has(extensionOf(logicalPath));
export const isTextFile = (logicalPath) => TEXT_EXTENSIONS.has(extensionOf(logicalPath));

export async function openDirectorySource(root) {
  const files = await listTree(root);
  return {
    kind: 'directory',
    root,
    list: () => files.map((file) => ({ logical_path: file.path, size: file.size })),
    read: (logicalPath) => readFileSync(join(root, logicalPath)),
  };
}

export function openAsarSource(bytes) {
  const directory = readAsarDirectory(bytes);
  const byPath = new Map(directory.entries.map((entry) => [entry.logical_path, entry]));
  return {
    kind: 'asar',
    root: null,
    directory,
    list: () => directory.entries.map((entry) => ({ logical_path: entry.logical_path, size: entry.size })),
    read: (logicalPath) => {
      const entry = byPath.get(logicalPath);
      if (entry === undefined) throw new Error(`no ASAR member: ${logicalPath}`);
      const read = readAsarMember(bytes, entry);
      if (!read.available) throw new Error(`ASAR member is not available in the archive: ${logicalPath}`);
      return read.bytes;
    },
    integrityFor: (logicalPath) => {
      const entry = byPath.get(logicalPath);
      if (entry === undefined) return null;
      return readAsarMember(bytes, entry).integrity;
    },
  };
}

export function decodeText(buffer) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), invalid: false };
  } catch {
    return { text: buffer.toString('latin1'), invalid: true };
  }
}
