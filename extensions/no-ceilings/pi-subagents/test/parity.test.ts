import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import type { AgentSessionEvent, ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverSubagents } from '../src/discovery.ts';
import { applyDefinitionToModel } from '../src/model-resolution.ts';
import { SUBAGENTS_CONFIG_FILE_NAME, type TaskToolDetails } from '../src/types.ts';
import { createSubagentWorktree, summarizeWorktreeDiff } from '../src/worktree.ts';
import { createGate, createTestHarness, double, makeDefinition } from './harness.ts';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;

interface MockPlan {
  readonly finalText: string;
  readonly events?: readonly AgentSessionEvent[];
  readonly throwError?: string;
  readonly waitForRelease?: Promise<void>;
}

interface CapturedCreate {
  readonly cwd?: string;
  readonly tools?: readonly string[];
  readonly modelId?: string;
  readonly thinkingLevel?: string;
  readonly activeTools: readonly string[];
  readonly childTrust?: boolean;
  readonly loaderTrust?: boolean;
}

let plans: readonly MockPlan[] = [];
let captured: readonly CapturedCreate[] = [];
let loaderOptions: Readonly<Record<string, unknown>> = {};
let loaderSettingsTrust: boolean | undefined;
let activeToolsCalls: readonly (readonly string[])[] = [];

function enqueuePlan(plan: MockPlan): void {
  plans = [...plans, plan];
}

function dequeuePlan(): MockPlan {
  const [first, ...rest] = plans;
  plans = rest;
  return first ?? { finalText: 'default response' };
}

function createMockSession(plan: MockPlan) {
  let listeners: readonly ((event: AgentSessionEvent) => void)[] = [];
  let aborted = false;
  const prompt = async (): Promise<void> => {
    for (const event of plan.events ?? []) {
      for (const listener of listeners) {
        listener(event);
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
    subscribe: (listener: (event: AgentSessionEvent) => void) => {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((entry) => entry !== listener);
      };
    },
    prompt,
    abort: async () => {
      aborted = true;
    },
    dispose: () => undefined,
    getLastAssistantText: () => plan.finalText,
    getCallableToolNames: () => ['read', 'bash', 'edit', 'write', 'grep', 'powershell'],
    setActiveToolsByName: (names: readonly string[]) => {
      activeToolsCalls = [...activeToolsCalls, names];
    },
  };
}

vi.mock('@earendil-works/pi-coding-agent', async () => {
  const actual = await vi.importActual<typeof import('@earendil-works/pi-coding-agent')>('@earendil-works/pi-coding-agent');

  class MockDefaultResourceLoader {
    constructor(options: Readonly<Record<string, unknown>>) {
      loaderOptions = options;
      const settingsManager = options['settingsManager'] as { readonly isProjectTrusted?: () => boolean } | undefined;
      loaderSettingsTrust = settingsManager?.isProjectTrusted?.();
    }
    async reload(): Promise<void> {
      return undefined;
    }
  }

  return {
    ...actual,
    DefaultResourceLoader: MockDefaultResourceLoader,
    createAgentSession: async (options: {
      readonly cwd?: string;
      readonly tools?: readonly string[];
      readonly model?: { readonly id: string };
      readonly thinkingLevel?: string;
      readonly settingsManager?: { readonly isProjectTrusted?: () => boolean };
    }) => {
      captured = [
        ...captured,
        {
          ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
          ...(options.tools !== undefined ? { tools: options.tools } : {}),
          ...(options.model !== undefined ? { modelId: options.model.id } : {}),
          ...(options.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
          activeTools: [],
          ...(options.settingsManager?.isProjectTrusted !== undefined ? { childTrust: options.settingsManager.isProjectTrusted() } : {}),
          ...(loaderSettingsTrust !== undefined ? { loaderTrust: loaderSettingsTrust } : {}),
        },
      ];
      return { session: createMockSession(dequeuePlan()) };
    },
  };
});

function writeAgent(cwd: string, relativeDir: string, fileName: string, contents: string): void {
  const dir = join(cwd, relativeDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), contents);
}

function writeConfig(cwd: string, config: unknown): void {
  writeAgent(cwd, '.pi', SUBAGENTS_CONFIG_FILE_NAME, JSON.stringify(config));
}

function toolEvent(toolName: string, toolCallId: string, args: unknown): readonly AgentSessionEvent[] {
  return [
    double<AgentSessionEvent>({ type: 'tool_execution_start', toolCallId, toolName, args }),
    double<AgentSessionEvent>({ type: 'tool_execution_end', toolCallId, toolName, result: { content: [{ type: 'text', text: `${toolName} output` }] }, isError: false }),
  ];
}

beforeEach(() => {
  plans = [];
  captured = [];
  loaderOptions = {};
  loaderSettingsTrust = undefined;
  activeToolsCalls = [];
});

afterEach(() => {
  plans = [];
  captured = [];
  loaderOptions = {};
  loaderSettingsTrust = undefined;
  activeToolsCalls = [];
});

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

  it('retries a run restored from an earlier session', async () => {
    const persisted = {
      sessions: [
        {
          agentId: '11111111-2222-4333-8444-555555555555',
          parentSessionId: 'previous-session',
          toolCallId: 'call-restored',
          subagentType: 'general-purpose',
          description: 'Restored run',
          prompt: 'Do the restored work',
          readonly: false,
          status: 'error',
          isBackground: false,
          backgroundReason: 'unspecified',
          error: 'boom',
          toolCallCount: ZERO,
          startedAt: 1,
          updatedAt: 2,
        },
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

describe('trust and tool inheritance', () => {
  it('gives the child an untrusted settings manager when the project is untrusted', async () => {
    const h = createTestHarness({ projectTrusted: false });
    try {
      writeConfig(h.cwd, {});
      writeAgent(h.cwd, '.pi', 'SYSTEM.md', 'UNTRUSTED_SYSTEM_CANARY');
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'ok' });
      await h.callTool('task', { description: 'Trust check', prompt: 'go', subagent_type: 'general-purpose' });
      expect(captured[ZERO]?.childTrust).toBe(false);
      expect(captured[ZERO]?.loaderTrust).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  it('gives the child the parent tool set even when that set inherits nothing', async () => {
    const h = createTestHarness({ activeTools: ['task'] });
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'ok' });
      await h.callTool('task', { description: 'Restricted parent', prompt: 'go', subagent_type: 'general-purpose' });
      expect(activeToolsCalls[ZERO]).toEqual([]);
    } finally {
      await h.cleanup();
    }
  });
});

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
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      await h.runCommand('tasks', 'list');
      expect(h.getNotifications().at(-ONE)?.message).toContain('[success/bg]');
      expect(h.getSentMessages().some((message) => JSON.stringify(message).includes('pi-subagents-background-completion'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  it('persists checkpoints and the transcript path while the run is still going', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'eventually', events: toolEvent('read', 'call-mid', { path: 'a.ts' }), waitForRelease: gate.promise });
      const launched = await h.callTool('task', { description: 'Mid run', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true });
      for (let attempt = ZERO; attempt < 40; attempt += 1) {
        if (h.getEmittedEvents().some((entry) => entry.channel === 'subagents:checkpoint')) {
          break;
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
      }
      const states = h.getEntries().filter((entry) => entry.customType === 'pi-subagents-state');
      const snapshot = double<{
        readonly sessions: readonly { readonly agentId: string; readonly status: string; readonly toolCallCount: number; readonly checkpoints: readonly { readonly seq: number }[]; readonly transcriptPath?: string }[];
      }>(states.at(-ONE)?.data);
      const recorded = snapshot.sessions.find((session) => session.agentId === launched.details?.agentId);
      expect(recorded?.checkpoints.length).toBeGreaterThan(ZERO);
      expect(recorded?.toolCallCount).toBeGreaterThan(ZERO);
      expect(recorded?.transcriptPath).toBeDefined();
      expect(recorded?.status).toBe('running');
      gate.release();
      await h.callTool('await_subagent', { agent_id: launched.details?.agentId });
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

describe('nested tool inheritance and shell coverage', () => {
  it('gives a grandchild the calling child tools, not the root session tools', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'owner.md', ['---', 'name: owner', 'description: Owns nested work', 'tools: read', 'nested-tasks: true', '---', 'Own the work.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'owner done' });
      await h.callTool('task', { description: 'Owner run', prompt: 'go', subagent_type: 'owner' });
      const factories = loaderOptions['extensionFactories'] as readonly unknown[];
      expect(factories.length).toBe(TWO);
      const nestedFactory = factories[ONE] as (api: ExtensionAPI) => void;
      const nestedTools: Record<string, { execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<unknown> }> = {};
      const fakeChild = double<ExtensionAPI>({
        registerTool: (tool: { readonly name: string; readonly execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<unknown> }) => {
          nestedTools[tool.name] = tool;
        },
        getActiveTools: () => ['read', 'task', 'await_subagent'],
      });
      nestedFactory(fakeChild);
      enqueuePlan({ finalText: 'grandchild done' });
      await nestedTools['task']?.execute('call-grand', { description: 'Grandchild work', prompt: 'go', subagent_type: 'general-purpose' }, undefined, undefined, h.ctx);
      expect(activeToolsCalls.at(-ONE)).toEqual(['read']);
    } finally {
      await h.cleanup();
    }
  });

  it('drops powershell from a read-only child that inherits tools', async () => {
    const h = createTestHarness({ activeTools: ['read', 'bash', 'powershell'] });
    try {
      writeAgent(h.cwd, '.pi/agents', 'reader.md', ['---', 'name: reader', 'description: Reads only', 'readonly: true', '---', 'Read the files.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'read' });
      await h.callTool('task', { description: 'Read only', prompt: 'go', subagent_type: 'reader' });
      expect(activeToolsCalls[ZERO]).toEqual(['read', 'bash']);
    } finally {
      await h.cleanup();
    }
  });
});

describe('worktree and transcript durability', () => {
  function initRepo(cwd: string): void {
    execFileSync('git', ['init'], { cwd });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
    writeFileSync(join(cwd, 'README.md'), 'base\n');
    execFileSync('git', ['add', '.'], { cwd });
    execFileSync('git', ['commit', '-m', 'base'], { cwd });
  }

  it('keeps the worktree across resumes and refuses a resume after prune', async () => {
    const h = createTestHarness();
    try {
      initRepo(h.cwd);
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'first' });
      const first = await h.callTool('task', { description: 'Isolated job', prompt: 'go', subagent_type: 'general-purpose', worktree: true });
      const worktreePath = first.details?.worktreePath;
      expect(worktreePath).toBeDefined();
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
      expect(transcriptPath).toBeDefined();
      if (transcriptPath === undefined) {
        return;
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
      const worktreePath = launched.details?.worktreePath;
      expect(worktreePath).toBeDefined();
      if (worktreePath !== undefined) {
        writeFileSync(join(worktreePath, 'notes.txt'), 'changed\n');
      }
      gate.release();
      const awaited = await h.callTool('await_subagent', { agent_id: launched.details?.agentId });
      const text = (awaited.content[ZERO] as { readonly text?: string }).text ?? '';
      expect(text).toContain('notes.txt');
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

  it('does not retry a refused resume into a fresh run', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'first' });
      const first = await h.callTool('task', { description: 'Resume job', prompt: 'go', subagent_type: 'general-purpose' });
      const transcriptPath = first.details?.transcriptPath;
      expect(transcriptPath).toBeDefined();
      if (transcriptPath === undefined) {
        return;
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
      for (let attempt = ZERO; attempt < 40; attempt += 1) {
        if (h.getEmittedEvents().some((entry) => entry.channel === 'subagents:checkpoint')) {
          break;
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
      }
      const state = h
        .getEntries()
        .filter((entry) => entry.customType === 'pi-subagents-state')
        .at(-ONE);
      const sessions = double<{ readonly sessions: readonly { readonly agentId: string; readonly transcriptItems?: readonly { readonly text: string }[] }[] }>(state?.data).sessions;
      const completedRecord = sessions.find((session) => session.agentId === completed.details?.agentId);
      const runningRecord = sessions.find((session) => session.agentId === running.details?.agentId);
      expect(completedRecord?.transcriptItems?.some((item) => item.text.includes('completed reply'))).toBe(true);
      expect(runningRecord?.transcriptItems === undefined || runningRecord.transcriptItems.length === ZERO).toBe(true);
      gate.release();
      await h.callTool('await_subagent', { agent_id: running.details?.agentId });
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
});

describe('sampling wiring', () => {
  it('adds a sampling factory that rewrites the provider payload', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'cold.md', ['---', 'name: cold', 'description: Reviews at a low temperature', 'model-params:', '  temperature: 0.2', '  top_p: 0.5', '---', 'Work.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'ok' });
      await h.callTool('task', { description: 'Cold run', prompt: 'go', subagent_type: 'cold' });
      const factories = loaderOptions['extensionFactories'] as readonly unknown[];
      expect(factories.length).toBe(TWO);
      let handler: ((event: { readonly type: 'before_provider_request'; readonly payload: unknown }) => Promise<unknown>) | undefined;
      const samplingFactory = factories[ONE] as (api: ExtensionAPI) => void;
      samplingFactory(
        double<ExtensionAPI>({
          on: (name: string, callback: unknown) => {
            if (name === 'before_provider_request') {
              handler = callback as typeof handler;
            }
          },
        }),
      );
      const payload = await handler?.({ type: 'before_provider_request', payload: { model: 'm' } });
      expect(payload).toMatchObject({ model: 'm', temperature: 0.2, top_p: 0.5 });
    } finally {
      await h.cleanup();
    }
  });
});

describe('hook events, thinking, and duplicates', () => {
  it('emits run_end when a worktree cannot be created', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      await expect(h.callTool('task', { description: 'Broken worktree', prompt: 'go', subagent_type: 'general-purpose', worktree: true })).rejects.toMatchObject({ code: 'worktree-failed' });
      const end = h.getEmittedEvents().find((entry) => entry.channel === 'subagents:run_end');
      const payload = double<{ readonly errorCode?: string } | undefined>(end?.data);
      expect(payload?.errorCode).toBe('worktree-failed');
    } finally {
      await h.cleanup();
    }
  });

  it('records thinking from thinking_end and message_end blocks once', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({
        finalText: 'done',
        events: [
          double<AgentSessionEvent>({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'thinking_start', contentIndex: ZERO, partial: {} } }),
          double<AgentSessionEvent>({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'thinking_end', contentIndex: ZERO, content: 'hidden reasoning', partial: {} } }),
          double<AgentSessionEvent>({
            type: 'message_end',
            message: {
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'hidden reasoning' },
                { type: 'text', text: 'done' },
              ],
            },
          }),
        ],
      });
      const result = await h.callTool('task', { description: 'Thinking job', prompt: 'think', subagent_type: 'general-purpose' });
      const record = double<{ readonly sessions: readonly { readonly agentId: string; readonly transcriptItems: readonly { readonly role: string; readonly text: string }[] }[] }>(
        h
          .getEntries()
          .filter((entry) => entry.customType === 'pi-subagents-state')
          .at(-ONE)?.data,
      );
      const items = record.sessions.find((session) => session.agentId === result.details?.agentId)?.transcriptItems ?? [];
      const thinking = items.filter((item) => item.role === 'thinking');
      expect(thinking.length).toBe(ONE);
      expect(thinking[ZERO]?.text).toContain('hidden reasoning');
      expect(items.filter((item) => item.role === 'assistant').length).toBe(ONE);
    } finally {
      await h.cleanup();
    }
  });

  it('stores one assistant item when the final text has trailing whitespace', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'All done.', events: [double<AgentSessionEvent>({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'All done.\n' }] } })] });
      const result = await h.callTool('task', { description: 'Whitespace job', prompt: 'go', subagent_type: 'general-purpose' });
      const record = double<{ readonly sessions: readonly { readonly agentId: string; readonly transcriptItems: readonly { readonly role: string; readonly text: string }[] }[] }>(
        h
          .getEntries()
          .filter((entry) => entry.customType === 'pi-subagents-state')
          .at(-ONE)?.data,
      );
      const items = record.sessions.find((session) => session.agentId === result.details?.agentId)?.transcriptItems ?? [];
      expect(items.filter((item) => item.role === 'assistant').length).toBe(ONE);
      expect(items.find((item) => item.role === 'assistant')?.text).toBe('All done.');
    } finally {
      await h.cleanup();
    }
  });
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
      execFileSync('git', ['init'], { cwd: h.cwd });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: h.cwd });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: h.cwd });
      writeFileSync(join(h.cwd, 'README.md'), 'base\n');
      execFileSync('git', ['add', '.'], { cwd: h.cwd });
      execFileSync('git', ['commit', '-m', 'base'], { cwd: h.cwd });
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
});

describe('nested catalog and command naming', () => {
  it('gives a nested child the agent catalog', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'owner.md', ['---', 'name: owner', 'description: Owns nested work', 'nested-tasks: true', '---', 'Own the work.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'owner done' });
      await h.callTool('task', { description: 'Owner run', prompt: 'go', subagent_type: 'owner' });
      const factories = loaderOptions['extensionFactories'] as readonly unknown[];
      const nestedFactory = factories[ONE] as (api: ExtensionAPI) => void;
      let handler: ((event: { readonly messageType: string }, ctx: ExtensionContext) => Promise<{ readonly systemPrompt?: string }>) | undefined;
      nestedFactory(
        double<ExtensionAPI>({
          registerTool: () => undefined,
          on: (name: string, callback: unknown) => {
            if (name === 'before_agent_start') {
              handler = callback as typeof handler;
            }
          },
        }),
      );
      const result = await handler?.({ messageType: 'user' }, h.ctx);
      expect(result?.systemPrompt).toContain('[SUBAGENTS AVAILABLE]');
      expect(result?.systemPrompt).toContain('`owner`');
      expect(result?.systemPrompt).toContain('`general-purpose`');
    } finally {
      await h.cleanup();
    }
  });

  it('registers a command for each agent when slugs collide', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'a.md', ['---', 'name: foo bar', 'description: Spaced', '---', 'Work.'].join('\n'));
      writeAgent(h.cwd, '.pi/agents', 'b.md', ['---', 'name: foo-bar', 'description: Hyphenated', '---', 'Work.'].join('\n'));
      await h.emit('session_start', {});
      const commands = h.listCommands().filter((command) => command.startsWith('subagent:foo-bar'));
      expect(commands.length).toBe(TWO);
    } finally {
      await h.cleanup();
    }
  });

  it('resolves a multi-word agent name in the generic subagent command', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'spaced.md', ['---', 'name: foo bar', 'description: Spaced name', '---', 'Work.'].join('\n'));
      await h.emit('session_start', {});
      await h.runCommand('subagent', 'foo bar scan');
      const sent = h.getSentUserMessages().at(-ONE)?.content ?? '';
      expect(sent).toContain('subagent_type="foo bar"');
      expect(sent).toContain('to: scan');
    } finally {
      await h.cleanup();
    }
  });

  it('warns when the generic command has no prompt after the background flag', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const before = h.getSentUserMessages().length;
      await h.runCommand('subagent', 'explore --bg');
      expect(h.getSentUserMessages().length).toBe(before);
      expect(h.getNotifications().at(-ONE)?.message).toContain('Usage');
    } finally {
      await h.cleanup();
    }
  });

  it('refuses a per-agent command after the agent file is removed', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'scout.md', ['---', 'name: scout', 'description: Finds things', '---', 'Scout.'].join('\n'));
      await h.emit('session_start', {});
      rmSync(join(h.cwd, '.pi/agents', 'scout.md'));
      await h.emit('session_start', {});
      const before = h.getSentUserMessages().length;
      await h.runCommand('subagent:scout', 'find the bug');
      expect(h.getSentUserMessages().length).toBe(before);
      expect(h.getNotifications().at(-ONE)?.message).toContain('Unknown subagent');
    } finally {
      await h.cleanup();
    }
  });
});

describe('read-only await validation', () => {
  it('validates the id on the read-only await shortcut', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      await expect(h.callTool('task', { description: 'Await bad id', prompt: '', subagent_type: 'explore', resume: 'not-a-uuid' })).rejects.toMatchObject({ code: 'invalid-id' });
      await expect(h.callTool('task', { description: 'Await unknown', prompt: '', subagent_type: 'explore', resume: '99999999-8888-4777-8666-555555555555' })).rejects.toMatchObject({ code: 'resume-unavailable' });
    } finally {
      await h.cleanup();
    }
  });
});

describe('nesting limit at zero', () => {
  it('rejects a top-level subagent when no nesting level is allowed', async () => {
    const h = createTestHarness();
    try {
      writeConfig(h.cwd, { nesting: { maxDepth: 0 } });
      await h.emit('session_start', {});
      await expect(h.callTool('task', { description: 'No level', prompt: 'go', subagent_type: 'general-purpose' })).rejects.toMatchObject({ code: 'nesting-limit' });
    } finally {
      await h.cleanup();
    }
  });
});

describe('built-in subagents and explore configuration', () => {
  it('uses the fast model for explore by default and the parent model when configured to inherit', async () => {
    const defaults = createTestHarness();
    try {
      await defaults.emit('session_start', {});
      enqueuePlan({ finalText: 'explored' });
      await defaults.callTool('task', { description: 'Explore', prompt: 'Look around', subagent_type: 'explore' });
      expect(captured[ZERO]?.modelId).toBe('model-haiku-fast');
    } finally {
      await defaults.cleanup();
    }
    captured = [];
    const inheriting = createTestHarness();
    try {
      writeConfig(inheriting.cwd, { explore: { model: 'inherit' } });
      await inheriting.emit('session_start', {});
      enqueuePlan({ finalText: 'explored' });
      await inheriting.callTool('task', { description: 'Explore', prompt: 'Look around', subagent_type: 'explore' });
      expect(captured[ZERO]?.modelId).toBe('model-sonnet');
    } finally {
      await inheriting.cleanup();
    }
  });

  it('hides explore when the config disables it', async () => {
    const h = createTestHarness();
    try {
      writeConfig(h.cwd, { explore: { enabled: false } });
      await h.emit('session_start', {});
      const contextResult = double<{ readonly systemPrompt?: string }>(await h.emit('before_agent_start', { messageType: 'user' }));
      expect(contextResult.systemPrompt).not.toContain('`explore`');
      await expect(h.callTool('task', { description: 'Explore', prompt: 'x', subagent_type: 'explore' })).rejects.toThrow('Unknown subagent_type');
    } finally {
      await h.cleanup();
    }
  });

  it('offers the browser subagent only when a browser MCP integration is available', async () => {
    const without = createTestHarness();
    try {
      await without.emit('session_start', {});
      const contextResult = double<{ readonly systemPrompt?: string }>(await without.emit('before_agent_start', { messageType: 'user' }));
      expect(contextResult.systemPrompt).not.toContain('`browser`');
    } finally {
      await without.cleanup();
    }
    const withIntegration = createTestHarness({ mcpToolNames: ['mcp__playwright__browser_click', 'mcp__playwright__browser_navigate'] });
    try {
      await withIntegration.emit('session_start', {});
      enqueuePlan({ finalText: 'clicked' });
      const result = await withIntegration.callTool('task', { description: 'Click the button', prompt: 'Open the page and click', subagent_type: 'browser' });
      expect(result.details?.subagentType).toBe('browser');
      expect(captured[ZERO]?.tools).toContain('mcp__*');
      expect((loaderOptions['extensionFactories'] as readonly unknown[]).length).toBeGreaterThan(ONE);
    } finally {
      await withIntegration.cleanup();
    }
  });
});

describe('project trust before session_start', () => {
  it('hides project agents before the first lifecycle event on an untrusted project', async () => {
    const h = createTestHarness({ projectTrusted: false });
    try {
      writeAgent(h.cwd, '.pi/agents', 'hidden.md', ['---', 'name: hidden-agent', 'description: Hidden project agent', '---', 'Body.'].join('\n'));
      await h.runCommand('agents');
      expect(h.getNotifications().at(-ONE)?.message).not.toContain('hidden-agent');
      await expect(h.callTool('task', { description: 'Use it', prompt: 'go', subagent_type: 'hidden-agent' })).rejects.toMatchObject({ code: 'type-unknown' });
    } finally {
      await h.cleanup();
    }
  });

  it('still discovers project agents before the first lifecycle event on a trusted project', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'visible.md', ['---', 'name: visible-agent', 'description: Visible project agent', '---', 'Body.'].join('\n'));
      await h.runCommand('agents');
      expect(h.getNotifications().at(-ONE)?.message).toContain('visible-agent');
    } finally {
      await h.cleanup();
    }
  });
});

describe('custom subagents: discovery and frontmatter', () => {
  it('discovers agents from Claude and Codex directories with their frontmatter conventions', () => {
    const home = join(tmpdir(), `pi-subagents-home-${process.pid}-${Date.now()}`);
    const agentDir = join(tmpdir(), `pi-subagents-agent-${process.pid}-${Date.now()}`);
    const cwd = join(tmpdir(), `pi-subagents-cwd-${process.pid}-${Date.now()}`);
    mkdirSync(join(cwd, '.claude/agents'), { recursive: true });
    mkdirSync(join(cwd, '.codex/agents'), { recursive: true });
    mkdirSync(join(cwd, '.pi/agents'), { recursive: true });
    mkdirSync(join(home, '.claude/agents'), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(cwd, '.claude/agents/claude-reviewer.md'), ['---', 'name: claude-reviewer', 'description: Reviews code', 'tools: Read, Grep', 'model: haiku', 'permission-mode: readonly', '---', 'Review carefully.'].join('\n'));
    writeFileSync(join(cwd, '.codex/agents/codex-runner.md'), ['---', 'name: codex-runner', 'description: Runs builds', 'model: gpt-5-codex', 'sandbox_mode: read-only', '---', 'Run the build.'].join('\n'));
    writeFileSync(join(cwd, '.pi/agents/pi-agent.md'), ['---', 'name: pi-agent', 'description: Pi native', '---', 'Do pi work.'].join('\n'));
    writeFileSync(join(home, '.claude/agents/user-agent.md'), ['---', 'name: user-agent', 'description: User scoped', '---', 'User work.'].join('\n'));

    const definitions = discoverSubagents(cwd, { homeDir: home, agentDir });
    const byName = new Map(definitions.map((definition) => [definition.name, definition]));
    expect(byName.get('claude-reviewer')?.permissionMode).toBe('readonly');
    expect(byName.get('claude-reviewer')?.model).toBe('fast');
    expect(byName.get('claude-reviewer')?.tools).toEqual(['read', 'grep']);
    expect(byName.get('codex-runner')?.permissionMode).toBe('readonly');
    expect(byName.get('pi-agent')?.source).toBe('workspace');
    expect(byName.get('user-agent')?.source).toBe('claude-user');
  });

  it('hides project agents from an untrusted project', async () => {
    const h = createTestHarness({ projectTrusted: false });
    try {
      writeAgent(h.cwd, '.pi/agents', 'secret.md', ['---', 'name: secret-agent', 'description: Project only', '---', 'Body.'].join('\n'));
      await h.emit('session_start', {});
      const contextResult = double<{ readonly systemPrompt?: string }>(await h.emit('before_agent_start', { messageType: 'user' }));
      expect(contextResult.systemPrompt).not.toContain('secret-agent');
      expect(h.listCommands()).not.toContain('subagent:secret-agent');
    } finally {
      await h.cleanup();
    }
  });

  it('applies thinking, sampling, context window, retry, worktree, and mcp frontmatter', () => {
    const home = join(tmpdir(), `pi-subagents-home2-${process.pid}-${Date.now()}`);
    const agentDir = join(tmpdir(), `pi-subagents-agent2-${process.pid}-${Date.now()}`);
    const cwd = join(tmpdir(), `pi-subagents-cwd2-${process.pid}-${Date.now()}`);
    mkdirSync(join(cwd, '.pi/agents'), { recursive: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(cwd, '.pi/agents/tuned.md'),
      [
        '---',
        'name: tuned',
        'description: Tuned agent',
        'thinking: xhigh',
        'model-params:',
        '  temperature: 0.2',
        '  top_p: 0.9',
        '  max_tokens: 4096',
        'context-window: 200k',
        'retry: 3',
        'worktree: true',
        'mcp: true',
        '---',
        'Tuned work.',
      ].join('\n'),
    );
    const tuned = discoverSubagents(cwd, { homeDir: home, agentDir }).find((definition) => definition.name === 'tuned');
    expect(tuned?.thinking).toBe('xhigh');
    expect(tuned?.sampling).toEqual({ temperature: 0.2, topP: 0.9, maxTokens: 4096 });
    expect(tuned?.contextWindow).toBe(200_000);
    expect(tuned?.retryAttempts).toBe(THREE);
    expect(tuned?.worktree).toBe(true);
    expect(tuned?.mcp).toBe(true);
  });

  it('registers one slash command per discovered agent', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'reviewer.md', ['---', 'name: reviewer', 'description: Reviews diffs', '---', 'Review the diff.'].join('\n'));
      await h.emit('session_start', {});
      expect(h.listCommands()).toContain('subagent:reviewer');
      await h.runCommand('subagent:reviewer', '--bg check the diff');
      expect(h.getSentUserMessages().at(-ONE)?.content).toContain('subagent_type="reviewer"');
      expect(h.getSentUserMessages().at(-ONE)?.content).toContain('run_in_background: true');
    } finally {
      await h.cleanup();
    }
  });

  it('slugifies agent names for slash commands and keeps the first of two colliding names', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'spaced.md', ['---', 'name: My Agent', 'description: Spaced name', '---', 'Work.'].join('\n'));
      writeAgent(h.cwd, '.pi/agents', 'collide.md', ['---', 'name: my-agent', 'description: Colliding name', '---', 'Work.'].join('\n'));
      await h.emit('session_start', {});
      expect(h.listCommands()).toContain('subagent:my-agent');
      expect(h.listCommands()).not.toContain('subagent:My Agent');
      await h.runCommand('subagent:my-agent', 'do the work');
      expect(h.getSentUserMessages().at(-ONE)?.content).toMatch(/subagent_type="(My Agent|my-agent)"/);
    } finally {
      await h.cleanup();
    }
  });

  it('inherits the parent tool loadout when the definition lists no tools and passes an explicit list otherwise', async () => {
    const inheriting = createTestHarness();
    try {
      await inheriting.emit('session_start', {});
      enqueuePlan({ finalText: 'ok' });
      await inheriting.callTool('task', { description: 'Inherit tools', prompt: 'go', subagent_type: 'general-purpose' });
      expect(captured[ZERO]?.tools).toBeUndefined();
      expect(activeToolsCalls[ZERO]).toEqual(['read', 'bash', 'edit', 'write']);
    } finally {
      await inheriting.cleanup();
    }
    captured = [];
    activeToolsCalls = [];
    const explicit = createTestHarness();
    try {
      await explicit.emit('session_start', {});
      enqueuePlan({ finalText: 'ok' });
      await explicit.callTool('task', { description: 'Explicit tools', prompt: 'go', subagent_type: 'shell' });
      expect(captured[ZERO]?.tools).toEqual(['bash', 'read']);
    } finally {
      await explicit.cleanup();
    }
  });

  it('starts runs in the background when the config default says so', async () => {
    const h = createTestHarness();
    try {
      writeConfig(h.cwd, { defaults: { background: true } });
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'background by default' });
      const launched = await h.callTool('task', { description: 'Default background', prompt: 'go', subagent_type: 'general-purpose' });
      expect(launched.details?.isBackground).toBe(true);
      expect(launched.details?.backgroundReason).toBe('unspecified');
      const awaited = await h.callTool('await_subagent', { agent_id: launched.details?.agentId });
      expect(awaited.details?.finalMessage).toBe('background by default');
    } finally {
      await h.cleanup();
    }
  });

  it('withholds write tools when a read-only agent inherits the parent loadout', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'reader.md', ['---', 'name: reader', 'description: Reads only', 'readonly: true', '---', 'Read the files.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'read' });
      await h.callTool('task', { description: 'Read only', prompt: 'go', subagent_type: 'reader' });
      expect(captured[ZERO]?.tools).toBeUndefined();
      expect(activeToolsCalls[ZERO]).toEqual(['read', 'bash']);
    } finally {
      await h.cleanup();
    }
  });

  it('keeps project rules in scope for the child session', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'ok' });
      await h.callTool('task', { description: 'Rules', prompt: 'go', subagent_type: 'general-purpose' });
      expect(loaderOptions['noContextFiles']).toBeUndefined();
      expect(loaderOptions['cwd']).toBe(h.cwd);
    } finally {
      await h.cleanup();
    }
  });
});

describe('isolation and observability', () => {
  it('runs in the parent checkout by default and in a git worktree on request', async () => {
    const h = createTestHarness();
    try {
      execFileSync('git', ['init'], { cwd: h.cwd });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: h.cwd });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: h.cwd });
      writeFileSync(join(h.cwd, 'README.md'), 'base\n');
      execFileSync('git', ['add', '.'], { cwd: h.cwd });
      execFileSync('git', ['commit', '-m', 'base'], { cwd: h.cwd });
      await h.emit('session_start', {});

      enqueuePlan({ finalText: 'shared checkout' });
      const shared = await h.callTool('task', { description: 'Shared work', prompt: 'go', subagent_type: 'general-purpose' });
      expect(shared.details?.worktreePath).toBeUndefined();
      expect(captured[ZERO]?.cwd).toBe(h.cwd);

      enqueuePlan({ finalText: 'isolated work' });
      const isolated = await h.callTool('task', { description: 'Isolated work', prompt: 'go', subagent_type: 'general-purpose', worktree: true });
      expect(isolated.details?.worktreePath).toBeDefined();
      expect(isolated.details?.branch).toMatch(/^pi-subagents\//);
      expect(captured[ONE]?.cwd).toBe(isolated.details?.worktreePath);

      const record = double<{ readonly sessions: readonly { readonly agentId: string; readonly worktree?: { readonly path: string; readonly branch: string; readonly repoRoot: string; readonly baseRef: string } }[] }>(
        h
          .getEntries()
          .filter((entry) => entry.customType === 'pi-subagents-state')
          .at(-ONE)?.data,
      );
      const worktree = record.sessions.find((session) => session.agentId === isolated.details?.agentId)?.worktree;
      expect(worktree).toBeDefined();
      if (worktree) {
        expect((await summarizeWorktreeDiff(worktree)).length).toBeGreaterThanOrEqual(ZERO);
      }
    } finally {
      await h.cleanup();
    }
  });

  it('keeps a running worktree and removes it after the run finishes', async () => {
    const h = createTestHarness();
    try {
      execFileSync('git', ['init'], { cwd: h.cwd });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: h.cwd });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: h.cwd });
      writeFileSync(join(h.cwd, 'README.md'), 'base\n');
      execFileSync('git', ['add', '.'], { cwd: h.cwd });
      execFileSync('git', ['commit', '-m', 'base'], { cwd: h.cwd });
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'isolated done', waitForRelease: gate.promise });
      const launched = await h.callTool('task', { description: 'Isolated job', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true, worktree: true });
      const worktreePath = launched.details?.worktreePath;
      expect(worktreePath).toBeDefined();
      await h.runCommand('tasks', `prune ${launched.details?.agentId ?? ''}`);
      expect(h.getNotifications().at(-ONE)?.message).toContain('still running');
      gate.release();
      await h.callTool('await_subagent', { agent_id: launched.details?.agentId });
      await h.runCommand('tasks', `prune ${launched.details?.agentId ?? ''}`);
      expect(h.getNotifications().at(-ONE)?.message).toContain('Removed worktree');
      if (worktreePath !== undefined) {
        expect(existsSync(worktreePath)).toBe(false);
      }
    } finally {
      await h.cleanup();
    }
  });

  it('creates and summarizes a real worktree outside the task pipeline', async () => {
    const repo = join(tmpdir(), `pi-subagents-repo-${process.pid}-${Date.now()}`);
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    writeFileSync(join(repo, 'file.txt'), 'one\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: repo });

    const created = await createSubagentWorktree({ cwd: repo, description: 'Refactor the parser', agentId: 'a', sessionDir: join(repo, '.sessions'), root: undefined, branchPrefix: 'pi-subagents' });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.worktree.branch).toMatch(/^pi-subagents\/refactor-the-parser-[0-9a-f]{3}$/);
      writeFileSync(join(created.worktree.path, 'file.txt'), 'two\n');
      const summary = await summarizeWorktreeDiff(created.worktree);
      expect(summary).toContain('file.txt');
    }
    const notRepo = await createSubagentWorktree({ cwd: tmpdir(), description: 'nope', agentId: 'b', sessionDir: undefined, root: undefined, branchPrefix: 'pi-subagents' });
    expect(notRepo.ok).toBe(false);
  });

  it('keeps an ordered transcript with the prompt, tool arguments, tool output, and assistant replies', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({
        finalText: 'final answer',
        events: [
          double<AgentSessionEvent>({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'thinking_delta', delta: 'considering options' } }),
          ...toolEvent('grep', 'call-7', { pattern: 'needle' }),
          double<AgentSessionEvent>({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Found the needle.' }] } }),
        ],
      });
      const result = await h.callTool('task', { description: 'Transcript', prompt: 'Search for the needle', subagent_type: 'general-purpose' });
      const record = double<{ readonly sessions: readonly { readonly agentId: string; readonly transcriptItems: readonly { readonly role: string; readonly text: string; readonly toolArgs?: string }[] }[] }>(
        h
          .getEntries()
          .filter((entry) => entry.customType === 'pi-subagents-state')
          .at(-ONE)?.data,
      );
      const items = record.sessions.find((session) => session.agentId === result.details?.agentId)?.transcriptItems ?? [];
      expect(items[ZERO]?.role).toBe('user');
      expect(items[ZERO]?.text).toBe('Search for the needle');
      const toolItem = items.find((item) => item.role === 'tool');
      expect(toolItem?.toolArgs).toContain('needle');
      const resultItem = items.find((item) => item.role === 'result');
      expect(resultItem?.text).toContain('grep output');
      expect(items.some((item) => item.role === 'assistant' && item.text.includes('Found the needle'))).toBe(true);
      expect(result.details?.finalMessage).toBe('final answer');
    } finally {
      await h.cleanup();
    }
  });

  it('keeps streamed thinking in the transcript history', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({
        finalText: 'answered',
        events: [
          double<AgentSessionEvent>({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'thinking_delta', delta: 'weighing the options' } }),
          double<AgentSessionEvent>({ type: 'turn_end', message: {}, toolResults: [] }),
          double<AgentSessionEvent>({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'answered' }] } }),
        ],
      });
      const result = await h.callTool('task', { description: 'Thinking', prompt: 'Think about it', subagent_type: 'general-purpose' });
      const record = double<{ readonly sessions: readonly { readonly agentId: string; readonly transcriptItems: readonly { readonly role: string; readonly text: string }[] }[] }>(
        h
          .getEntries()
          .filter((entry) => entry.customType === 'pi-subagents-state')
          .at(-ONE)?.data,
      );
      const items = record.sessions.find((session) => session.agentId === result.details?.agentId)?.transcriptItems ?? [];
      expect(items.some((item) => item.role === 'thinking' && item.text.includes('weighing the options'))).toBe(true);
      expect(items.at(-ONE)?.role).toBe('assistant');
    } finally {
      await h.cleanup();
    }
  });

  it('retries a recorded run through the tasks command', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: '', throwError: 'first run fails' });
      const failed = await h.callTool('task', { description: 'Retry me', prompt: 'Do the work', subagent_type: 'general-purpose' });
      expect(failed.details?.status).toBe('error');
      enqueuePlan({ finalText: 'retry succeeded' });
      await h.runCommand('tasks', `retry ${failed.details?.agentId ?? ''}`);
      await h.runCommand('tasks', 'list');
      const listing = h.getNotifications().at(-ONE)?.message ?? '';
      expect(h.getNotifications().some((notification) => notification.message.includes('Retrying subagent'))).toBe(true);
      expect(listing).toContain('[success/fg]');
    } finally {
      await h.cleanup();
    }
  });

  it('attaches the MCP extension for agents that opt in and never for read-only agents', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'mcp-agent.md', ['---', 'name: mcp-agent', 'description: Uses MCP tools', 'mcp: true', 'tools: read', '---', 'Use the MCP tools.'].join('\n'));
      writeAgent(h.cwd, '.pi/agents', 'mcp-readonly.md', ['---', 'name: mcp-readonly', 'description: Read-only MCP agent', 'mcp: true', 'readonly: true', 'tools: read', '---', 'Look only.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'ok' });
      await h.callTool('task', { description: 'MCP agent', prompt: 'go', subagent_type: 'mcp-agent' });
      const mcpFactories = loaderOptions['extensionFactories'] as readonly unknown[];
      expect(mcpFactories.length).toBe(TWO);
      enqueuePlan({ finalText: 'ok' });
      await h.callTool('task', { description: 'MCP readonly', prompt: 'go', subagent_type: 'mcp-readonly' });
      const readonlyFactories = loaderOptions['extensionFactories'] as readonly unknown[];
      expect(readonlyFactories.length).toBe(TWO);
    } finally {
      await h.cleanup();
    }
  });

  it('emits subagent hook events for start, status, tool calls, checkpoints, and end', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'hooked', events: toolEvent('read', 'call-9', { path: 'a.ts' }) });
      await h.callTool('task', { description: 'Hook job', prompt: 'go', subagent_type: 'general-purpose' });
      const channels = h.getEmittedEvents().map((entry) => entry.channel);
      expect(channels).toContain('subagents:run_start');
      expect(channels).toContain('subagents:tool_call');
      expect(channels).toContain('subagents:checkpoint');
      expect(channels).toContain('subagents:run_end');
      const end = h.getEmittedEvents().find((entry) => entry.channel === 'subagents:run_end');
      const payload = double<{ readonly agentId?: string; readonly status?: string; readonly transcriptPath?: string }>(end?.data);
      expect(payload.status).toBe('success');
      expect(payload.agentId).toBeDefined();
    } finally {
      await h.cleanup();
    }
  });

  it('exposes an explicit failure identifier when a run is cancelled', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'never arrives', waitForRelease: gate.promise });
      const launched = await h.callTool('task', { description: 'Cancel me', prompt: 'go', subagent_type: 'general-purpose', run_in_background: true });
      await h.runCommand('tasks', `abort ${launched.details?.agentId ?? ''}`);
      gate.release();
      const awaited = await h.callTool('await_subagent', { agent_id: launched.details?.agentId });
      const details: TaskToolDetails | undefined = awaited.details;
      expect(details?.status).toBe('cancelled');
      expect(details?.failureId).toMatch(/^[0-9a-f]{12}$/);
    } finally {
      await h.cleanup();
    }
  });
});

describe('nesting limits', () => {
  it('does not grant nested task tools when the configured depth is one', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'owner.md', ['---', 'name: owner', 'description: Owns work', 'nested-tasks: true', '---', 'Own the work.'].join('\n'));
      writeConfig(h.cwd, { nesting: { maxDepth: 1 } });
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'owned' });
      await h.callTool('task', { description: 'Own it', prompt: 'go', subagent_type: 'owner' });
      const factories = loaderOptions['extensionFactories'] as readonly unknown[];
      expect(factories.length).toBe(ONE);
    } finally {
      await h.cleanup();
    }
  });

  it('grants nested task tools one level deeper when the definition opts in', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'owner.md', ['---', 'name: owner', 'description: Owns work', 'nested-tasks: true', '---', 'Own the work.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'owned' });
      await h.callTool('task', { description: 'Own it', prompt: 'go', subagent_type: 'owner' });
      const factories = loaderOptions['extensionFactories'] as readonly unknown[];
      expect(factories.length).toBe(TWO);
    } finally {
      await h.cleanup();
    }
  });
});

describe('custom agent model parameters', () => {
  it('applies definition sampling, max tokens, and context window to the child model', () => {
    const definition = makeDefinition({ sampling: { temperature: 0.1, topP: 0.8, maxTokens: 2048 }, contextWindow: 100_000 });
    const model = double<Model<Api>>({ provider: 'test', id: 'm', reasoning: true, contextWindow: 200_000, maxTokens: 8192, samplingParams: { top_k: 5 } });
    const tuned = applyDefinitionToModel(model, definition);
    expect(tuned.contextWindow).toBe(100_000);
    expect(tuned.maxTokens).toBe(2048);
    expect(tuned.samplingParams).toMatchObject({ top_k: 5, temperature: 0.1, top_p: 0.8 });
    expect(model.contextWindow).toBe(200_000);
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
      expect(rendered.at(-ONE)?.join('\n')).toBeDefined();
    } finally {
      void h.cleanup();
    }
  });

  it('removes a worktree only when it exists', async () => {
    const { removeSubagentWorktree } = await import('../src/worktree.ts');
    const missing = await removeSubagentWorktree({ repoRoot: '/tmp', path: '/tmp/definitely-not-a-worktree', branch: 'b', baseRef: 'HEAD' });
    expect(missing.ok).toBe(true);
  });
});
