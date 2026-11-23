import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Theme } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { buildBackgroundCompletionText } from '../src/index.ts';
import { createSubagentStore } from '../src/store.ts';
import { ONE, type SubagentSessionRecord, type TaskToolDetails, ZERO } from '../src/types.ts';
import { renderBackgroundCompletionMessage, renderTaskCall, renderTaskResult, syncSubagentsUi } from '../src/ui-renderers.ts';
import { createTestHarness, double } from './harness.ts';

const TWO = 2;
const WIDTH = 120;
const THREE = 3;
const FOUR = 4;

function createTheme(): Theme {
  return double<Theme>({
    fg: (_token: string, text: string) => text,
    bold: (text: string) => text,
    strikethrough: (text: string) => text,
  });
}

function details(overrides: Partial<TaskToolDetails> = {}): TaskToolDetails {
  return {
    agentId: 'agent-1',
    description: 'Investigate the flaky test',
    subagentType: 'explore',
    readonly: true,
    status: 'success',
    isBackground: false,
    backgroundReason: 'unspecified',
    attempts: ONE,
    maxAttempts: ONE,
    toolCallCount: TWO,
    checkpoints: TWO,
    ...overrides,
  };
}

function result(overrides: Partial<TaskToolDetails> = {}): AgentToolResult<TaskToolDetails> {
  return { content: [{ type: 'text', text: 'subagent text' }], details: details(overrides) };
}

function record(overrides: Partial<SubagentSessionRecord> = {}): SubagentSessionRecord {
  return {
    agentId: 'agent-1',
    parentSessionId: 'parent-1',
    toolCallId: 'call-1',
    subagentType: 'general-purpose',
    description: 'Work',
    prompt: 'Do work',
    readonly: false,
    status: 'running',
    isBackground: false,
    backgroundReason: 'unspecified',
    attempts: ONE,
    maxAttempts: ONE,
    toolCallCount: ZERO,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    checkpoints: [],
    transcriptItems: [],
    ...overrides,
  };
}

describe('task renderers', () => {
  const theme = createTheme();

  it('renders a call header with type and background markers', () => {
    const lines = renderTaskCall({ description: 'Explore layout', subagent_type: 'explore', run_in_background: true }, theme).render(WIDTH);
    expect(lines.join('\n')).toContain('Task');
    expect(lines.join('\n')).toContain('explore');
    expect(lines.join('\n')).toContain('background');
    const fallback = renderTaskCall({}, theme).render(WIDTH).join('\n');
    expect(fallback).toContain('Subagent task');
  });

  it('renders a result without details from its text content', () => {
    const lines = renderTaskResult(double<AgentToolResult<TaskToolDetails>>({ content: [{ type: 'text', text: 'plain output' }], details: undefined }), { expanded: false, isPartial: false }, theme).render(WIDTH);
    expect(lines.join('\n')).toContain('plain output');
  });

  it('renders running, partial, and background states', () => {
    const running = renderTaskResult(result({ status: 'running', currentStep: 'Reading files', activeToolVerb: 'Reading', activeToolDetail: 'a.ts' }), { expanded: false, isPartial: true }, theme)
      .render(WIDTH)
      .join('\n');
    expect(running).toContain('Reading a.ts');
    const background = renderTaskResult(result({ status: 'running', isBackground: true }), { expanded: false, isPartial: false }, theme)
      .render(WIDTH)
      .join('\n');
    expect(background).toContain('Running in background');
  });

  it('renders failures with the failure identifier', () => {
    const failed = renderTaskResult(result({ status: 'error', error: 'boom', failureId: 'abc123', errorCode: 'failed', attempts: TWO, maxAttempts: 3 }), { expanded: false, isPartial: false }, theme)
      .render(WIDTH)
      .join('\n');
    expect(failed).toContain('abc123');
    expect(failed).toContain('boom');
    const cancelled = renderTaskResult(result({ status: 'cancelled', error: 'stopped' }), { expanded: false, isPartial: false }, theme)
      .render(WIDTH)
      .join('\n');
    expect(cancelled).toContain('stopped');
  });

  it('renders worktree and final output for expanded and collapsed results', () => {
    const expanded = renderTaskResult(result({ finalMessage: 'Done work', worktreePath: '/tmp/wt', branch: 'pi-subagents/x' }), { expanded: true, isPartial: false }, theme)
      .render(WIDTH)
      .join('\n');
    expect(expanded).toContain('pi-subagents/x');
    expect(expanded).toContain('Done work');
    const collapsed = renderTaskResult(result({ finalMessage: 'Done work' }), { expanded: false, isPartial: false }, theme)
      .render(WIDTH)
      .join('\n');
    expect(collapsed).toContain('Last output');
  });

  it('renders background completion headers for one and many completions', () => {
    const single = renderBackgroundCompletionMessage({ details: { completions: [{ taskId: 'a', kind: 'subagent', status: 'success', title: 'One' }] }, content: '' }, theme)
      .render(WIDTH)
      .join('\n');
    expect(single).toContain('Finished');
    expect(single).toContain('One');
    const grouped = renderBackgroundCompletionMessage(
      {
        details: {
          completions: [
            { taskId: 'a', kind: 'subagent', status: 'success', title: 'One' },
            { taskId: 'b', kind: 'subagent', status: 'error', title: 'Two' },
          ],
        },
        content: '',
      },
      theme,
    )
      .render(WIDTH)
      .join('\n');
    expect(grouped).toContain('2 background tasks');
    const invalid = renderBackgroundCompletionMessage({ details: {}, content: '' }, theme).render(WIDTH).join('\n');
    expect(invalid).toContain('Finished');
  });

  it('renders background completion text with failure and worktree details', () => {
    const text = buildBackgroundCompletionText([{ taskId: 'a', kind: 'subagent', status: 'error', title: 'Broken', detail: 'boom', outputPath: '/tmp/t', failureId: 'abc', attempts: TWO, worktreePath: '/tmp/wt', branch: 'pi-subagents/x' }]);
    expect(text).toContain('ERROR');
    expect(text).toContain('transcript_path: /tmp/t');
    expect(text).toContain('failure_id: abc');
    expect(text).toContain('branch: pi-subagents/x');
  });
});

describe('status widget', () => {
  it('clears the status and widget when nothing is active', async () => {
    const h = createTestHarness();
    try {
      syncSubagentsUi(h.ctx, createSubagentStore());
      expect(h.getStatuses()['pi-subagents-status']).toBeUndefined();
      expect(h.getWidgets()['pi-subagents-running']).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});

describe('store', () => {
  it('appends checkpoints, marks failures, and restores persisted state', () => {
    const store = createSubagentStore();
    store.upsertSession(record());
    const first = store.withCheckpoint('agent-1', { transcriptPath: '/tmp/t' });
    expect(first?.seq).toBe(ZERO);
    const duplicate = store.withCheckpoint('agent-1', {});
    expect(duplicate?.seq).toBe(ZERO);
    store.appendTranscriptItem('agent-1', { id: 'i1', role: 'assistant', text: 'progress', completed: true, timestamp: 2 });
    const second = store.withCheckpoint('agent-1', {});
    expect(second?.seq).toBe(ONE);
    const failed = store.markFailure('agent-1', 'failed', 'boom');
    expect(failed?.status).toBe('error');
    expect(failed?.failureId).toMatch(/^[0-9a-f]{12}$/);
    expect(store.markFailure('missing', 'failed', 'x')).toBeUndefined();

    const persisted = store.toPersistedState();
    expect(persisted.sessions[ZERO]?.checkpoints?.length).toBe(TWO);
    const restored = createSubagentStore();
    restored.restoreFromPersisted(JSON.parse(JSON.stringify(persisted)), 'new-parent-session');
    expect(restored.getSession('agent-1')?.status).toBe('error');
    expect(restored.getSession('agent-1')?.checkpoints.length).toBe(TWO);
    expect(restored.getSession('agent-1')?.parentSessionId).toBe('new-parent-session');
  });

  it('suppresses, drains, and re-enables wakeups', () => {
    const store = createSubagentStore();
    const payload = { taskId: 'a', kind: 'subagent' as const, status: 'success' as const, title: 'done' };
    expect(store.enqueueWakeup(payload)).toBe(true);
    expect(store.enqueueWakeup(payload)).toBe(false);
    store.suppressWakeup('a');
    expect(store.hasPendingWakeups()).toBe(false);
    expect(store.enqueueWakeup(payload)).toBe(false);
    store.unsuppressWakeup('a');
    expect(store.enqueueWakeup(payload)).toBe(true);
    expect(store.drainWakeups().length).toBe(ONE);
    expect(store.drainWakeups().length).toBe(ZERO);
  });

  it('tracks active runs and aborts them all', () => {
    const store = createSubagentStore();
    store.upsertSession(record());
    let aborted = false;
    store.registerActiveRun({
      agentId: 'agent-1',
      toolCallId: 'call-1',
      isBackground: true,
      abort: () => {
        aborted = true;
      },
      completionPromise: Promise.resolve({ status: 'completed', toolCallCount: ZERO, durationMs: ZERO }),
    });
    expect(store.isRunBusy('agent-1')).toBe(true);
    expect(store.abortAllRuns()).toBe(ONE);
    expect(aborted).toBe(true);
    expect(store.isRunBusy('agent-1')).toBe(false);
  });

  it('rejects malformed agent ids and foreign lineages', () => {
    const store = createSubagentStore();
    expect(store.getSession('missing')).toBeUndefined();
    store.upsertSession(record());
    expect(store.listSessions().length).toBe(ONE);
    expect(store.listActiveSessions().length).toBe(ONE);
    store.reset();
    expect(store.listSessions().length).toBe(ZERO);
  });
});

describe('commands', () => {
  it('lists, aborts, backgrounds, retries, and prunes tasks', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      await h.runCommand('tasks', 'list');
      expect(h.getNotifications().at(-ONE)?.message).toBe('No active tasks');
      await h.runCommand('tasks', 'abort missing');
      expect(h.getNotifications().at(-ONE)?.level).toBe('warning');
      await h.runCommand('tasks', 'bg missing');
      expect(h.getNotifications().at(-ONE)?.level).toBe('warning');
      await h.runCommand('tasks', 'retry missing');
      expect(h.getNotifications().at(-ONE)?.message).toContain('No subagent found');
      await h.runCommand('tasks', 'prune missing');
      expect(h.getNotifications().at(-ONE)?.level).toBe('warning');
    } finally {
      await h.cleanup();
    }
  });

  it('lists tasks without a UI', async () => {
    const h = createTestHarness({ hasUI: false });
    try {
      await h.emit('session_start', {});
      await h.runCommand('tasks');
      expect(h.getNotifications().at(-ONE)?.message).toBe('No active tasks');
    } finally {
      await h.cleanup();
    }
  });

  it('lists agents with config details and reloads definitions', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      await h.runCommand('agents');
      const message = h.getNotifications().at(-ONE)?.message ?? '';
      expect(message).toContain('general-purpose');
      expect(message).toContain('config:');
      expect(message).toContain('nesting depth:');
      await h.runCommand('agents', 'reload');
      expect(h.getNotifications().at(-ONE)?.message).toContain('Reloaded');
    } finally {
      await h.cleanup();
    }
  });

  it('validates the /subagent command', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      await h.runCommand('subagent', '');
      expect(h.getNotifications().at(-ONE)?.message).toContain('Usage');
      await h.runCommand('subagent', 'nope do something');
      expect(h.getNotifications().at(-ONE)?.message).toContain('Unknown subagent');
    } finally {
      await h.cleanup();
    }
  });

  it('warns when a per-agent command is used without a prompt', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      await h.runCommand('subagent:explore', '');
      expect(h.getNotifications().at(-ONE)?.message).toContain('Usage: /subagent:explore');
    } finally {
      await h.cleanup();
    }
  });
});

describe('tasks overlay', () => {
  function driveOverlay(theme: Theme, inputs: readonly string[], onRender: (lines: readonly string[]) => void) {
    return async (
      factory: (tui: { readonly requestRender: () => void }, th: Theme, kb: unknown, done: (val: unknown) => void) => { readonly render: (w: number) => string[]; readonly handleInput?: (d: string) => void; readonly dispose?: () => void },
    ): Promise<void> => {
      const comp = factory({ requestRender: () => undefined }, theme, {}, () => undefined);
      onRender(comp.render(WIDTH));
      for (const input of inputs) {
        comp.handleInput?.(input);
        onRender(comp.render(WIDTH));
      }
      comp.dispose?.();
    };
  }

  it('navigates the list, opens a transcript, and returns', async () => {
    const theme = createTheme();
    let rendered: readonly (readonly string[])[] = [];
    const h = createTestHarness({
      onCustomOverlay: driveOverlay(theme, ['\u001b[B', '\u001b[A', '\r', '\u001b', '\u001b'], (lines) => {
        rendered = [...rendered, [...lines]];
      }),
    });
    try {
      const store = createSubagentStore();
      store.upsertSession(
        record({
          description: 'First task',
          transcriptItems: [
            { id: 'i1', role: 'user', text: 'prompt text', completed: true, timestamp: 1 },
            { id: 'i2', role: 'tool', text: 'Reading a.ts', toolSummary: 'Reading a.ts', completed: true, timestamp: 2 },
            { id: 'i3', role: 'thinking', text: 'thinking hard', completed: true, timestamp: 3 },
            { id: 'i4', role: 'result', text: 'tool output', completed: true, timestamp: 4 },
          ],
        }),
      );
      store.upsertSession(record({ agentId: 'agent-2', description: 'Second task', status: 'success' }));
      const { openTasksOverlay } = await import('../src/tasks-overlay.ts');
      await openTasksOverlay(h.ctx, store);
      expect(rendered[ZERO]?.join('\n')).toContain('Tasks');
      expect(rendered[ONE]?.join('\n')).toContain('Second task');
      expect(rendered[TWO]?.join('\n')).toContain('First task');
      expect(rendered[THREE]?.join('\n')).toContain('prompt text');
      expect(rendered[THREE]?.join('\n')).toContain('tool output');
      expect(rendered[FOUR]?.join('\n')).toContain('Tasks');
    } finally {
      await h.cleanup();
    }
  });

  it('shows live thinking in the transcript view', async () => {
    const theme = createTheme();
    let transcript = '';
    const h = createTestHarness({
      onCustomOverlay: async (factory) => {
        const comp = factory({ requestRender: () => undefined }, theme, {}, () => undefined);
        comp.handleInput?.('\r');
        transcript = comp.render(WIDTH).join('\n');
        comp.dispose?.();
      },
    });
    try {
      const store = createSubagentStore();
      store.upsertSession(record({ streamingThinking: 'LIVE_THINKING' }));
      const { openTasksOverlay } = await import('../src/tasks-overlay.ts');
      await openTasksOverlay(h.ctx, store);
      expect(transcript).toContain('LIVE_THINKING');
    } finally {
      await h.cleanup();
    }
  });

  it('aborts a selected background task with k', async () => {
    const theme = createTheme();
    const h = createTestHarness({ onCustomOverlay: driveOverlay(theme, ['k', '\u001b'], () => undefined) });
    try {
      const store = createSubagentStore();
      store.upsertSession(record({ isBackground: true }));
      let aborted = false;
      store.registerActiveRun({
        agentId: 'agent-1',
        toolCallId: 'call-1',
        isBackground: true,
        abort: () => {
          aborted = true;
        },
        completionPromise: Promise.resolve({ status: 'completed', toolCallCount: ZERO, durationMs: ZERO }),
      });
      const { openTasksOverlay } = await import('../src/tasks-overlay.ts');
      await openTasksOverlay(h.ctx, store);
      expect(aborted).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('flags and MCP reloads', () => {
  it('takes the explore model from the CLI flag', async () => {
    const h = createTestHarness({ flags: { 'subagent-explore-model': 'inherit' } });
    try {
      await h.emit('session_start', {});
      await h.runCommand('agents');
      expect(h.getNotifications().at(-ONE)?.message).toContain('explore model: inherit');
    } finally {
      await h.cleanup();
    }
  });

  it('re-registers agent commands when MCP servers change', async () => {
    const h = createTestHarness({ mcpServerNames: ['playwright'] });
    try {
      await h.emit('session_start', {});
      await h.emit('mcp_servers_change', {});
      expect(h.listCommands()).toContain('subagent:browser');
    } finally {
      await h.cleanup();
    }
  });
});

describe('session lifecycle', () => {
  it('aborts every active run on shutdown', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = new Promise<void>(() => undefined);
      let aborted = false;
      const store = createSubagentStore();
      store.upsertSession(record());
      store.registerActiveRun({
        agentId: 'agent-1',
        toolCallId: 'call-1',
        isBackground: true,
        abort: () => {
          aborted = true;
        },
        completionPromise: gate.then(() => ({ status: 'completed' as const, toolCallCount: ZERO, durationMs: ZERO })),
      });
      void store.abortAllRuns();
      expect(aborted).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  it('restores persisted sessions on the next start', async () => {
    const persisted = {
      sessions: [
        {
          agentId: 'agent-1',
          parentSessionId: 'parent',
          toolCallId: 'call',
          subagentType: 'general-purpose',
          description: 'Work',
          prompt: 'p',
          readonly: false,
          status: 'success',
          isBackground: false,
          backgroundReason: 'unspecified',
          toolCallCount: ZERO,
          startedAt: 1,
          updatedAt: 1,
        },
      ],
    };
    const h = createTestHarness({ initialEntries: [{ type: 'custom', customType: 'pi-subagents-state', data: persisted }] });
    try {
      await h.emit('session_start', {});
      await h.runCommand('tasks', 'list');
      expect(h.getNotifications().at(-ONE)?.message).toContain('agent-1');
    } finally {
      await h.cleanup();
    }
  });

  it('appends the agent catalog to the system prompt for user and custom runs', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const userRun = double<{ readonly systemPrompt?: string }>(await h.emit('before_agent_start', { messageType: 'user' }));
      expect(userRun.systemPrompt).toContain('BASE SYSTEM PROMPT');
      expect(userRun.systemPrompt).toContain('[SUBAGENTS AVAILABLE]');
      const customRun = double<{ readonly systemPrompt?: string }>(await h.emit('before_agent_start', { messageType: 'custom' }));
      expect(customRun.systemPrompt).toContain('[SUBAGENTS AVAILABLE]');
    } finally {
      await h.cleanup();
    }
  });
});
