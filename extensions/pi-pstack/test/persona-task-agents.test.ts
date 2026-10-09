import { expect, test } from 'vitest';
import { personaTaskAgents } from '../src/persona-agents.ts';
import { offeredAgents, resolveAgentType, type AgentGates, type RegistryInputs } from '../src/subagents/agent-registry.ts';

const gates: AgentGates = { rubberDuck: true, subconscious: false };
const withPersonas = (): RegistryInputs => ({ custom: personaTaskAgents(), policy: {}, disabled: [], gates });

test('Comment Sicko is an offered lowercase-task agent_type', () => {
  const names = offeredAgents(withPersonas()).map((agent) => agent.name);
  expect(names).toContain('Comment Sicko');
  expect(names).toContain('comment-sicko');
});

test('resolveAgentType accepts Comment Sicko from the persona bridge', () => {
  const result = resolveAgentType('Comment Sicko', withPersonas());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.agent.source).toBe('plugin');
  expect(result.agent.prompt).toContain('Yes... Ha ha ha... Yes!');
  expect(result.agent.prompt).toContain('I hate comments');
});

test('unknown types still list Comment Sicko among valid types once bridged', () => {
  const result = resolveAgentType('not-a-type', withPersonas());
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.message).toContain('Comment Sicko');
  expect(result.message).toMatch(/^Unknown agent_type: not-a-type\. Valid types are: /);
});
