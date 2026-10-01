import { expect, test } from 'vitest';
import { taskOutcome } from '../src/task-outcome.ts';

const usage = { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 } };
const assistant = (id: string, parentId: string | null, text: string, stopReason = 'stop') => ({ id, parentId, type: 'message', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason, usage } });

test('usage includes compaction and abandoned work while output follows the active leaf', () => {
  const entries = [assistant('one', null, 'old'), { id: 'compact', parentId: 'one', type: 'compaction', usage }, assistant('abandoned', 'compact', 'abandoned'), assistant('active', 'compact', ' final ')];
  expect(taskOutcome(entries, 'active')).toEqual({ status: 'settled', output: 'final', usage: { input: 8, output: 12, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 4, output: 8, cacheRead: 0, cacheWrite: 0, total: 12 } } });
});

test.each([
  ['error', 'failed'],
  ['aborted', 'interrupted'],
])('assistant stop reason %s preserves its error', (stopReason, status) => {
  expect(taskOutcome([{ ...assistant('one', null, 'partial', stopReason), message: { ...assistant('one', null, 'partial', stopReason).message, errorMessage: 'request ended' } }], 'one')).toEqual({ status, output: 'request ended', usage });
});

test('empty invocation metadata has no stale output or usage', () => {
  expect(taskOutcome([], 'older-leaf')).toEqual({ status: 'settled', output: '', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
});

test.each([null, undefined, {}, [{ id: 'one', parentId: null, type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 3 }], stopReason: 'stop' } }]])('rejects malformed snapshot data', (entries) => {
  expect(() => taskOutcome(entries, null)).toThrow('Invalid task entries');
});
