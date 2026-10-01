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
  expect(pick({ definitionModel: 'inherit', env: { CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-x' } })).toEqual({ request: undefined });
  expect(pick({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'inherit' } })).toEqual({ request: undefined });
});

test('[G3-03] force is a flag selecting the configured model rather than a model name', () => {
  expect(pick({ toolModel: 'opus', definitionModel: 'sonnet', env: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-x' } }).request).toBe('gpt-x');
  expect(pick({ fork: true, toolModel: 'opus', env: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-x' } })).toEqual({ request: undefined });
  expect(pick({ toolModel: 'inherit', env: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-x' } })).toEqual({ request: undefined });
});

test('[G3-02] explicit tool inherit wins over the definition and environment', () => {
  expect(pick({ toolModel: 'inherit', definitionModel: 'opus', env: { CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-x' } })).toEqual({ request: undefined });
});

test('[G3-04] an unavailable full model ID steps to the newest available family member', () => {
  expect(pick({ toolModel: 'claude-opus-4' })).toEqual({ request: 'claude-opus-5', steppedFrom: 'claude-opus-4' });
  expect(pick({ toolModel: 'claude-opus-8', available: ['claude-opus-9', 'claude-opus-10'] })).toEqual({ request: 'claude-opus-10', steppedFrom: 'claude-opus-8' });
});

test('[G3-04] unavailable family steps to inheritance and unknown ids are dropped', () => {
  expect(pick({ toolModel: 'fable' })).toEqual({ request: undefined, dropped: 'fable' });
  expect(pick({ toolModel: 'sonnet' })).toEqual({ request: 'claude-sonnet-5-5', steppedFrom: 'sonnet' });
  expect(pick({ toolModel: 'mystery' })).toEqual({ request: undefined, dropped: 'mystery' });
});

test('an unavailable override falls back to the configured default before the parent', () => {
  expect(pick({ definitionModel: 'unavailable/model', env: { PI_SUBAGENT_MODEL: 'gpt-x' } })).toEqual({ request: 'gpt-x', dropped: 'unavailable/model' });
  expect(pick({ toolModel: 'haiku', env: { CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-x' } })).toEqual({ request: 'gpt-x', dropped: 'haiku' });
});
