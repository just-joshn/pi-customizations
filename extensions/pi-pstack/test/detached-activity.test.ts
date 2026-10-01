import { expect, test } from 'vitest';
import { nextActivity } from '../scripts/detached-rpc-protocol.mjs';

test('only final settlement completes a running invocation', () => {
  expect(nextActivity({ kind: 'running', invocation: 'one' }, { type: 'agent_end' })).toEqual({ kind: 'running', invocation: 'one' });
  expect(nextActivity({ kind: 'running', invocation: 'one' }, { type: 'agent_settled' })).toEqual({ kind: 'settled', invocation: 'one' });
});

test('a queued continuation preserves the invocation identity', () => {
  expect(nextActivity({ kind: 'settled', invocation: 'one' }, { type: 'agent_start' })).toEqual({ kind: 'running', invocation: 'one' });
});

test.each([null, undefined, {}, { type: 'compaction_end' }, { type: 'retry' }])('unrelated records do not complete an invocation', (event) => {
  expect(nextActivity({ kind: 'running', invocation: 'one' }, event)).toEqual({ kind: 'running', invocation: 'one' });
});

test('an idle RPC process does not invent an invocation from an event', () => {
  expect(nextActivity({ kind: 'idle' }, { type: 'agent_start' })).toEqual({ kind: 'idle' });
});
