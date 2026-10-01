import { tmpdir } from 'node:os';

import { expect, test, vi } from 'vitest';
import { runShellCommand } from '../src/subagents/shell-command.ts';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('a timed-out shell kills descendants holding its output pipes and completes promptly', async () => {
  const started = Date.now();
  const result = await runShellCommand('sleep 2 & wait', { cwd: tmpdir(), input: '', env: process.env, timeoutMs: 100 });

  expect(result.code).toBe(124);
  expect(result.stderr).toContain('terminated by timeout');
  expect(Date.now() - started).toBeLessThan(1000);
});

test('timeout escalation kills a descendant even after the shell closes its output pipes', async () => {
  const result = await runShellCommand("(trap '' TERM; echo $$; exec sleep 30 >/dev/null 2>&1) & sleep 30", {
    cwd: tmpdir(),
    input: '',
    env: process.env,
    timeoutMs: 100,
  });
  const pid = Number(result.stdout.trim().split('\n')[0]);

  try {
    expect(result.code).toBe(124);
    expect(Number.isSafeInteger(pid)).toBe(true);
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 1000 });
  } finally {
    if (alive(pid)) process.kill(pid, 'SIGKILL');
  }
});
