import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { parseRunId, parseWorkerId, tmuxSessionName } from '../../src/run-files.ts';
import { removeRunContainers } from './families/pr-shipping.ts';

const available = spawnSync('docker', ['version', '--format', '{{.Server.Version}}']).status === 0;
test.skipIf(!available)('cleanup preserves another sandbox sharing the run label (requires a reachable Docker engine)', () => {
  const root = mkdtempSync(join(tmpdir(), 'cleanup-isolation-'));
  const runId = parseRunId('cleanup-shared');
  const workerId = parseWorkerId('verifier');
  const owner = (id: string) => {
    const repo = join(root, id);
    return { repo, name: tmuxSessionName(repo, runId, workerId) };
  };
  const first = owner('a');
  const second = owner('b');
  const owners = [first, second];
  const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
  try {
    for (const { repo, name } of owners) {
      mkdirSync(join(repo, '.pi/pstack/runs', runId, 'workers', workerId, 'claim'), { recursive: true });
      docker('run', '-d', '--name', name, '--label', `pstack.run=${runId}`, '--label', `pstack.worker=${name}`, '--entrypoint', 'sleep', 'node:24-bookworm', '300');
    }
    removeRunContainers(runId, first.repo);
    expect(docker('ps', '--quiet', '--filter', `name=^/${first.name}$`)).toBe('');
    expect(docker('inspect', '--format', '{{.State.Running}}', second.name)).toBe('true');
  } finally {
    for (const { name } of owners) spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
    rmSync(root, { recursive: true, force: true });
  }
});
