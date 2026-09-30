import { expect, test } from 'vitest';
import { chooseChildModel } from '../src/subagents/models.ts';

const available = ['claude-sonnet-4', 'claude-sonnet-5-5', 'claude-opus-5', 'gpt-x'];
const pick = (input: Partial<Parameters<typeof chooseChildModel>[0]>) => chooseChildModel({ fork: false, env: {}, available, ...input });

test('[G3-02] tool model beats definition beats environment default beats parent', () => {
  expect(pick({ toolModel: 'opus', definitionModel: 'sonnet', env: { CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-x' } }).request).toBe('claude-opus-5');
  expect(pick({ definitionModel: 'sonnet', env: { CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-x' } }).request).toBe('claude-sonnet-5-5');
  expect(pick({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-x' } }).request).toBe('gpt-x');
  expect(pick({}).request).toBeUndefined();
});

test('[G3-02] explicit inherit on the definition bypasses the environment default', () => {
  expect(pick({ definitionModel: 'inherit', env: { CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-x' } }).request).toBeUndefined();
  expect(pick({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'inherit' } }).request).toBeUndefined();
});

test('[G3-03] force discards overrides and forks always inherit', () => {
  expect(pick({ toolModel: 'opus', definitionModel: 'sonnet', env: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: 'gpt-x' } }).request).toBe('gpt-x');
  expect(pick({ fork: true, toolModel: 'opus', env: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: 'gpt-x' } }).request).toBeUndefined();
});

test('[G3-04] unavailable family steps to inheritance and unknown ids are dropped', () => {
  expect(pick({ toolModel: 'fable' })).toEqual({ request: undefined, dropped: 'fable' });
  expect(pick({ toolModel: 'sonnet' })).toEqual({ request: 'claude-sonnet-5-5', steppedFrom: 'sonnet' });
  expect(pick({ toolModel: 'mystery' })).toEqual({ request: undefined, dropped: 'mystery' });
});
