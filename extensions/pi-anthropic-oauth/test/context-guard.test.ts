import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { CompactOptions, SessionProjection, ToolInfo } from '@earendil-works/pi-coding-agent';
import { createSyntheticSourceInfo } from '@earendil-works/pi-coding-agent';
import { expect } from 'vitest';
import { type ContextGuard, type ContextGuardHost, calibratedBias, type GuardContext, installContextGuard } from '../src/context/guard.ts';
import { test } from './network-guard.ts';

type BeforeStartHandler = (event: { prompt: string; systemPrompt: string }, ctx: GuardContext) => unknown;
type SessionHandler = () => unknown;
type ProjectionMessage = SessionProjection['messages'][number];

function invoke(handler: unknown, args: readonly unknown[]): unknown {
  if (typeof handler !== 'function') return undefined;
  return Reflect.apply(handler, undefined, [...args]);
}

interface Rig {
  readonly guard: ContextGuard;
  readonly notices: string[];
  beforeStart(): BeforeStartHandler;
  sessionStart(): SessionHandler;
  sessionShutdown(): SessionHandler;
}

function subscriptionModel(): NonNullable<GuardContext['model']> {
  const provider = builtinProviders().find((candidate) => candidate.id === 'anthropic');
  const model = provider?.getModels().find((candidate) => candidate.id === 'claude-opus-5-5');
  if (!model) throw new Error('the anthropic catalog has no claude-opus-5-5');
  return { ...model, provider: 'claude-subscription', contextWindow: 200_000 };
}

function readTool(): ToolInfo {
  return {
    name: 'read',
    description: 'Read a file',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
    exposure: 'direct',
    sourceInfo: createSyntheticSourceInfo('inline:read', { source: 'test' }),
  };
}

function createRig(compactionEnabled = true): Rig {
  const notices: string[] = [];
  const handlers = new Map<string, unknown>();
  const api: ContextGuardHost = {
    on: (...args: unknown[]): (() => void) => {
      const [event, handler] = args;
      if (typeof event === 'string' && typeof handler === 'function') handlers.set(event, handler);
      return () => undefined;
    },
    getAllTools: () => [readTool()],
    getActiveTools: () => ['read'],
    getSettings: () => ({ compaction: { enabled: compactionEnabled } }),
  };
  const guard = installContextGuard(api, { providerId: 'claude-subscription', notify: (message) => notices.push(message) });
  const beforeAgentStart = handlers.get('before_agent_start');
  const sessionStart = handlers.get('session_start');
  const sessionShutdown = handlers.get('session_shutdown');
  if (beforeAgentStart === undefined || sessionStart === undefined) throw new Error('the guard did not register its handlers');
  return {
    guard,
    notices,
    beforeStart: () => (event, ctx) => invoke(beforeAgentStart, [event, ctx]),
    sessionStart: () => () => invoke(sessionStart, []),
    sessionShutdown: () => () => invoke(sessionShutdown, []),
  };
}

function guardContext(overrides: { projection?: readonly ProjectionMessage[]; idle?: boolean; compact?: (options?: CompactOptions) => void; model?: GuardContext['model'] }): GuardContext {
  const model = 'model' in overrides ? overrides.model : subscriptionModel();
  return {
    model,
    hasUI: false,
    ui: { notify: () => undefined },
    isIdle: () => overrides.idle ?? true,
    sessionManager: {
      buildSessionProjection: () => ({ entries: [], messages: [...(overrides.projection ?? [])], thinkingLevel: 'off', model: null }),
    },
    compact: overrides.compact ?? (() => undefined),
  };
}

const prompt = { prompt: 'continue', systemPrompt: 'You are helpful.' };

function bigProjection(bytes: number): ProjectionMessage[] {
  return [{ role: 'user', content: 'a'.repeat(bytes), timestamp: 1 }];
}

function counted(): { count: () => number; compact: (options?: CompactOptions) => void } {
  let compactions = 0;
  return {
    count: () => compactions,
    compact: (options) => {
      compactions += 1;
      options?.onComplete?.({ summary: 'ok', firstKeptEntryId: 'entry', tokensBefore: 1 });
    },
  };
}

test('the guard ignores another provider', async () => {
  const rig = createRig();
  const counter = counted();
  await rig.beforeStart()(prompt, guardContext({ projection: bigProjection(450_000), compact: counter.compact, model: { ...subscriptionModel(), provider: 'anthropic' } }));
  expect(counter.count()).toBe(0);
});

test('the guard compacts when the projection reaches the threshold', async () => {
  const rig = createRig();
  const counter = counted();
  await rig.beforeStart()(prompt, guardContext({ projection: bigProjection(450_000), compact: counter.compact }));
  expect(counter.count()).toBe(1);
  expect(rig.notices.some((notice) => notice.includes('compacting before this request'))).toBe(true);
});

test('a below-threshold projection is left alone', async () => {
  const rig = createRig();
  const counter = counted();
  await rig.beforeStart()(prompt, guardContext({ projection: bigProjection(300_000), compact: counter.compact }));
  expect(counter.count()).toBe(0);
  expect(rig.notices).toStrictEqual([]);
});

test('the guard does not compact while a run is active', async () => {
  const rig = createRig();
  const counter = counted();
  await rig.beforeStart()(prompt, guardContext({ projection: bigProjection(450_000), idle: false, compact: counter.compact }));
  expect(counter.count()).toBe(0);
});

test('the guard respects a disabled compaction setting', async () => {
  const rig = createRig(false);
  const counter = counted();
  await rig.beforeStart()(prompt, guardContext({ projection: bigProjection(450_000), compact: counter.compact }));
  expect(counter.count()).toBe(0);
});

test.for(['Nothing to compact (session too small)', 'Already compacted'])('the benign failure "%s" resolves without a warning', async (message) => {
  const rig = createRig();
  let compactions = 0;
  const ctx = guardContext({
    projection: bigProjection(450_000),
    compact: (options) => {
      compactions += 1;
      options?.onError?.(new Error(message));
    },
  });
  await rig.beforeStart()(prompt, ctx);
  expect(compactions).toBe(1);
  expect(rig.notices.filter((notice) => notice.includes('compaction failed'))).toHaveLength(0);
});

test('only the first real compaction failure warns', async () => {
  const rig = createRig();
  const ctx = guardContext({ projection: bigProjection(450_000), compact: (options) => options?.onError?.(new Error('summarization request failed')) });
  await rig.beforeStart()(prompt, ctx);
  await rig.beforeStart()(prompt, ctx);
  expect(rig.notices.filter((notice) => notice.includes('compaction failed: summarization request failed'))).toHaveLength(1);
});

test('one prompt triggers at most one compaction', async () => {
  const rig = createRig();
  let compactions = 0;
  let finish: (() => void) | undefined;
  const ctx = guardContext({
    projection: bigProjection(450_000),
    compact: (options) => {
      compactions += 1;
      finish = () => options?.onComplete?.({ summary: 'ok', firstKeptEntryId: 'entry', tokensBefore: 1 });
    },
  });
  const first = rig.beforeStart()(prompt, ctx);
  await rig.beforeStart()(prompt, ctx);
  expect(compactions).toBe(1);
  finish?.();
  await first;
});

test('an observed payload calibrates the bias upward', async () => {
  const rig = createRig();
  const counter = counted();
  const ctx = guardContext({ projection: bigProjection(300_000), compact: counter.compact });
  await rig.beforeStart()(prompt, ctx);
  expect(counter.count()).toBe(0);
  rig.guard.observe({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'a'.repeat(300_000) }] }, 50_000);
  await rig.beforeStart()(prompt, ctx);
  expect(counter.count()).toBe(1);
});

function payloadWithTokens(tokens: number): Record<string, unknown> {
  return { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'a'.repeat(tokens * 3) }] };
}

test('a measured ratio resets the bias within the clamp', () => {
  expect(calibratedBias(payloadWithTokens(135_000), 150_000, undefined)).toBe(1);
  expect(calibratedBias(payloadWithTokens(114_000), 100_000, undefined)).toBeCloseTo(1.14);
  expect(calibratedBias(payloadWithTokens(114_000), 50_000, undefined)).toBe(2);
});

test('a measured ratio replaces the 1.2 seed', async () => {
  const rig = createRig();
  const counter = counted();
  const ctx = guardContext({ projection: bigProjection(441_000), compact: counter.compact });
  await rig.beforeStart()(prompt, ctx);
  expect(counter.count()).toBe(1);
  rig.guard.observe(payloadWithTokens(135_000), 150_000);
  await rig.beforeStart()(prompt, ctx);
  expect(counter.count()).toBe(1);
});

test('the observed bias never falls below parity', async () => {
  const rig = createRig();
  const counter = counted();
  rig.guard.observe({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'a'.repeat(435_000) }] }, 290_000);
  await rig.beforeStart()(prompt, guardContext({ projection: bigProjection(435_000), compact: counter.compact }));
  expect(counter.count()).toBe(0);
});

test('a summarization payload does not re-tune the conversation bias', async () => {
  const rig = createRig();
  const counter = counted();
  rig.guard.observe({ model: 'claude-opus-5-5', system: [{ type: 'text', text: 'You are a context summarization assistant.' }], messages: [{ role: 'user', content: 'a'.repeat(435_000) }] }, 290_000);
  await rig.beforeStart()(prompt, guardContext({ projection: bigProjection(435_000), compact: counter.compact }));
  expect(counter.count()).toBe(1);
});

test('a session start resets the observed bias', async () => {
  const rig = createRig();
  const counter = counted();
  const ctx = guardContext({ projection: bigProjection(300_000), compact: counter.compact });
  rig.guard.observe({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'a'.repeat(300_000) }] }, 50_000);
  await rig.beforeStart()(prompt, ctx);
  expect(counter.count()).toBe(1);
  rig.sessionStart()();
  await rig.beforeStart()(prompt, ctx);
  expect(counter.count()).toBe(1);
});

test('shutdown resets the observed bias before another session starts', async () => {
  const rig = createRig();
  const counter = counted();
  const ctx = guardContext({ projection: bigProjection(300_000), compact: counter.compact });
  rig.guard.observe({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'a'.repeat(300_000) }] }, 50_000);
  await rig.beforeStart()(prompt, ctx);
  expect(counter.count()).toBe(1);

  rig.sessionShutdown()();
  await rig.beforeStart()(prompt, ctx);

  expect(counter.count()).toBe(1);
});

test('an invalid observation leaves the session bias unchanged', async () => {
  const rig = createRig();
  const counter = counted();
  rig.guard.observe({ model: 'claude-opus-5-5' }, 0);
  rig.guard.observe(null, 1000);
  rig.guard.observe({ model: 'claude-opus-5-5', messages: 'nope' }, 1000);
  await rig.beforeStart()(prompt, guardContext({ projection: bigProjection(300_000), compact: counter.compact }));
  expect(counter.count()).toBe(0);
});

test('the wire fit reports the first cut of a session once', () => {
  const rig = createRig();
  const over = {
    model: 'claude-opus-5-5',
    messages: [
      { role: 'user', content: 'a'.repeat(600_000) },
      { role: 'user', content: 'keep me' },
    ],
  };
  expect(rig.guard.fit(over, subscriptionModel())).not.toBe(over);
  expect(rig.guard.fit(over, subscriptionModel())).not.toBe(over);
  expect(rig.notices.filter((notice) => notice.includes('trimmed the outgoing request'))).toHaveLength(1);
});
