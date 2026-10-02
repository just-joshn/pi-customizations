import { expect, test } from 'vitest';
import { type ModelOption, matchModel, type SelectionRequest, selectModel } from '../src/subagents/model-selection.ts';

function option(reference: string, cost = 10, contextWindow = 200000): ModelOption {
  const slash = reference.indexOf('/');
  return { reference, provider: reference.slice(0, slash), id: reference.slice(slash + 1), cost, contextWindow };
}

const session = option('anthropic/claude-opus-5', 20);
const catalog = [session, option('anthropic/claude-haiku-4-5', 2), option('openai/gpt-6-luna', 4), option('openai/gpt-5-4-mini', 1), option('anthropic/claude-sonnet-5', 8), option('xai/grok-4-7', 15)];
const explore = { name: 'explore', source: 'built-in', model: ['gpt-5.6-luna', 'gpt-5.4-mini'], reasoningEffort: 'low' } as const;

function run(overrides: Partial<SelectionRequest> = {}) {
  return selectModel({ agent: explore, session, available: catalog, ...overrides });
}

function chosen(result: ReturnType<typeof selectModel>) {
  if (!result.ok) throw new Error(result.message);
  return result.selection;
}

test('a required setting beats the definition models and effort', () => {
  const selection = chosen(run({ setting: { model: 'gpt-6-luna', modelPolicy: 'required', effortLevel: 'medium', contextTier: 'default' } }));
  expect(selection).toMatchObject({ model: { reference: 'openai/gpt-6-luna' }, source: 'configured_required', taskSource: 'subagent_configuration', effort: 'medium', contextTier: 'default', firstDispatched: 'openai/gpt-6-luna' });
});

test('a required setting silently replaces a conflicting task model', () => {
  const selection = chosen(run({ taskModel: 'xai/grok-4-7', setting: { model: 'gpt-6-luna', modelPolicy: 'required' } }));
  expect(selection).toMatchObject({ model: { reference: 'openai/gpt-6-luna' }, requested: 'xai/grok-4-7', overrideReason: 'required_policy_replaced_request', configured: 'gpt-6-luna' });
});

test('a required model above the cost guard is a hard error with no fallback', () => {
  const cheapSession = option('openai/gpt-5-4-mini', 1);
  const result = run({ session: cheapSession, setting: { model: 'claude-opus-5', modelPolicy: 'required' } });
  expect(result).toEqual({ ok: false, message: "Model 'claude-opus-5' is required for agent type 'explore' but exceeds the allowed cost relative to the current session model" });
});

test('a required model that is not available is a hard error', () => {
  expect(run({ setting: { model: 'no-such-model', modelPolicy: 'required' } })).toEqual({ ok: false, message: "Model 'no-such-model' is required for agent type 'explore' but is not available in this session." });
});

test('an explicit task model beats a preferred setting and the definition', () => {
  const selection = chosen(run({ taskModel: 'anthropic/claude-sonnet-5', setting: { model: 'gpt-6-luna', modelPolicy: 'preferred' } }));
  expect(selection).toMatchObject({ model: { reference: 'anthropic/claude-sonnet-5' }, source: 'explicit_override', taskSource: 'task_argument', requested: 'anthropic/claude-sonnet-5', configured: 'gpt-6-luna' });
});

test('a preferred setting beats the definition list', () => {
  const selection = chosen(run({ setting: { model: 'claude-haiku-4.5', modelPolicy: 'preferred' } }));
  expect(selection).toMatchObject({ model: { reference: 'anthropic/claude-haiku-4-5' }, source: 'configured_preference', taskSource: 'subagent_configuration', effort: 'low' });
});

test('a task-level required policy forces its model and reports the configured source', () => {
  const selection = chosen(run({ taskModel: 'gpt-6-luna', taskModelPolicy: 'required' }));
  expect(selection).toMatchObject({ model: { reference: 'openai/gpt-6-luna' }, source: 'configured_required', taskSource: 'subagent_configuration', configured: 'gpt-6-luna' });
});

test('a required setting beats a task-level preferred policy', () => {
  const selection = chosen(run({ taskModel: 'anthropic/claude-sonnet-5', taskModelPolicy: 'preferred', setting: { model: 'gpt-6-luna', modelPolicy: 'required' } }));
  expect(selection).toMatchObject({ model: { reference: 'openai/gpt-6-luna' }, source: 'configured_required', requested: 'anthropic/claude-sonnet-5', overrideReason: 'required_policy_replaced_request' });
});

test('a task-level effort level beats the setting and the definition', () => {
  expect(chosen(run({ taskEffortLevel: 'high' }))).toMatchObject({ effort: 'high' });
  expect(chosen(run({ taskEffortLevel: 'high', setting: { effortLevel: 'medium' } }))).toMatchObject({ effort: 'high' });
});

test('the first available definition model wins and a built-in reports an unset task source', () => {
  const selection = chosen(run({ available: [session, option('openai/gpt-5-4-mini', 1)] }));
  expect(selection).toMatchObject({ model: { reference: 'openai/gpt-5-4-mini' }, source: 'agent_definition_default', taskSource: 'unset', effort: 'low' });
});

test('a custom agent definition reports its own task source', () => {
  const selection = chosen(run({ agent: { name: 'mine', source: 'project', model: 'claude-sonnet-5' } }));
  expect(selection).toMatchObject({ model: { reference: 'anthropic/claude-sonnet-5' }, source: 'agent_definition_default', taskSource: 'custom_agent_definition' });
});

test('a candidate over the cost guard is skipped for the next one', () => {
  const tight = option('anthropic/claude-haiku-4-5', 2);
  const selection = chosen(run({ session: tight, available: [tight, option('openai/gpt-6-luna', 4), option('openai/gpt-5-4-mini', 1)] }));
  expect(selection.model.reference).toBe('openai/gpt-5-4-mini');
});

test('when no candidate survives the child falls back to the session model', () => {
  expect(chosen(run({ available: [session] }))).toMatchObject({ model: { reference: session.reference }, source: 'runtime_policy', taskSource: 'unset' });
});

test('with no candidates at all the child inherits the session model', () => {
  expect(chosen(run({ agent: { name: 'general-purpose', source: 'built-in' } }))).toMatchObject({ model: { reference: session.reference }, source: 'session_inheritance', taskSource: 'unset' });
});

test('an unavailable explicit model is recorded and the walk continues', () => {
  const selection = chosen(run({ taskModel: 'ghost-model' }));
  expect(selection).toMatchObject({ source: 'agent_definition_default', requested: 'ghost-model', overrideReason: 'request_not_available' });
});

test('an explicit model above the cost guard is recorded and skipped', () => {
  const small = option('openai/gpt-5-4-mini', 1);
  const selection = chosen(run({ session: small, taskModel: 'anthropic/claude-opus-5', available: [small, session] }));
  expect(selection).toMatchObject({ model: { reference: 'openai/gpt-5-4-mini' }, overrideReason: 'request_exceeds_cost_guard', requested: 'anthropic/claude-opus-5' });
});

test('a complementary agent takes a stronger model from another provider', () => {
  const selection = chosen(run({ agent: { name: 'rubber-duck', source: 'built-in', dynamicModel: 'complementary' } }));
  expect(selection).toMatchObject({ model: { reference: 'xai/grok-4-7' }, source: 'complementary_default', taskSource: 'unset' });
});

test('a complementary agent stays on the session model when no other provider fits', () => {
  const selection = chosen(run({ agent: { name: 'rubber-duck', source: 'built-in', dynamicModel: 'complementary' }, available: [session, option('anthropic/claude-haiku-4-5', 2)] }));
  expect(selection).toMatchObject({ model: { reference: session.reference }, source: 'session_inheritance' });
});

test('a zero priced session model disables the cost guard', () => {
  const free = option('subscription/model', 0);
  expect(chosen(run({ session: free, available: [free, option('anthropic/claude-opus-5', 99)], agent: { name: 'mine', source: 'user', model: 'claude-opus-5' } })).model.reference).toBe('anthropic/claude-opus-5');
});

test('long_context picks the largest window in the same model family', () => {
  const standard = option('anthropic/claude-sonnet-5', 8, 200000);
  const long = option('anthropic/claude-sonnet-5-1m', 8, 1000000);
  const selection = chosen(run({ agent: { name: 'mine', source: 'user', model: 'claude-sonnet-5' }, available: [session, standard, long], taskContextTier: 'long_context' }));
  expect(selection).toMatchObject({ model: { reference: 'anthropic/claude-sonnet-5-1m' }, contextTier: 'long_context' });
});

test.for([
  { candidate: 'claude-haiku-4.5', expected: 'anthropic/claude-haiku-4-5' },
  { candidate: 'anthropic/claude-haiku-4-5', expected: 'anthropic/claude-haiku-4-5' },
  { candidate: 'CLAUDE-SONNET-5', expected: 'anthropic/claude-sonnet-5' },
  { candidate: 'missing', expected: undefined },
])('candidate $candidate matches $expected', ({ candidate, expected }) => {
  expect(matchModel(candidate, session, catalog)?.reference).toBe(expected);
});

test('a bare id prefers the session provider', () => {
  const twin = [option('other/shared', 1), option('anthropic/shared', 1)];
  expect(matchModel('shared', session, twin)?.reference).toBe('anthropic/shared');
});
