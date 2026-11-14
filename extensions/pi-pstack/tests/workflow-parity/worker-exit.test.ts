import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';
import * as runFiles from '../../src/run-files.ts';
import { untilWorkersExit } from './lib/driver.ts';

const repos: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

function worker(state: object, started?: string): string {
  const repo = mkdtempSync(join(tmpdir(), 'worker-exit-'));
  repos.push(repo);
  const dir = join(repo, '.pi/pstack/runs/run/workers/worker');
  mkdirSync(join(dir, 'claim'), { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
  if (started !== undefined) writeFileSync(join(dir, 'claim/identity.json'), JSON.stringify({ instance: 'instance', hostPid: process.pid, hostStarted: started }));
  return repo;
}

test('a PID reused by another process does not hold the sandbox open', async () => {
  const repo = worker({ hostPid: process.pid }, 'a different process start');
  vi.useFakeTimers();
  await Promise.all([expect(untilWorkersExit(repo)).resolves.toBeUndefined(), vi.advanceTimersByTimeAsync(30_000)]);
});

test('a child already recorded as exited does not hold the sandbox open through a reused PID', async () => {
  const repo = worker({ childPid: process.pid, exit: { code: 0, signal: null } });
  vi.useFakeTimers();
  await Promise.all([expect(untilWorkersExit(repo)).resolves.toBeUndefined(), vi.advanceTimersByTimeAsync(30_000)]);
});

test('a child PID changing identity during tmux shutdown does not hold the sandbox open', async () => {
  const repo = worker({ childPid: process.pid, exit: null });
  const started = vi.spyOn(runFiles, 'processStartTime').mockReturnValue('original child');
  await untilWorkersExit(repo, () => {
    started.mockReturnValue('replacement process');
  });
});

test('the same live host still fails after the shutdown deadline', async () => {
  const repo = worker({ hostPid: process.pid }, runFiles.processStartTime(process.pid));
  vi.useFakeTimers();
  await Promise.all([expect(untilWorkersExit(repo)).rejects.toThrow(`worker processes ${process.pid} outlived the tmux server for 30 s`), vi.advanceTimersByTimeAsync(30_000)]);
});
