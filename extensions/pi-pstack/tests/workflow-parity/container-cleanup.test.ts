import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
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
  const repos = ['a', 'b'].map((owner) => join(root, owner));
  const names = repos.map((repo) => tmuxSessionName(repo, runId, workerId));
  const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
  try {
    for (const [index, repo] of repos.entries()) {
      mkdirSync(join(repo, '.pi/pstack/runs', runId, 'workers', workerId, 'claim'), { recursive: true });
      docker('run', '-d', '--name', names[index]!, '--label', `pstack.run=${runId}`, '--label', `pstack.worker=${names[index]!}`, '--entrypoint', 'sleep', 'node:24-bookworm', '300');
    }
    removeRunContainers(runId, repos[0]!);
    expect(docker('ps', '--quiet', '--filter', `name=^/${names[0]!}$`)).toBe('');
    expect(docker('inspect', '--format', '{{.State.Running}}', names[1]!)).toBe('true');
  } finally {
    for (const name of names) spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
    rmSync(root, { recursive: true, force: true });
  }
});
