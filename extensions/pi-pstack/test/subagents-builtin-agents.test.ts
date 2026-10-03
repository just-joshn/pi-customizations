import { expect, test } from 'vitest';
import { allTools, builtInPromptParts, customPromptParts, declaredTools as declaredToolsOf } from '../src/subagents/agent-definition.ts';
import { type AgentGates, type RegistryInputs, resolveAgentType } from '../src/subagents/agent-registry.ts';

const everything: AgentGates = { rubberDuck: true, subconscious: true };
const inputs: RegistryInputs = { custom: [], policy: {}, disabled: [], gates: everything };

function builtIn(name: string) {
  const resolved = resolveAgentType(name, inputs);
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.agent;
}

test('explore declares two candidate models, low effort and a read-only tool list', () => {
  const explore = builtIn('explore');
  expect({ model: explore.model, effort: explore.reasoningEffort }).toEqual({ model: ['gpt-5.6-luna', 'gpt-5.4-mini'], effort: 'low' });
  expect(declaredToolsOf(explore)).toEqual(['grep', 'glob', 'view', 'bash', 'read_bash', 'stop_bash', 'powershell', 'read_powershell', 'stop_powershell', 'lsp', 'github-mcp-server/*', 'bluebird/*']);
});

test('the explore prompt opens with the exploration sentence', () => {
  expect(builtIn('explore').prompt.split('\n')[0]).toBe('You are an exploration agent. Answer the question as fast as possible, then stop.');
});

test('task lists three candidate models and every tool', () => {
  const task = builtIn('task');
  expect({ model: task.model, tools: declaredToolsOf(task) }).toEqual({ model: ['gpt-5.6-luna', 'gpt-5.4-mini', 'claude-haiku-4.5'], tools: ['*'] });
});

test('research pins a single model string', () => {
  expect(builtIn('research').model).toBe('claude-sonnet-5');
});

test('custom agents inherit every built-in prompt part except their own instructions', () => {
  expect(customPromptParts).toEqual({ ...builtInPromptParts, includeCustomAgentInstructions: true });
  expect(allTools).toEqual({ kind: 'all' });
});

test('general-purpose has no model and a prompt that cannot be overridden', () => {
  const general = builtIn('general-purpose');
  expect({ model: general.model, overridable: general.promptOverridable, tools: declaredToolsOf(general) }).toEqual({ model: undefined, overridable: false, tools: ['*'] });
});

test.for(['code-review', 'security-review'])('%s declares no model and every tool', (name) => {
  const agent = builtIn(name);
  expect({ model: agent.model, tools: declaredToolsOf(agent) }).toEqual({ model: undefined, tools: ['*'] });
});

test('rubber-duck takes its model dynamically from a complementary family', () => {
  const duck = builtIn('rubber-duck');
  expect({ model: duck.model, dynamic: duck.dynamicModel }).toEqual({ model: undefined, dynamic: 'complementary' });
});

test('rem-agent has only the context board and its own prompt parts', () => {
  const rem = builtIn('rem-agent');
  expect(declaredToolsOf(rem)).toEqual(['context_board']);
  expect(rem.promptParts).toMatchObject({ includeEnvironmentContext: false, includeParallelToolCalling: false, includeConsolidationPrompt: true, includeAISafety: true, includeToolInstructions: true });
  expect(rem.description).toMatch(/Do not invoke spontaneously/);
});

test.for(['general-purpose', 'explore', 'task', 'code-review', 'security-review', 'research', 'rubber-duck', 'rem-agent'])('%s turns off custom agent instructions and keeps safety text', (name) => {
  expect(builtIn(name).promptParts).toMatchObject({ includeCustomAgentInstructions: false, includeAISafety: true, includeToolInstructions: true });
});

test.for(['general-purpose', 'explore', 'task', 'code-review', 'security-review', 'research', 'rubber-duck'])('%s includes the environment context', (name) => {
  expect(builtIn(name).promptParts.includeEnvironmentContext).toBe(true);
});
