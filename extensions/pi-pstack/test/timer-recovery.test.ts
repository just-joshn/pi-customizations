import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test } from 'vitest';
import { openDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { restartTimerService, timerCommand } from '../scripts/timer-client.mjs';
import { letTimersTick, occurrences } from './timer-clock.ts';

async function owner(prompt = 'TIMER:survive', deferred = false) {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-timer-recovery-'));
  onTestFinished(async () => {
    await timerCommand(directory, { type: 'shutdown' }).catch(async () => {
      const root = JSON.parse(await readFile(join(directory, 'root.json'), 'utf8'));
      await openDetachedRpc(root.rpcDirectory).close();
    });
    await rm(directory, { recursive: true, force: true });
  });
  const { stdout } = await promisify(execFile)(process.execPath, ['test/timer-initiator.mjs', directory, process.cwd(), prompt, ...(deferred ? ['deferred'] : [])]);
  return { directory, receipt: JSON.parse(stdout) };
}

async function killService(directory: string) {
  const status = JSON.parse(await readFile(join(directory, 'status.json'), 'utf8'));
  process.kill(status.pid, 'SIGKILL');
  await expect
    .poll(() => {
      try {
        process.kill(status.pid, 0);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
}

test('restart reattaches the existing Pi root and keeps subscription identity', async () => {
  const { directory, receipt } = await owner();
  await killService(directory);
  await restartTimerService(directory);
  const duplicate = await timerCommand(directory, { type: 'subscribe', timer: { name: 'survivor', prompt: 'changed', delaySeconds: 60 } });
  expect(duplicate.subscriptionId).toBe(receipt.subscriptionId);
  expect(duplicate.sessionFile).toBe(receipt.sessionFile);
  expect(duplicate.rpcDirectory).toBe(receipt.rpcDirectory);
}, 15000);

test('a running occurrence survives a service restart until cancelled', async () => {
  const { directory, receipt } = await owner('TIMER:HOLD');
  await expect.poll(() => readFile(receipt.sessionFile, 'utf8'), { timeout: 10000 }).toContain('sleep 30');
  await killService(directory);
  await restartTimerService(directory);
  await timerCommand(directory, { type: 'unsubscribe', subscriptionId: receipt.subscriptionId });
  expect((await openDetachedRpc(receipt.rpcDirectory).activity()).kind).toBe('settled');
  const stopped = await occurrences(receipt.sessionFile, 'TIMER:HOLD');
  await letTimersTick(directory);
  expect(await occurrences(receipt.sessionFile, 'TIMER:HOLD')).toBe(stopped);
  const users = (await readFile(receipt.sessionFile, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'message' && entry.message.role === 'user' && JSON.stringify(entry.message.content).includes('TIMER:HOLD'));
  expect(users).toHaveLength(1);
}, 15000);

test('recovery resumes a dead root exclusively and preserves pending subscriptions', async () => {
  const { directory, receipt } = await owner();
  await timerCommand(directory, { type: 'unsubscribe', subscriptionId: receipt.subscriptionId });
  const deferred = await timerCommand(directory, { type: 'subscribe', timer: { name: 'deferred', prompt: 'later', delaySeconds: 60, runImmediately: false } });
  await killService(directory);
  await openDetachedRpc(receipt.rpcDirectory).close();
  await restartTimerService(directory);
  const result = await timerCommand(directory, { type: 'list' });
  expect(result[0].subscriptionId).toBe(deferred.subscriptionId);
  expect(result[0].sessionFile).toBe(receipt.sessionFile);
  expect(result[0].rpcDirectory).not.toBe(receipt.rpcDirectory);
  expect((await openDetachedRpc(receipt.rpcDirectory).info()).kind).toBe('exited');
}, 15000);

test('an ambiguous attempted occurrence is reported instead of replayed silently', async () => {
  const { directory, receipt } = await owner();
  await timerCommand(directory, { type: 'unsubscribe', subscriptionId: receipt.subscriptionId });
  const deferred = await timerCommand(directory, { type: 'subscribe', timer: { name: 'ambiguous', prompt: 'DO_NOT_REPLAY', delaySeconds: 60, runImmediately: false } });
  await killService(directory);
  await openDetachedRpc(receipt.rpcDirectory).close();
  const path = join(directory, 'subscriptions.json');
  const records = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(
    path,
    JSON.stringify(
      records.map((item: { receipt: { subscriptionId: string } }) =>
        item.receipt.subscriptionId === deferred.subscriptionId ? { ...item, occurrence: { phase: 'accepted', invocation: randomUUID(), dueAt: Date.now(), attempted: true } } : item,
      ),
    ),
  );
  await restartTimerService(directory);
  expect(await timerCommand(directory, { type: 'list' })).toEqual([expect.objectContaining({ status: 'needs_reconciliation', error: expect.stringContaining('may have executed') })]);
  expect(await readFile(receipt.sessionFile, 'utf8')).not.toContain('DO_NOT_REPLAY');
}, 15000);

test.for([
  { name: 'active branch', abandoned: false },
  { name: 'abandoned branch', abandoned: true },
])('a stopped assistant on the $name does not replace a lost settlement receipt', { timeout: 15000 }, async ({ abandoned }) => {
  const { directory, receipt } = await owner('NO_REPLAY', true);
  await killService(directory);
  await openDetachedRpc(receipt.rpcDirectory).close();
  const invocation = randomUUID();
  const session = SessionManager.open(receipt.sessionFile);
  const previous = session.getLeafId();
  session.appendMessage({ role: 'user', content: `[pstack-timer occurrence=${invocation} due_at=1]`, timestamp: 1 });
  session.appendMessage({
    role: 'assistant',
    api: 'openai-completions',
    provider: 'journey-test',
    model: 'recorder',
    content: [{ type: 'text', text: 'An intermediate reply.' }],
    stopReason: 'stop',
    timestamp: 2,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  if (abandoned) {
    if (!previous) throw new Error('Missing timer seed entry.');
    session.branch(previous);
    session.appendMessage({ role: 'user', content: 'The active branch has no occurrence.', timestamp: 3 });
  }
  const path = join(directory, 'subscriptions.json');
  const records: { receipt: { subscriptionId: string } }[] = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify(records.map((item) => ({ ...item, occurrence: { phase: 'accepted', invocation, dueAt: 1, attempted: true } }))));
  await restartTimerService(directory);
  expect(await timerCommand(directory, { type: 'list' })).toEqual([expect.objectContaining({ subscriptionId: receipt.subscriptionId, status: 'needs_reconciliation', error: expect.stringContaining('may have executed') })]);
  const recovered = SessionManager.open(receipt.sessionFile);
  expect(recovered.getEntries().filter((entry) => entry.type === 'message' && entry.message.role === 'user' && JSON.stringify(entry.message.content).includes(invocation))).toHaveLength(1);
});

test('a matching native settlement receipt settles recovery without replay', async () => {
  const { directory, receipt } = await owner('RECEIPT_RECOVERY', true);
  await killService(directory);
  const running = openDetachedRpc(receipt.rpcDirectory);
  const invocation = randomUUID();
  await running.send({ type: 'prompt', message: `RECEIPT_RECOVERY [pstack-timer occurrence=${invocation} due_at=1]` }, invocation);
  await expect.poll(() => running.activity(), { timeout: 10000 }).toEqual({ kind: 'settled', invocation });
  const path = join(directory, 'subscriptions.json');
  const records: { receipt: { subscriptionId: string } }[] = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify(records.map((item) => ({ ...item, occurrence: { phase: 'accepted', invocation, dueAt: 1, attempted: true } }))));
  await restartTimerService(directory);
  expect(await timerCommand(directory, { type: 'list' })).toEqual([expect.objectContaining({ subscriptionId: receipt.subscriptionId })]);
  const current = JSON.parse(await readFile(path, 'utf8'));
  expect(current[0].occurrence.phase).toBe('settled');
  expect(current[0].nextAt).toBeGreaterThan(1);
  expect(
    SessionManager.open(receipt.sessionFile)
      .getEntries()
      .filter((entry) => entry.type === 'message' && entry.message.role === 'user' && JSON.stringify(entry.message.content).includes(invocation)),
  ).toHaveLength(1);
}, 15000);

test('recovery drains a cancellation persisted before its acknowledgment', async () => {
  const { directory, receipt } = await owner('TIMER:HOLD');
  await expect.poll(() => readFile(receipt.sessionFile, 'utf8'), { timeout: 10000 }).toContain('sleep 30');
  await killService(directory);
  const path = join(directory, 'subscriptions.json');
  const records = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify(records.map((item: object) => ({ ...item, enabled: false }))));
  await restartTimerService(directory);
  expect((await openDetachedRpc(receipt.rpcDirectory).activity()).kind).toBe('settled');
  expect(await timerCommand(directory, { type: 'list' })).toEqual([]);
}, 15000);

test('concurrent restart attempts retain one native Pi writer', async () => {
  const { directory, receipt } = await owner();
  await killService(directory);
  const attempts = await Promise.allSettled([restartTimerService(directory), restartTimerService(directory)]);
  expect(attempts.some((result) => result.status === 'fulfilled')).toBe(true);
  const current = JSON.parse(await readFile(join(directory, 'root.json'), 'utf8'));
  expect(current.rpcDirectory).toBe(receipt.rpcDirectory);
  expect(current.sessionFile).toBe(receipt.sessionFile);
  expect(await timerCommand(directory, { type: 'list' })).toHaveLength(1);
}, 15000);

test('a deferred first occurrence has a persistent root before its first model turn', async () => {
  const { directory, receipt } = await owner('DEFERRED_ROOT', true);
  expect(await readFile(receipt.sessionFile, 'utf8')).not.toContain('DEFERRED_ROOT');
  await killService(directory);
  await openDetachedRpc(receipt.rpcDirectory).close();
  await restartTimerService(directory);
  const result = await timerCommand(directory, { type: 'list' });
  expect(result[0].sessionFile).toBe(receipt.sessionFile);
  expect(await readFile(receipt.sessionFile, 'utf8')).not.toContain('DEFERRED_ROOT');
}, 15000);

test('a persisted unsent occurrence is delivered after restart instead of skipped', async () => {
  const { directory, receipt } = await owner();
  await timerCommand(directory, { type: 'unsubscribe', subscriptionId: receipt.subscriptionId });
  const deferred = await timerCommand(directory, { type: 'subscribe', timer: { name: 'pending', prompt: 'PENDING_RECOVERY', delaySeconds: 60, runImmediately: false } });
  await killService(directory);
  const path = join(directory, 'subscriptions.json');
  const records = JSON.parse(await readFile(path, 'utf8'));
  const invocation = randomUUID();
  await writeFile(
    path,
    JSON.stringify(
      records.map((item: { receipt: { subscriptionId: string } }) => (item.receipt.subscriptionId === deferred.subscriptionId ? { ...item, occurrence: { phase: 'pending', invocation, dueAt: Date.now(), attempted: false } } : item)),
    ),
  );
  await restartTimerService(directory);
  await expect.poll(() => readFile(receipt.sessionFile, 'utf8'), { timeout: 10000 }).toContain(invocation);
  await timerCommand(directory, { type: 'unsubscribe', subscriptionId: deferred.subscriptionId });
}, 15000);

test('cancellation survives supervisor restart without rearming the timer', async () => {
  const { directory, receipt } = await owner();
  await timerCommand(directory, { type: 'unsubscribe', subscriptionId: receipt.subscriptionId });
  const stopped = await occurrences(receipt.sessionFile, 'TIMER:survive');
  await killService(directory);
  await restartTimerService(directory);
  expect(await timerCommand(directory, { type: 'list' })).toEqual([]);
  await letTimersTick(directory);
  expect(await timerCommand(directory, { type: 'list' })).toEqual([]);
  expect(await occurrences(receipt.sessionFile, 'TIMER:survive')).toBe(stopped);
}, 15000);

test('retrying a command identity returns its existing durable receipt', async () => {
  const { directory } = await owner();
  const id = randomUUID();
  const command = { type: 'subscribe' as const, timer: { name: 'retry', prompt: 'retry', delaySeconds: 60, runImmediately: false } };
  const first = await timerCommand(directory, command, id);
  expect(await timerCommand(directory, command, id)).toEqual(first);
  await expect(timerCommand(directory, { ...command, timer: { ...command.timer, prompt: 'different' } }, id)).rejects.toThrow('different command');
}, 15000);
