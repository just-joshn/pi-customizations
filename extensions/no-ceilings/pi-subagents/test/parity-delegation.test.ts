import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock(import('@earendil-works/pi-coding-agent'), async (importOriginal) => {
  const { createCodingAgentMock } = await import('./parity-support.ts');
  return createCodingAgentMock(await importOriginal());
});

import { createGate, createTestHarness, double } from './harness.ts';
import { ZERO, ONE, TWO, captured, enqueuePlan, loaderOptions, toolEvent, writeAgent, writeConfig, installParityHooks } from './parity-support.ts';

installParityHooks();

function persistedRecord(agentId: string, description: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentId,
    parentSessionId: 'previous-session',
    toolCallId: `call-${agentId}`,
    subagentType: 'general-purpose',
    description,
    prompt: 'go',
    readonly: false,
    status: 'success',
    isBackground: false,
    backgroundReason: 'unspecified',
    toolCallCount: ZERO,
    startedAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('delegation: automatic and explicit selection', () => {
  it('picks the custom agent whose description matches the task when subagent_type is omitted', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'reviewer.md', ['---', 'name: reviewer', 'description: Reviews diffs for correctness and security', '---', 'Review the diff.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'Reviewed.' });
      const result = await h.callTool('task', { description: 'Review the diff', prompt: 'Check the staged diff for correctness' });
      expect(result.details?.subagentType).toBe('reviewer');
      expect(result.details?.status).toBe('success');
    } finally {
      await h.cleanup();
    }
  });

  it('falls back to general-purpose when no description matches', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'reviewer.md', ['---', 'name: reviewer', 'description: Reviews diffs for correctness and security', '---', 'Review the diff.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'ok' });
      const result = await h.callTool('task', { description: 'Summarize the changelog', prompt: 'Write two sentences' });
      expect(result.details?.subagentType).toBe('general-purpose');
    } finally {
      await h.cleanup();
    }
  });

  it('runs two background subagents concurrently and collects both with await_subagent', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gateOne = createGate();
      const gateTwo = createGate();
      enqueuePlan({ finalText: 'first done', waitForRelease: gateOne.promise });
      enqueuePlan({ finalText: 'second done', waitForRelease: gateTwo.promise });
      const first = await h.callTool('task', { description: 'First job', prompt: 'Do the first job', subagent_type: 'general-purpose', run_in_background: true });
      const second = await h.callTool('task', { description: 'Second job', prompt: 'Do the second job', subagent_type: 'general-purpose', run_in_background: true });
      expect(first.details?.agentId).not.toBe(second.details?.agentId);
      gateOne.release();
      gateTwo.release();
      const awaitedFirst = await h.callTool('await_subagent', { agent_id: first.details?.agentId });
      const awaitedSecond = await h.callTool('await_subagent', { agent_id: second.details?.agentId });
      expect(awaitedFirst.details?.finalMessage).toBe('first done');
      expect(awaitedSecond.details?.finalMessage).toBe('second done');
    } finally {
      await h.cleanup();
    }
  });
});

describe('harness isolation', () => {
  it('ignores user agent directories outside the harness', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pi-subagents-home-'));
    mkdirSync(join(home, '.claude/agents'), { recursive: true });
    writeFileSync(join(home, '.claude/agents/changelog-writer.md'), ['---', 'name: changelog-writer', 'description: Summarize changelogs, release notes, and two sentence summaries', '---', 'Write the summary.'].join('\n'));
    const previousHome = process.env['HOME'];
    const previousAgentDir = process.env['PI_CODING_AGENT_DIR'];
    process.env['HOME'] = home;
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'summary' });
      const result = await h.callTool('task', { description: 'Summarize the changelog', prompt: 'Write two sentences' });
      expect(result.details?.subagentType).toBe('general-purpose');
    } finally {
      await h.cleanup();
      process.env['HOME'] = previousHome;
      if (previousAgentDir === undefined) {
        delete process.env['PI_CODING_AGENT_DIR'];
      } else {
        process.env['PI_CODING_AGENT_DIR'] = previousAgentDir;
      }
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('delegation: retries and checkpoints', () => {
  it('retries a failing run up to max_attempts and records every attempt', async () => {
    const h = createTestHarness();
    try {
      writeConfig(h.cwd, { retry: { delayMs: 0 } });
      await h.emit('session_start', {});
      enqueuePlan({ finalText: '', throwError: 'transient failure' });
      enqueuePlan({ finalText: 'recovered on retry' });
      const result = await h.callTool('task', { description: 'Flaky job', prompt: 'Run it', subagent_type: 'general-purpose', max_attempts: TWO });
      expect(result.details?.status).toBe('success');
      expect(result.details?.attempts).toBe(TWO);
      expect(result.details?.finalMessage).toBe('recovered on retry');
      expect(captured.length).toBe(TWO);
    } finally {
      await h.cleanup();
    }
  });

  it('honours the configured retry attempt count when the call and the definition are silent', async () => {
    const h = createTestHarness();
    try {
      writeConfig(h.cwd, { retry: { maxAttempts: TWO, delayMs: 0 } });
      await h.emit('session_start', {});
      enqueuePlan({ finalText: '', throwError: 'first attempt fails' });
      enqueuePlan({ finalText: 'second attempt works' });
      const result = await h.callTool('task', { description: 'Configured retry', prompt: 'Run it', subagent_type: 'general-purpose' });
      expect(result.details?.status).toBe('success');
      expect(result.details?.attempts).toBe(TWO);
    } finally {
      await h.cleanup();
    }
  });

  it('honours the retry count in the agent definition', async () => {
    const h = createTestHarness();
    try {
      writeConfig(h.cwd, { retry: { delayMs: 0 } });
      writeAgent(h.cwd, '.pi/agents', 'retrying.md', ['---', 'name: retrying', 'description: Retries its own work', 'retry: 2', '---', 'Retry the work.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: '', throwError: 'nope' });
      enqueuePlan({ finalText: 'definition retry worked' });
      const result = await h.callTool('task', { description: 'Retrying agent', prompt: 'Run it', subagent_type: 'retrying' });
      expect(result.details?.status).toBe('success');
      expect(result.details?.attempts).toBe(TWO);
    } finally {
      await h.cleanup();
    }
  });

  it('reports a failure identifier and error code when every attempt fails', async () => {
    const h = createTestHarness();
    try {
      writeConfig(h.cwd, { retry: { delayMs: 0 } });
      await h.emit('session_start', {});
      enqueuePlan({ finalText: '', throwError: 'always broken' });
      enqueuePlan({ finalText: '', throwError: 'still broken' });
      const result = await h.callTool('task', { description: 'Broken job', prompt: 'Run it', subagent_type: 'general-purpose', max_attempts: TWO });
      expect(result.details?.status).toBe('error');
      expect(result.details?.errorCode).toBe('failed');
      expect(result.details?.failureId).toMatch(/^[0-9a-f]{12}$/);
      expect(result.details?.attempts).toBe(TWO);
    } finally {
      await h.cleanup();
    }
  });

  it('records checkpoints at step boundaries and persists them', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'checkpointed', events: toolEvent('read', 'call-1', { path: 'src/index.ts' }) });
      const result = await h.callTool('task', { description: 'Checkpoint job', prompt: 'Read the file', subagent_type: 'general-purpose' });
      expect(result.details?.status).toBe('success');
      expect(result.details?.checkpoints).toBeGreaterThan(ZERO);
      const state = h
        .getEntries()
        .filter((entry) => entry.customType === 'pi-subagents-state')
        .at(-ONE);
      const sessions = double<{ readonly sessions: readonly { readonly agentId: string; readonly checkpoints?: readonly unknown[] }[] }>(state?.data);
      const recorded = sessions.sessions.find((session) => session.agentId === result.details?.agentId);
      expect(recorded?.checkpoints?.length).toBeGreaterThan(ZERO);
    } finally {
      await h.cleanup();
    }
  });
});

describe('failure codes and resume safety', () => {
  it('keeps a readonly subagent readonly when it is resumed', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'first pass' });
      const first = await h.callTool('task', { description: 'Read only run', prompt: 'go', subagent_type: 'general-purpose', readonly: true });
      expect(first.details?.readonly).toBe(true);
      enqueuePlan({ finalText: 'second pass' });
      const resumed = await h.callTool('task', { description: 'Read only again', prompt: 'go', subagent_type: 'general-purpose', resume: first.details?.agentId });
      expect(resumed.details?.readonly).toBe(true);
      const factories = loaderOptions['extensionFactories'] as readonly unknown[];
      expect(factories.length).toBe(TWO);
    } finally {
      await h.cleanup();
    }
  });

  it('reports typed failure codes for an unknown model and an unknown agent type', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      await expect(h.callTool('task', { description: 'Bad model', prompt: 'go', subagent_type: 'general-purpose', model: 'not-a-model' })).rejects.toMatchObject({ code: 'model-unknown' });
      await expect(h.callTool('task', { description: 'Bad type', prompt: 'go', subagent_type: 'not-an-agent' })).rejects.toMatchObject({ code: 'type-unknown' });
    } finally {
      await h.cleanup();
    }
  });

  it('restores records from multiple persisted patches', async () => {
    const h = createTestHarness({
      initialEntries: [
        { type: 'custom', customType: 'pi-subagents-state', data: { sessions: [persistedRecord('11111111-2222-4333-8444-555555555555', 'First patch')] } },
        { type: 'custom', customType: 'pi-subagents-state', data: { sessions: [persistedRecord('22222222-3333-4444-8555-666666666666', 'Second patch')] } },
      ],
    });
    try {
      await h.emit('session_start', {});
      await h.runCommand('tasks', 'list');
      const message = h.getNotifications().at(-ONE)?.message ?? '';
      expect(message).toContain('First patch');
      expect(message).toContain('Second patch');
    } finally {
      await h.cleanup();
    }
  });

  it('retries a run restored from an earlier session', async () => {
    const persisted = {
      sessions: [persistedRecord('11111111-2222-4333-8444-555555555555', 'Restored run', { toolCallId: 'call-restored', prompt: 'Do the restored work', status: 'error', error: 'boom' })],
    };
    const h = createTestHarness({ initialEntries: [{ type: 'custom', customType: 'pi-subagents-state', data: persisted }] });
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'recovered' });
      await h.runCommand('tasks', 'retry 11111111-2222-4333-8444-555555555555');
      await h.runCommand('tasks', 'list');
      expect(h.getNotifications().at(-ONE)?.message).toContain('[success/fg]');
    } finally {
      await h.cleanup();
    }
  });

  it('refuses to resume a run with no transcript path', async () => {
    const persisted = {
      sessions: [persistedRecord('11111111-2222-4333-8444-555555555555', 'No transcript', { toolCallId: 'call-no-transcript', prompt: 'First prompt', status: 'error', error: 'boom' })],
    };
    const h = createTestHarness({ initialEntries: [{ type: 'custom', customType: 'pi-subagents-state', data: persisted }] });
    try {
      await h.emit('session_start', {});
      await expect(h.callTool('task', { description: 'Resume without transcript', prompt: 'Second prompt', resume: '11111111-2222-4333-8444-555555555555' })).rejects.toMatchObject({ code: 'resume-unavailable' });
    } finally {
      await h.cleanup();
    }
  });

  it('keeps background mode across a resume', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'first background' });
      const background = await h.callTool('task', { description: 'Background job', prompt: 'first', subagent_type: 'general-purpose', run_in_background: true });
      await h.callTool('await_subagent', { agent_id: background.details?.agentId });
      enqueuePlan({ finalText: 'resumed background' });
      const resumed = await h.callTool('task', { description: 'Background resume', prompt: 'second', subagent_type: 'general-purpose', resume: background.details?.agentId });
      expect(resumed.details?.isBackground).toBe(true);
      const awaited = await h.callTool('await_subagent', { agent_id: background.details?.agentId });
      expect(double<{ readonly outcome?: string }>(awaited.details).outcome).toBe('complete');
    } finally {
      await h.cleanup();
    }
  });

  it('restores valid runs when a sibling record is invalid', async () => {
    const persisted = {
      sessions: [
        persistedRecord('11111111-2222-4333-8444-555555555555', 'Restored run', { toolCallId: 'call-restored', prompt: 'Do the restored work', status: 'error', error: 'boom' }),
        persistedRecord('99999999-8888-4777-8666-555555555555', 'Invalid run', { toolCallId: 'call-invalid', prompt: 'Never ran', status: 'bogus' }),
      ],
    };
    const h = createTestHarness({ initialEntries: [{ type: 'custom', customType: 'pi-subagents-state', data: persisted }] });
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'recovered' });
      await h.runCommand('tasks', 'retry 11111111-2222-4333-8444-555555555555');
      await h.runCommand('tasks', 'list');
      expect(h.getNotifications().at(-ONE)?.message).toContain('[success/fg]');
    } finally {
      await h.cleanup();
    }
  });

  it('persists the run record before the subagent finishes', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'slow', waitForRelease: gate.promise });
      const launched = await h.callTool('task', { description: 'Slow background', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true });
      const state = h
        .getEntries()
        .filter((entry) => entry.customType === 'pi-subagents-state')
        .at(-ONE);
      const sessions = double<{ readonly sessions: readonly { readonly agentId: string; readonly prompt: string }[] }>(state?.data).sessions;
      const recorded = sessions.find((session) => session.agentId === launched.details?.agentId);
      expect(recorded?.prompt).toBe('go');
      gate.release();
      await h.callTool('await_subagent', { agent_id: launched.details?.agentId });
    } finally {
      await h.cleanup();
    }
  });
});
