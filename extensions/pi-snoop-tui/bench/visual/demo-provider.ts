import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Api, Model, SimpleStreamOptions, TranscriptContext } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { estimateTokens, replayStream, type Turn } from '../replay.ts';

const DELTA_CHARS = 3;
const DELTA_INTERVAL_MS = 14;
const TURN_DELAY_MS = 450;
const BASE_INPUT_TOKENS = 4200;
const INPUT_TOKENS_PER_TURN = 900;
const REPLY_OVERHEAD_TOKENS = 40;
const BASE_URL = 'http://127.0.0.1:9';

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

const SIGNAL_EDIT = {
  oldText: 'export async function refreshCache(store: Store): Promise<void> {\n  const snapshot = await withRetry(() => fetchSnapshot());',
  newText: 'export async function refreshCache(store: Store, signal?: AbortSignal): Promise<void> {\n  const snapshot = await withRetry(() => fetchSnapshot({ signal }));',
};

const SCRIPT: readonly Turn[] = [
  {
    text: "I'll check the refresh path and keep the existing retry behavior.",
    toolCalls: [
      { id: 'demo-read', name: 'read', arguments: { path: CACHE_FILE } },
      { id: 'demo-grep', name: 'grep', arguments: { pattern: 'refreshCache', path: 'src' } },
    ],
  },
  { text: '', toolCalls: [{ id: 'demo-edit-signal', name: 'edit', arguments: { path: CACHE_FILE, edits: [SIGNAL_EDIT] } }] },
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

function streamDemo(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) {
  return replayStream(model, context, options, {
    script: SCRIPT,
    deltaChars: DELTA_CHARS,
    deltaIntervalMs: DELTA_INTERVAL_MS,
    leadDelayMs: TURN_DELAY_MS,
    emitEmptyText: false,
    notifyHost: false,
    usage: (assistantCount, turn) => ({ input: BASE_INPUT_TOKENS + assistantCount * INPUT_TOKENS_PER_TURN, output: estimateTokens(turn.text) + REPLY_OVERHEAD_TOKENS }),
  });
}

export default function demoProvider(pi: ExtensionAPI): void {
  pi.registerProvider('demo', {
    name: 'Scripted demo',
    baseUrl: BASE_URL,
    apiKey: 'demo',
    api: 'demo-script',
    models: [{ id: 'demo-model', name: 'Demo', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 64_000, maxTokens: 8_000 }],
    streamSimple: streamDemo,
  });
  pi.on('session_start', (_event, ctx) => writeWorkspace(ctx.cwd));
}
