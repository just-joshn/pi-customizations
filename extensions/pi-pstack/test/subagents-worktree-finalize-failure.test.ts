import { execFileSync } from 'node:child_process';

import { expect, test, vi } from 'vitest';
import { finalizeWorktree } from '../src/subagents/worktree.ts';
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

test('partial cleanup warnings appear on foreground results and background completion notifications', async () => {
  const fixture = await workerFixture();
  const finalize = vi.mocked(finalizeWorktree);
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture.dir });
    git('init', '-q');
    git('config', 'user.email', 'a@b.c');
    git('config', 'user.name', 'n');
    git('add', 'settings.json');
    git('commit', '-qm', 'init');

    const foregroundWarning = "Worktree was removed, but branch 'foreground-branch' remains";
    finalize.mockResolvedValueOnce({ kept: false, branchCleanupError: foregroundWarning });
    const foreground = await fixture.call('Agent', { description: 'partial cleanup', prompt: 'clean', isolation: 'worktree', run_in_background: false });
    const foregroundAgent = foreground.details as { agentId: string };
    const foregroundRecord = await fixture.call('TaskOutput', { task_id: foregroundAgent.agentId });
    expect(foregroundRecord.details).toMatchObject({ worktreeCleanlyRemoved: true, worktreeCleanupWarning: foregroundWarning });
    const [content] = foreground.content;
    expect(content?.type === 'text' ? content.text : '').toContain(foregroundWarning);

    const backgroundWarning = "Worktree was removed, but branch 'background-branch' remains";
    finalize.mockResolvedValueOnce({ kept: false, branchCleanupError: backgroundWarning });
    const started = await fixture.call('Agent', { description: 'partial cleanup notice', prompt: 'clean', isolation: 'worktree' });
    const { agentId } = started.details as { agentId: string };
    await vi.waitFor(() => {
      const notification = fixture.session.messages.findLast((message) => message.role === 'custom' && message.customType === 'task_notification' && (message.details as { task_id?: string }).task_id === agentId);
      const details = notification && 'details' in notification ? notification.details : undefined;
      expect(details).toMatchObject({ worktree_cleanup_warning: backgroundWarning });
      expect(String(notification && 'content' in notification ? notification.content : '')).toContain(backgroundWarning);
    });
  } finally {
    finalize.mockReset().mockRejectedValue(new Error('git refused the removal'));
    await fixture.close();
  }
});
