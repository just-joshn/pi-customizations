import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { ExtensionFactory, ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test, vi } from 'vitest';
import extension from '../src/index.ts';
import largeOutput, { type ToolResultHandler } from '../src/large-output.ts';
import { captureProvider } from './support/load-extension.ts';

const INLINE_LIMIT = 30_000;
const PREVIEW_CHARS = 2_000;

const subscriptionModel = captureProvider(extension).getModels()[0];
const anthropicModel = builtinProviders()
  .find((provider) => provider.id === 'anthropic')
  ?.getModels()[0];

function handlerOf(): ToolResultHandler {
  const handlers: ToolResultHandler[] = [];
  largeOutput({ on: (_event, handler) => void handlers.push(handler) });
  const [only] = handlers;
  if (handlers.length !== 1 || !only) throw new Error(`expected one tool_result handler, received ${handlers.length}`);
  return only;
}

function numbered(chars: number): string {
  let text = '';
  for (let line = 0; text.length < chars; line += 1) text += `line ${line}\n`;
  return text.slice(0, chars);
}

function bashResult(text: string, details?: { fullOutputPath: string }): ToolResultEvent {
  return { type: 'tool_result', toolCallId: 'call_1', toolName: 'bash', input: { command: 'run' }, content: [{ type: 'text', text }], isError: false, details };
}

function readResult(text: string): ToolResultEvent {
  return { type: 'tool_result', toolCallId: 'call_2', toolName: 'read', input: { path: 'a' }, content: [{ type: 'text', text }], isError: false, details: undefined };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-large-output-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function textOf(result: Awaited<ReturnType<ToolResultHandler>>): string {
  return (result?.content ?? []).map((block) => (block.type === 'text' ? block.text : '')).join('');
}

function savedPath(message: string): string {
  const path = /Full output: (\S+)/.exec(message)?.[1];
  if (!path) throw new Error(`message names no file: ${message}`);
  onTestFinished(() => rm(path, { force: true }));
  return path;
}

test('the handler is a Pi extension factory', () => {
  const factory: ExtensionFactory = largeOutput;
  expect(factory).toBe(largeOutput);
});

async function shrinks(event: ToolResultEvent, model: Model<Api> | undefined): Promise<boolean> {
  const result = await handlerOf()(event, { model });
  if (result) savedPath(textOf(result));
  return result !== undefined;
}

test('the inline limit is exactly 30,000 characters', async () => {
  expect(await shrinks(bashResult(numbered(INLINE_LIMIT)), subscriptionModel)).toBe(false);
  expect(await shrinks(bashResult(numbered(INLINE_LIMIT + 1)), subscriptionModel)).toBe(true);
});

test('output over the limit shrinks to a preview of the first 2000 characters', async () => {
  const original = numbered(INLINE_LIMIT + 1);
  const result = await handlerOf()(bashResult(original), { model: subscriptionModel });
  const message = textOf(result);
  expect(message).toContain(original.slice(0, PREVIEW_CHARS));
  expect(message).not.toContain(original.slice(0, PREVIEW_CHARS + 20));
  expect(message.length).toBeLessThan(PREVIEW_CHARS + 600);
  savedPath(message);
});

test('the full output is saved to the file the preview names', async () => {
  const original = numbered(INLINE_LIMIT * 3);
  const message = textOf(await handlerOf()(bashResult(original), { model: subscriptionModel }));
  expect(await readFile(savedPath(message), 'utf8')).toBe(original);
});

test('the preview states the full size in kilobytes', async () => {
  const message = textOf(await handlerOf()(bashResult(numbered(102_400)), { model: subscriptionModel }));
  expect(message).toContain('100KB');
  savedPath(message);
});

test('output Pi already saved is previewed from that file', async () => {
  const dir = await tempDir();
  const full = join(dir, 'pi-bash-full.txt');
  const original = numbered(INLINE_LIMIT * 4);
  await writeFile(full, original);
  const tail = original.slice(-50_000);
  const message = textOf(await handlerOf()(bashResult(tail, { fullOutputPath: full }), { model: subscriptionModel }));
  expect(message).toContain(original.slice(0, PREVIEW_CHARS));
  expect(message).toContain(`Full output: ${full}`);
});

test('a multibyte preview is cut on a character boundary', async () => {
  const dir = await tempDir();
  const full = join(dir, 'pi-bash-full.txt');
  const original = 'é'.repeat(INLINE_LIMIT * 2);
  await writeFile(full, original);
  const message = textOf(await handlerOf()(bashResult(original.slice(-50_000), { fullOutputPath: full }), { model: subscriptionModel }));
  expect(message).toContain('é'.repeat(PREVIEW_CHARS));
  expect(message).not.toContain('\uFFFD');
});

test('an unreadable saved file keeps the output while a readable one shrinks', async () => {
  const dir = await tempDir();
  const readable = join(dir, 'full.txt');
  await writeFile(readable, numbered(INLINE_LIMIT * 2));
  const big = numbered(INLINE_LIMIT * 2);
  expect(await shrinks(bashResult(big, { fullOutputPath: join(dir, 'missing.txt') }), subscriptionModel)).toBe(false);
  expect(await shrinks(bashResult(big, { fullOutputPath: readable }), subscriptionModel)).toBe(true);
});

test('output that cannot be saved keeps the full result', async () => {
  const dir = await tempDir();
  vi.stubEnv('TMPDIR', join(dir, 'missing'));
  const event = bashResult(numbered(INLINE_LIMIT * 2));
  expect(await shrinks(event, subscriptionModel)).toBe(false);
  vi.unstubAllEnvs();
  expect(await shrinks(event, subscriptionModel)).toBe(true);
});

test('only the subscription provider shrinks output', async () => {
  const event = bashResult(numbered(INLINE_LIMIT * 2));
  expect(await shrinks(event, anthropicModel)).toBe(false);
  expect(await shrinks(event, undefined)).toBe(false);
  expect(await shrinks(event, subscriptionModel)).toBe(true);
});

test('only bash output is shrunk', async () => {
  const text = numbered(INLINE_LIMIT * 2);
  expect(await shrinks(readResult(text), subscriptionModel)).toBe(false);
  expect(await shrinks(bashResult(text), subscriptionModel)).toBe(true);
});

test('images in a large result survive the shrink', async () => {
  const event: ToolResultEvent = {
    ...bashResult(numbered(INLINE_LIMIT * 2)),
    content: [
      { type: 'text', text: numbered(INLINE_LIMIT * 2) },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ],
  };
  const result = await handlerOf()(event, { model: subscriptionModel });
  expect(result?.content?.at(-1)).toStrictEqual({ type: 'image', data: 'AAAA', mimeType: 'image/png' });
  savedPath(textOf(result));
});
