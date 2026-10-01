import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AgentSession } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

type Fixture = Awaited<ReturnType<typeof workerFixture>>;

function initRepository(fixture: Fixture): void {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture.dir });
  git('init', '-q');
  git('config', 'user.email', 'a@b.c');
  git('config', 'user.name', 'n');
  git('add', 'settings.json');
  git('commit', '-qm', 'init');
}

test('a failing child shutdown stage still finalizes the worktree and reports the failure', async () => {
  const fixture = await workerFixture();
  try {
    initRepository(fixture);
    await writeFile(join(fixture.dir, 'extensions/failing-shutdown.ts'), `export default pi => { pi.on('session_shutdown', () => { throw new Error('extension cleanup failure'); }); };`);
    await expect(fixture.call('Agent', { description: 'staged', prompt: 'clean', isolation: 'worktree', run_in_background: false })).rejects.toThrow(/extension cleanup failure/);
    const [agent] = ((await fixture.call('ListAgents', {})).details as { agents: { agentId: string }[] }).agents;
    const record = (await fixture.call('TaskOutput', { task_id: agent?.agentId ?? '' })).details as { status: string; output: string; cwd: string; worktreeCleanlyRemoved?: boolean };
    expect(record).toMatchObject({ status: 'failed', worktreeCleanlyRemoved: true, output: expect.stringContaining('Worker shutdown failed') });
    expect(existsSync(record.cwd)).toBe(false);
  } finally {
    await fixture.close();
  }
});

test('a resumed isolated agent finalizes its retained worktree again when the run settles', async () => {
  const fixture = await workerFixture();
  try {
    initRepository(fixture);
    const first = await fixture.call('Agent', { description: 'retained', prompt: 'WORKTREE_WRITE', isolation: 'worktree', run_in_background: false });
    const { agentId, worktreePath } = first.details as { agentId: string; worktreePath: string };
    await rm(join(worktreePath, 'child-change.txt'));
    await fixture.call('SendMessage', { to: agentId, message: 'nothing left to change' });
    expect((await fixture.call('TaskOutput', { task_id: agentId, block: true })).details).toMatchObject({ status: 'settled', worktreeCleanlyRemoved: true });
    expect(existsSync(worktreePath)).toBe(false);
  } finally {
    await fixture.close();
  }
});

test('every child session is disposed once its run settles', async () => {
  const fixture = await workerFixture();
  const disposed: AgentSession[] = [];
  const dispose = AgentSession.prototype.dispose;
  const spy = vi.spyOn(AgentSession.prototype, 'dispose').mockImplementation(function (this: AgentSession) {
    disposed.push(this);
    dispose.call(this);
  });
  try {
    await fixture.call('Agent', { description: 'first', prompt: 'done', run_in_background: false });
    await fixture.call('Agent', { description: 'second', prompt: 'done', run_in_background: false });
    const children = disposed.filter((session) => session !== fixture.session);
    expect(children).toHaveLength(2);
    expect(new Set(children).size).toBe(2);
  } finally {
    spy.mockRestore();
    await fixture.close();
  }
});

test('a nested agent inside an isolated agent records the inherited worktree binding', async () => {
  const fixture = await workerFixture();
  try {
    initRepository(fixture);
    const done = await fixture.call('Agent', { description: 'isolated parent', prompt: 'SPAWN_AGENT', isolation: 'worktree', run_in_background: false });
    const { agentId } = done.details as { agentId: string };
    const parent = (await fixture.call('TaskOutput', { task_id: agentId })).details as { cwd: string; sessionFile: string };
    const entries = (await readFile(parent.sessionFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; customType?: string; data?: { inheritedWorktreePath?: string; cwd?: string } });
    const nested = entries.filter((entry) => entry.customType === 'pstack-task').at(-1)?.data;
    expect(nested).toMatchObject({ inheritedWorktreePath: parent.cwd, cwd: parent.cwd });
  } finally {
    await fixture.close();
  }
});
