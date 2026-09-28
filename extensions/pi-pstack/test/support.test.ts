import { expect, test } from 'vitest';
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
  expect(result).toEqual(usage);
  expect(result).not.toBe(previous);
  expect(result.cost).not.toBe(previous.cost);
  expect(sumUsage([]).totalTokens).toBe(0);
  const messages = [{ role: 'user', content: 'hello', timestamp: 0 },
    { role: 'toolResult', toolName: 'test', toolCallId: 'one', content: [], isError: false, timestamp: 0 },
    { role: 'toolResult', toolName: 'test', toolCallId: 'two', content: [], isError: false, timestamp: 0, usage }];
  expect(sumUsage(messages as AgentSession['messages'], previous)).toEqual({
    input: 4, output: 6, cacheRead: 0, cacheWrite: 0, totalTokens: 10,
    cost: { input: 2, output: 4, cacheRead: 0, cacheWrite: 0, total: 6 },
  });
});

test('extension deduplication preserves the first SDK descriptor and stable order', () => {
  expect(deduplicateExtensions([])).toEqual([]);
  const input = [{ resolvedPath: 'z', label: 'first' }, { resolvedPath: 'a', label: 'second' }, { resolvedPath: 'z', label: 'discard' }];
  const snapshot = structuredClone(input);
  expect(deduplicateExtensions(input)).toEqual([{ resolvedPath: 'z', label: 'first' }, { resolvedPath: 'a', label: 'second' }]);
  expect(input).toEqual(snapshot);
});

test('restored task records do not expose caller-owned records or usage', () => {
  const record = { id: 'one', persona: 'generalPurpose', cwd: '/tmp', readonly: false, sessionFile: '/tmp/one', outputFile: '/tmp/out', status: 'settled', output: 'done', usage };
  const restored = restoreTaskRecords([{ type: 'custom', customType: 'pstack-task', data: record }]).get('one');
  expect(restored).toEqual(record);
  expect(restored).not.toBe(record);
  expect(restored?.usage).not.toBe(record.usage);
});

test('result truncation preserves empty and exact-boundary values', () => {
  const ctx = { sessionManager: { getSessionFile: () => '/tmp/transcript' } } as ExtensionContext;
  for (const size of [0, 47999, 48000]) {
    const text = 'a'.repeat(size);
    expect(boundedResult(text, {}, ctx).content[0]?.text).toBe(text);
  }
  const result = boundedResult('a'.repeat(48001), {}, ctx);
  expect(result.content[0]?.text).toBe('a'.repeat(48000) + '\n[Truncated. Full current transcript: /tmp/transcript]');
});

test('hostInstructions formats defaults without overrides or transcript file', async () => {
  const { hostInstructions } = await import('../src/host.ts');
  const ctx = {
    cwd: '/workspace',
    sessionManager: { getSessionDir: () => '/sessions', getSessionFile: () => undefined },
  } as unknown as ExtensionContext;
  const output = hostInstructions('/root', ctx, '');
  expect(output.includes('No override. Upstream defaults remain requests, not confirmed available models.')).toBe(true);
  expect(output.includes('This session transcript is in memory.')).toBe(true);
});

test('AskQuestion tool cancellation break and validation checks', async () => {
  const { registerQuestions } = await import('../src/questions.ts');
  let toolDef: any;
  const pi = { registerTool: (def: any) => { toolDef = def; } } as any;
  registerQuestions(pi);
  expect(toolDef).toBeDefined();

  const ctxNoUI = { hasUI: false } as any;
  await expect(toolDef.execute('1', { questions: [{ id: 'q1', prompt: 'p1' }] }, undefined, undefined, ctxNoUI)).rejects.toThrow(/requires Pi TUI/);

  const ctxUI = {
    hasUI: true,
    ui: {
      input: async () => undefined,
      select: async () => undefined,
    },
    sessionManager: { getSessionFile: () => null },
  } as any;
  const cancelledRes = await toolDef.execute('2', {
    questions: [
      { id: 'q1', prompt: 'p1' },
      { id: 'q2', prompt: 'p2' },
    ],
  }, undefined, undefined, ctxUI);
  expect(cancelledRes.details).toEqual([{ id: 'q1', answers: [], cancelled: true }]);
});

test('workerControl handles disposal failure and abort on agent_start when stopped', async () => {
  const { workerControl } = await import('../src/worker-control.ts');
  let listener: ((event: { type: string }) => void) | undefined;
  const fakeSession = {
    abort: async () => { throw new Error('abort fail'); },
    dispose: () => { throw new Error('dispose fail'); },
    subscribe: (fn: (event: { type: string }) => void) => {
      listener = fn;
      return () => {};
    },
  } as any;
  const ctrl = workerControl(fakeSession, undefined);
  ctrl.stop();
  listener?.({ type: 'agent_start' });
  const failures = await ctrl.drain();
  expect(failures.length).toBe(4);
  expect(failures[0]).toMatch(/Worker abort failed/);
  expect(failures[1]).toMatch(/Worker disposal failed/);
  expect(ctrl.stopped()).toBe(true);
  ctrl.unsubscribe();
});

test('registerStatus context event filters pstack-status messages', async () => {
  const { registerStatus } = await import('../src/context.ts');
  let contextHandler: any;
  const pi = {
    on: (event: string, handler: any) => { if (event === 'context') contextHandler = handler; },
    registerCommand() {},
  } as any;
  registerStatus(pi, {} as any);
  expect(contextHandler).toBeDefined();
  const filtered = contextHandler({
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'custom', customType: 'pstack-status', content: 'status' },
      { role: 'assistant', content: 'reply' },
    ],
  });
  expect(filtered.messages.length).toBe(2);
  expect(filtered.messages[0].role).toBe('user');
  expect(filtered.messages[1].role).toBe('assistant');
});

test('resolveModel with empty registry and default thinkingLevel', async () => {
  const { resolveModel } = await import('../src/models.ts');
  expect(() => resolveModel("m", { modelRegistry: { getAvailable: () => [] } } as any)).toThrow(
    /none \(configure Pi provider credentials first\)/,
  );
  const mockModel = { provider: 'test', id: 'm', reasoning: false, input: ['text'] } as any;
  const resolved = resolveModel(undefined, { model: mockModel } as any);
  expect(resolved.thinkingLevel).toBe('off');
});

test('boundedResult falls back when transcript file is not present', () => {
  const ctx = { sessionManager: { getSessionFile: () => null } } as unknown as ExtensionContext;
  const text = 'a'.repeat(48001);
  const res = boundedResult(text, {}, ctx);
  expect(res.content[0]?.text).toMatch(/available in tool details/);
});
