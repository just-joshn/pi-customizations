import { expect, test } from 'vitest';
import type { AgentDefinition } from '../src/subagents/agent-definition.ts';
import { type AgentGates, offeredAgents, type RegistryInputs, resolveAgentType } from '../src/subagents/agent-registry.ts';
import { parseCustomAgent } from '../src/subagents/custom-agents.ts';

const gates: AgentGates = { rubberDuck: true, subconscious: false };
const inputs = (overrides: Partial<RegistryInputs> = {}): RegistryInputs => ({ custom: [], policy: {}, disabled: [], gates, ...overrides });

function custom(name: string, extra = '', source: AgentDefinition['source'] = 'project'): AgentDefinition {
  const parsed = parseCustomAgent(`---\nname: ${name}\ndescription: ${name} agent\n${extra}---\nBody for ${name}.\n`, { source, path: `/repo/.github/agents/${name}.agent.md` });
  if (!parsed.agent) throw new Error(parsed.error);
  return parsed.agent;
}

test('the offered built-ins hide gated agents until their gate opens', () => {
  expect(offeredAgents(inputs()).map((agent) => agent.name)).toEqual(['code-review', 'explore', 'general-purpose', 'research', 'rubber-duck', 'security-review', 'task']);
  expect(offeredAgents(inputs({ gates: { rubberDuck: false, subconscious: true } })).map((agent) => agent.name)).toEqual(['code-review', 'explore', 'general-purpose', 'rem-agent', 'research', 'security-review', 'task']);
});

test('an unknown type fails with the valid list', () => {
  expect(resolveAgentType('nope', inputs())).toEqual({
    ok: false,
    message: 'Unknown agent_type: nope. Valid types are: code-review, explore, general-purpose, research, rubber-duck, security-review, task',
  });
});

test('a gated-off built-in is reported as unknown', () => {
  const result = resolveAgentType('rem-agent', inputs());
  expect(result.ok).toBe(false);
  expect(result.ok ? '' : result.message).toMatch(/^Unknown agent_type: rem-agent\. Valid types are: /);
});

test('an excluded built-in names the session configuration', () => {
  expect(resolveAgentType('research', inputs({ policy: { excluded: ['research'] } }))).toEqual({ ok: false, message: "Subagent 'research' is excluded by this session's configuration." });
});

test('a built-in missing from the included list names the session configuration', () => {
  expect(resolveAgentType('task', inputs({ policy: { included: ['explore'] } }))).toEqual({ ok: false, message: "Subagent 'task' is not included by this session's configuration." });
});

test('a custom agent with the name of an excluded built-in is dispatchable', () => {
  const result = resolveAgentType('research', inputs({ policy: { excluded: ['research'] }, custom: [custom('research')] }));
  expect(result.ok ? result.agent.source : result.message).toBe('project');
});

test('a disabled subagent refuses with the /subagents hint', () => {
  expect(resolveAgentType('explore', inputs({ disabled: ['explore'] }))).toEqual({ ok: false, message: "Subagent 'explore' is disabled. Enable it in /subagents before dispatching it." });
});

test('disabling a built-in that cannot be disabled changes nothing', () => {
  expect(resolveAgentType('general-purpose', inputs({ disabled: ['general-purpose'] })).ok).toBe(true);
  expect(offeredAgents(inputs({ disabled: ['general-purpose', 'task'] })).map((agent) => agent.name)).toEqual(['code-review', 'explore', 'general-purpose', 'research', 'rubber-duck', 'security-review']);
});

test('a custom agent can be disabled', () => {
  expect(resolveAgentType('mine', inputs({ custom: [custom('mine')], disabled: ['mine'] }))).toEqual({ ok: false, message: "Subagent 'mine' is disabled. Enable it in /subagents before dispatching it." });
});

test('a model-invocation-disabled custom agent is refused and unlisted', () => {
  const agent = custom('manual', 'disable-model-invocation: true\n');
  expect(offeredAgents(inputs({ custom: [agent] })).map((entry) => entry.name)).not.toContain('manual');
  expect(resolveAgentType('manual', inputs({ custom: [agent] }))).toEqual({ ok: false, message: "Subagent 'manual' cannot be invoked by the model. Ask the user to run it directly." });
});

test('a project agent overrides a user agent and a user agent overrides a plugin agent', () => {
  const plugin = custom('dup', 'model: from-plugin\n', 'plugin');
  const user = custom('dup', 'model: from-user\n', 'user');
  const project = custom('dup', 'model: from-project\n', 'project');
  expect(resolveAgentType('dup', inputs({ custom: [project, user, plugin] }))).toMatchObject({ ok: true, agent: { model: 'from-project' } });
  expect(resolveAgentType('dup', inputs({ custom: [plugin, user] }))).toMatchObject({ ok: true, agent: { model: 'from-user' } });
});
