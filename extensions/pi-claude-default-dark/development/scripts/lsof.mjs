import { spawnSync } from 'node:child_process';

export function requireLsof() {
  const probe = spawnSync('lsof', ['-v'], { encoding: 'utf8' });
  if (probe.error) throw new Error(`lsof is required to watch for network egress: ${probe.error.message}`);
}
