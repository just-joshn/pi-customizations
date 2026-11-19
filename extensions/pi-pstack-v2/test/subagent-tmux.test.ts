import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { runPiInTmux } from '../src/subagent/run-in-tmux.ts';

describe('runPiInTmux', () => {
  test('starts the command inside a live tmux session', async () => {
    let seen: string | undefined;
    const chunks: string[] = [];
    const outcome = await runPiInTmux({
      command: 'bash',
      args: ['-c', 'echo hello-from-tmux; sleep 0.4'],
      cwd: process.cwd(),
      onStdoutChunk: (chunk) => chunks.push(chunk),
      onStderrChunk: () => undefined,
      onSessionStarted: (session) => {
        seen = session;
        execFileSync('tmux', ['has-session', '-t', `=${session}`], { stdio: 'ignore' });
      },
    });
    expect(seen).toMatch(/^pi-subagent-/);
    expect(outcome.code).toBe(0);
    expect(chunks.join('')).toContain('hello-from-tmux');
  }, 15_000);

  test('abort kills the tmux session', async () => {
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
    expect(() => execFileSync('tmux', ['has-session', '-t', `=${session!}`], { stdio: 'ignore' })).toThrow();
    expect(outcome.signal).toBe('SIGTERM');
  }, 15_000);
});
