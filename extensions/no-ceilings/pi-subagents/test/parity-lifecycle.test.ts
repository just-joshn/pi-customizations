import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock(import('@earendil-works/pi-coding-agent'), async (importOriginal) => {
  const { createCodingAgentMock } = await import('./parity-support.ts');
  return createCodingAgentMock(await importOriginal());
});

import { createGate, createTestHarness, delay, double } from './harness.ts';
import { ZERO, ONE, TWO, THREE, captured, enqueuePlan, initRepo, installSlowGit, latestRunningAgentId, loaderOptions, promptCalls, settledCount, toolEvent, writeAgent, writeConfig, installParityHooks } from './parity-support.ts';

installParityHooks();

describe('retry, resume, and persistence', () => {
  it('retries with the model the run actually used', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'first' });
      const first = await h.callTool('task', { description: 'Model run', prompt: 'go', subagent_type: 'general-purpose', model: 'fast' });
      expect(captured[ZERO]?.modelId).toBe('model-haiku-fast');
      enqueuePlan({ finalText: 'retried' });
      await h.runCommand('tasks', `retry ${first.details?.agentId ?? ''}`);
      expect(captured[ONE]?.modelId).toBe('model-haiku-fast');
    } finally {
      await h.cleanup();
    }
  });

  it('resumes with the model and thinking level the run actually used', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'first' });
      const first = await h.callTool('task', { description: 'Model run', prompt: 'go', subagent_type: 'general-purpose', model: 'fast', thinking: 'high' });
      expect(captured[ZERO]?.thinkingLevel).toBe('high');
      enqueuePlan({ finalText: 'resumed' });
      await h.callTool('task', { description: 'Follow up', prompt: 'continue', subagent_type: 'general-purpose', resume: first.details?.agentId });
      expect(captured[ONE]?.modelId).toBe('model-haiku-fast');
      expect(captured[ONE]?.thinkingLevel).toBe('high');
    } finally {
      await h.cleanup();
    }
  });

  it('retries a background run as background and wakes the parent', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'background first', waitForRelease: gate.promise });
      const first = await h.callTool('task', { description: 'Background run', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true });
      gate.release();
      await h.callTool('await_subagent', { agent_id: first.details?.agentId });
      enqueuePlan({ finalText: 'background retry' });
      await h.runCommand('tasks', `retry ${first.details?.agentId ?? ''}`);
      await expect.poll(() => h.getSentMessages().some((message) => JSON.stringify(message).includes('pi-subagents-background-completion'))).toBe(true);
      await h.runCommand('tasks', 'list');
      expect(h.getNotifications().at(-ONE)?.message).toContain('[success/bg]');
    } finally {
      await h.cleanup();
    }
  });

  it('keeps mid-run state metadata-only and persists checkpoints at completion', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'eventually', events: toolEvent('read', 'call-mid', { path: 'a.ts' }), waitForRelease: gate.promise });
      const launched = await h.callTool('task', { description: 'Mid run', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true });
      await expect.poll(() => h.getEmittedEvents().some((entry) => entry.channel === 'subagents:checkpoint')).toBe(true);
      const states = h.getEntries().filter((entry) => entry.customType === 'pi-subagents-state');
      const snapshot = double<{
        readonly sessions: readonly { readonly agentId: string; readonly status: string; readonly toolCallCount: number; readonly checkpoints: readonly { readonly seq: number }[]; readonly transcriptPath?: string }[];
      }>(states.at(-ONE)?.data);
      const recorded = snapshot.sessions.find((session) => session.agentId === launched.details?.agentId);
      expect(recorded?.checkpoints.length).toBe(ZERO);
      expect(recorded?.toolCallCount).toBe(ZERO);
      expect(recorded?.transcriptPath).toBeTypeOf('string');
      expect(recorded?.transcriptPath ?? '').toContain('.jsonl');
      expect(recorded?.status).toBe('running');
      gate.release();
      await h.callTool('await_subagent', { agent_id: launched.details?.agentId });
      const finalState = h
        .getEntries()
        .filter((entry) => entry.customType === 'pi-subagents-state')
        .at(-ONE);
      const finalSessions = double<{ readonly sessions: readonly { readonly agentId: string; readonly checkpoints: readonly { readonly seq: number }[]; readonly transcriptPath?: string }[] }>(finalState?.data).sessions;
      const finalRecord = finalSessions.find((session) => session.agentId === launched.details?.agentId);
      expect(finalRecord?.checkpoints.length).toBeGreaterThan(ZERO);
      expect(finalRecord?.transcriptPath).toBeTypeOf('string');
    } finally {
      await h.cleanup();
    }
  });

  it('persists state changes as patches for changed records', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      for (let index = ZERO; index < THREE; index += 1) {
        enqueuePlan({ finalText: `done ${index}` });
        await h.callTool('task', { description: `Patch job ${index}`, prompt: 'go', subagent_type: 'general-purpose' });
      }
      const states = h.getEntries().filter((entry) => entry.customType === 'pi-subagents-state');
      expect(states.length).toBeGreaterThan(THREE);
      const counts = states.map((entry) => double<{ readonly sessions: readonly unknown[] }>(entry.data).sessions.length);
      expect(Math.max(...counts)).toBe(ONE);
    } finally {
      await h.cleanup();
    }
  });

  it('returns the failure reason from await_subagent', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: '', throwError: 'kaboom from child' });
      const launched = await h.callTool('task', { description: 'Failing run', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true });
      const awaited = await h.callTool('await_subagent', { agent_id: launched.details?.agentId });
      const text = (awaited.content[ZERO] as { readonly text?: string }).text ?? '';
      expect(text).toContain('kaboom from child');
    } finally {
      await h.cleanup();
    }
  });
});

describe('state growth and disabled defaults', () => {
  it('keeps persisted state bounded for a many-step run', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const events = Array.from({ length: 40 }, (_value, index) => toolEvent('read', `call-${index}`, { path: `file-${index}.ts` })).flat();
      enqueuePlan({ finalText: 'done', events });
      await h.callTool('task', { description: 'Long job', prompt: 'go', subagent_type: 'general-purpose' });
      const total = h.getEntries().reduce((sum, entry) => sum + JSON.stringify(entry.data).length, ZERO);
      expect(total).toBeLessThan(200_000);
    } finally {
      await h.cleanup();
    }
  });

  it('delegates an ambiguous task to an available agent when general-purpose is disabled', async () => {
    const h = createTestHarness();
    try {
      writeConfig(h.cwd, { agents: { disabled: ['general-purpose'] } });
      writeAgent(h.cwd, '.pi/agents', 'reviewer.md', ['---', 'name: reviewer', 'description: Reviews changes', '---', 'Review.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'delegated' });
      const result = await h.callTool('task', { description: 'Summarize the changelog', prompt: 'Write two sentences' });
      expect(result.details?.status).toBe('success');
      expect(result.details?.subagentType).not.toBe('');
      expect(result.details?.subagentType).not.toBe('general-purpose');
    } finally {
      await h.cleanup();
    }
  });

  it('aborts a foreground worktree launch from /tasks while git worktree add is running', async () => {
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
      const pending = h.callTool('task', { description: 'Abort from tasks', prompt: 'go', subagent_type: 'general-purpose', worktree: true });
      await vi.waitFor(() => expect(existsSync(flag)).toBe(true));
      const agentId = latestRunningAgentId(h);
      expect(agentId).toBeTypeOf('string');
      await h.runCommand('tasks', `abort ${agentId ?? ''}`);
      const result = await pending;
      expect(result.details?.status).toBe('cancelled');
      expect(result.details?.worktreePath).toBeUndefined();
      expect(promptCalls).toBe(ZERO);
      const branches = execFileSync('git', ['branch', '--list', 'pi-subagents/*'], { cwd: h.cwd, encoding: 'utf8' }).trim();
      expect(branches).toBe('');
      expect(h.getNotifications().at(-ONE)?.message).toContain('Aborted subagent');
    } finally {
      process.env['PATH'] = previousPath;
      await h.cleanup();
    }
  }, 30_000);
});

describe('read-only floors and retry safety', () => {
  it('keeps a read-only agent read-only when the call passes readonly false', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'explored' });
      const result = await h.callTool('task', { description: 'Explore', prompt: 'go', subagent_type: 'explore', readonly: false });
      expect(result.details?.readonly).toBe(true);
      expect((loaderOptions['extensionFactories'] as readonly unknown[]).length).toBe(TWO);
    } finally {
      await h.cleanup();
    }
  });
  it('keeps call-level read-only mode when a resume passes readonly false', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'first' });
      const first = await h.callTool('task', { description: 'Read only job', prompt: 'go', subagent_type: 'general-purpose', readonly: true });
      expect(first.details?.readonly).toBe(true);
      const firstFactories = (loaderOptions['extensionFactories'] as readonly unknown[]).length;
      enqueuePlan({ finalText: 'resumed' });
      const resumed = await h.callTool('task', {
        description: 'Read only job',
        prompt: 'again',
        subagent_type: 'general-purpose',
        resume: first.details?.agentId,
        readonly: false,
      });

      expect(resumed.details?.readonly).toBe(true);
      expect((loaderOptions['extensionFactories'] as readonly unknown[]).length).toBe(firstFactories);
    } finally {
      await h.cleanup();
    }
  });

  it('keeps a foreground run foreground when the agent defaults to background', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'bg-true.md', ['---', 'name: bg-true', 'description: Background by default', 'background: true', '---', 'Body.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'first' });
      const first = await h.callTool('task', { description: 'Foreground override', prompt: 'go', subagent_type: 'bg-true', run_in_background: false });
      expect(first.details?.isBackground).toBe(false);
      enqueuePlan({ finalText: 'second' });
      const resumed = await h.callTool('task', { description: 'Foreground override', prompt: 'again', subagent_type: 'bg-true', resume: first.details?.agentId });
      expect(resumed.details?.isBackground).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  it('keeps a background run background when the agent defaults to foreground', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'bg-false.md', ['---', 'name: bg-false', 'description: Foreground by default', 'background: false', '---', 'Body.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'first' });
      const first = await h.callTool('task', { description: 'Background override', prompt: 'go', subagent_type: 'bg-false', run_in_background: true });
      expect(first.details?.isBackground).toBe(true);
      await h.callTool('await_subagent', { agent_id: first.details?.agentId });
      enqueuePlan({ finalText: 'second' });
      const resumed = await h.callTool('task', { description: 'Background override', prompt: 'again', subagent_type: 'bg-false', resume: first.details?.agentId });
      expect(resumed.details?.isBackground).toBe(true);
      await h.callTool('await_subagent', { agent_id: resumed.details?.agentId });
    } finally {
      await h.cleanup();
    }
  });

  it('does not retry a refused resume into a fresh run', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'first' });
      const first = await h.callTool('task', { description: 'Resume job', prompt: 'go', subagent_type: 'general-purpose' });
      const transcriptPath = first.details?.transcriptPath;
      expect(transcriptPath).toBeTypeOf('string');
      expect(transcriptPath ?? '').toContain('.jsonl');
      if (transcriptPath === undefined) {
        throw new Error('missing transcript path');
      }
      writeFileSync(transcriptPath, 'not a session\n');
      enqueuePlan({ finalText: 'should not run' });
      const corrupt = await h.callTool('task', { description: 'Resume job', prompt: 'again', subagent_type: 'general-purpose', resume: first.details?.agentId, max_attempts: TWO });
      expect(corrupt.details?.status).toBe('error');
      expect(corrupt.details?.errorCode).toBe('resume-unavailable');
      expect(corrupt.details?.attempts).toBe(ONE);
      expect(captured.length).toBe(ONE);
    } finally {
      await h.cleanup();
    }
  });
});

describe('state snapshots and shutdown', () => {
  it('keeps a completed run transcript in a mid-run snapshot', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'completed reply' });
      const completed = await h.callTool('task', { description: 'Completed job', prompt: 'first prompt', subagent_type: 'general-purpose' });
      const gate = createGate();
      enqueuePlan({ finalText: 'slow', events: toolEvent('read', 'call-slow', { path: 'a.ts' }), waitForRelease: gate.promise });
      const running = await h.callTool('task', { description: 'Running job', prompt: 'second prompt', subagent_type: 'general-purpose', run_in_background: true });
      await expect.poll(() => h.getEmittedEvents().some((entry) => entry.channel === 'subagents:checkpoint')).toBe(true);
      const sessions = h
        .getEntries()
        .filter((entry) => entry.customType === 'pi-subagents-state')
        .flatMap((entry) => double<{ readonly sessions: readonly { readonly agentId: string; readonly transcriptItems?: readonly { readonly text: string }[] }[] }>(entry.data).sessions);
      const completedRecord = sessions.findLast((session) => session.agentId === completed.details?.agentId);
      const runningRecord = sessions.findLast((session) => session.agentId === running.details?.agentId);
      expect(completedRecord).toBeDefined();
      expect(runningRecord).toBeDefined();
      expect(completedRecord?.transcriptItems?.length ?? ZERO).toBeGreaterThan(ZERO);
      expect(runningRecord?.transcriptItems ?? []).toHaveLength(ZERO);
      gate.release();
      await h.callTool('await_subagent', { agent_id: running.details?.agentId });
      const finalSessions = h
        .getEntries()
        .filter((entry) => entry.customType === 'pi-subagents-state')
        .flatMap((entry) => double<{ readonly sessions: readonly { readonly agentId: string; readonly transcriptItems?: readonly { readonly text: string }[] }[] }>(entry.data).sessions);
      expect(finalSessions.findLast((session) => session.agentId === completed.details?.agentId)?.transcriptItems?.some((item) => item.text.includes('completed reply'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  it('caps restored transcripts after four foreground completions', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      for (let index = ZERO; index < 4; index += 1) {
        enqueuePlan({ finalText: `done ${index}` });
        await h.callTool('task', { description: `Completed job ${index}`, prompt: 'go', subagent_type: 'general-purpose' });
      }
      const state = h
        .getEntries()
        .filter((entry) => entry.customType === 'pi-subagents-state')
        .at(-ONE);
      const sessions = double<{ readonly sessions: readonly { readonly transcriptPath?: string; readonly transcriptItems?: readonly unknown[] }[] }>(state?.data).sessions;
      expect(sessions.filter((session) => (session.transcriptItems?.length ?? ZERO) > ZERO).length).toBeLessThanOrEqual(3);
      expect(sessions[ZERO]?.transcriptPath).toBeTypeOf('string');
    } finally {
      await h.cleanup();
    }
  });

  it('marks running records cancelled on session shutdown', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'slow', waitForRelease: gate.promise });
      const launched = await h.callTool('task', { description: 'Shutdown job', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true });
      await h.emit('session_shutdown', {});
      const state = h
        .getEntries()
        .filter((entry) => entry.customType === 'pi-subagents-state')
        .at(-ONE);
      const sessions = double<{ readonly sessions: readonly { readonly agentId: string; readonly status: string }[] }>(state?.data).sessions;
      expect(sessions.find((session) => session.agentId === launched.details?.agentId)?.status).toBe('cancelled');
      gate.release();
    } finally {
      await h.cleanup();
    }
  });

  it('persists a failure id when shutdown cancels a background run', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'slow', waitForRelease: gate.promise });
      const launched = await h.callTool('task', { description: 'Shutdown job', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true });
      await h.emit('session_shutdown', {});
      const state = h
        .getEntries()
        .filter((entry) => entry.customType === 'pi-subagents-state')
        .at(-ONE);
      const sessions = double<{ readonly sessions: readonly { readonly agentId: string; readonly status: string; readonly failureId?: string }[] }>(state?.data).sessions;
      const record = sessions.find((session) => session.agentId === launched.details?.agentId);
      expect(record?.status).toBe('cancelled');
      expect(record?.failureId).toMatch(/^[0-9a-f]{12}$/);
      gate.release();
    } finally {
      await h.cleanup();
    }
  });

  it('keeps a shutdown cancellation and skips the wakeup when a worktree summary finishes late', async () => {
    const h = createTestHarness();
    const bin = join(h.cwd, 'bin');
    const flag = join(h.cwd, 'diff-started');
    installSlowGit(bin, 'diff', flag);
    const previousPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:${previousPath ?? ''}`;
    try {
      initRepo(h.cwd);
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'finished after shutdown', waitForRelease: gate.promise });
      const launched = await h.callTool('task', { description: 'Summary race', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true, worktree: true });
      gate.release();
      await expect.poll(() => existsSync(flag)).toBe(true);
      await h.emit('session_shutdown', {});
      await h.emit('session_start', {});
      await delay(2500);
      const state = h
        .getEntries()
        .filter((entry) => entry.customType === 'pi-subagents-state')
        .at(-ONE);
      const sessions = double<{ readonly sessions: readonly { readonly agentId: string; readonly status: string; readonly failureId?: string }[] }>(state?.data).sessions;
      const record = sessions.find((session) => session.agentId === launched.details?.agentId);
      expect(record?.status).toBe('cancelled');
      expect(record?.failureId).toMatch(/^[0-9a-f]{12}$/);
      expect(h.getSentMessages()).toHaveLength(ZERO);
    } finally {
      process.env['PATH'] = previousPath;
      await h.cleanup();
    }
  }, 30_000);

  it('does not touch a stale UI context when a background run settles after session shutdown', async () => {
    const h = createTestHarness();
    const errors: unknown[] = [];
    const onUnhandled = (error: unknown): void => {
      errors.push(error);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'slow', waitForRelease: gate.promise });
      await h.callTool('task', { description: 'Stale UI job', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true });
      await h.emit('session_shutdown', {});
      vi.spyOn(h.ctx.ui, 'setStatus').mockImplementation(() => {
        throw new Error('This extension ctx is stale after session replacement or reload.');
      });
      const before = settledCount;
      gate.release();
      await expect.poll(() => settledCount).toBe(before + ONE);
      await Promise.resolve();
      expect(errors).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      await h.cleanup();
    }
  });
});
