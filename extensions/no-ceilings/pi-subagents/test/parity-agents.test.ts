import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import type { AgentSessionEvent, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

vi.mock(import('@earendil-works/pi-coding-agent'), async (importOriginal) => {
  const { createCodingAgentMock } = await import('./parity-support.ts');
  return createCodingAgentMock(await importOriginal());
});

import { discoverSubagents } from '../src/discovery.ts';
import { applyDefinitionToModel } from '../src/model-resolution.ts';
import { createTestHarness, double, makeDefinition } from './harness.ts';
import { ZERO, ONE, TWO, THREE, activeToolsCalls, captured, clearActiveToolsCalls, clearCaptured, createdSessions, enqueuePlan, loaderOptions, writeAgent, writeConfig, installParityHooks } from './parity-support.ts';

installParityHooks();

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

  it('gives the child every parent tool, including ones outside the default set', async () => {
    const h = createTestHarness({ activeTools: ['read', 'bash', 'grep', 'find', 'ls'] });
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'ok' });
      await h.callTool('task', { description: 'Inventory', prompt: 'go', subagent_type: 'general-purpose' });
      expect(activeToolsCalls[ZERO]).toEqual(['read', 'bash', 'grep', 'find', 'ls']);
    } finally {
      await h.cleanup();
    }
  });

  it('creates a fresh child session for every delegation', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'first' });
      enqueuePlan({ finalText: 'second' });
      await h.callTool('task', { description: 'First', prompt: 'one', subagent_type: 'general-purpose' });
      await h.callTool('task', { description: 'Second', prompt: 'two', subagent_type: 'general-purpose' });
      expect(createdSessions.length).toBe(TWO);
      expect(createdSessions[ZERO]).not.toBe(createdSessions[ONE]);
    } finally {
      await h.cleanup();
    }
  });

  it('discovers an agent file added after the session starts', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      writeAgent(h.cwd, '.pi/agents', 'late.md', ['---', 'name: late-agent', 'description: Added after startup', '---', 'Work late.'].join('\n'));
      enqueuePlan({ finalText: 'late' });
      const result = await h.callTool('task', { description: 'Late agent', prompt: 'go', subagent_type: 'late-agent' });
      expect(result.details?.status).toBe('success');
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

  it('gives a child with an explicit empty tools list no tools', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, '.pi/agents', 'locked.md', ['---', 'name: locked', 'description: Locked down', 'tools: []', '---', 'Body.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'locked' });
      const activeBefore = activeToolsCalls.length;
      await h.callTool('task', { description: 'Locked agent', prompt: 'go', subagent_type: 'locked' });
      expect(captured.at(-ONE)?.tools).toEqual([]);
      expect(activeToolsCalls.length).toBe(activeBefore);
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

  it('treats --bg as a whole flag token on per-agent commands', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      await h.runCommand('subagent:explore', '--bg-color the button');
      const sent = h.getSentUserMessages().at(-ONE)?.content ?? '';
      expect(sent).not.toContain('run_in_background: true');
      expect(sent).toContain('to: --bg-color the button');
    } finally {
      await h.cleanup();
    }
  });

  it('fails and retries when the child assistant message ends with stopReason error', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const errorEvent = double<AgentSessionEvent>({
        type: 'message_end',
        message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'HTTP 500 from upstream' },
      });
      enqueuePlan({ finalText: '', events: [errorEvent] });
      enqueuePlan({ finalText: '', events: [errorEvent] });
      const result = await h.callTool('task', { description: 'Failing provider', prompt: 'go', subagent_type: 'general-purpose', max_attempts: TWO });
      expect(result.details?.status).toBe('error');
      expect(result.details?.errorCode).toBe('failed');
      expect(result.details?.failureId).toMatch(/^[0-9a-f]+$/);
      expect(result.details?.attempts).toBe(TWO);
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
    clearCaptured();
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
      expect(captured[ZERO]?.tools).toEqual(['mcp__playwright__*']);
      expect(captured[ZERO]?.tools).not.toContain('mcp__*');
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
    clearCaptured();
    clearActiveToolsCalls();
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

  it('keeps the capped model when a provider is registered', async () => {
    const h = createTestHarness({ registeredProviderConfigs: { dummy: { name: 'Dummy', baseUrl: 'https://example.invalid/v1', apiKey: 'test-key', api: 'openai-completions' } } });
    try {
      writeAgent(h.cwd, '.pi/agents', 'capped.md', ['---', 'name: capped', 'description: Capped', 'max-tokens: 1234', 'context-window: 4321', '---', 'Body.'].join('\n'));
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'ok' });
      await h.callTool('task', { description: 'Capped', prompt: 'go', subagent_type: 'capped' });
      const model = createdSessions.at(-ONE)?.agent.state.model as { readonly maxTokens?: number; readonly contextWindow?: number } | undefined;
      expect(model?.maxTokens).toBe(1234);
      expect(model?.contextWindow).toBe(4321);
    } finally {
      await h.cleanup();
    }
  });
});
