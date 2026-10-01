import { expect, test } from 'vitest';
import type { AgentDefinition } from '../src/subagents/definitions.ts';
import { toolAllowList } from '../src/subagents/tool-pool.ts';
import { agentTypeScope, hasUnsupportedToolScope } from '../src/subagents/tool-specs.ts';
import { workerFixture } from './worker-fixture.ts';

const all = ['read', 'bash', 'Agent', 'Task'];
const def = (extra: Partial<AgentDefinition>): AgentDefinition => ({ agentType: 't', whenToUse: '', systemPrompt: '', source: 'userSettings', baseDir: '/', ...extra }) as AgentDefinition;

test.for([
  { tools: ['Task(Plan, Explore)'], expected: ['Plan', 'Explore'] },
  { tools: ['task(Plan)', 'Agent(Explore)'], expected: ['Plan', 'Explore'] },
  { tools: ['Task'], expected: undefined },
])('Task(...) is the legacy spelling of an Agent(...) scope: $tools', ({ tools, expected }) => {
  expect(agentTypeScope(tools)).toEqual(expected);
});

test('Task(...) scopes are supported tool rules, unlike other argument scopes', () => {
  expect([hasUnsupportedToolScope('Task(Plan)'), hasUnsupportedToolScope('Bash(git:*)')]).toEqual([false, true]);
});

test.for([
  { rule: { tools: ['Task'] }, expected: ['Agent'] },
  { rule: { tools: ['Task(Plan)'] }, expected: ['Agent'] },
  { rule: { disallowedTools: ['Task'] }, expected: ['read', 'bash'] },
  { rule: { disallowedTools: ['Agent'] }, expected: ['read', 'bash'] },
])('the legacy Task name resolves to Agent and denying either removes both: $rule', ({ rule, expected }) => {
  expect(toolAllowList(def(rule), all)).toEqual(expected);
});

test('a Task call carrying the Agent contract launches through the Agent launcher', async () => {
  const fixture = await workerFixture();
  try {
    await fixture.session.prompt('LEGACY_TASK_AGENT_CONTRACT');
    const result = fixture.session.messages.find((message) => message.role === 'toolResult' && message.toolCallId === 'legacy-alias');
    expect(result).toMatchObject({ toolName: 'Task', isError: false, details: { status: 'completed', agentType: 'Explore', prompt: 'hello' } });
    expect(((await fixture.call('ListAgents', {})) as { details: unknown }).details).toMatchObject({ agents: [{ agentType: 'Explore', description: 'legacy alias child' }] });
  } finally {
    await fixture.close();
  }
});

test('a Task call naming a Cursor persona keeps the Cursor Task contract even with a description', async () => {
  const fixture = await workerFixture();
  try {
    const done = (await fixture.call('Task', { description: 'cursor persona', prompt: 'hello', subagent_type: 'generalPurpose', run_in_background: false })) as { details: Record<string, unknown> };
    expect(done.details).toMatchObject({ persona: 'generalPurpose', status: 'settled' });
  } finally {
    await fixture.close();
  }
});
