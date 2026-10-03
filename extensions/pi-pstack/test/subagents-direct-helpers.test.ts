import { expect, test } from 'vitest';
import type { ModelOption, SelectionRequest } from '../src/subagents/model-selection.ts';
import { sameModel, selectModel } from '../src/subagents/model-selection.ts';
import { parseSubagentHooks } from '../src/subagents/subagent-hooks.ts';
import { parsePreferenceCommand } from '../src/subagents/subagent-preferences.ts';
import { planTools } from '../src/subagents/tool-mapping.ts';
import { readAgentText } from '../src/subagents/tool-results.ts';

const session: ModelOption = { reference: 'p/session', provider: 'p', id: 'session', cost: 1, contextWindow: 1000 };
const cheap: ModelOption = { reference: 'p/other', provider: 'p', id: 'other', cost: 0.5, contextWindow: 2000 };
const pricey: ModelOption = { reference: 'p/pricey', provider: 'p', id: 'pricey', cost: 5, contextWindow: 4000 };
const long: ModelOption = { reference: 'p/session-1m', provider: 'p', id: 'session-1m', cost: 1, contextWindow: 1_000_000 };
const builtIn = { name: 'explore', source: 'built-in' as const };
const available: readonly ModelOption[] = [session, cheap, pricey, long];

function request(overrides: Partial<SelectionRequest> = {}): SelectionRequest {
  return { agent: builtIn, session, available, ...overrides };
}

test('sameModel compares normalized ids and accepts a provider-qualified reference', () => {
  expect([sameModel('GPT-5.6-Luna', 'gpt-5-6-luna'), sameModel('gpt-5.6-luna', 'openai/gpt-5.6-luna'), sameModel('gpt-5.6-luna', 'openai/claude')]).toEqual([true, true, false]);
});

test('selectModel inherits the session model when nothing overrides it', () => {
  const result = selectModel(request());
  expect(result.ok && result.selection).toMatchObject({ model: session, source: 'session_inheritance', taskSource: 'unset', firstDispatched: 'p/session' });
});

test('an explicit task model wins and records the requested reference', () => {
  const result = selectModel(request({ taskModel: 'p/other' }));
  expect(result.ok && result.selection).toMatchObject({ model: cheap, source: 'explicit_override', taskSource: 'task_argument', requested: 'p/other' });
});

test('an unavailable or too-expensive task model falls back with the documented override reason', () => {
  const missing = selectModel(request({ taskModel: 'p/ghost' }));
  expect(missing.ok && missing.selection).toMatchObject({ model: session, requested: 'p/ghost', overrideReason: 'request_not_available' });
  const blocked = selectModel(request({ taskModel: 'p/pricey' }));
  expect(blocked.ok && blocked.selection).toMatchObject({ model: session, requested: 'p/pricey', overrideReason: 'request_exceeds_cost_guard' });
});

test('a configured preference is used when it resolves and a required policy refuses otherwise', () => {
  const preferred = selectModel(request({ setting: { model: 'p/other' } }));
  expect(preferred.ok && preferred.selection).toMatchObject({ model: cheap, source: 'configured_preference', taskSource: 'subagent_configuration', configured: 'p/other' });
  const required = selectModel(request({ setting: { model: 'p/other', modelPolicy: 'required' } }));
  expect(required.ok && required.selection).toMatchObject({ model: cheap, source: 'configured_required' });
  const replaced = selectModel(request({ taskModel: 'p/pricey', setting: { model: 'p/other', modelPolicy: 'required' } }));
  expect(replaced.ok && replaced.selection).toMatchObject({ model: cheap, requested: 'p/pricey', overrideReason: 'required_policy_replaced_request' });
  const missing = selectModel(request({ setting: { model: 'p/ghost', modelPolicy: 'required' } }));
  expect(missing.ok).toBe(false);
  expect(missing.ok ? '' : missing.message).toMatch(/is not available in this session/);
  const cost = selectModel(request({ setting: { model: 'p/pricey', modelPolicy: 'required' } }));
  expect(cost.ok).toBe(false);
  expect(cost.ok ? '' : cost.message).toMatch(/exceeds the allowed cost/);
});

test('a long-context request escalates to the largest window in the model family and records effort', () => {
  const result = selectModel(request({ taskModel: 'p/session', taskContextTier: 'long_context', taskEffortLevel: 'high' }));
  expect(result.ok && result.selection).toMatchObject({ model: long, contextTier: 'long_context', effort: 'high', firstDispatched: 'p/session-1m' });
});

test('a custom agent definition supplies the fallback model layer', () => {
  const result = selectModel(request({ agent: { name: 'mine', source: 'user', model: 'p/other' } }));
  expect(result.ok && result.selection).toMatchObject({ model: cheap, source: 'agent_definition_default', taskSource: 'custom_agent_definition' });
  const unmatched = selectModel(request({ agent: { name: 'mine', source: 'user', model: 'p/ghost' } }));
  expect(unmatched.ok && unmatched.selection).toMatchObject({ model: session, source: 'runtime_policy' });
});

test('planTools keeps only reachable tools and reports unmatched declarations', () => {
  const plan = planTools({ definition: { tools: { kind: 'named', names: ['read', 'ghost', 'grep'] } }, parentTools: ['read', 'grep'], available: ['read', 'grep', 'write'], contextManagement: false });
  expect(plan).toEqual({ declared: ['read', 'ghost', 'grep'], effective: ['read', 'grep'], unmatched: ['ghost'] });
  expect(planTools({ definition: { tools: { kind: 'all' } }, parentTools: ['read'], available: ['read', 'write'], contextManagement: false })).toEqual({ declared: ['*'], effective: ['read'], unmatched: [] });
});

test('readAgentText headlines each terminal status and lists turns from the requested index', () => {
  const view = { id: 'a1', agentType: 'explore', name: 'alpha', status: 'completed' as const, mode: 'background' as const, description: 'd', elapsedMs: 2500, turns: ['one', 'two'] };
  const text = readAgentText(view, 1);
  expect(text).toContain('Agent completed.');
  expect(text).toContain('[Turn 1]');
  expect(text).not.toContain('[Turn 0]');
  expect(readAgentText({ ...view, turns: [] })).toContain('Agent completed but produced no response.');
  expect(readAgentText({ ...view, status: 'failed', error: 'boom' }, 5)).toContain('Agent failed: boom');
  expect(readAgentText({ ...view, status: 'failed' }, 5)).toContain('No responses from turn 5 onward.');
});

test('parseSubagentHooks accepts string and timed object hooks and ignores malformed settings', () => {
  expect(parseSubagentHooks({ hooks: { subagentStart: ['echo start'], subagentStop: [{ command: 'stop', timeoutSec: 2 }] } })).toEqual({
    start: [{ command: 'echo start', timeoutMs: 30_000 }],
    stop: [{ command: 'stop', timeoutMs: 2000 }],
  });
  expect(parseSubagentHooks({ hooks: { subagentStart: [7] } })).toEqual({ start: [], stop: [] });
  expect(parseSubagentHooks(null)).toEqual({ start: [], stop: [] });
});

test('parsePreferenceCommand validates every subagents subcommand', () => {
  expect(parsePreferenceCommand('')).toEqual({ kind: 'show' });
  expect(parsePreferenceCommand('disable explore')).toEqual({ kind: 'disable', agent: 'explore' });
  expect(parsePreferenceCommand('model explore gpt-6')).toEqual({ kind: 'model', agent: 'explore', model: 'gpt-6', policy: 'preferred' });
  expect(parsePreferenceCommand('model explore gpt-6 required')).toEqual({ kind: 'model', agent: 'explore', model: 'gpt-6', policy: 'required' });
  expect(parsePreferenceCommand('model explore gpt-6 sometimes')).toMatchObject({ error: expect.stringContaining('model policy') });
  expect(parsePreferenceCommand('effort explore high')).toEqual({ kind: 'effort', agent: 'explore', level: 'high' });
  expect(parsePreferenceCommand('tier explore long_context')).toEqual({ kind: 'tier', agent: 'explore', tier: 'long_context' });
  expect(parsePreferenceCommand('rubber-duck on')).toEqual({ kind: 'rubber-duck', enabled: true });
  expect(parsePreferenceCommand('rubber-duck')).toMatchObject({ error: 'Usage: /subagents rubber-duck <on|off>' });
  expect(parsePreferenceCommand('nonsense')).toMatchObject({ error: expect.stringContaining('Usage:') });
});
