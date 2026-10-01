import { execFileSync } from 'node:child_process';

import { expect, test, vi } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

vi.mock(import('../src/subagents/worktree.ts'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, finalizeWorktree: vi.fn(async () => Promise.reject(new Error('git refused the removal'))) };
});

test('a worktree finalization failure is reported in the output and the result is still delivered', async () => {
  const fixture = await workerFixture();
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture.dir });
    git('init', '-q');
    git('config', 'user.email', 'a@b.c');
    git('config', 'user.name', 'n');
    git('add', 'settings.json');
    git('commit', '-qm', 'init');
    const done = await fixture.call('Agent', { description: 'finalize failure', prompt: 'clean', isolation: 'worktree', run_in_background: false });
    expect(done.details).toMatchObject({ status: 'completed' });
    const { agentId } = done.details as { agentId: string };
    expect((await fixture.call('TaskOutput', { task_id: agentId })).details).toMatchObject({ status: 'settled', output: 'users=1\nWorktree cleanup failed: Error: git refused the removal' });
  } finally {
    await fixture.close();
  }
});
