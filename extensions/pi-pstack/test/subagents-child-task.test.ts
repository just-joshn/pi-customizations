import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { ChildTask } from '../src/subagents/child-task.ts';
import { RpcChild } from '../src/subagents/rpc-child.ts';
import { test as childTest, loggedCommands, newTask } from './child-harness.ts';

childTest.for(['', 'prior answer'])('handled prompts settle without returning prior assistant text %j', async (prior, { workspace }) => {
  const { task, host } = newTask(workspace, { env: { FAKE_PI_DISPOSITION: 'handled', FAKE_PI_PRIOR_TEXT: prior } });
  await task.open();

  const record = await task.begin('/handled');

  expect(record).toMatchObject({ status: 'settled', output: '', toolUseCount: 0 });
  expect(host.settlements).toHaveLength(1);
  expect(task.alive).toBe(false);
  expect((await loggedCommands(workspace)).map((command) => command.type)).not.toContain('get_last_assistant_text');
  expect((await loggedCommands(workspace)).map((command) => command.type)).not.toContain('get_session_stats');
});

childTest.for(['started', 'queued'])('$0 prompts wait for agent_settled, not acceptance or agent_end', async (disposition, { workspace }) => {
  const { task, host } = newTask(workspace, { kind: 'teammate', env: { FAKE_PI_DISPOSITION: disposition, FAKE_PI_PRIOR_TEXT: 'prior answer' } });
  await task.open();
  const completion = task.begin('hang');
  await task.steer('agent_end', 'steer');

  expect(host.settlements).toHaveLength(0);
  expect((await loggedCommands(workspace)).map((command) => command.type)).not.toContain('get_last_assistant_text');
  await task.steer('settle', 'steer');

  expect(await completion).toMatchObject({ status: 'settled', output: 'fresh answer' });
  expect(host.settlements).toHaveLength(1);
});

childTest('prompt rejection settles the failed record and closes the child before rejecting', async ({ workspace }) => {
  const { task, host } = newTask(workspace, { env: { FAKE_PI_PROMPT_ERROR: 'preflight rejected', FAKE_PI_PRIOR_TEXT: 'prior answer' } });
  await task.open();

  await expect(task.begin('fail preflight')).rejects.toThrow('preflight rejected');

  expect(host.settlements).toHaveLength(1);
  expect(host.settlements[0]?.record).toMatchObject({ status: 'failed', output: 'preflight rejected' });
  expect(task.alive).toBe(false);
  await expect(task.done).rejects.toThrow('preflight rejected');
  expect(await task.stop()).toMatchObject({ status: 'failed', output: 'preflight rejected' });
  expect((await loggedCommands(workspace)).map((command) => command.type)).not.toContain('get_last_assistant_text');
});

childTest('an unobserved prompt rejection still settles and closes the child', async ({ workspace }) => {
  const { task, host } = newTask(workspace, { env: { FAKE_PI_PROMPT_ERROR: 'preflight rejected' } });
  await task.open();

  void task.begin('fail preflight');

  await vi.waitFor(() => expect(host.settlements).toHaveLength(1));
  expect(task.alive).toBe(false);
});

childTest('handled teammate prompts settle while leaving their process available', async ({ workspace }) => {
  const { task, host } = newTask(workspace, { kind: 'teammate', env: { FAKE_PI_DISPOSITION: 'handled', FAKE_PI_PRIOR_TEXT: 'prior answer' } });
  await task.open();

  expect(await task.begin('/handled')).toMatchObject({ status: 'settled', output: '' });
  expect(await task.begin('/handled again')).toMatchObject({ status: 'settled', output: '' });
  expect(host.settlements).toHaveLength(2);
  expect(task.alive).toBe(true);
});

childTest('fast settlement received before the prompt reply is awaited is retained', async ({ workspace }) => {
  const { task } = newTask(workspace, { env: { FAKE_PI_EARLY_SETTLE: '1' } });
  await task.open();

  expect(await task.begin('fast')).toMatchObject({ status: 'settled', output: 'done: fast' });
});

test('opening a child fails instead of falling back when its recorded cwd is missing', async () => {
  const start = vi.spyOn(RpcChild, 'start');
  const cwd = join(tmpdir(), `missing-child-${randomUUID()}`);
  const task = new ChildTask({ start: { cwd } } as never, {} as never);
  try {
    await expect(task.open()).rejects.toThrow(`Task working directory does not exist: ${cwd}`);
    expect(start).not.toHaveBeenCalled();
  } finally {
    start.mockRestore();
  }
});
