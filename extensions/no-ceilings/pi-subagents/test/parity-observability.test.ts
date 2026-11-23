import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentSessionEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

vi.mock(import('@earendil-works/pi-coding-agent'), async (importOriginal) => {
  const { createCodingAgentMock } = await import('./parity-support.ts');
  return createCodingAgentMock(await importOriginal());
});

import type { TaskToolDetails } from '../src/types.ts';
import { createSubagentWorktree, summarizeWorktreeDiff } from '../src/worktree.ts';
import { createGate, createTestHarness, double } from './harness.ts';
import { ZERO, ONE, TWO, captured, enqueuePlan, initRepo, loaderOptions, persistedWorktreePath, toolEvent, writeAgent, installParityHooks } from './parity-support.ts';

installParityHooks();

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

describe('isolation and observability', () => {
  it('runs in the parent checkout by default and in a git worktree on request', async () => {
    const h = createTestHarness();
    try {
      initRepo(h.cwd);
      await h.emit('session_start', {});

      enqueuePlan({ finalText: 'shared checkout' });
      const shared = await h.callTool('task', { description: 'Shared work', prompt: 'go', subagent_type: 'general-purpose' });
      expect(shared.details?.worktreePath).toBeUndefined();
      expect(captured[ZERO]?.cwd).toBe(h.cwd);

      enqueuePlan({ finalText: 'isolated work' });
      const isolated = await h.callTool('task', { description: 'Isolated work', prompt: 'go', subagent_type: 'general-purpose', worktree: true });
      expect(isolated.details?.worktreePath).toBeTypeOf('string');
      expect(existsSync(isolated.details?.worktreePath ?? '')).toBe(true);
      expect(isolated.details?.branch).toMatch(/^pi-subagents\//);
      expect(captured[ONE]?.cwd).toBe(isolated.details?.worktreePath);

      const record = double<{ readonly sessions: readonly { readonly agentId: string; readonly worktree?: { readonly path: string; readonly branch: string; readonly repoRoot: string; readonly baseRef: string } }[] }>(
        h
          .getEntries()
          .filter((entry) => entry.customType === 'pi-subagents-state')
          .at(-ONE)?.data,
      );
      const worktree = record.sessions.find((session) => session.agentId === isolated.details?.agentId)?.worktree;
      expect(worktree).toMatchObject({
        path: isolated.details?.worktreePath,
        branch: isolated.details?.branch,
      });
    } finally {
      await h.cleanup();
    }
  });

  it('keeps a running worktree and removes it after the run finishes', async () => {
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
      await h.runCommand('tasks', `prune ${agentId}`);
      expect(h.getNotifications().at(-ONE)?.message).toContain('still running');
      gate.release();
      await h.callTool('await_subagent', { agent_id: launched.details?.agentId });
      await h.runCommand('tasks', `prune ${launched.details?.agentId ?? ''}`);
      expect(h.getNotifications().at(-ONE)?.message).toContain('Removed worktree');
      expect(worktreePath).toBeTypeOf('string');
      expect(existsSync(worktreePath ?? '')).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  it('creates and summarizes a real worktree outside the task pipeline', async () => {
    const repo = join(tmpdir(), `pi-subagents-repo-${process.pid}-${Date.now()}`);
    mkdirSync(repo, { recursive: true });
    initRepo(repo);
    writeFileSync(join(repo, 'file.txt'), 'one\n');

    const created = await createSubagentWorktree({ cwd: repo, description: 'Refactor the parser', agentId: 'a', sessionDir: join(repo, '.sessions'), root: undefined, branchPrefix: 'pi-subagents' });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error('worktree creation failed');
    }
    expect(created.worktree.branch).toMatch(/^pi-subagents\/refactor-the-parser-[0-9a-f]{3}$/);
    writeFileSync(join(created.worktree.path, 'file.txt'), 'two\n');
    const summary = await summarizeWorktreeDiff(created.worktree);
    expect(summary).toContain('file.txt');
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
      expect(payload.agentId).toBeTypeOf('string');
      expect(payload.agentId?.length ?? ZERO).toBeGreaterThan(ZERO);
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
