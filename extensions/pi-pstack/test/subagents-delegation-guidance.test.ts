import { expect, test } from 'vitest';
import { builtInAgents } from '../src/subagents/builtin-agents.ts';
import { parseCustomAgent } from '../src/subagents/custom-agents.ts';
import { childSubagentUsageBlock, delegationHeuristics, modelPreferencesBlock, subagentUsageBlock, taskToolDescription, toolHeader } from '../src/subagents/delegation-guidance.ts';

const custom = parseCustomAgent('---\nname: mine\ndescription: Does my thing\n---\nBody\n', { source: 'user', path: '/home/me/.reference-assistant/agents/mine.agent.md' }).agent;

test('the tool description opens with the header and lists built-in then custom agents', () => {
  if (!custom) throw new Error('fixture failed to parse');
  const text = taskToolDescription([builtInAgents[1], custom].flatMap((agent) => (agent ? [agent] : [])));
  expect(text.startsWith('Launch specialized agents in separate context windows for specific tasks.\n\nAvailable agent types:\n- explore: ')).toBe(true);
  expect(text).toContain('Custom agents provided by the user:\n- mine: Does my thing');
  expect(text).toContain('Its result comes back to you as a single message.');
  expect(toolHeader).toBe('Launch specialized agents in separate context windows for specific tasks.');
});

test('the custom section is omitted when the user has no custom agents', () => {
  expect(taskToolDescription(builtInAgents.slice(0, 2))).not.toContain('Custom agents provided by the user');
});

test('the parent usage block carries the five heuristics', () => {
  const block = subagentUsageBlock({ rubberDuck: false, securityReview: false });
  expect(block.startsWith('<subagent_usage>\nDefault to doing the work yourself.')).toBe(true);
  for (const heuristic of delegationHeuristics) expect(block).toContain(`- ${heuristic}`);
  expect(block).toContain('- Use custom agents sparingly.');
});

test('the rubber-duck and security-review guidance appear only when those agents are offered', () => {
  expect(subagentUsageBlock({ rubberDuck: true, securityReview: true })).toContain('Call rubber-duck synchronously after planning and before implementation');
  expect(subagentUsageBlock({ rubberDuck: true, securityReview: true })).toContain('When you call security-review');
  expect(subagentUsageBlock({ rubberDuck: false, securityReview: false })).not.toContain('rubber-duck');
});

test('the child block repeats three of the parent bullets and the nested delegation line', () => {
  const block = childSubagentUsageBlock();
  expect(block.match(/^- /gm)).toHaveLength(3);
  expect(block).toContain("As a sub-agent, complete your parent's task yourself");
});

test('model preferences list configured models and tell the parent not to copy them', () => {
  expect(modelPreferencesBlock({ explore: { model: 'gpt-6-luna', modelPolicy: 'required', effortLevel: 'medium' }, task: { effortLevel: 'low' }, research: { model: 'claude-sonnet-5' } })).toBe(
    '<subagent_model_preferences>\nThe user configured these subagent models in /subagents:\n- explore: gpt-6-luna (required, effort medium)\n- research: claude-sonnet-5 (preferred)\nDo not copy them into task calls unless the user or persistent instructions require an explicit model. Required entries are enforced anyway.\n</subagent_model_preferences>',
  );
});

test('only entries that configure a model are listed and none means no block', () => {
  expect(modelPreferencesBlock({ task: { effortLevel: 'low' }, explore: { model: 'm' } })).toContain('- explore: m (preferred)');
  expect(modelPreferencesBlock({ task: { effortLevel: 'low' } })).toBe(undefined);
});
