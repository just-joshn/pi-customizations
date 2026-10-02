import { expect, test } from 'vitest';
import type { AgentNode } from '../src/subagents/agent-node.ts';
import { completedData, failedData, initialNode, startedData, usageOf, viewOf } from '../src/subagents/agent-records.ts';
import type { ChildPlan } from '../src/subagents/context-builder.ts';

function node(overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    id: 'a1',
    registryId: 'r1',
    toolCallId: 'c1',
    agentType: 'explore',
    agentDisplayName: 'alpha',
    agentDescription: 'Explores the codebase',
    description: 'Look around',
    prompt: 'p',
    mode: 'sync',
    status: 'running',
    depth: 1,
    turns: [],
    startedAt: 1000,
    model: 'prov/m',
    modelSource: 'runtime_policy',
    taskModelSource: 'unset',
    contextTier: 'inherit',
    firstDispatchedModel: 'prov/m',
    totalToolCalls: 3,
    totalTokens: 40,
    sessionFile: '/sessions/agent-a1.jsonl',
    cwd: '/repo',
    ...overrides,
  };
}

test('a failed node reports its error and falls back when none was recorded', () => {
  expect(failedData(node({ status: 'failed', error: 'boom' }))).toMatchObject({ error: 'boom', agentName: 'explore', totalToolCalls: 3, totalTokens: 40 });
  expect(failedData(node({ status: 'failed' })).error).toBe('Unknown error');
});

test('a cancelled completion carries the cancelled flag while a plain one omits it', () => {
  expect(completedData(node({ status: 'completed', endedAt: 2500 }))).toMatchObject({ durationMs: 1500 });
  expect(completedData(node({ status: 'cancelled', cancelled: true }))).toMatchObject({ cancelled: true });
});

test('started facts carry the parent link and workflow identifiers only when present', () => {
  expect(startedData(node({ parentRegistryId: 'parent-1', workflowRunId: 'run-9' }))).toMatchObject({
    parentId: 'parent-1',
    workflowRunId: 'run-9',
    factoryRunId: 'run-9',
    agentType: 'explore',
    executionMode: 'sync',
  });
  const bare = startedData(node());
  expect(bare).not.toHaveProperty('parentId');
  expect(bare).not.toHaveProperty('workflowRunId');
  expect(bare).not.toHaveProperty('factoryRunId');
});

test('a finished node reports provenance from the model it first dispatched', () => {
  const finished = failedData(
    node({
      status: 'failed',
      endedAt: 4000,
      model: 'prov/actual',
      firstDispatchedModel: 'prov/first',
      configuredModel: 'prov/preferred',
      requestedModel: 'prov/asked',
      overrideReason: 'preference unavailable',
    }),
  );
  expect(finished).toMatchObject({
    durationMs: 3000,
    model: 'prov/actual',
    firstDispatchedModel: 'prov/first',
    configuredModelPreference: 'prov/preferred',
    explicitModelOverride: 'prov/asked',
    modelOverrideReason: 'preference unavailable',
    configuredModelMatchesActual: false,
  });
});

test('a view uses the end time when present and the supplied clock otherwise', () => {
  expect(viewOf(node({ status: 'completed', endedAt: 3500 }), 9000).elapsedMs).toBe(2500);
  expect(viewOf(node({ status: 'running' }), 3000).elapsedMs).toBe(2000);
  expect(viewOf(node({ status: 'failed', error: 'x' }), 3000).error).toBe('x');
});

test('session statistics become the usage a tool result reports', () => {
  expect(usageOf({ tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 }, cost: 0.5 } as never)).toEqual({
    input: 1,
    output: 2,
    cacheRead: 3,
    cacheWrite: 4,
    totalTokens: 10,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 },
  });
});

const selection = {
  model: { reference: 'p/m', provider: 'p', id: 'm', cost: 1, contextWindow: 1 },
  source: 'runtime_policy',
  taskSource: 'unset',
  contextTier: 'inherit',
  effort: 'high',
  configured: 'p/c',
  requested: 'p/r',
  overrideReason: 'required_policy_replaced_request',
  firstDispatched: 'p/f',
} as const;

function plan(overrides: Partial<ChildPlan> = {}): ChildPlan {
  return {
    agentId: 'a1',
    registryId: 'r1',
    rootSessionId: 's1',
    definition: { name: 'explore', description: 'Explores' },
    selection,
    mode: 'sync',
    prompt: { text: 'body', mode: 'append', sections: [] },
    userMessage: 'do it',
    tools: { declared: ['*'], effective: ['read'], unmatched: [] },
    contextFiles: false,
    skills: [],
    mcpServers: [],
    identity: {},
    limits: {},
    cwd: '/repo',
    effects: [],
    writeGate: () => true,
    ...overrides,
  } as unknown as ChildPlan;
}

test('a new node carries the plan identity and every selection override it was given', () => {
  const node = initialNode(plan({ parentRegistryId: 'parent-r' }), { toolCallId: 'c1', description: 'desc', name: 'alpha', depth: 2, now: 1000 });
  expect(node).toMatchObject({
    id: 'a1',
    registryId: 'r1',
    parentRegistryId: 'parent-r',
    toolCallId: 'c1',
    agentType: 'explore',
    agentDisplayName: 'alpha',
    agentDescription: 'Explores',
    description: 'desc',
    prompt: 'do it',
    mode: 'sync',
    status: 'running',
    depth: 2,
    startedAt: 1000,
    model: 'p/m',
    modelSource: 'runtime_policy',
    taskModelSource: 'unset',
    contextTier: 'inherit',
    effort: 'high',
    firstDispatchedModel: 'p/f',
    configuredModel: 'p/c',
    requestedModel: 'p/r',
    overrideReason: 'required_policy_replaced_request',
    totalToolCalls: 0,
    totalTokens: 0,
    sessionFile: '',
    cwd: '/repo',
  });
  expect(initialNode(plan(), { toolCallId: 'c2', description: 'd', name: 'n', depth: 1, now: 0 })).not.toHaveProperty('parentRegistryId');
});
