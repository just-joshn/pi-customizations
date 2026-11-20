import { writeFileSync } from 'node:fs';

import { z } from 'zod';
import type { Json, JsonObject } from './json.ts';

/** Builds one session entry body from the timestamp of the message it holds. */
export type Draft = (ts: number) => JsonObject;

export const ARGV_USER_START = 2;
const BASE_TS = 1794759360000;
const TS_STEP = 1000;
const ID_WIDTH = 4;
const HEX_RADIX = 16;
const HEX_WIDTH = 4;
const SESSION_VERSION = 3;
const INPUT_TOKENS = 30000;
const NON_ASCII = /[\u0080-\uffff]/g;
const INTEGER_ARG = /^\s*[+-]?\d+\s*$/;
const WRAPPER_TIMESTAMP = '2026-11-15T16:16:00.000Z';
const SESSION_TIMESTAMP = '2026-11-15T16:15:55.270Z';
const MODEL_PROVIDER = 'openai';
const MODEL_ID = 'gpt-6.1-sol';

const escapeNonAscii = (text: string): string => text.replace(NON_ASCII, (char) => `\\u${char.charCodeAt(0).toString(HEX_RADIX).padStart(HEX_WIDTH, '0')}`);

/** Serializes like Python's json.dumps: ", " and ": " separators, non-ASCII escaped. */
export function pyJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map((item) => pyJson(item)).join(', ')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, item]) => `${pyJson(key)}: ${pyJson(item)}`)
      .join(', ')}}`;
  return escapeNonAscii(JSON.stringify(value));
}

/** Integers from start up to, but not including, stop. */
export const range = (start: number, stop: number): number[] => Array.from({ length: Math.max(0, stop - start) }, (_, offset) => start + offset);

export const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/** Zod schema for `<out> <cwd> [count]`, with `count` falling back to the given default. */
export const fixtureArgsSchema = (fallback: number) =>
  z
    .tuple([z.string(), z.string(), z.string().regex(INTEGER_ARG).optional()])
    .rest(z.string())
    .transform(([out, cwd, count]) => ({ out, cwd, count: count === undefined ? fallback : Number(count) }));

const usageFor = (output: number): JsonObject => ({
  input: INPUT_TOKENS,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  totalTokens: INPUT_TOKENS + output,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

export const toolCall = (id: string, name: string, args: JsonObject): JsonObject => ({ type: 'toolCall', id, name, arguments: args });

export const textBlock = (text: string): JsonObject => ({ type: 'text', text });

export const user =
  (text: string): Draft =>
  (ts) => ({ type: 'message', message: { role: 'user', content: [textBlock(text)], timestamp: ts } });

export const assistant =
  (content: JsonObject[], outputTokens: number, stopReason = 'toolUse'): Draft =>
  (ts) => ({
    type: 'message',
    message: { role: 'assistant', content, api: 'openai-responses', provider: MODEL_PROVIDER, model: MODEL_ID, usage: usageFor(outputTokens), stopReason, timestamp: ts },
  });

export interface ResultOptions {
  readonly details?: JsonObject;
  readonly error?: boolean;
  readonly extra?: JsonObject[];
}

export const toolResult =
  (id: string, name: string, text: string, options: ResultOptions = {}): Draft =>
  (ts) => ({
    type: 'message',
    message: { role: 'toolResult', toolCallId: id, toolName: name, content: [textBlock(text), ...(options.extra ?? [])], details: options.details ?? {}, isError: options.error ?? false, timestamp: ts },
  });

export interface SessionConfig {
  readonly sessionId: string;
  readonly idPrefix: string;
  readonly cwd: string;
}

const preamble: Draft[] = [() => ({ type: 'model_change', provider: MODEL_PROVIDER, modelId: MODEL_ID }), () => ({ type: 'thinking_level_change', thinkingLevel: 'medium' })];

/** Writes the session header and chained entries as JSONL, matching the original Python fixtures byte for byte. */
export function writeSession(out: string, config: SessionConfig, drafts: readonly Draft[]): void {
  const idOf = (index: number): string => `${config.idPrefix}${pad(index, ID_WIDTH)}`;
  const header: JsonObject = { type: 'session', version: SESSION_VERSION, id: config.sessionId, timestamp: SESSION_TIMESTAMP, cwd: config.cwd };
  const body = [...preamble, ...drafts].map((draft, index): JsonObject => ({ id: idOf(index + 1), parentId: index === 0 ? null : idOf(index), timestamp: WRAPPER_TIMESTAMP, ...draft(BASE_TS + TS_STEP * index) }));
  writeFileSync(out, [header, ...body].map((entry) => `${pyJson(entry)}\n`).join(''));
}
