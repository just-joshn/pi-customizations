import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, onTestFinished, test } from 'vitest';
import { startTimerService, timerCommand } from '../scripts/timer-client.mjs';

const run = promisify(execFile);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a real Pi timer survives its initiating process, deduplicates unchanged and drains cancellation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-timer-test-'));
  onTestFinished(async () => {
    await timerCommand(directory, { type: 'shutdown' }).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  });
  const { stdout } = await run(process.execPath, ['test/timer-initiator.mjs', directory, process.cwd()]);
  const original = JSON.parse(stdout);
  expect(original.sessionFile).toContain(directory);
  expect(original.runId).toEqual(expect.any(String));
  const duplicate = await timerCommand(directory, { type: 'subscribe', timer: { name: 'survivor', prompt: 'CHANGED', delaySeconds: 99 } });
  expect(duplicate).toEqual(original);
  await expect.poll(async () => (await readFile(original.sessionFile, 'utf8')).split('TIMER:survive').length, { timeout: 15000 }).toBeGreaterThan(3);
  await timerCommand(directory, { type: 'unsubscribe', subscriptionId: original.subscriptionId });
  const stopped = await readFile(original.sessionFile, 'utf8');
  await pause(1300);
  expect(await readFile(original.sessionFile, 'utf8')).toBe(stopped);
  expect(await timerCommand(directory, { type: 'list' })).toEqual([]);
  await expect(timerCommand(directory, { type: 'subscribe', timer: { name: 'bad', prompt: 'x', delaySeconds: 0 } })).rejects.toThrow('Invalid timer');
  await expect(timerCommand(directory, { type: 'unsubscribe', subscriptionId: 'missing' })).rejects.toThrow('Unknown subscription');
  await timerCommand(directory, { type: 'unsubscribe', subscriptionId: original.subscriptionId });
  const deferred = await timerCommand(directory, { type: 'subscribe', timer: { name: 'survivor', prompt: 'REARM', delaySeconds: 60, runImmediately: false } });
  expect(deferred.subscriptionId).not.toBe(original.subscriptionId);
  await pause(150);
  expect(await readFile(original.sessionFile, 'utf8')).toBe(stopped);
}, 30000);

test('commands against an absent service fail explicitly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-timer-absent-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await expect(timerCommand(directory, { type: 'list' })).rejects.toThrow('not started');
});

test('failed Pi startup is reported rather than advertising an armed timer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-timer-failed-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await expect(startTimerService(directory, { cwd: join(directory, 'missing'), agentDir: directory, args: [] })).rejects.toThrow('Timer service unavailable');
}, 10000);

test('a terminated Pi root makes the timer service fail visibly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-timer-terminated-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const { stdout } = await run(process.execPath, ['test/timer-initiator.mjs', directory, process.cwd()]);
  const receipt = JSON.parse(stdout);
  const identity = JSON.parse(await readFile(join(receipt.rpcDirectory, 'status.json'), 'utf8'));
  process.kill(identity.childPid, 'SIGKILL');
  await expect.poll(async () => JSON.parse(await readFile(join(directory, 'status.json'), 'utf8')).kind, { timeout: 10000 }).toBe('failed');
  await expect(timerCommand(directory, { type: 'list' })).rejects.toThrow('Timer service unavailable');
}, 15000);
