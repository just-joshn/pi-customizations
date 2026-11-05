import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { createSubagentRegistry } from '../src/task/registry.ts';
import type { ChildOutcome } from '../src/task/runner.ts';

const notice = { title: 't', description: 'd', toolCallId: 'c1', mode: 'json' as const, detailFor: () => ({ status: 'success' as const, detail: 'x' }) };
const json = { mode: 'json' } as ExtensionContext;

test('a one-shot run holds its exit for a running background subagent, unless the run was aborted (TASK-003; review r2: architecture)', async () => {
  const registry = createSubagentRegistry({ sendMessage: () => undefined } as unknown as ExtensionAPI);
  registry.track('11111111-2222-4333-8444-555555555555', { done: new Promise<ChildOutcome>(() => undefined), kill: () => undefined, stop: () => undefined, pid: 1 }, () => undefined, notice);
  let completedSettled = false;
  void registry.beforeSettle(json, 'completed', []).then(() => {
    completedSettled = true;
  });
  const aborted = await registry.beforeSettle(json, 'aborted', []);
  expect([aborted, completedSettled]).toEqual([undefined, false]);
});

test('a settle-time Task notice appends after entries another extension proposed at the boundary', async () => {
  const registry = createSubagentRegistry({ sendMessage: () => undefined } as unknown as ExtensionAPI);
  registry.track(
    '11111111-2222-4333-8444-555555555555',
    {
      done: Promise.resolve({ finalText: 'done', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stderr: '' }),
      kill: () => undefined,
      stop: () => undefined,
      pid: 1,
    },
    () => undefined,
    notice,
  );
  const earlier = { type: 'custom_message' as const, customType: 'earlier', content: 'keep me', display: true };
  const result = await registry.beforeSettle(json, 'completed', [earlier]);
  expect(result?.entries?.[0]).toEqual(earlier);
  expect(result?.entries?.[1]).toMatchObject({ customType: 'pstack/task' });
});
