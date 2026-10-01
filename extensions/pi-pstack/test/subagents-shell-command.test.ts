import { tmpdir } from 'node:os';

import { expect, test } from 'vitest';
import { runShellCommand } from '../src/subagents/shell-command.ts';

test('a timed-out shell kills descendants holding its output pipes and completes promptly', async () => {
  const started = Date.now();
  const result = await runShellCommand('sleep 2 & wait', { cwd: tmpdir(), input: '', env: process.env, timeoutMs: 100 });

  expect(result.code).toBe(124);
  expect(result.stderr).toContain('terminated by timeout');
  expect(Date.now() - started).toBeLessThan(1000);
});
