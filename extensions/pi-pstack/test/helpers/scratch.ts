import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directories: string[] = [];

export function scratchDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

export function removeScratch(): void {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
}
