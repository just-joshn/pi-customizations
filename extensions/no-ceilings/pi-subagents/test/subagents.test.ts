import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentSessionEvent, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { Key } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGate, createTestHarness, double, extractGuardHandler } from './harness.ts';

interface MockSessionPlan {
  readonly finalText: string;
  readonly events?: readonly AgentSessionEvent[];
  readonly throwError?: string;
  readonly waitForRelease?: Promise<void>;
}

interface CapturedCreateCall {
  readonly modelId?: string;
  readonly tools?: readonly string[];
  readonly extensionFactories: readonly ExtensionFactory[];
  readonly appendSystemPrompt: readonly string[];
}

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const SHORT_TIMEOUT_MS = 50;
const OVERLAY_WIDTH = 120;

let nextPlans: readonly MockSessionPlan[] = [];
let capturedCalls: readonly CapturedCreateCall[] = [];
let lastLoaderOpts: { readonly extensionFactories?: readonly ExtensionFactory[]; readonly appendSystemPrompt?: readonly string[] } = {};

function enqueuePlan(plan: MockSessionPlan): void {
  nextPlans = [...nextPlans, plan];
}

function dequeuePlan(): MockSessionPlan {
  const [first, ...rest] = nextPlans;
  nextPlans = rest;
  return first ?? { finalText: 'Default subagent response' };
}

function createMockSession(plan: MockSessionPlan) {
  let listeners: readonly ((event: AgentSessionEvent) => void)[] = [];
  let aborted = false;

  const prompt = async (): Promise<void> => {
    for (const ev of plan.events ?? []) {
      for (const listener of listeners) {
        listener(ev);
      }
    }
    if (plan.waitForRelease !== undefined) {
      await plan.waitForRelease;
    }
    if (aborted) {
      throw new Error('aborted');
    }
    if (plan.throwError) {
      throw new Error(plan.throwError);
    }
  };

  return {
    subscribe: (fn: (event: AgentSessionEvent) => void) => {
      listeners = [...listeners, fn];
      return () => {
        listeners = listeners.filter((l) => l !== fn);
      };
    },
    prompt,
    abort: async () => {
      aborted = true;
    },
    dispose: () => undefined,
    getLastAssistantText: () => plan.finalText,
    getCallableToolNames: () => ['read', 'bash', 'edit', 'write'],
    getAllTools: () => [{ name: 'read' }, { name: 'bash' }, { name: 'powershell' }, { name: 'edit' }, { name: 'write' }, { name: 'grep' }, { name: 'find' }, { name: 'ls' }],
    setActiveToolsByName: () => undefined,
    agent: { state: { model: undefined } },
  };
}

vi.mock(import('@earendil-works/pi-coding-agent'), async (importOriginal) => {
  const actual = await importOriginal();

  class MockDefaultResourceLoader {
    constructor(opts: { readonly extensionFactories?: readonly ExtensionFactory[]; readonly appendSystemPrompt?: readonly string[] }) {
      lastLoaderOpts = opts;
    }
    async reload(): Promise<void> {
      return undefined;
    }
  }

  return {
    ...actual,
    DefaultResourceLoader: MockDefaultResourceLoader as typeof actual.DefaultResourceLoader,
    createAgentSession: (async (opts: { readonly model?: { readonly id: string }; readonly tools?: readonly string[] }) => {
      const plan = dequeuePlan();
      const captured: CapturedCreateCall = {
        ...(opts.model?.id ? { modelId: opts.model.id } : {}),
        ...(opts.tools ? { tools: opts.tools } : {}),
        extensionFactories: lastLoaderOpts.extensionFactories ?? [],
        appendSystemPrompt: lastLoaderOpts.appendSystemPrompt ?? [],
      };
      capturedCalls = [...capturedCalls, captured];
      return { session: createMockSession(plan) };
    }) as unknown as typeof actual.createAgentSession,
  };
});

afterEach(() => {
  nextPlans = [];
  capturedCalls = [];
  lastLoaderOpts = {};
});

function writeReviewerAgent(cwd: string): void {
  const agentsDir = join(cwd, '.pi', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  const content = ['---', 'name: reviewer', 'description: Reviews diffs for correctness', 'readonly: true', 'model: fast', 'tools: read, grep', '---', 'Review every changed file carefully.'].join('\n');
  writeFileSync(join(agentsDir, 'reviewer.md'), content);
}

describe('pi-subagents discovery and commands', () => {
  it('discovers built-in and custom workspace subagents and injects them into before_agent_start', async () => {
    const h = createTestHarness();
    try {
      writeReviewerAgent(h.cwd);
      await h.emit('session_start', {});
      const ctxRes = double<{ readonly systemPrompt?: string } | undefined>(await h.emit('before_agent_start', { messageType: 'user' }));
      expect(ctxRes?.systemPrompt).toContain('BASE SYSTEM PROMPT');
      expect(ctxRes?.systemPrompt).toContain('[SUBAGENTS AVAILABLE]');
      expect(ctxRes?.systemPrompt).toContain('general-purpose');
      expect(ctxRes?.systemPrompt).toContain('explore');
      expect(ctxRes?.systemPrompt).toContain('reviewer');

      await h.runCommand('agents');
      const note = h.getNotifications().at(-ONE)?.message ?? '';
      expect(note).toContain('reviewer');
      expect(note).toContain('workspace');

      await h.runCommand('subagent', 'reviewer check src/index.ts');
      expect(h.getSentUserMessages().at(-ONE)?.content).toBe('Use the task tool with subagent_type="reviewer" to: check src/index.ts');
    } finally {
      await h.cleanup();
    }
  });
});

function buildExploreEvents(): readonly AgentSessionEvent[] {
  return [
    double<AgentSessionEvent>({ type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'read', args: { path: 'src/index.ts' } }),
    double<AgentSessionEvent>({ type: 'tool_execution_end', toolCallId: 'tc-1', toolName: 'read', result: {}, isError: false }),
    double<AgentSessionEvent>({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', delta: 'Found 3 matching files.' } }),
  ];
}

describe('pi-subagents foreground execution', () => {
  it('streams live updates, renders call and result, and attaches readonly guard on explore', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'Found 3 matching files.', events: buildExploreEvents() });

      let seenUpdates: readonly string[] = [];
      const onUpdate = (partial: { readonly details?: { readonly currentStep?: string } }): void => {
        seenUpdates = [...seenUpdates, partial.details?.currentStep ?? ''];
      };
      const result = await h.callTool('task', { description: 'Explore source layout', prompt: 'Inspect src/index.ts', subagent_type: 'explore' }, { onUpdate });

      expect(result.details?.status).toBe('success');
      expect(result.details?.readonly).toBe(true);
      expect(result.details?.toolCallCount).toBe(ONE);
      expect(seenUpdates.some((step) => step.includes('Reading index.ts'))).toBe(true);
      expect(capturedCalls[ZERO]?.modelId).toBe('model-haiku-fast');

      const renderedCall = h.renderToolCall('task', { description: 'Explore source layout', subagent_type: 'explore' }).join('\n');
      expect(renderedCall).toContain('Task');
      expect(renderedCall).toContain('explore');

      const renderedResult = h.renderToolResult('task', result, false, false).join('\n');
      expect(renderedResult).toContain('Last output');
      expect(renderedResult).toContain('Found 3 matching files.');
    } finally {
      await h.cleanup();
    }
  });
});

describe('pi-subagents readonly guard', () => {
  it('blocks write and mutating bash in readonly subagents while allowing safe read-only commands', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'Checked.' });
      await h.callTool('task', { description: 'Read-only check', prompt: 'Check', subagent_type: 'explore' });
      const guardHandler = extractGuardHandler(capturedCalls[ZERO]?.extensionFactories[ZERO]);
      expect(guardHandler).toBeTypeOf('function');

      const writeBlocked = await guardHandler?.({ toolName: 'write', input: { path: 'a.ts', content: 'x' } });
      expect(writeBlocked?.block).toBe(true);
      expect(writeBlocked?.reason).toContain('readonly: true');

      const rmBlocked = await guardHandler?.({ toolName: 'bash', input: { command: 'rm -rf tmp' } });
      expect(rmBlocked?.block).toBe(true);

      const chainBlocked = await guardHandler?.({ toolName: 'bash', input: { command: 'ls -la; python3 -c "print(1)"' } });
      expect(chainBlocked?.block).toBe(true);

      const pipeBlocked = await guardHandler?.({ toolName: 'bash', input: { command: 'ls -la | python3 -c "print(1)"' } });
      expect(pipeBlocked?.block).toBe(true);

      const pipeAllowed = await guardHandler?.({ toolName: 'bash', input: { command: 'ls -la | head -n 5' } });
      expect(pipeAllowed).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});

describe('pi-subagents background execution and resume', () => {
  it('runs in background, delivers completion wakeup, supports await_subagent, and enforces resume rules', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'Background analysis complete.', waitForRelease: gate.promise });

      const bgResult = await h.callTool('task', { description: 'Run background audit', prompt: 'Audit deps', run_in_background: true });
      const agentId = bgResult.details?.agentId ?? '';
      expect(bgResult.details?.isBackground).toBe(true);
      expect(h.getStatuses()['pi-subagents-status']).toContain('1 task running');
      expect((h.getWidgets()['pi-subagents-running'] ?? []).join('\n')).toContain('Running 1 agent');

      await expect(h.callTool('task', { description: 'Follow up', prompt: 'More detail', resume: agentId })).rejects.toThrow('Sub-agent is currently running');

      const stillRunning = await h.callTool('await_subagent', { agent_id: agentId, timeout_ms: SHORT_TIMEOUT_MS });
      expect(double<{ readonly outcome?: string } | undefined>(stillRunning.details)?.outcome).toBe('still_running');

      gate.release();
      await expect.poll(() => h.getSentMessages().length).toBe(ONE);

      const sent = double<{ readonly customType: string; readonly details: unknown; readonly content: string }>(h.getSentMessages()[ZERO]?.message);
      expect(sent.customType).toBe('pi-subagents-background-completion');
      expect(h.renderMessage(sent.customType, sent).join('\n')).toContain('Run background audit');

      enqueuePlan({ finalText: 'Resumed follow-up answer.' });
      const resumed = await h.callTool('task', { description: 'Follow up', prompt: 'Summarize risks', resume: agentId });
      expect(resumed.details?.finalMessage).toBe('Resumed follow-up answer.');

      await expect(h.callTool('task', { description: 'Bad', prompt: 'Hi', resume: 'not-a-uuid' })).rejects.toThrow('Invalid subagent agent_id format');
    } finally {
      await h.cleanup();
    }
  });
});

describe('pi-subagents await_subagent deduplication', () => {
  it('returns finalized output from await_subagent and suppresses duplicate background wakeup', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'Awaited result payload.', waitForRelease: gate.promise });

      const bgResult = await h.callTool('task', { description: 'Awaited bg task', prompt: 'Compute', run_in_background: true });
      const agentId = bgResult.details?.agentId ?? '';

      const awaitPromise = h.callTool('await_subagent', { agent_id: agentId, timeout_ms: OVERLAY_WIDTH * SHORT_TIMEOUT_MS });
      gate.release();
      const awaited = await awaitPromise;
      const details = double<{ readonly outcome?: string; readonly finalMessage?: string } | undefined>(awaited.details);
      expect(details?.outcome).toBe('complete');
      expect(details?.finalMessage).toBe('Awaited result payload.');
      expect(h.getSentMessages().length).toBe(ZERO);
    } finally {
      await h.cleanup();
    }
  });
});

describe('pi-subagents foreground-to-background and overlay', () => {
  it('moves a foreground subagent to background via Ctrl+Alt+B and opens Tasks overlay via /tasks', async () => {
    let renderedList: readonly string[] = [];
    let renderedTranscript: readonly string[] = [];
    const h = createTestHarness({
      onCustomOverlay: async (factory) => {
        const comp = factory({ requestRender: () => undefined }, h.theme, {}, () => undefined);
        renderedList = comp.render(OVERLAY_WIDTH);
        comp.handleInput?.('\r');
        renderedTranscript = comp.render(OVERLAY_WIDTH);
        comp.handleInput?.('\u001b');
        comp.dispose?.();
      },
    });
    try {
      await h.emit('session_start', {});
      const fgGate = createGate();
      enqueuePlan({ finalText: 'Finished after backgrounding.', waitForRelease: fgGate.promise });

      const fgPromise = h.callTool('task', { description: 'Long foreground scan', prompt: 'Scan repo' });
      await expect.poll(() => h.getStatuses()['pi-subagents-status'] ?? '').toContain('1 task running');

      await h.triggerShortcut(Key.ctrlAlt('b'));
      const movedResult = await fgPromise;
      expect(movedResult.details?.isBackground).toBe(true);
      expect(movedResult.details?.backgroundReason).toBe('user_request');

      await h.runCommand('tasks');
      expect(renderedList.join('\n')).toContain('Long foreground scan');
      expect(renderedTranscript.join('\n')).toContain('Subagent · Long foreground scan');

      fgGate.release();
      await expect.poll(() => h.getSentMessages().length).toBe(ONE);
    } finally {
      await h.cleanup();
    }
  });

  it('renders grouped background completion header for multiple completions', async () => {
    const h = createTestHarness();
    try {
      const first = { taskId: 'a', kind: 'subagent', status: 'success', title: 'Task A' };
      const second = { taskId: 'b', kind: 'subagent', status: 'success', title: 'Task B' };
      const rendered = h.renderMessage('pi-subagents-background-completion', { content: '', details: { completions: [first, second] } }).join('\n');
      expect(rendered).toContain('Finished');
      expect(rendered).toContain(`[${TWO} background tasks]`);
    } finally {
      await h.cleanup();
    }
  });
});
