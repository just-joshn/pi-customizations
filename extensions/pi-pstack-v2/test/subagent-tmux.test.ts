import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import { hostEnv } from '../src/host-env.ts';
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
    onSessionStarted: (session, socket) => {
      seen = session;
      execFileSync('tmux', ['-S', socket, 'has-session', '-t', `=${session}`], { stdio: 'ignore' });
    },
  });
  expect(seen).toMatch(/^pi-subagent-/);
  expect(outcome.code).toBe(0);
  expect(chunks.join('')).toContain('hello-from-tmux');
}

async function abortKillsSession(): Promise<void> {
  const controller = new AbortController();
  let session: string | undefined;
  let socket = '';
  const outcomePromise = runPiInTmux({
    command: 'bash',
    args: ['-c', 'sleep 30'],
    cwd: process.cwd(),
    signal: controller.signal,
    onStdoutChunk: () => undefined,
    onStderrChunk: () => undefined,
    onSessionStarted: (name, socketPath) => {
      session = name;
      socket = socketPath;
      controller.abort();
    },
  });
  const outcome = await outcomePromise;
  expect(session).toBeDefined();
  expect(() => execFileSync('tmux', ['-S', socket, 'has-session', '-t', `=${session}`], { stdio: 'ignore' })).toThrow();
  expect(outcome.signal).toBe('SIGTERM');
}

/**
 * A user's tmux server is usually already running, started with whatever environment it had then. The child Pi must
 * still see the dispatching Pi's environment (agent dir, credentials, PATH), not that server's.
 */
async function childSeesParentEnvWithRunningServer(): Promise<void> {
  const tmuxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagent-tmux-test-'));
  vi.stubEnv('TMUX_TMPDIR', tmuxDir);
  vi.stubEnv('TMUX', '');
  const { PI_SUBAGENT_TEST_VAR: _unset, ...serverEnv } = hostEnv();
  execFileSync('tmux', ['new-session', '-d', '-s', 'already-running', 'sleep 30'], { stdio: 'ignore', env: serverEnv });
  vi.stubEnv('PI_SUBAGENT_TEST_VAR', 'from-parent');
  try {
    let chunks: readonly string[] = [];
    const outcome = await runPiInTmux({
      command: 'bash',
      args: ['-c', 'echo "var=[$PI_SUBAGENT_TEST_VAR]"'],
      cwd: process.cwd(),
      onStdoutChunk: (chunk) => {
        chunks = [...chunks, chunk];
      },
      onStderrChunk: () => undefined,
    });
    expect(outcome.code).toBe(0);
    expect(chunks.join('')).toContain('var=[from-parent]');
  } finally {
    execFileSync('tmux', ['kill-server'], { stdio: 'ignore', env: hostEnv() });
    vi.unstubAllEnvs();
    fs.rmSync(tmuxDir, { recursive: true, force: true });
  }
}

describe('runPiInTmux', () => {
  test('the child sees the parent environment when a tmux server is already running', childSeesParentEnvWithRunningServer, TEST_TIMEOUT_MS);
  test('starts the command inside a live tmux session', startsInsideTmux, TEST_TIMEOUT_MS);
  test('abort kills the tmux session', abortKillsSession, TEST_TIMEOUT_MS);
});
