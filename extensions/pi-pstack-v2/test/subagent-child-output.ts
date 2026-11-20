/** What a child Pi prints in `--mode json`, and scripts for the fake tmux that print it. */
import { expect, vi } from 'vitest';
import { type ChildScript, type FakeChild, fakeTmux } from './subagent-fake-tmux.ts';

const CLEAN_EXIT = 0;
const TOKENS = 1;
const COST = 1;

export interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens: number;
  readonly cost: { total: number };
}

export interface Said {
  readonly stopReason?: string;
  readonly errorMessage?: string;
  readonly model?: string;
  readonly usage?: Partial<Usage>;
  readonly toolCalls?: readonly { name: string; arguments: Record<string, unknown> }[];
}

/** The `message_end` line of an assistant turn. Empty text leaves the turn without any text part. */
export function assistantLine(text: string, extra: Said = {}): string {
  const { toolCalls = [], usage: usageOverride, ...rest } = extra;
  const calls = toolCalls.map((call, index) => ({ type: 'toolCall', id: `call-${index}`, ...call }));
  const content = [...calls, ...(text ? [{ type: 'text', text }] : [])];
  const usage: Usage = { input: TOKENS, output: TOKENS, cacheRead: 0, cacheWrite: 0, totalTokens: TOKENS, cost: { total: COST }, ...usageOverride };
  return JSON.stringify({ type: 'message_end', message: { role: 'assistant', content, usage, model: 'child-model', ...rest } });
}

/** A child that prints its answer and exits cleanly. */
export const says =
  (text: string, extra?: Said): ChildScript =>
  (child) => {
    child.stdout(`${assistantLine(text, extra)}\n`);
    child.exit(CLEAN_EXIT);
  };

/** A child that prints these lines, in order, one per line, and exits cleanly. */
export const printing =
  (...lines: string[]): ChildScript =>
  (child) => {
    for (const line of lines) child.stdout(`${line}\n`);
    child.exit(CLEAN_EXIT);
  };

/** A child that exits with a code and optional stderr, printing nothing. */
export const dies =
  (code: number, stderr = ''): ChildScript =>
  (child) => {
    if (stderr) child.stderr(stderr);
    child.exit(code);
  };

/** Chooses a script by the task a child was given, so each parallel or chained child can behave on its own. */
export const byTask =
  (scripts: Readonly<Record<string, ChildScript>>, fallback: ChildScript = says('done')): ChildScript =>
  (child) =>
    (scripts[child.task] ?? fallback)(child);

/** Waits until `count` children have started. A child starts a moment after the tool call, once its prompt file is written. */
export const startedChildren = async (count: number): Promise<readonly FakeChild[]> => {
  await vi.waitFor(() => expect(fakeTmux.children()).toHaveLength(count));
  return fakeTmux.children();
};
