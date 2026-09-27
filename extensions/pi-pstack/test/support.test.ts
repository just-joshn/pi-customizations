import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentSession, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { sumUsage, deduplicateExtensions } from '../src/worker-support.ts';
import { restoreTaskRecords } from '../src/worker-records.ts';
import { boundedResult } from '../src/results.ts';

const usage = { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 } };

 test('usage aggregation snapshots the previous total even without new usage', () => {
  const previous = structuredClone(usage);
  Object.freeze(previous.cost);
  Object.freeze(previous);
  const result = sumUsage([], previous);
  assert.deepEqual(result, usage);
  assert.notEqual(result, previous);
  assert.notEqual(result.cost, previous.cost);
  assert.equal(sumUsage([]).totalTokens, 0);
  const messages = [{ role: 'user', content: 'hello', timestamp: 0 },
    { role: 'toolResult', toolName: 'test', toolCallId: 'one', content: [], isError: false, timestamp: 0 },
    { role: 'toolResult', toolName: 'test', toolCallId: 'two', content: [], isError: false, timestamp: 0, usage }];
  assert.deepEqual(sumUsage(messages as AgentSession['messages'], previous), {
    input: 4, output: 6, cacheRead: 0, cacheWrite: 0, totalTokens: 10,
    cost: { input: 2, output: 4, cacheRead: 0, cacheWrite: 0, total: 6 },
  });
});

test('extension deduplication preserves the first SDK descriptor and stable order', () => {
  assert.deepEqual(deduplicateExtensions([]), []);
  const input = [{ resolvedPath: 'z', label: 'first' }, { resolvedPath: 'a', label: 'second' }, { resolvedPath: 'z', label: 'discard' }];
  const snapshot = structuredClone(input);
  assert.deepEqual(deduplicateExtensions(input), [{ resolvedPath: 'z', label: 'first' }, { resolvedPath: 'a', label: 'second' }]);
  assert.deepEqual(input, snapshot);
});

test('restored task records do not expose caller-owned records or usage', () => {
  const record = { id: 'one', persona: 'generalPurpose', cwd: '/tmp', readonly: false, sessionFile: '/tmp/one', outputFile: '/tmp/out', status: 'settled', output: 'done', usage };
  const restored = restoreTaskRecords([{ type: 'custom', customType: 'pstack-task', data: record }]).get('one');
  assert.deepEqual(restored, record);
  assert.notEqual(restored, record);
  assert.notEqual(restored?.usage, record.usage);
});

test('result truncation preserves empty and exact-boundary values', () => {
  const ctx = { sessionManager: { getSessionFile: () => '/tmp/transcript' } } as ExtensionContext;
  for (const size of [0, 47999, 48000]) {
    const text = 'a'.repeat(size);
    assert.equal(boundedResult(text, {}, ctx).content[0]?.text, text);
  }
  const result = boundedResult('a'.repeat(48001), {}, ctx);
  assert.equal(result.content[0]?.text, 'a'.repeat(48000) + '\n[Truncated. Full current transcript: /tmp/transcript]');
});
