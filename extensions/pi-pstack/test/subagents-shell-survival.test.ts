import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import type { ShellRecord } from '../src/shell-runtime.ts';
import { workerFixture } from './worker-fixture.ts';

type Launched = { agentId: string };
const shellList = 'Background' + 'ShellList';
const endsWithFinalResponse = 'backgroundEnds' + 'WithFinalResponse';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function childShell(dir: string): Promise<ShellRecord> {
  const history = (await readFile(join(dir, 'child-tool-results-history.jsonl'), 'utf8')).trim().split('\n');
  const results = history.flatMap((line) => JSON.parse(line) as { toolName: string; details: ShellRecord }[]);
  const started = results.find((result) => result.toolName === 'BackgroundShell');
  if (!started) throw new Error('the child never started a background shell');
  return started.details;
}

test('an async worker hands its background shell to the parent, which ends it at shutdown', async () => {
  const fixture = await workerFixture({ shells: true });
  let shell: ShellRecord | undefined;
  try {
    const { agentId } = (await fixture.call('Agent', { description: 'async shell', prompt: 'BG_SHELL_SLEEP' })).details as Launched;
    expect((await fixture.call('TaskOutput', { task_id: agentId, block: true })).details).toMatchObject({ status: 'settled' });
    shell = await childShell(fixture.dir);
    expect(shell).not.toHaveProperty(endsWithFinalResponse);
    expect(alive(shell.pid)).toBe(true);
    expect((await fixture.call(shellList, {})).details).toMatchObject([{ id: shell.id, title: 'keepalive probe', status: { kind: 'running' } }]);
  } finally {
    await fixture.close();
  }
  expect(alive(shell?.pid ?? 0)).toBe(false);
});

test('a synchronous worker marks its background shell and ends it with its final response', async () => {
  const fixture = await workerFixture({ shells: true });
  try {
    expect((await fixture.call('Agent', { description: 'sync shell', prompt: 'BG_SHELL_SLEEP', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    const shell = await childShell(fixture.dir);
    expect(shell.backgroundEndsWithFinalResponse).toBe(true);
    expect(alive(shell.pid)).toBe(false);
    expect((await fixture.call(shellList, {})).details).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('a stopped async worker does not keep its background shell alive', async () => {
  const fixture = await workerFixture({ shells: true });
  try {
    const { agentId } = (await fixture.call('Agent', { description: 'stopped shell', prompt: 'BG_SHELL_SLEEP WAIT_BLOCKED' })).details as Launched;
    const shell = await vi.waitFor(() => childShell(fixture.dir), { timeout: 5000 });
    await fixture.call('TaskStop', { task_id: agentId });
    expect(alive(shell.pid)).toBe(false);
    expect((await fixture.call(shellList, {})).details).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('an isolated async worker that keeps a shell alive keeps its worktree', async () => {
  const fixture = await workerFixture({ shells: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture.dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.email', 'a@b.c');
    git('config', 'user.name', 'n');
    git('add', 'settings.json');
    git('commit', '-qm', 'init');
    const { agentId } = (await fixture.call('Agent', { description: 'kept shell', prompt: 'BG_SHELL_SLEEP', isolation: 'worktree' })).details as Launched;
    const record = (await fixture.call('TaskOutput', { task_id: agentId, block: true })).details as { worktreePath?: string; worktreeCleanlyRemoved?: boolean };
    expect(record).toMatchObject({ worktreeCleanlyRemoved: false, worktreePath: expect.stringContaining(`agent-`) });
    expect(existsSync(record.worktreePath ?? '')).toBe(true);
  } finally {
    await fixture.close();
  }
});
