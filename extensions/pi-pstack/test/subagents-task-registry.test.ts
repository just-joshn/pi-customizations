import { expect, test } from 'vitest';
import type { AgentNode } from '../src/subagents/agent-node.ts';
import { type RegistryChange, TaskRegistry } from '../src/subagents/task-registry.ts';

function node(id: string, overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    id,
    registryId: `r-${id}`,
    toolCallId: `call-${id}`,
    agentType: 'explore',
    agentDisplayName: id,
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

function harness() {
  const persisted: AgentNode[] = [];
  const changes: RegistryChange[] = [];
  const registry = new TaskRegistry({ persist: (saved) => persisted.push(saved) });
  registry.subscribe((change) => changes.push(change));
  return { registry, persisted, changes };
}

test('registering a running node persists it and reports a registration', () => {
  const { registry, persisted, changes } = harness();
  registry.register(node('a'));
  expect(persisted.map((saved) => saved.id)).toEqual(['a']);
  expect(changes).toEqual([{ id: 'a', transition: { id: 'a', from: 'registered', to: 'running' } }]);
  expect(registry.get('a')?.status).toBe('running');
});

test('a duplicate id and a non-running registration are refused', () => {
  const { registry } = harness();
  registry.register(node('a'));
  expect(() => registry.register(node('a'))).toThrow('Agent a is already registered.');
  expect(() => registry.register(node('b', { status: 'idle' }))).toThrow('Agent b must be registered as running, not idle.');
});

test('a transition follows the status machine and carries its fields', () => {
  const { registry, changes } = harness();
  registry.register(node('a'));
  const idle = registry.transition('a', 'idle', { turns: ['done'], endedAt: 5 });
  expect(idle).toMatchObject({ status: 'idle', turns: ['done'], endedAt: 5 });
  expect(changes.at(-1)).toEqual({ id: 'a', transition: { id: 'a', from: 'running', to: 'idle' } });
  registry.transition('a', 'running');
  registry.transition('a', 'cancelled', { cancelled: true });
  expect(() => registry.transition('a', 'running')).toThrow('Agent a cannot move from cancelled to running.');
});

test('a patch changes fields without reporting a transition', () => {
  const { registry, changes } = harness();
  registry.register(node('a'));
  registry.patch('a', { totalTokens: 9 });
  expect(registry.get('a')?.totalTokens).toBe(9);
  expect(changes.at(-1)).toEqual({ id: 'a' });
});

test('unknown ids fail with the not-found message', () => {
  const { registry } = harness();
  expect(() => registry.transition('ghost', 'idle')).toThrow('Agent not found: ghost');
});

test('promote moves a running sync agent to background and refuses anything else', () => {
  const { registry } = harness();
  registry.register(node('a', { mode: 'sync' }));
  registry.register(node('b'));
  expect(registry.promote('a').mode).toBe('background');
  expect(() => registry.promote('b')).toThrow('Agent b is not a running sync agent.');
});

test('progress mutations set intent, count tool calls and record tokens', () => {
  const { registry, changes } = harness();
  registry.register(node('a'));
  registry.mutateProgress('a', { kind: 'intent', intent: 'reading' });
  registry.mutateProgress('a', { kind: 'tool_call' });
  registry.mutateProgress('a', { kind: 'tool_call' });
  registry.mutateProgress('a', { kind: 'executor_telemetry', tokens: 42 });
  expect(registry.get('a')).toMatchObject({ intent: 'reading', totalToolCalls: 2, totalTokens: 42 });
  expect(changes.at(-1)).toEqual({ id: 'a', progress: { kind: 'executor_telemetry', tokens: 42 } });
});

test('children are the nodes whose parent registry id matches', () => {
  const { registry } = harness();
  registry.register(node('root'));
  registry.register(node('kid', { parentRegistryId: 'r-root' }));
  registry.register(node('other'));
  expect(registry.children('r-root').map((child) => child.id)).toEqual(['kid']);
  expect(registry.count('running')).toBe(3);
});

test('an unsubscribed listener hears nothing and remove forgets the node', () => {
  const { registry } = harness();
  const heard: string[] = [];
  const stop = registry.subscribe((change) => heard.push(change.id));
  registry.register(node('a'));
  stop();
  registry.register(node('b'));
  registry.remove('a');
  expect(heard).toEqual(['a']);
  expect(registry.list().map((entry) => entry.id)).toEqual(['b']);
});
