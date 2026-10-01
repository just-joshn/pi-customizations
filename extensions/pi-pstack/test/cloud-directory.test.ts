import { realpath } from 'node:fs/promises';
import { join } from 'node:path';

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test } from 'vitest';
import type { TaskRecord } from '../src/worker-records.ts';
import { prepareWorkerSession } from '../src/worker-support.ts';
import { fixture } from './session-fixture.ts';

async function mainFixture() {
  let context: ExtensionContext | undefined;
  const f = await fixture({
    extensionFactories: [
      (pi) => {
        pi.on('session_start', (_event, ctx) => {
          context = ctx;
        });
      },
    ],
  });
  onTestFinished(() => f.close());
  const { manager } = await f.open();
  if (!context) throw new Error('Main fixture context was not captured');
  const params = { prompt: 'Not executed', model: 'pstack-integration/scripted', cwd: f.cwd };
  const base = join(manager.getSessionDir(), 'pstack-workers', manager.getSessionId());
  const prior: TaskRecord = {
    id: 'task-one',
    persona: 'generalPurpose',
    cwd: await realpath(f.cwd),
    readonly: false,
    sessionFile: manager.getSessionFile() ?? '',
    outputFile: join(base, 'output.txt'),
    status: 'settled',
    output: '',
    modelReference: 'pstack-integration/scripted',
  };
  return { f, context, params, base, prior };
}

test('detached preparations use task-owned directories without launching sessions', async () => {
  const { f, context, params, base } = await mainFixture();
  const one = await prepareWorkerSession({ id: 'task-one', params, prior: undefined, ctx: context }, 'detached');
  const two = await prepareWorkerSession({ id: 'task-two', params, prior: undefined, ctx: context }, 'detached');
  expect(one.dir).toBe(join(base, 'task-one'));
  expect(two.dir).toBe(join(base, 'task-two'));
  expect(f.requests).toEqual([]);
});

test('resume rejects changing a local task to cloud execution', async () => {
  const { f, context, params, prior } = await mainFixture();
  await expect(prepareWorkerSession({ id: prior.id, params: { ...params, environment: 'cloud' }, prior, ctx: context }, 'detached')).rejects.toThrow('Resume must preserve the task execution environment');
  expect(f.requests).toEqual([]);
});

test('resume rejects changing a cloud task to local execution', async () => {
  const { f, context, params, prior, base } = await mainFixture();
  const detached = { ...prior, detached: { directory: join(base, prior.id), invocation: 'fixture', entryCursor: null } };
  await expect(prepareWorkerSession({ id: prior.id, params: { ...params, environment: 'local' }, prior: detached, ctx: context })).rejects.toThrow('Resume must preserve the task execution environment');
  expect(f.requests).toEqual([]);
});

test('local resume retains its existing directory when no environment change is requested', async () => {
  const { f, context, params, prior, base } = await mainFixture();
  expect((await prepareWorkerSession({ id: prior.id, params, prior, ctx: context })).dir).toBe(base);
  expect(f.requests).toEqual([]);
});
