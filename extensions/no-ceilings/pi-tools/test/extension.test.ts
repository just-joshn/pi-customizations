import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import piToolsExtension from '../src/index.ts';

interface RegisteredTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
  readonly defaultActive?: boolean;
  execute: (toolCallId: string, params: unknown, signal?: unknown, onUpdate?: unknown, ctx?: unknown) => Promise<unknown>;
}

interface Harness {
  readonly registered: RegisteredTool[];
  readonly events: Map<string, (event: unknown, ctx: unknown) => Promise<unknown> | unknown>;
  readonly commands: Map<string, { description: string; handler: (args: string, ctx: unknown) => Promise<void> }>;
  activate(names: readonly string[]): void;
  active(): readonly string[];
  notifications: { message: string; level: string }[];
  api: ExtensionAPI;
}

function createFakeApi(): Harness {
  const registered: RegisteredTool[] = [];
  const events = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown> | unknown>();
  const commands = new Map<string, { description: string; handler: (args: string, ctx: unknown) => Promise<void> }>();
  const notifications: { message: string; level: string }[] = [];
  let activeNames: string[] = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];

  const api = {
    registerTool(definition: RegisteredTool) {
      const existing = registered.findIndex((tool) => tool.name === definition.name);
      if (existing === -1) {
        registered.push(definition);
      } else {
        registered[existing] = definition;
      }
    },
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) {
      events.set(name, handler);
    },
    registerCommand(name: string, options: { description: string; handler: (args: string, ctx: unknown) => Promise<void> }) {
      commands.set(name, options);
    },
    getAllTools() {
      return registered.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
    },
    getActiveTools() {
      return activeNames;
    },
    setActiveTools(names: string[]) {
      activeNames = [...names];
    },
    async exec() {
      return { stdout: '', stderr: '', code: 0 };
    },
  } as unknown as ExtensionAPI;

  return {
    registered,
    events,
    commands,
    notifications,
    api,
    activate(names) {
      activeNames = [...new Set([...activeNames, ...names])];
    },
    active() {
      return activeNames;
    },
  };
}

describe('extension wiring', () => {
  let root: string;
  let harness: Harness;
  const previousCwd = process.cwd();

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pi-tools-extension-'));
    const agentDir = path.join(root, 'agent');
    const workspace = path.join(root, 'workspace');
    await mkdir(agentDir, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(agentDir, 'pi-tools.json'), JSON.stringify({ mode: 'auto', rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] }), 'utf-8');
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
    harness = createFakeApi();
    piToolsExtension(harness.api);
    process.chdir(workspace);
  });

  afterAll(async () => {
    process.chdir(previousCwd);
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it('registers one tool per capability, overriding the built-in names it replaces', () => {
    const names = harness.registered.map((tool) => tool.name).sort();
    expect(names).toEqual(['apply_patch', 'bash', 'delete', 'edit', 'find', 'git', 'grep', 'ls', 'read', 'save_resource', 'search_tools', 'web_fetch', 'web_search', 'write']);
    expect(names).toEqual(expect.arrayContaining(['read', 'ls', 'find', 'grep', 'write', 'edit', 'bash']));
  });

  it('keeps the auxiliary tools inactive until the loader activates them', () => {
    const byName = new Map(harness.registered.map((tool) => [tool.name, tool]));
    expect(byName.get('git')?.defaultActive).toBe(false);
    expect(byName.get('web_fetch')?.defaultActive).toBe(false);
    expect(byName.get('web_search')?.defaultActive).toBe(false);
    expect(byName.get('save_resource')?.defaultActive).toBe(false);
    expect(byName.has('apply_patch')).toBe(true);
    expect(byName.get('apply_patch')?.defaultActive).toBeUndefined();
    expect(byName.has('search_tools')).toBe(true);
    expect(byName.get('search_tools')?.defaultActive).toBeUndefined();
  });

  it('exposes every registered tool through the catalog loader and activates matches', async () => {
    const searchTools = harness.registered.find((tool) => tool.name === 'search_tools');
    expect(searchTools).toBeDefined();
    const result = (await searchTools?.execute('call', { query: 'patch' }, undefined, undefined, { cwd: process.cwd(), hasUI: false })) as {
      content: { type: string; text?: string }[];
      details: { activated?: readonly string[] };
    };
    expect(result.details.activated).toContain('apply_patch');
    expect(harness.active()).toContain('apply_patch');
    expect(result.content[0]?.text).toContain('Loaded tools: apply_patch');
  });

  it('refreshes the session on session_start and reports configuration problems there', async () => {
    const handler = harness.events.get('session_start');
    expect(handler).toBeDefined();
    const ctx = {
      cwd: process.cwd(),
      isProjectTrusted: () => false,
      ui: {
        notify(message: string, level: string) {
          harness.notifications.push({ message, level });
        },
      },
    };
    await handler?.({}, ctx);
    const before = harness.events.get('before_agent_start');
    await before?.({}, ctx);
    expect(harness.notifications.map((notification) => notification.level)).toEqual(harness.notifications.map(() => 'warning'));
  });

  it('registers a command that reports the policy, ignore files, and catalog', async () => {
    const command = harness.commands.get('pi-tools');
    expect(command).toBeDefined();
    const ctx = {
      cwd: process.cwd(),
      isProjectTrusted: () => true,
      ui: {
        notify(message: string, level: string) {
          harness.notifications.push({ message, level });
        },
      },
    };
    await command?.handler('', ctx);
    const message = harness.notifications.at(-1)?.message ?? '';
    expect(message).toContain('mode: auto');
    expect(message).toContain('workspace roots:');
    expect(message).toContain('rules: read deny **/.env');
    expect(message).toContain('tools:');
  });
});
