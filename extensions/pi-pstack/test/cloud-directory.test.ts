import { join } from 'node:path';

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { prepareWorkerSession } from '../src/worker-support.ts';
import { fixture } from './session-fixture.ts';

test('detached preparations use task-owned directories without launching sessions', async () => {
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
  try {
    const { manager } = await f.open();
    if (!context) throw new Error('Main fixture context was not captured');
    const params = { prompt: 'Not executed', model: 'pstack-integration/scripted', cwd: f.cwd };
    const one = await prepareWorkerSession({ id: 'task-one', params, prior: undefined, ctx: context }, 'detached');
    const two = await prepareWorkerSession({ id: 'task-two', params, prior: undefined, ctx: context }, 'detached');
    const base = join(manager.getSessionDir(), 'pstack-workers', manager.getSessionId());
    expect(one.dir).toBe(join(base, 'task-one'));
    expect(two.dir).toBe(join(base, 'task-two'));
    const prior = {
      id: 'task-one',
      persona: 'generalPurpose',
      cwd: one.cwd,
      readonly: false,
      sessionFile: manager.getSessionFile() ?? '',
      outputFile: join(base, 'output.txt'),
      status: 'settled' as const,
      output: '',
      modelReference: 'pstack-integration/scripted',
    };
    await expect(prepareWorkerSession({ id: prior.id, params: { ...params, environment: 'cloud' }, prior, ctx: context }, 'detached')).rejects.toThrow('Resume must preserve the task execution environment');
    const detached = { ...prior, detached: { directory: one.dir, invocation: 'fixture', entryCursor: null } };
    await expect(prepareWorkerSession({ id: prior.id, params: { ...params, environment: 'local' }, prior: detached, ctx: context })).rejects.toThrow('Resume must preserve the task execution environment');
    expect((await prepareWorkerSession({ id: prior.id, params, prior, ctx: context })).dir).toBe(base);
    expect(f.requests).toEqual([]);
  } finally {
    await f.close();
  }
});
