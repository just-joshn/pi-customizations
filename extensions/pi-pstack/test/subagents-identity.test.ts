import { expect, test } from 'vitest';
import { identityExtension } from '../src/subagents/identity-extension.ts';

function harness() {
  const registered = new Map<string, (event: never) => unknown>();
  const pi = { on: (name: string, handler: (event: never) => unknown) => registered.set(name, handler), events: { emit: () => {}, on: () => () => {} } };
  const call = (name: string, event: unknown) => registered.get(name)?.(event as never);
  identityExtension({ headers: { 'X-Agent-Task-Id': 'a1', 'X-Parent-Agent-Id': 'root' }, agentId: 'a1', parentAgentId: 'root' })(pi as never);
  return { call };
}

test('every child model request carries the identity headers', () => {
  const { call } = harness();
  const headers: Record<string, string | null> = {};
  call('before_provider_headers', { type: 'before_provider_headers', headers });
  expect(headers).toEqual({ 'X-Agent-Task-Id': 'a1', 'X-Parent-Agent-Id': 'root' });
});

test('the reference-assistant wire provider also gets the body fields and others do not', () => {
  const { call } = harness();
  call('model_select', { type: 'model_select', model: { provider: 'github-reference-assistant', id: 'gpt-5' } });
  const changed = call('before_provider_request', { type: 'before_provider_request', payload: { messages: [] } }) as Record<string, unknown>;
  expect(changed).toEqual({ messages: [], agent_task_id: 'a1', parent_agent_id: 'root' });
  call('model_select', { type: 'model_select', model: { provider: 'anthropic', id: 'm' } });
  expect(call('before_provider_request', { type: 'before_provider_request', payload: { messages: [] } })).toBe(undefined);
});
