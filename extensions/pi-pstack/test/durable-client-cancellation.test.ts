import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { expect, onTestFinished, test, vi } from 'vitest';
import { disableRoutine, inspectRoutine, prepareRoutine, routineRecord, startRoutine, durableRecord as writeRecord } from '../scripts/routine-client.mjs';
import { restartTimerService, startTimerService, timerCommand, timerRecord } from '../scripts/timer-client.mjs';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-caller-abort-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const input = { name: 'cancel', prompt: 'Read action.', fields: ['action'] };

test('pre-aborted clients write no drafts, launch records, or commands', async () => {
  const directory = await fixture();
  const signal = AbortSignal.abort();
  const absent = join(directory, 'absent');
  await expect(startTimerService(absent, { cwd: directory, agentDir: directory, args: [] }, signal)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(restartTimerService(absent, signal)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(timerCommand(absent, { type: 'list' }, undefined, signal)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(prepareRoutine(absent, input, signal)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(startRoutine(absent, 'revision', { cwd: directory, agentDir: directory, args: [] }, signal)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(disableRoutine(absent, signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(await readdir(directory)).toEqual([]);
});

test('canceling a command wait preserves its accepted command and receipt identity', async () => {
  const directory = await fixture();
  for (const name of ['commands', 'receipts']) await mkdir(join(directory, name));
  await writeRecord(join(directory, 'status.json'), { kind: 'ready', pid: process.pid });
  const id = randomUUID();
  const command = { type: 'list' } satisfies { type: 'list' };
  const controller = new AbortController();
  const waiting = timerCommand(directory, command, id, controller.signal);
  const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  await expect.poll(() => timerRecord(join(directory, 'commands', `${id}.json`))).toEqual({ id, command });
  controller.abort();
  await rejected;
  expect(await timerRecord(join(directory, 'commands', `${id}.json`))).toEqual({ id, command });
  await writeRecord(join(directory, 'receipts', `${id}.json`), { command, success: true, result: [] });
  expect(await timerCommand(directory, command, id)).toEqual([]);
  await expect(timerCommand(directory, { type: 'shutdown' }, id)).rejects.toThrow('different command');
}, 1000);

test('canceling a shutdown drain leaves the successful shutdown receipt intact', async () => {
  const directory = await fixture();
  for (const name of ['commands', 'receipts']) await mkdir(join(directory, name));
  await writeRecord(join(directory, 'status.json'), { kind: 'ready', pid: process.pid });
  const id = randomUUID();
  const command = { type: 'shutdown' } satisfies { type: 'shutdown' };
  const controller = new AbortController();
  const waiting = timerCommand(directory, command, id, controller.signal);
  const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  await expect.poll(() => timerRecord(join(directory, 'commands', `${id}.json`))).toEqual({ id, command });
  await writeRecord(join(directory, 'receipts', `${id}.json`), { command, success: true, result: { stopped: true } });
  await delay(50);
  controller.abort();
  await rejected;
  expect(await timerRecord(join(directory, 'receipts', `${id}.json`))).toMatchObject({ success: true });
}, 1000);

test('canceling routine disable preserves the durable disable request', async () => {
  const root = await fixture();
  const draft = await prepareRoutine(root, input);
  await writeRecord(join(draft.directory, 'status.json'), { kind: 'ready', pid: process.pid });
  const controller = new AbortController();
  const waiting = disableRoutine(draft.directory, controller.signal);
  const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  await expect.poll(() => timerRecord(join(draft.directory, 'disable.json'))).toHaveProperty('requestedAt');
  controller.abort();
  await rejected;
  expect(await timerRecord(join(draft.directory, 'disable.json'))).toHaveProperty('requestedAt');
  await writeRecord(join(draft.directory, 'status.json'), { kind: 'disabled' });
  expect(await disableRoutine(draft.directory)).toMatchObject({ kind: 'disabled', revision: draft.revision });
}, 1000);

test('uncanceled timer readiness and command waits retain their timeout errors', async () => {
  const directory = await fixture();
  for (const name of ['commands', 'receipts']) await mkdir(join(directory, name));
  await writeRecord(join(directory, 'status.json'), { kind: 'starting', pid: process.pid });
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const readyWait = startTimerService(directory, { cwd: directory, agentDir: directory, args: [] });
  const readyRejected = expect(readyWait).rejects.toThrow('Timer service startup timed out.');
  await delay(50);
  clock.mockReturnValue(now + 30001);
  await readyRejected;
  clock.mockReturnValue(now);
  const commandWait = timerCommand(directory, { type: 'list' });
  const commandRejected = expect(commandWait).rejects.toThrow('Timer command timed out: list');
  await delay(50);
  clock.mockReturnValue(now + 45001);
  await commandRejected;
  expect(await readdir(join(directory, 'commands'))).toHaveLength(1);
});

test('uncanceled routine disable retains its timeout and durable request', async () => {
  const root = await fixture();
  const draft = await prepareRoutine(root, input);
  await writeRecord(join(draft.directory, 'status.json'), { kind: 'ready', pid: process.pid });
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const waiting = disableRoutine(draft.directory);
  const rejected = expect(waiting).rejects.toThrow('Routine disable timed out. The disable request remains persisted.');
  await delay(50);
  clock.mockReturnValue(now + 45001);
  await rejected;
  expect(await routineRecord(join(draft.directory, 'disable.json'))).toHaveProperty('requestedAt');
});

test('routine clients preserve reconciliation and invalid-record errors', async () => {
  const root = await fixture();
  const launch = { cwd: root, agentDir: root, args: [] };
  await expect(inspectRoutine(join(root, 'missing'))).rejects.toThrow('Routine draft is missing.');
  const draft = await prepareRoutine(root, input);
  await writeRecord(join(draft.directory, 'status.json'), { kind: 'ready', pid: process.pid });
  expect(await startRoutine(draft.directory, draft.revision, launch)).toMatchObject({ kind: 'ready', revision: draft.revision });
  await writeRecord(join(draft.directory, 'status.json'), { kind: 'ready', pid: 2147483647 });
  expect(await inspectRoutine(draft.directory)).toMatchObject({ kind: 'failed', error: expect.stringContaining('Supervisor exited') });
  await expect(disableRoutine(draft.directory)).rejects.toThrow('Disable is persisted');
  expect(await routineRecord(join(draft.directory, 'disable.json'))).toHaveProperty('requestedAt');
  await mkdir(join(draft.directory, 'owner'));
  await expect(startRoutine(draft.directory, draft.revision, launch)).rejects.toThrow('Routine already has an owner');
  await writeRecord(join(draft.directory, 'definition.json'), { ...input, revision: 'changed', trigger: { type: 'webhook' } });
  await expect(inspectRoutine(draft.directory)).rejects.toThrow('Routine revision changed');
  await writeFile(join(draft.directory, 'definition.json'), '{');
  await expect(inspectRoutine(draft.directory)).rejects.toThrow(SyntaxError);
});

test('a real routine startup failure remains visible instead of advertising readiness', async () => {
  const root = await fixture();
  const draft = await prepareRoutine(root, input);
  await expect(startRoutine(draft.directory, draft.revision, { cwd: root, agentDir: root, args: [] })).rejects.toThrow('Routine service unavailable');
  expect(await inspectRoutine(draft.directory)).toMatchObject({ kind: 'failed' });
}, 10000);

test('canceling real timer startup abandons only the caller wait', async () => {
  const directory = await fixture();
  onTestFinished(() => timerCommand(directory, { type: 'shutdown' }).catch(() => {}));
  const launch = {
    cwd: process.cwd(),
    agentDir: join(directory, 'agent'),
    args: ['--no-extensions', '--no-skills', '--no-prompt-templates', '-e', join(process.cwd(), 'test/journey-provider.ts'), '--provider', 'journey-test', '--model', 'recorder', '--session-dir', join(directory, 'session')],
  };
  const controller = new AbortController();
  const waiting = startTimerService(directory, launch, controller.signal);
  const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  await expect.poll(() => timerRecord(join(directory, 'launch.json'))).toBeDefined();
  controller.abort();
  await rejected;
  await expect.poll(async () => (await routineRecord(join(directory, 'status.json')))?.kind, { timeout: 15000 }).toBe('ready');
  expect(await timerCommand(directory, { type: 'list' })).toEqual([]);
  const id = randomUUID();
  const command = { type: 'subscribe', timer: { name: 'accepted-after-abort', prompt: 'check', delaySeconds: 60, runImmediately: false } } satisfies {
    type: 'subscribe';
    timer: { name: string; prompt: string; delaySeconds: number; runImmediately: boolean };
  };
  const commandController = new AbortController();
  const commandWait = timerCommand(directory, command, id, commandController.signal);
  const commandRejected = expect(commandWait).rejects.toMatchObject({ name: 'AbortError' });
  await expect.poll(() => timerRecord(join(directory, 'commands', `${id}.json`)), { interval: 1 }).toBeDefined();
  commandController.abort();
  await commandRejected;
  await expect.poll(() => timerRecord(join(directory, 'receipts', `${id}.json`)), { timeout: 15000 }).toMatchObject({ success: true });
  expect(await timerCommand(directory, { type: 'list' })).toMatchObject([{ name: 'accepted-after-abort' }]);
}, 20000);

test('canceling real routine startup leaves its supervisor ready and independently disableable', async () => {
  const root = await fixture();
  const draft = await prepareRoutine(root, { ...input, port: 0 });
  onTestFinished(async () => {
    await disableRoutine(draft.directory).catch(() => {});
  });
  await writeFile(join(draft.directory, 'secrets', 'sender-key'), 'fixture-routine-key-with-at-least-32-bytes', { mode: 0o600 });
  const launch = {
    cwd: root,
    agentDir: join(root, 'agent'),
    args: ['--no-extensions', '--no-skills', '--no-prompt-templates', '-e', join(process.cwd(), 'test/routine-provider.ts'), '--provider', 'journey-test', '--model', 'recorder', '--session-dir', join(draft.directory, 'session')],
  };
  const controller = new AbortController();
  const waiting = startRoutine(draft.directory, draft.revision, launch, controller.signal);
  const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  await expect.poll(() => routineRecord(join(draft.directory, 'approval.json'))).toHaveProperty('revision', draft.revision);
  controller.abort();
  await rejected;
  await expect.poll(async () => (await inspectRoutine(draft.directory)).kind, { timeout: 15000 }).toBe('ready');
  expect(await disableRoutine(draft.directory)).toMatchObject({ kind: 'disabled' });
}, 20000);
