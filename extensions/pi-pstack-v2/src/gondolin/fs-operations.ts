import * as path from 'node:path';

import type { VM } from '@earendil-works/gondolin';
import type { EditOperations, LsOperations, ReadOperations, WriteOperations } from '@earendil-works/pi-coding-agent';
import { toGuestPath } from './paths.ts';

// The read tool shows these as images; any other extension reads as text.
const IMAGE_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

/** A missing or unreachable guest path reads as absent rather than failing the tool. */
export const guestExists = (vm: VM, localCwd: string, filePath: string): Promise<boolean> =>
  vm.fs.access(toGuestPath(localCwd, filePath)).then(
    () => true,
    () => false,
  );

export function createGondolinReadOps(vm: VM, localCwd: string): ReadOperations {
  return {
    readFile: async (filePath) => vm.fs.readFile(toGuestPath(localCwd, filePath)),
    access: async (filePath) => {
      await vm.fs.access(toGuestPath(localCwd, filePath));
    },
    detectImageMimeType: async (filePath) => IMAGE_MIME_TYPES.get(path.posix.extname(toGuestPath(localCwd, filePath)).toLowerCase()) ?? null,
  };
}

export function createGondolinWriteOps(vm: VM, localCwd: string): WriteOperations {
  return {
    writeFile: async (filePath, content) => {
      await vm.fs.writeFile(toGuestPath(localCwd, filePath), content, { encoding: 'utf8' });
    },
    mkdir: async (dirPath) => {
      await vm.fs.mkdir(toGuestPath(localCwd, dirPath), { recursive: true });
    },
  };
}

export function createGondolinEditOps(vm: VM, localCwd: string): EditOperations {
  const readOps = createGondolinReadOps(vm, localCwd);
  const writeOps = createGondolinWriteOps(vm, localCwd);
  return { readFile: readOps.readFile, writeFile: writeOps.writeFile, access: readOps.access };
}

export function createGondolinLsOps(vm: VM, localCwd: string): LsOperations {
  return {
    exists: async (filePath) => guestExists(vm, localCwd, filePath),
    stat: async (filePath) => vm.fs.stat(toGuestPath(localCwd, filePath)),
    readdir: async (dirPath) => vm.fs.listDir(toGuestPath(localCwd, dirPath)),
  };
}
