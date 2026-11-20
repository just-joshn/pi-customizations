import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { expect, vi } from 'vitest';
import pstack from '../src/index.ts';
import { type FakeTmux, hangUpFakeTmux, installFakeTmux } from './core-fake-tmux.ts';
import { extensionApiFrom } from './fake-guards.ts';

export type BranchEntry = { type: string; customType?: string; data?: unknown };
type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type ToolDefinition = {
  description?: string;
  parameters: { properties: Record<string, { description?: string }> };
  execute: (id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, update: ((partial: unknown) => void) | undefined, ctx: unknown) => Promise<{ content: { text: string }[] }>;
};
type CommandDefinition = { getArgumentCompletions?: (prefix: string) => { value: string; label: string }[] | null; handler: (args: string, ctx: unknown) => Promise<void> };
type Ctx = Record<string, unknown>;

export type SessionOptions = { sessionId?: string; sessionFile?: string };

const DEFAULT_SESSION_ID = 'core-session';

/** A temp agent dir, a temp workspace, and the fake tmux, all removed again by `dispose`. */
export function createWorld() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-core-')));
  const agentDir = join(root, 'agent');
  const cwd = join(root, 'workspace');
  const tmux: FakeTmux = installFakeTmux(root);
  mkdirSync(cwd);
  mkdirSync(agentDir);
  for (const [name, value] of Object.entries({ ...tmux.env, PI_CODING_AGENT_DIR: agentDir })) vi.stubEnv(name, value);
  return {
    root,
    agentDir,
    cwd,
    jobsRoot: join(agentDir, 'pstack-v2', 'jobs'),
    tmux,
    dispose: () => {
      hangUpFakeTmux(tmux);
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

export type World = ReturnType<typeof createWorld>;

/** A recording fake of Pi's extension API: it keeps what an extension registers and the session branch it appends to. */
function recordPi() {
  let tools: Record<string, ToolDefinition> = {};
  let commands: Record<string, CommandDefinition> = {};
  let handlers: Record<string, Handler[]> = {};
  let branch: BranchEntry[] = [];
  const sendMessage = vi.fn();
  const api = {
    appendEntry: (customType: string, data?: unknown) => {
      branch = [...branch, { type: 'custom', customType, data }];
    },
    registerCommand: (name: string, command: CommandDefinition) => {
      commands = { ...commands, [name]: command };
    },
    on: (event: string, handler: Handler) => {
      handlers = { ...handlers, [event]: [...(handlers[event] ?? []), handler] };
    },
    registerTool: (tool: ToolDefinition & { name: string }) => {
      tools = { ...tools, [tool.name]: tool };
    },
    sendMessage,
  };
  return {
    api: extensionApiFrom(api),
    sendMessage,
    tool: (name: string): ToolDefinition => {
      const found = tools[name];
      if (!found) throw new Error(`extension registered no ${name} tool`);
      return found;
    },
    command: (name: string): CommandDefinition => {
      const found = commands[name];
      if (!found) throw new Error(`extension registered no ${name} command`);
      return found;
    },
    handlers: (event: string): Handler[] => handlers[event] ?? [],
    branch: () => branch,
    setBranch: (entries: BranchEntry[]) => {
      branch = entries;
    },
  };
}

/**
 * Loads an extension into a recording fake of Pi, the way Pi loads it (pstack by default), and returns the things a user
 * of Pi can do with it: call its tools, run its command, and fire lifecycle events.
 */
export function loadPstack(world: World, session: SessionOptions = {}, extension: (pi: ExtensionAPI) => void = pstack) {
  const sessionId = session.sessionId ?? DEFAULT_SESSION_ID;
  const pi = recordPi();
  const setStatus = vi.fn();
  const notify = vi.fn();
  extension(pi.api);
  const ctx = (overrides: Ctx = {}): Ctx => ({
    mode: 'tui',
    hasUI: true,
    ui: { setStatus, notify },
    cwd: world.cwd,
    sessionManager: { getSessionId: () => sessionId, getSessionFile: () => session.sessionFile, getBranch: pi.branch },
    isIdle: () => true,
    isProjectTrusted: () => true,
    hasPendingMessages: () => false,
    ...overrides,
  });
  const call = (name: string, params: Record<string, unknown>, overrides: Ctx = {}, signal?: AbortSignal, update?: (partial: unknown) => void) => pi.tool(name).execute('call', params, signal, update, ctx(overrides));
  return {
    sessionId,
    sendMessage: pi.sendMessage,
    setStatus,
    notify,
    ctx,
    tool: pi.tool,
    command: pi.command,
    branch: pi.branch,
    setBranch: pi.setBranch,
    call,
    text: async (name: string, params: Record<string, unknown>, overrides: Ctx = {}) => (await call(name, params, overrides)).content[0]?.text ?? '',
    fire: async (event: string, payload: unknown, overrides: Ctx = {}) => {
      const results = await Promise.all(pi.handlers(event).map((handler) => handler(payload, ctx(overrides))));
      return results.find((result) => result !== undefined);
    },
  };
}

export type Host = ReturnType<typeof loadPstack>;

/** The prompt options object Pi hands to before_agent_start, and what the extension wrote into it. */
export async function promptFor(host: Host, overrides: Ctx = {}) {
  const options = { promptGuidelines: [] as string[], sections: {} as Record<string, string> };
  await host.fire('before_agent_start', { systemPromptOptions: options }, overrides);
  return options;
}

const WATCHER_POLL_MS = 2000;
const DRIVE_TIMEOUT_MS = 15_000;

/** Starts a tmux_run job and returns its id, which the tool reports on its first line. */
export async function startJob(host: Host, params: Record<string, unknown>, overrides: Ctx = {}): Promise<string> {
  const id = /^Started (\S+)/.exec(await host.text('tmux_run', params, overrides))?.[1];
  if (!id) throw new Error('tmux_run did not report a job id');
  return id;
}

/** Waits until tmux_jobs list shows the job as no longer running, which is when Pi would show its result. */
export const untilExited = async (host: Host, id: string, overrides: Ctx = {}): Promise<void> => {
  await expect.poll(() => host.text('tmux_jobs', { action: 'list' }, overrides), { timeout: DRIVE_TIMEOUT_MS }).toMatch(new RegExp(`${id}  exited`));
};

/** Lets a promise that sleeps on fake timers finish, moving the clock on while real jobs run. */
export async function driveTimers<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  const watched = promise
    .finally(() => {
      settled = true;
    })
    .catch(() => undefined);
  await expect
    .poll(
      async () => {
        await vi.advanceTimersByTimeAsync(WATCHER_POLL_MS);
        return settled;
      },
      { timeout: DRIVE_TIMEOUT_MS },
    )
    .toBe(true);
  await watched;
  return promise;
}

/** The tail of a job's output as tmux_run wake reports and tmux_jobs wait reports quote it. */
export const outputBlock = (text: string): string => `<output>\n${text}\n</output>`;
