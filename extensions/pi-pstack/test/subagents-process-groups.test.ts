import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';

import { expect, test, vi } from 'vitest';
import { ProcessGroups } from '../src/subagents/process-groups.ts';
import { trackedBashOperations } from '../src/subagents/tracked-bash.ts';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('killAll SIGKILLs every tracked group and counts the owning agents', async () => {
  const published: unknown[] = [];
  const groups = new ProcessGroups('parent', (spawned) => published.push(spawned));
  const sleeper = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  await once(sleeper, 'spawn');
  const pid = sleeper.pid ?? 0;
  const exited = once(sleeper, 'exit');
  groups.add({ pid });
  groups.add({ pid: 2 ** 22 + 7, agentId: 'grandchild' });
  expect(published).toEqual([
    { pid, agentId: 'parent' },
    { pid: 2 ** 22 + 7, agentId: 'grandchild' },
  ]);
  expect(groups.killAll()).toBe(2);
  expect(await exited).toEqual([null, 'SIGKILL']);
});

test('killAll clears groups before signaling so a retry cannot signal a reused PID', () => {
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  try {
    const groups = new ProcessGroups('parent', () => {});
    groups.add({ pid: 12345 });
    expect(groups.killAll()).toBe(1);
    expect(groups.killAll()).toBe(1);
    expect(kill).toHaveBeenCalledTimes(1);
  } finally {
    kill.mockRestore();
  }
});

test('an agent with no tracked groups still reports itself', () => {
  expect(new ProcessGroups('solo', () => {}).killAll()).toBe(1);
});

test('tracked bash reports the process group leader it spawned', async () => {
  const pids: number[] = [];
  const chunks: Buffer[] = [];
  const result = await trackedBashOperations((pid) => pids.push(pid)).exec('echo $$', tmpdir(), { onData: (data) => chunks.push(data) });
  expect(result).toEqual({ exitCode: 0 });
  expect(pids).toEqual([Number(Buffer.concat(chunks).toString().trim())]);
});

test('aborting tracked bash kills its group and rejects as aborted', async () => {
  const controller = new AbortController();
  let leader = 0;
  const running = trackedBashOperations((pid) => {
    leader = pid;
    setTimeout(() => controller.abort(), 50);
  }).exec('sleep 30', tmpdir(), { onData: () => {}, signal: controller.signal });
  await expect(running).rejects.toThrow('aborted');
  expect(alive(leader)).toBe(false);
});

test('tracked bash times out with the pi timeout error', async () => {
  await expect(trackedBashOperations(() => {}).exec('sleep 30', tmpdir(), { onData: () => {}, timeout: 0.1 })).rejects.toThrow('timeout:0.1');
});

test('tracked bash refuses a missing working directory', async () => {
  await expect(trackedBashOperations(() => {}).exec('true', '/nonexistent-pstack-dir', { onData: () => {} })).rejects.toThrow('Working directory does not exist: /nonexistent-pstack-dir\nCannot execute bash commands.');
});
