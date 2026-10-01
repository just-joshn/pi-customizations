import { expect, test } from 'vitest';
import { chooseChildModel } from '../src/subagents/models.ts';

const choose = (input: Partial<Parameters<typeof chooseChildModel>[0]>) => chooseChildModel({ fork: false, env: {}, available: [], ...input });

test('family stepping stays on the parent provider', () => {
  const available = ['anthropic/claude-sonnet-5-5', 'amazon-bedrock/us.anthropic.claude-sonnet-4-5', 'amazon-bedrock/us.anthropic.claude-opus-4-6'];
  expect(choose({ toolModel: 'sonnet', available, parent: 'amazon-bedrock/us.anthropic.claude-opus-4-6' })).toEqual({ request: 'amazon-bedrock/us.anthropic.claude-sonnet-4-5', steppedFrom: 'sonnet' });
  expect(choose({ toolModel: 'sonnet', available, parent: 'anthropic/claude-opus-5' })).toEqual({ request: 'anthropic/claude-sonnet-5-5', steppedFrom: 'sonnet' });
});

test('family stepping keeps the parent inference-profile decoration', () => {
  const available = ['amazon-bedrock/anthropic.claude-sonnet-4-5', 'amazon-bedrock/us.anthropic.claude-sonnet-4-5', 'amazon-bedrock/eu.anthropic.claude-sonnet-4-5', 'amazon-bedrock/us.anthropic.claude-sonnet-4'];
  expect(choose({ toolModel: 'sonnet', available, parent: 'amazon-bedrock/eu.anthropic.claude-opus-4-6' }).request).toBe('amazon-bedrock/eu.anthropic.claude-sonnet-4-5');
  expect(choose({ toolModel: 'sonnet', available, parent: 'amazon-bedrock/anthropic.claude-opus-4-6' }).request).toBe('amazon-bedrock/anthropic.claude-sonnet-4-5');
});

test('an Opus selection takes the 1M-context variant when the parent runs one', () => {
  const available = ['anthropic/claude-opus-5', 'anthropic/claude-opus-5[1m]', 'anthropic/claude-sonnet-5[1m]', 'anthropic/claude-sonnet-5'];
  expect(choose({ toolModel: 'opus', available, parent: 'anthropic/claude-sonnet-5[1m]' }).request).toBe('anthropic/claude-opus-5[1m]');
  expect(choose({ toolModel: 'opus', available, parent: 'anthropic/claude-sonnet-5' }).request).toBe('anthropic/claude-opus-5');
  expect(choose({ toolModel: 'sonnet', available, parent: 'anthropic/claude-opus-5[1m]' }).request).toBe('anthropic/claude-sonnet-5');
});

const capped = { definitionModel: 'inherit', inheritCap: 'opus', available: ['anthropic/claude-fable-1', 'anthropic/claude-opus-4', 'anthropic/claude-opus-5', 'other/claude-opus-6'] } as const;

test.for([
  { label: 'a parent above the cap is capped at the newest cap-family model on its provider', input: { parent: 'anthropic/claude-fable-1' }, expected: { request: 'anthropic/claude-opus-5' } },
  { label: 'a parent at the cap inherits', input: { parent: 'anthropic/claude-opus-5' }, expected: { request: undefined } },
  { label: 'a parent below the cap inherits', input: { parent: 'anthropic/claude-sonnet-5' }, expected: { request: undefined } },
  { label: 'a tool model replaces the cap', input: { parent: 'anthropic/claude-fable-1', toolModel: 'anthropic/claude-opus-4' }, expected: { request: 'anthropic/claude-opus-4' } },
  { label: 'FORCE with an inherit default preserves the cap', input: { parent: 'anthropic/claude-fable-1', env: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' } }, expected: { request: 'anthropic/claude-opus-5' } },
  {
    label: 'FORCE with a configured default uses that default',
    input: { parent: 'anthropic/claude-fable-1', env: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'other/claude-opus-6' } },
    expected: { request: 'other/claude-opus-6' },
  },
])('inheritCap: $label', ({ input, expected }) => {
  expect(choose({ ...capped, ...input })).toEqual(expected);
});

test.for([
  { env: { CLAUDE_CODE_COORDINATOR_MODE: '1', CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL: '1' }, expected: { request: 'anthropic/claude-sonnet-5' } },
  { env: { CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL: '1' }, expected: { request: 'anthropic/claude-opus-5' } },
])('coordinator worker inheritance discards the tool model: $env', ({ env, expected }) => {
  expect(choose({ toolModel: 'anthropic/claude-opus-5', definitionModel: 'anthropic/claude-sonnet-5', env, available: ['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5'] })).toEqual(expected);
});
