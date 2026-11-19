import { execFileSync } from 'node:child_process';

import { describe, expect, test } from 'vitest';
import { runPiInTmux } from '../src/subagent/run-in-tmux.ts';

const TEST_TIMEOUT_MS = 15_000;

async function startsInsideTmux(): Promise<void> {
  let seen: string | undefined;
  let chunks: readonly string[] = [];
  const outcome = await runPiInTmux({
    command: 'bash',
    args: ['-c', 'echo hello-from-tmux; sleep 0.4'],
    cwd: process.cwd(),
    onStdoutChunk: (chunk) => {
      chunks = [...chunks, chunk];
    },
    onStderrChunk: () => undefined,
    onSessionStarted: (session) => {
      seen = session;
      execFileSync('tmux', ['has-session', '-t', `=${session}`], { stdio: 'ignore' });
    },
  });
  expect(seen).toMatch(/^pi-subagent-/);
  expect(outcome.code).toBe(0);
  expect(chunks.join('')).toContain('hello-from-tmux');
}

async function abortKillsSession(): Promise<void> {
  const controller = new AbortController();
  let session: string | undefined;
  const outcomePromise = runPiInTmux({
    command: 'bash',
    args: ['-c', 'sleep 30'],
    cwd: process.cwd(),
    signal: controller.signal,
    onStdoutChunk: () => undefined,
    onStderrChunk: () => undefined,
    onSessionStarted: (name) => {
      session = name;
      controller.abort();
    },
  });
  const outcome = await outcomePromise;
  expect(session).toBeDefined();
  expect(() => execFileSync('tmux', ['has-session', '-t', `=${session}`], { stdio: 'ignore' })).toThrow();
  expect(outcome.signal).toBe('SIGTERM');
}

describe('runPiInTmux', () => {
  test('starts the command inside a live tmux session', startsInsideTmux, TEST_TIMEOUT_MS);
  test('abort kills the tmux session', abortKillsSession, TEST_TIMEOUT_MS);
});
