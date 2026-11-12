import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listFiles } from '../../adapters/provenance.ts';

export const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function run(script: string, args: string[] = []) {
  const result = spawnSync(process.execPath, [join(PKG, 'scripts', script), ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function fixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'pstack-parity-'));
  cpSync(join(PKG, 'vendor'), join(root, 'vendor'), { recursive: true });
  cpSync(join(PKG, 'generated'), join(root, 'generated'), { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function treeHash(dir: string): string {
  const hash = createHash('sha256');
  for (const file of listFiles(dir))
    hash
      .update(file)
      .update('\0')
      .update(readFileSync(join(dir, file)))
      .update('\0');
  return hash.digest('hex');
}
