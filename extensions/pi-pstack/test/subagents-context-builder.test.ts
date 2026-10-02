import { expect, test } from 'vitest';
import { resolveAgentType } from '../src/subagents/agent-registry.ts';
import { buildChildPlan, creationEffects, datetimeTag, identityHeaders, missingField } from '../src/subagents/context-builder.ts';

const environment = { cwd: '/repo', os: 'Darwin', tools: ['git'] };
const toolNames = { grep: 'grep', glob: 'find', shell: 'bash', view: 'read' };
const selection = { model: { reference: 'p/m', provider: 'p', id: 'm', cost: 1, contextWindow: 1 }, source: 'session_inheritance', taskSource: 'unset', contextTier: 'inherit', firstDispatched: 'p/m' } as const;

function definition(name = 'explore') {
  const resolved = resolveAgentType(name, { custom: [], policy: {}, disabled: [], gates: { rubberDuck: true, subconscious: true } });
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.agent;
}

function plan(overrides: Partial<Parameters<typeof buildChildPlan>[0]> = {}) {
  return buildChildPlan({
    definition: definition(),
    selection,
    settings: {
      subagents: { agents: {}, disabledSubagents: [], contextManagementTools: false },
      builtInAgents: { rubberDuck: true, rubberDuckAutoInvoke: true },
      workflows: { maxConcurrentRuns: 4, logPhaseNames: false, defaultLimits: {} },
    },
    agentId: 'a1',
    registryId: 'r1',
    parentAgentId: 'root',
    rootSessionId: 's1',
    cwd: '/repo',
    prompt: 'do it',
    mode: 'sync',
    tools: { declared: ['*'], effective: ['read'], unmatched: [] },
    toolNames,
    environment,
    now: new Date(0),
    headless: false,
    ...overrides,
  });
}

test('a plan carries the user message with the datetime tag and the identity headers', () => {
  const built = plan();
  expect(built.userMessage.startsWith(`${datetimeTag(new Date(0))}\n\ndo it`)).toBe(true);
  expect(built.identity).toEqual({ 'X-Interaction-Type': 'conversation-subagent', 'X-Agent-Task-Id': 'a1', 'X-Parent-Agent-Id': 'root', 'X-Client-Session-Id': 's1' });
  expect(identityHeaders({ agentId: 'a', parentAgentId: 'b', rootSessionId: 'c' })).toEqual({ 'X-Interaction-Type': 'conversation-subagent', 'X-Agent-Task-Id': 'a', 'X-Parent-Agent-Id': 'b', 'X-Client-Session-Id': 'c' });
  expect(built.effects).toEqual(creationEffects);
});

test('a hook context is prepended to the prompt', () => {
  expect(plan({ hookContext: 'Team rules apply.' }).userMessage).toContain('Team rules apply.\n\ndo it');
});

test.for([
  { label: 'the agent id', overrides: { agentId: '' }, field: 'agentId' },
  { label: 'the registry id', overrides: { registryId: '' }, field: 'registryId' },
  { label: 'the root session id', overrides: { rootSessionId: '' }, field: 'rootSessionId' },
  { label: 'the cwd', overrides: { cwd: '' }, field: 'cwd' },
])('a plan missing $label fails with the required field message', ({ overrides, field }) => {
  expect(() => plan(overrides)).toThrow(`subagent creation plan is missing required field: ${field}`);
});

test('missingField names the first empty required field', () => {
  expect(missingField({ agentId: '', registryId: 'r', rootSessionId: 's', cwd: 'c', prompt: { text: 'x', mode: 'append', sections: [] } })).toBe('agentId');
});
