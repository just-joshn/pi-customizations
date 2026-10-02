import { expect, test, vi } from 'vitest';
import { executionSubagent, searchSubagent, specializedEnabled, specializedTurns } from '../src/subagents/specialized-tools.ts';
import { workerFixture } from './worker-fixture.ts';

type Result = { content: { text: string }[]; details: Record<string, unknown> };

test('the specialized tools exist only when their feature flag is on', async () => {
  const off = await workerFixture();
  try {
    expect(off.session.getAllTools().map((tool) => tool.name)).not.toContain('execution_subagent');
  } finally {
    await off.close();
  }
  vi.stubEnv('COPILOT_CLI_ENABLED_FEATURE_FLAGS', 'copilot_cli_execution_subagent');
  const on = await workerFixture();
  try {
    const result = (await on.call('execution_subagent', { description: 'run it', prompt: 'hello' })) as Result;
    expect(result.content[0]?.text).toBe('users=1');
    const names = on.session.getAllTools().map((tool) => tool.name);
    expect(names).toContain('execution_subagent');
    expect(names).not.toContain('search_subagent');
  } finally {
    await on.close();
  }
});

test('the execution subagent stops at its own turn cap and says so', async () => {
  vi.stubEnv('COPILOT_CLI_ENABLED_FEATURE_FLAGS', 'copilot_cli_execution_subagent');
  vi.stubEnv('EXECUTION_SUBAGENT_MAX_TURNS', '1');
  const fixture = await workerFixture();
  try {
    const result = (await fixture.call('execution_subagent', { description: 'run it', prompt: 'TOOL_ONCE' })) as Result;
    expect(result.content[0]?.text).toContain('Note: this agent stopped at its 1-turn limit, so the text above may be partial.');
  } finally {
    await fixture.close();
  }
});

test('the execution subagent takes its model from its own variable, not the task argument', async () => {
  vi.stubEnv('COPILOT_CLI_ENABLED_FEATURE_FLAGS', 'copilot_cli_execution_subagent,copilot_cli_execution_subagent_model');
  vi.stubEnv('EXECUTION_SUBAGENT_MODEL', 'worker-test/alternate');
  const fixture = await workerFixture();
  const seen: unknown[] = [];
  fixture.eventBus.on('copilot:event', (payload) => seen.push(payload));
  try {
    await fixture.call('execution_subagent', { description: 'run it', prompt: 'hello' });
    expect(seen[0]).toMatchObject({ type: 'subagent.started', data: { model: 'worker-test/alternate', modelSelectionSource: 'explicit_override' } });
  } finally {
    await fixture.close();
  }
});

test('the execution model variable is ignored while its own flag is off', async () => {
  vi.stubEnv('COPILOT_CLI_ENABLED_FEATURE_FLAGS', 'copilot_cli_execution_subagent');
  vi.stubEnv('EXECUTION_SUBAGENT_MODEL', 'worker-test/alternate');
  const fixture = await workerFixture();
  const seen: unknown[] = [];
  fixture.eventBus.on('copilot:event', (payload) => seen.push(payload));
  try {
    await fixture.call('execution_subagent', { description: 'run it', prompt: 'hello' });
    expect(seen[0]).toMatchObject({ type: 'subagent.started', data: { model: 'worker-test/deterministic' } });
  } finally {
    await fixture.close();
  }
});

test.for([
  { value: undefined, expected: 30 },
  { value: '12', expected: 12 },
  { value: '0', expected: 30 },
  { value: 'many', expected: 30 },
  { value: '2.5', expected: 30 },
])('EXECUTION_SUBAGENT_MAX_TURNS=$value gives $expected turns', ({ value, expected }) => {
  expect(specializedTurns(value === undefined ? {} : { EXECUTION_SUBAGENT_MAX_TURNS: value }, executionSubagent)).toBe(expected);
});

test('search and execution have separate flags, defaults and agents', () => {
  expect(specializedTurns({}, searchSubagent)).toBe(20);
  expect(specializedEnabled({ COPILOT_EXPERIMENTS: 'copilot_cli_search_subagent_model' }, searchSubagent)).toBe(true);
  expect(specializedEnabled({ COPILOT_EXPERIMENTS: 'copilot_cli_search_subagent_model' }, executionSubagent)).toBe(false);
  expect([executionSubagent.agentType, searchSubagent.agentType]).toEqual(['task', 'explore']);
});
