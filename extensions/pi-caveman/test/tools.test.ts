import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionContext, ExtensionToolContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { emptyUsage, messageText, outcomeResult } from '../src/compress-tool.ts';
import { messageBody } from '../src/renderers.ts';
import { harness } from './support/harness.ts';

const runCrew = vi.hoisted(() => vi.fn());
vi.mock(import('../src/cavecrew.ts'), async (original) => ({ ...(await original()), runCrew }));

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'caveman-tools-'));
  vi.stubEnv('XDG_DATA_HOME', join(dir, 'data'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const usage = { ...emptyUsage(), output: 7, totalTokens: 7, cost: { ...emptyUsage().cost, total: 0.01 } };
const reply = (text: string, stopReason: AssistantMessage['stopReason'] = 'stop'): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'openai-completions',
  provider: 'p',
  model: 'm',
  usage,
  stopReason,
  timestamp: 0,
});

function ctxWith(replies: readonly AssistantMessage[]): ExtensionContext {
  let index = 0;
  const modelRegistry = { streamSimple: () => ({ result: async () => replies[Math.min(index++, replies.length - 1)] }), getAvailable: () => [{ provider: 'p', id: 'm' }] };
  return { cwd: dir, model: { provider: 'p', id: 'm' }, modelRegistry } as unknown as ExtensionContext;
}

function execute(tool: ToolDefinition | undefined, params: unknown, ctx: ExtensionContext) {
  if (!tool) throw new Error('tool not registered');
  return tool.execute('call-1', params as never, undefined, undefined, ctx as ExtensionToolContext);
}

describe('caveman_compress tool', () => {
  const compressNotes = async () => {
    writeFileSync(join(dir, 'notes.md'), '# Notes\n\nYou should always make sure to run the whole test suite before you push anything at all.\n');
    return execute(harness().tool('caveman_compress'), { path: 'notes.md' }, ctxWith([reply('# Notes\n\nRun tests before push.\n')]));
  };

  test('compresses a path relative to the session cwd', async () => {
    await compressNotes();
    expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toBe('# Notes\n\nRun tests before push.\n');
  });

  test('reports the nested model usage', async () => {
    expect((await compressNotes()).usage).toStrictEqual(usage);
  });

  test('declares destructive, open-world annotations', () => {
    expect(harness().tool('caveman_compress')?.annotations).toStrictEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true });
  });

  test('a skipped file returns structured content', () => {
    expect(outcomeResult({ kind: 'skipped', reason: 'Skipping (not natural language)' }, '/x.py', usage).structuredContent).toStrictEqual({
      kind: 'skipped',
      reason: 'Skipping (not natural language)',
    });
  });

  test('a failed outcome throws with every error', () => {
    expect(() => outcomeResult({ kind: 'failed', errors: ['a', 'b'] }, '/x.md', usage)).toThrow('Compression failed, /x.md left untouched:\na\nb');
  });

  test('an errored model reply throws its message', () => {
    expect(() => messageText({ ...reply(''), stopReason: 'error', errorMessage: 'rate limited' })).toThrow('rate limited');
  });

  test('a missing model is reported', async () => {
    writeFileSync(join(dir, 'a.md'), '# A\n\nSome prose that is long enough to be worth compressing here.\n');
    const ctx = { ...ctxWith([]), model: undefined } as unknown as ExtensionContext;
    await expect(execute(harness().tool('caveman_compress'), { path: 'a.md' }, ctx)).rejects.toThrow('caveman_compress: no model selected');
  });
});

describe('cavecrew tool', () => {
  test('returns the subagent output with usage', async () => {
    runCrew.mockResolvedValue({ role: 'investigator', model: 'p/m', exitCode: 0, output: 'a.ts:1', stderr: '', turns: 1, usage });
    const result = await execute(harness().tool('cavecrew'), { agent: 'investigator', task: 'find x' }, ctxWith([]));
    expect(result).toStrictEqual({
      content: [{ type: 'text', text: 'a.ts:1' }],
      details: undefined,
      structuredContent: { role: 'investigator', model: 'p/m', turns: 1, output: 'a.ts:1' },
      usage,
    });
  });

  test('resolves a relative cwd against the session cwd', async () => {
    runCrew.mockResolvedValue({ role: 'builder', model: null, exitCode: 0, output: 'ok', stderr: '', turns: 1, usage });
    await execute(harness().tool('cavecrew'), { agent: 'builder', task: 't', cwd: 'sub' }, ctxWith([]));
    expect(runCrew.mock.lastCall?.[0]).toMatchObject({ cwd: join(dir, 'sub'), model: 'p/m' });
  });

  test('a failed subagent throws with its stderr', async () => {
    runCrew.mockResolvedValue({ role: 'reviewer', model: null, exitCode: 2, output: '', stderr: 'no model\n', turns: 0, usage });
    await expect(execute(harness().tool('cavecrew'), { agent: 'reviewer', task: 't' }, ctxWith([]))).rejects.toThrow('cavecrew-reviewer failed (exit 2): no model');
  });
});

describe('renderers', () => {
  test.for(['caveman-stats', 'caveman-help'])('%s has a message renderer', (customType) => {
    expect(typeof harness().renderer(customType)).toBe('function');
  });

  test.for([
    { content: 'plain', expected: 'plain' },
    { content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }], expected: 'a\nb' },
    { content: [], expected: '' },
  ])('messageBody flattens $expected', ({ content, expected }) => {
    expect(messageBody(content)).toBe(expected);
  });
});
