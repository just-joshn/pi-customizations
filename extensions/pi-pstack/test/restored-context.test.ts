import type { SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { restoredContext } from '../src/subagents/restored-context.ts';

type Entry = ReturnType<SessionManager['getBranch']>[number];

let sequence = 0;
function custom(customType: string, data: unknown): Entry {
  sequence += 1;
  return { type: 'custom', id: `entry-${sequence}`, parentId: null, timestamp: '2026-01-01T00:00:00.000Z', customType, data };
}

test('an empty branch restores no identity and depth zero', () => {
  expect(restoredContext([])).toEqual({ agentId: undefined, depth: 0 });
});

test('the latest saved value of each context entry wins', () => {
  const branch = [custom('pstack-agent-identity', 'old-agent'), custom('pstack-agent-identity', 'agent-7'), custom('pstack-agent-depth', 1), custom('pstack-agent-depth', 2)];
  expect(restoredContext(branch)).toEqual({ agentId: 'agent-7', depth: 2 });
});

test.for([{ depth: 0 }, { depth: -1 }, { depth: 1.5 }, { depth: 'two' }])('a saved depth of $depth restores as zero', ({ depth }) => {
  expect(restoredContext([custom('pstack-agent-depth', depth)]).depth).toBe(0);
});

test('a non-string identity restores as undefined', () => {
  expect(restoredContext([custom('pstack-agent-identity', 7)]).agentId).toBe(undefined);
});
