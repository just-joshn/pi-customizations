// TLC is an environment prerequisite for the formal-verification families. Absence is reported, never passed.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PKG } from './driver.ts';

let cached: boolean | undefined;

/** Whether the statechart wrapper can reach Java and tla2tools.jar on this machine. */
export function tlcAvailable(): boolean {
  if (cached !== undefined) return cached;
  const mise = spawnSync('mise', ['--version'], { encoding: 'utf8' });
  cached = mise.status === 0 && existsSync(join(PKG, 'dist', 'statechart.js'));
  if (cached) {
    const where = spawnSync('mise', ['where', 'http:tla2tools[url=https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar,checksum=sha256:936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88]@1.7.4'], { encoding: 'utf8' });
    cached = where.status === 0 && existsSync(join(where.stdout.trim(), 'tla2tools.jar'));
  }
  return cached;
}
