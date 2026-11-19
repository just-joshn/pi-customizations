import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import pstack from '../src/index.ts';

type Tool = { execute: (id: string, params: unknown, signal: undefined, update: undefined, ctx: unknown) => Promise<{ content: { text: string }[] }> };
type Command = { handler: (args: string, ctx: unknown) => Promise<void> };

const OWNER = 'equivalence-owner';
const OUTSIDE_PROJECT = '/';
const SANDBOX_ENV = 'PSTACK_V2_SANDBOXED';

let agentDir: string;
let repo: string;
let tools: Record<string, Tool>;
let commands: Record<string, Command>;
let notify: ReturnType<typeof vi.fn>;
let ctx: unknown;

beforeEach(() => {
  agentDir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-equivalence-agent-')));
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-equivalence-repo-')));
  execFileSync('git', ['init', '-q', repo]);
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  vi.stubEnv(SANDBOX_ENV, '');
  tools = {};
  commands = {};
  notify = vi.fn();
  const api = {
    appendEntry: vi.fn(),
    registerCommand: (name: string, command: Command) => {
      commands = { ...commands, [name]: command };
    },
    on: vi.fn(),
    registerTool: (tool: Tool & { name: string }) => {
      tools = { ...tools, [tool.name]: tool };
    },
    sendMessage: vi.fn(),
  };
  pstack(api as unknown as ExtensionAPI);
  ctx = { hasUI: true, ui: { setStatus: vi.fn(), notify }, cwd: repo, sessionManager: { getSessionId: () => OWNER, getSessionFile: () => undefined, getBranch: () => [] }, hasPendingMessages: () => false };
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

const call = (name: string, params: unknown) => (tools[name] as Tool).execute('call', params, undefined, undefined, ctx);
const textOf = async (name: string, params: unknown): Promise<string> => (await call(name, params)).content[0]?.text ?? '';

describe('tmux_jobs input', () => {
  test.each([['output'], ['stop']])('says %s needs ids when ids is empty', async (action) => {
    await expect(call('tmux_jobs', { action, ids: [] })).rejects.toThrow(`${action} needs ids.`);
  });

  test('ignores extra keys', async () => {
    expect(await textOf('tmux_jobs', { action: 'list', future: 1 })).toBe('No jobs in this session.');
    expect(await textOf('tmux_jobs', { action: 'wait' })).toBe('No jobs to wait on.');
  });

  test('reports an unknown job id as before', async () => {
    await expect(call('tmux_jobs', { action: 'output', ids: ['gone'] })).rejects.toThrow('No job gone in this session.');
  });
});

describe('tmux_run input', () => {
  test('refuses repeat without a wake', async () => {
    await expect(call('tmux_run', { name: 'n', command: 'true', repeat: true })).rejects.toThrow(/repeat needs a wake/);
  });

  test('ignores extra keys', async () => {
    await expect(call('tmux_run', { name: 'n', command: 'true', cwd: OUTSIDE_PROJECT, extra: 1 })).rejects.toThrow(/inside this project/);
  });
});

describe('the pstack-mode command input', () => {
  const run = async (args: string): Promise<void> => (commands['pstack-mode'] as Command).handler(args, ctx);

  test('trims its argument, and treats blank as asking for the state', async () => {
    await run('   ');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('No pstack mode is on'), 'info');
  });

  test('names a skill that does not exist after trimming it', async () => {
    await run('  nonesuch  ');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('nonesuch is not a pstack skill'), 'error');
  });
});
