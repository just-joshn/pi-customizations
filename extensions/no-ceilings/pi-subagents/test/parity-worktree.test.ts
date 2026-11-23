import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Theme } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

vi.mock(import('@earendil-works/pi-coding-agent'), async (importOriginal) => {
  const { createCodingAgentMock } = await import('./parity-support.ts');
  return createCodingAgentMock(await importOriginal());
});

import { createGate, createTestHarness, double } from './harness.ts';
import { ZERO, ONE, captured, enqueuePlan, initRepo, installSlowGit, persistedWorktreePath, promptCalls, setCreationGate, installParityHooks } from './parity-support.ts';

installParityHooks();

describe('worktree and transcript durability', () => {
  it('keeps the worktree across resumes and refuses a resume after prune', async () => {
    const h = createTestHarness();
    try {
      initRepo(h.cwd);
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'first' });
      const first = await h.callTool('task', { description: 'Isolated job', prompt: 'go', subagent_type: 'general-purpose', worktree: true });
      const worktreePath = first.details?.worktreePath;
      expect(worktreePath).toBeTypeOf('string');
      expect(typeof worktreePath === 'string' && existsSync(worktreePath)).toBe(true);
      enqueuePlan({ finalText: 'second' });
      const second = await h.callTool('task', { description: 'Isolated job', prompt: 'again', subagent_type: 'general-purpose', resume: first.details?.agentId });
      expect(second.details?.worktreePath).toBe(worktreePath);
      expect(second.details?.branch).toBe(first.details?.branch);
      await h.runCommand('tasks', `prune ${first.details?.agentId ?? ''}`);
      expect(h.getNotifications().at(-ONE)?.message).toContain('Removed worktree');
      enqueuePlan({ finalText: 'third' });
      await expect(h.callTool('task', { description: 'Isolated job', prompt: 'again', subagent_type: 'general-purpose', resume: first.details?.agentId })).rejects.toMatchObject({ code: 'resume-unavailable' });
    } finally {
      await h.cleanup();
    }
  });

  it('refuses to resume when the transcript file is gone or corrupt', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'first' });
      const first = await h.callTool('task', { description: 'Transcript job', prompt: 'go', subagent_type: 'general-purpose' });
      const transcriptPath = first.details?.transcriptPath;
      expect(transcriptPath).toBeTypeOf('string');
      expect(transcriptPath ?? '').toContain('.jsonl');
      if (transcriptPath === undefined) {
        throw new Error('missing transcript path');
      }
      writeFileSync(transcriptPath, 'not a session\n');
      enqueuePlan({ finalText: 'second' });
      const corrupt = await h.callTool('task', { description: 'Transcript job', prompt: 'again', subagent_type: 'general-purpose', resume: first.details?.agentId });
      expect(corrupt.details?.status).toBe('error');
      expect(corrupt.details?.errorCode).toBe('resume-unavailable');
      rmSync(transcriptPath, { force: true });
      await expect(h.callTool('task', { description: 'Transcript job', prompt: 'again', subagent_type: 'general-purpose', resume: first.details?.agentId })).rejects.toMatchObject({ code: 'resume-unavailable' });
    } finally {
      await h.cleanup();
    }
  });

  it('includes the worktree diff summary in a background result', async () => {
    const h = createTestHarness();
    try {
      initRepo(h.cwd);
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'isolated done', waitForRelease: gate.promise });
      const launched = await h.callTool('task', { description: 'Isolated job', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true, worktree: true });
      const agentId = launched.details?.agentId ?? '';
      await expect.poll(() => persistedWorktreePath(h, agentId)).toBeTypeOf('string');
      const worktreePath = persistedWorktreePath(h, agentId);
      expect(typeof worktreePath === 'string' && existsSync(worktreePath)).toBe(true);
      if (worktreePath !== undefined) {
        writeFileSync(join(worktreePath, 'notes.txt'), 'changed\n');
      }
      gate.release();
      const awaited = await h.callTool('await_subagent', { agent_id: agentId });
      const text = (awaited.content[ZERO] as { readonly text?: string }).text ?? '';
      expect(text).toContain('notes.txt');
      expect(awaited.details?.worktreePath).toBe(worktreePath);
    } finally {
      await h.cleanup();
    }
  });
});

describe('round-eight background worktree lifecycle', () => {
  it('returns a background worktree launch before git worktree add finishes', async () => {
    const h = createTestHarness();
    const bin = join(h.cwd, 'bin');
    const flag = join(h.cwd, 'worktree-add-started');
    installSlowGit(bin, 'worktree', flag);
    const previousPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:${previousPath ?? ''}`;
    try {
      initRepo(h.cwd);
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'background worktree done' });
      const started = Date.now();
      const launched = await h.callTool('task', { description: 'Background worktree', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true, worktree: true });
      const elapsed = Date.now() - started;
      expect(launched.details?.status).toBe('running');
      expect(launched.details?.isBackground).toBe(true);
      expect(elapsed).toBeLessThan(1000);
      const awaited = await h.callTool('await_subagent', { agent_id: launched.details?.agentId });
      expect(awaited.details?.status).toBe('success');
      expect(awaited.details?.worktreePath).toBeTypeOf('string');
    } finally {
      process.env['PATH'] = previousPath;
      await h.cleanup();
    }
  }, 30_000);

  it('does not launch a background worktree when the call is already aborted', async () => {
    const h = createTestHarness();
    try {
      initRepo(h.cwd);
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'should not run' });
      const controller = new AbortController();
      controller.abort();
      const result = await h.callTool('task', { description: 'Aborted background worktree', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true, worktree: true }, { signal: controller.signal });
      expect(result.details?.status).toBe('cancelled');
      expect(result.details?.worktreePath).toBeUndefined();
      const branches = execFileSync('git', ['branch', '--list', 'pi-subagents/*'], { cwd: h.cwd, encoding: 'utf8' }).trim();
      expect(branches).toBe('');
      expect(promptCalls).toBe(ZERO);
    } finally {
      await h.cleanup();
    }
  });

  it('removes the worktree and branch when a call aborts during git worktree add', async () => {
    const h = createTestHarness();
    const bin = join(h.cwd, 'bin');
    const flag = join(h.cwd, 'worktree-add-started');
    installSlowGit(bin, 'worktree', flag);
    const previousPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:${previousPath ?? ''}`;
    try {
      initRepo(h.cwd);
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'should not run' });
      const controller = new AbortController();
      const pending = h.callTool('task', { description: 'Abort during worktree', prompt: 'go', subagent_type: 'general-purpose', worktree: true }, { signal: controller.signal });
      await vi.waitFor(() => expect(existsSync(flag)).toBe(true));
      controller.abort();
      const result = await pending;
      expect(result.details?.status).toBe('cancelled');
      expect(result.details?.worktreePath).toBeUndefined();
      const branches = execFileSync('git', ['branch', '--list', 'pi-subagents/*'], { cwd: h.cwd, encoding: 'utf8' }).trim();
      expect(branches).toBe('');
      expect(promptCalls).toBe(ZERO);
    } finally {
      process.env['PATH'] = previousPath;
      await h.cleanup();
    }
  }, 30_000);
});

describe('abort handling and pre-aborted worktrees', () => {
  it('reports an aborted await as aborted', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'slow', waitForRelease: gate.promise });
      const launched = await h.callTool('task', { description: 'Await abort', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true });
      const controller = new AbortController();
      controller.abort();
      const awaited = await h.callTool('await_subagent', { agent_id: launched.details?.agentId }, { signal: controller.signal });
      expect(awaited.details?.errorCode).toBe('aborted');
      gate.release();
      await h.callTool('await_subagent', { agent_id: launched.details?.agentId });
    } finally {
      await h.cleanup();
    }
  });

  it('reports an aborted resume-await as aborted', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'slow', waitForRelease: gate.promise });
      const launched = await h.callTool('task', { description: 'Resume abort', prompt: 'go', subagent_type: 'explore', run_in_background: true });
      const controller = new AbortController();
      controller.abort();
      await expect(h.callTool('task', { description: 'Resume abort', prompt: '', subagent_type: 'explore', resume: launched.details?.agentId }, { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
      gate.release();
      await h.callTool('await_subagent', { agent_id: launched.details?.agentId });
    } finally {
      await h.cleanup();
    }
  });

  it('does not create a worktree when the call is already aborted', async () => {
    const h = createTestHarness();
    try {
      initRepo(h.cwd);
      await h.emit('session_start', {});
      const controller = new AbortController();
      controller.abort();
      const result = await h.callTool('task', { description: 'Aborted worktree', prompt: 'go', subagent_type: 'general-purpose', worktree: true }, { signal: controller.signal });
      expect(result.details?.status).toBe('cancelled');
      expect(result.details?.worktreePath).toBeUndefined();
      const branches = execFileSync('git', ['branch', '--list', 'pi-subagents/*'], { cwd: h.cwd, encoding: 'utf8' });
      expect(branches.trim()).toBe('');
    } finally {
      await h.cleanup();
    }
  });

  it('never prompts a child when the call aborts during session creation', async () => {
    const gate = createGate();
    setCreationGate(gate.promise);
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'should not run' });
      const controller = new AbortController();
      const pending = h.callTool('task', { description: 'Cancel during create', prompt: 'go', subagent_type: 'general-purpose' }, { signal: controller.signal });
      await vi.waitFor(() => expect(captured.length).toBe(ONE));
      controller.abort();
      gate.release();
      const result = await pending;
      expect(promptCalls).toBe(ZERO);
      expect(result.details?.status).toBe('cancelled');
    } finally {
      await h.cleanup();
    }
  });
});

describe('overlay edge cases and worktree cleanup', () => {
  it('shows the empty state and reports a vanished transcript', async () => {
    const theme = double<Theme>({ fg: (_token: string, text: string) => text, bold: (text: string) => text, strikethrough: (text: string) => text });
    let rendered: readonly (readonly string[])[] = [];
    const h = createTestHarness({
      onCustomOverlay: async (factory) => {
        const component = factory({ requestRender: () => undefined }, theme, {}, () => undefined);
        for (const input of [undefined, 'g', 'G', '\r', '\u001b'] as const) {
          if (input !== undefined) {
            component.handleInput?.(input);
          }
          rendered = [...rendered, component.render(60)];
        }
        component.dispose?.();
      },
    });
    try {
      const { openTasksOverlay } = await import('../src/tasks-overlay.ts');
      const { createSubagentStore } = await import('../src/store.ts');
      const store = createSubagentStore();
      await openTasksOverlay(h.ctx, store);
      expect(rendered[ZERO]?.join('\n')).toContain('No active tasks');
      store.upsertSession({
        agentId: 'agent-x',
        parentSessionId: 'p',
        toolCallId: 'c',
        subagentType: 'general-purpose',
        description: 'Work',
        prompt: 'p',
        readonly: false,
        status: 'running',
        isBackground: false,
        backgroundReason: 'unspecified',
        attempts: 1,
        maxAttempts: 1,
        toolCallCount: 0,
        startedAt: 1,
        updatedAt: 1,
        checkpoints: [],
        transcriptItems: [],
      });
      await openTasksOverlay(h.ctx, store);
      expect(rendered.at(-ONE)?.join('\n')).toMatch(/Work|Tasks/);
    } finally {
      await h.cleanup();
    }
  });

  it('removes a worktree only when it exists', async () => {
    const { removeSubagentWorktree } = await import('../src/worktree.ts');
    const missing = await removeSubagentWorktree({ repoRoot: '/tmp', path: '/tmp/definitely-not-a-worktree', branch: 'b', baseRef: 'HEAD' });
    expect(missing.ok).toBe(true);
  });
});
