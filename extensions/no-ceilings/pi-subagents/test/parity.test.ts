import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import type { AgentSessionEvent, Theme } from '@earendil-works/pi-coding-agent';
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
}

let plans: readonly MockPlan[] = [];
let captured: readonly CapturedCreate[] = [];
let loaderOptions: Readonly<Record<string, unknown>> = {};
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
    getCallableToolNames: () => ['read', 'bash', 'edit', 'write', 'grep'],
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
    }
    async reload(): Promise<void> {
      return undefined;
    }
  }

  return {
    ...actual,
    DefaultResourceLoader: MockDefaultResourceLoader,
    createAgentSession: async (options: { readonly cwd?: string; readonly tools?: readonly string[]; readonly model?: { readonly id: string }; readonly thinkingLevel?: string }) => {
      captured = [
        ...captured,
        {
          ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
          ...(options.tools !== undefined ? { tools: options.tools } : {}),
          ...(options.model !== undefined ? { modelId: options.model.id } : {}),
          ...(options.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
          activeTools: [],
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
  activeToolsCalls = [];
});

afterEach(() => {
  plans = [];
  captured = [];
  loaderOptions = {};
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
    expect(byName.get('claude-reviewer')?.tools).toEqual(['Read', 'Grep']);
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
