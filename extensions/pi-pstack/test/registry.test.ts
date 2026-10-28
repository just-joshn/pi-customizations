import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { createSubagentRegistry } from '../src/task/registry.ts';
import type { ChildOutcome } from '../src/task/runner.ts';

const notice = { title: 't', toolCallId: 'c1', mode: 'json' as const, detailFor: () => ({ status: 'success' as const, detail: 'x' }) };
const json = { mode: 'json' } as ExtensionContext;

test('a one-shot run holds its exit for a running background subagent, unless the run was aborted (TASK-003; review r2: architecture)', async () => {
  const registry = createSubagentRegistry({ sendMessage: () => undefined } as unknown as ExtensionAPI);
  registry.track('11111111-2222-4333-8444-555555555555', { done: new Promise<ChildOutcome>(() => undefined), kill: () => undefined, stop: () => undefined, steer: async () => undefined, pid: 1 }, () => undefined, false, notice);
  let completedSettled = false;
  void registry.beforeSettle(json, 'completed').then(() => {
    completedSettled = true;
  });
  const aborted = await registry.beforeSettle(json, 'aborted');
  expect([aborted, completedSettled]).toEqual([undefined, false]);
});
