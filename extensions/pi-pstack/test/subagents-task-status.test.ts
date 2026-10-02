import { expect, test } from 'vitest';
import { type AgentNode, repairInterrupted, restoreNodes } from '../src/subagents/agent-node.ts';
import { acceptsMessages, canTransition, isTerminal, moveTo, type TaskStatus, transitionBetween } from '../src/subagents/task-status.ts';

function node(overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    id: 'a1',
    registryId: 'r1',
    toolCallId: 'call-1',
    agentType: 'explore',
    agentDisplayName: 'alpha',
    agentDescription: 'Explore',
    description: 'find files',
    prompt: 'look',
    mode: 'background',
    status: 'running',
    depth: 1,
    turns: [],
    startedAt: 1,
    model: 'p/m',
    modelSource: 'session_inheritance',
    taskModelSource: 'unset',
    contextTier: 'inherit',
    firstDispatchedModel: 'p/m',
    totalToolCalls: 0,
    totalTokens: 0,
    sessionFile: '/s.jsonl',
    cwd: '/repo',
    ...overrides,
  };
}

test.for([
  { from: 'running', to: 'idle', allowed: true },
  { from: 'running', to: 'completed', allowed: true },
  { from: 'running', to: 'failed', allowed: true },
  { from: 'running', to: 'cancelled', allowed: true },
  { from: 'idle', to: 'running', allowed: true },
  { from: 'idle', to: 'cancelled', allowed: true },
  { from: 'idle', to: 'completed', allowed: false },
  { from: 'idle', to: 'failed', allowed: false },
  { from: 'completed', to: 'running', allowed: false },
  { from: 'failed', to: 'idle', allowed: false },
  { from: 'cancelled', to: 'running', allowed: false },
] satisfies { from: TaskStatus; to: TaskStatus; allowed: boolean }[])('$from to $to is allowed: $allowed', ({ from, to, allowed }) => {
  expect(canTransition(from, to)).toBe(allowed);
});

test.for([
  { status: 'running', terminal: false },
  { status: 'idle', terminal: false },
  { status: 'completed', terminal: true },
  { status: 'failed', terminal: true },
  { status: 'cancelled', terminal: true },
] satisfies { status: TaskStatus; terminal: boolean }[])('$status terminal is $terminal', ({ status, terminal }) => {
  expect(isTerminal(status)).toBe(terminal);
});

test('moveTo returns a new node and refuses an impossible edge', () => {
  const before = node();
  const after = moveTo(before, 'idle');
  expect({ before: before.status, after: after.status }).toEqual({ before: 'running', after: 'idle' });
  expect(() => moveTo(node({ status: 'completed' }), 'running')).toThrow('Agent a1 cannot move from completed to running.');
});

test.for([
  { overrides: { status: 'running', mode: 'background' }, expected: true },
  { overrides: { status: 'idle', mode: 'background' }, expected: true },
  { overrides: { status: 'idle', mode: 'background', retired: true }, expected: false },
  { overrides: { status: 'running', mode: 'sync' }, expected: false },
  { overrides: { status: 'failed', mode: 'background' }, expected: false },
  { overrides: { status: 'cancelled', mode: 'background' }, expected: false },
] satisfies { overrides: Partial<AgentNode>; expected: boolean }[])('write_agent accepts $expected for $overrides', ({ overrides, expected }) => {
  expect(acceptsMessages(node(overrides))).toBe(expected);
});

test('a first sighting is a registration and an unchanged status is no transition', () => {
  expect(transitionBetween('a', undefined, node())).toEqual({ id: 'a', from: 'registered', to: 'running' });
  expect(transitionBetween('a', node(), node())).toBe(undefined);
  expect(transitionBetween('a', node(), node({ status: 'idle' }))).toEqual({ id: 'a', from: 'running', to: 'idle' });
});

test('restoring keeps the last entry per id and ignores foreign or invalid entries', () => {
  const restored = restoreNodes([
    { type: 'custom', customType: 'copilot-agent', data: node({ turns: [] }) },
    { type: 'custom', customType: 'copilot-agent', data: node({ status: 'idle', turns: ['done'] }) },
    { type: 'custom', customType: 'other', data: node({ id: 'z' }) },
    { type: 'custom', customType: 'copilot-agent', data: { id: 'broken' } },
    { type: 'message' },
  ]);
  expect([...restored.keys()]).toEqual(['a1']);
  expect(restored.get('a1')).toMatchObject({ status: 'idle', turns: ['done'] });
});

test('repair closes running nodes as cancelled and retires idle ones', () => {
  const nodes = new Map([
    ['a', node({ id: 'a', status: 'running' })],
    ['b', node({ id: 'b', status: 'idle', turns: ['x'] })],
    ['c', node({ id: 'c', status: 'completed' })],
  ]);
  const { nodes: repaired, closed, dangling } = repairInterrupted(nodes, 99);
  expect({ closed, dangling }).toEqual({ closed: ['a'], dangling: ['b'] });
  expect(repaired.get('a')).toMatchObject({ status: 'cancelled', cancelled: true, endedAt: 99, error: 'Parent session ended before the agent finished.' });
  expect(repaired.get('b')).toMatchObject({ status: 'idle', retired: true });
  expect(repaired.get('c')).toMatchObject({ status: 'completed' });
  expect(nodes.get('a')?.status).toBe('running');
});
