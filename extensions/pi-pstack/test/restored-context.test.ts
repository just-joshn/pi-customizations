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
  expect(restoredContext([])).toEqual({
    appendedPrompt: undefined,
    inheritedDefinitions: undefined,
    agentId: undefined,
    ownWorktree: undefined,
    depth: 0,
    allowedAgentTypes: undefined,
    invalidScope: false,
  });
});

test('the latest saved value of each context entry wins', () => {
  const branch = [
    custom('pstack-agent-identity', 'old-agent'),
    custom('pstack-agent-identity', 'agent-7'),
    custom('pstack-agent-depth', 2),
    custom('pstack-agent-worktree', '/work/tree'),
    custom('pstack-append-subagent-system-prompt', 'extra rules'),
    custom('pstack-agent-definition-overrides', '{"a":{}}'),
    custom('pstack-agent-allowed-types', ['reviewer', 'explorer']),
  ];
  expect(restoredContext(branch)).toEqual({
    appendedPrompt: 'extra rules',
    inheritedDefinitions: '{"a":{}}',
    agentId: 'agent-7',
    ownWorktree: '/work/tree',
    depth: 2,
    allowedAgentTypes: ['reviewer', 'explorer'],
    invalidScope: false,
  });
});

test.for([
  { name: 'a null scope allows every type', data: null, allowed: undefined, invalid: false },
  { name: 'a scope with a non-string entry permits no child type', data: ['reviewer', 3], allowed: [], invalid: true },
  { name: 'a scope that is not a list permits no child type', data: 'reviewer', allowed: [], invalid: true },
])('$name', ({ data, allowed, invalid }) => {
  const restored = restoredContext([custom('pstack-agent-allowed-types', data)]);
  expect(restored.allowedAgentTypes).toEqual(allowed);
  expect(restored.invalidScope).toBe(invalid);
});

test.for([{ depth: 0 }, { depth: -1 }, { depth: 1.5 }, { depth: 'two' }])('a saved depth of $depth restores as zero', ({ depth }) => {
  expect(restoredContext([custom('pstack-agent-depth', depth)]).depth).toBe(0);
});
