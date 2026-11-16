import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { type Api, type AssistantMessage, type AssistantMessageEventStream, createAssistantMessageEventStream, type Model, type SimpleStreamOptions, type ToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const DELTA_CHARS = 3;
const DELTA_INTERVAL_MS = 14;
const TURN_DELAY_MS = 450;

const CACHE_FILE = 'src/session/cache.ts';

const CACHE_SOURCE = `import { fetchSnapshot } from './api';
import { withRetry } from './retry';
import type { Snapshot, Store } from './store';

const STALE_AFTER_MS = 30_000;

export function isStale(snapshot: Snapshot | undefined, now = Date.now()): boolean {
  return !snapshot || now - snapshot.fetchedAt > STALE_AFTER_MS;
}

export async function refreshCache(store: Store): Promise<void> {
  const snapshot = await withRetry(() => fetchSnapshot());
  store.replace(snapshot);
}

export function clearCache(store: Store): void {
  store.replace(undefined);
}
`;

const LOADER_SOURCE = `import { isStale, refreshCache } from './cache';
import type { Store } from './store';

export async function load(store: Store): Promise<void> {
  if (isStale(store.current())) await refreshCache(store);
}

export function watch(store: Store): () => void {
  const timer = setInterval(() => void refreshCache(store), 60_000);
  return () => clearInterval(timer);
}
`;

const TEST_SCRIPT = `#!/bin/sh
echo " RUN  test/cache.test.ts"
sleep 0.4
echo "   ✓ refreshes a stale snapshot"
sleep 0.4
if grep -q throwIfAborted src/session/cache.ts; then
  echo "   ✓ respects cancellation"
  sleep 0.4
  echo " Tests  2 passed"
  exit 0
fi
echo "   ✗ respects cancellation"
sleep 0.3
echo "     expected store to be untouched, got 1 replace call"
echo "     at test/cache.test.ts:18:7"
sleep 0.4
echo " Tests  1 failed, 1 passed"
exit 1
`;

const WORKSPACE: Readonly<Record<string, string>> = {
  'package.json': `${JSON.stringify({ name: 'session-cache', version: '1.0.0', private: true, scripts: { test: 'sh test.sh' } }, null, 2)}\n`,
  'test.sh': TEST_SCRIPT,
  [CACHE_FILE]: CACHE_SOURCE,
  'src/session/loader.ts': LOADER_SOURCE,
};

interface Turn {
  readonly text: string;
  readonly toolCalls: readonly Omit<ToolCall, 'type'>[];
}

const SCRIPT: readonly Turn[] = [
  {
    text: "I'll check the refresh path and keep the existing retry behavior.",
    toolCalls: [
      { id: 'demo-read', name: 'read', arguments: { path: CACHE_FILE } },
      { id: 'demo-grep', name: 'grep', arguments: { pattern: 'refreshCache', path: 'src' } },
    ],
  },
  {
    text: '',
    toolCalls: [
      {
        id: 'demo-edit-signal',
        name: 'edit',
        arguments: {
          path: CACHE_FILE,
          edits: [
            {
              oldText: 'export async function refreshCache(store: Store): Promise<void> {\n  const snapshot = await withRetry(() => fetchSnapshot());',
              newText: 'export async function refreshCache(store: Store, signal?: AbortSignal): Promise<void> {\n  const snapshot = await withRetry(() => fetchSnapshot({ signal }));',
            },
          ],
        },
      },
    ],
  },
  { text: '', toolCalls: [{ id: 'demo-test-fail', name: 'bash', arguments: { command: 'npm test' } }] },
  {
    text: 'The fetch stops, but the store still updates after an abort. Check the signal before replacing it.',
    toolCalls: [
      {
        id: 'demo-edit-guard',
        name: 'edit',
        arguments: { path: CACHE_FILE, edits: [{ oldText: '  store.replace(snapshot);', newText: '  signal?.throwIfAborted();\n  store.replace(snapshot);' }] },
      },
    ],
  },
  { text: '', toolCalls: [{ id: 'demo-test-pass', name: 'bash', arguments: { command: 'npm test' } }] },
  {
    text: '`refreshCache` now takes an optional `AbortSignal`. An aborted refresh leaves the store untouched.\n\nExisting retries are unchanged. **Tests pass.**',
    toolCalls: [],
  },
];

function writeWorkspace(cwd: string): void {
  for (const [path, content] of Object.entries(WORKSPACE)) {
    const target = join(cwd, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

function streamDemo(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const lastUser = context.messages.findLastIndex((message) => message.role === 'user');
  const assistantCount = context.messages.slice(lastUser + 1).filter((message) => message.role === 'assistant').length;
  const turn = SCRIPT[Math.min(assistantCount, SCRIPT.length - 1)] ?? { text: '', toolCalls: [] };
  const signal = options?.signal;
  const output: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'pending',
    timestamp: Date.now(),
  };

  void (async () => {
    try {
      stream.push({ type: 'start', partial: output });
      await sleep(TURN_DELAY_MS, signal);

      if (turn.text) {
        const block = { type: 'text' as const, text: '' };
        output.content.push(block);
        const textIndex = output.content.length - 1;
        stream.push({ type: 'text_start', contentIndex: textIndex, partial: output });
        for (let offset = 0; offset < turn.text.length; offset += DELTA_CHARS) {
          await sleep(DELTA_INTERVAL_MS, signal);
          const delta = turn.text.slice(offset, offset + DELTA_CHARS);
          block.text += delta;
          stream.push({ type: 'text_delta', contentIndex: textIndex, delta, partial: output });
        }
        stream.push({ type: 'text_end', contentIndex: textIndex, content: block.text, partial: output });
      }

      for (const call of turn.toolCalls) {
        const toolCall: ToolCall = { type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments };
        output.content.push(toolCall);
        const index = output.content.length - 1;
        stream.push({ type: 'toolcall_start', contentIndex: index, partial: output });
        stream.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(call.arguments), partial: output });
        stream.push({ type: 'toolcall_end', contentIndex: index, toolCall, partial: output });
      }

      output.usage.input = 4200 + assistantCount * 900;
      output.usage.output = Math.ceil(turn.text.length / 4) + 40;
      output.usage.totalTokens = output.usage.input + output.usage.output;
      output.stopReason = turn.toolCalls.length > 0 ? 'toolUse' : 'stop';
      stream.push({ type: 'done', reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      output.stopReason = signal?.aborted ? 'aborted' : 'error';
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: 'error', reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

export default function demoProvider(pi: ExtensionAPI): void {
  pi.registerProvider('demo', {
    name: 'Scripted demo',
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'demo',
    api: 'demo-script',
    models: [{ id: 'demo-model', name: 'Demo', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 64_000, maxTokens: 8_000 }],
    streamSimple: streamDemo,
  });
  pi.on('session_start', (_event, ctx) => writeWorkspace(ctx.cwd));
}
