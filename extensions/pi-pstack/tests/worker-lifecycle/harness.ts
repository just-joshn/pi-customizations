// Real tmux (a private server per test file) and real Pi with the scripted model, driven through a minimal fake
// parent ExtensionAPI whose session entries live in memory.
import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerEvidenceTool } from '../../src/evidence.ts';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { registerWorkerTools, type WorkerToolOptions } from '../../src/workers.ts';

const run = promisify(execFile);

export const PI = process.env['PSTACK_E2E_PI'] || '/Users/josh-desktop/.pi/agent/bin/pi';
export const FIXTURE = join(PACKAGE_ROOT, 'test/fixtures/scripted-model.ts');
export const TMUX = `pstack-test-${randomBytes(4).toString('hex')}`;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until<T>(probe: () => T | Promise<T>, accept: (value: T) => boolean, ms = 20_000, what = 'condition'): Promise<T> {
  const end = Date.now() + ms;
  let last: T | undefined;
  while (Date.now() < end) {
    last = await probe();
    if (accept(last)) return last;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(last)?.slice(0, 2000)}`);
}

export async function tmux(...args: string[]): Promise<string> {
  return (await run('tmux', ['-L', TMUX, ...args])).stdout;
}

/** Kills only this file's private server and removes the socket file tmux leaves behind. */
export async function killTmuxServer(): Promise<void> {
  await run('tmux', ['-L', TMUX, 'kill-server']).catch(() => undefined);
  rmSync(join(process.env['TMUX_TMPDIR'] || '/tmp', `tmux-${process.getuid?.()}`, TMUX), { force: true });
}

export async function liveTmuxSessions(): Promise<string[]> {
  return (await tmux('list-sessions', '-F', '#{session_name}').catch(() => '')).split('\n').filter(Boolean);
}

export interface Project {
  dir: string;
  home: string;
  agentDir: string;
  agentsDir: string;
  sessionFile: string;
  commit: string;
  runRoot: (runId: string) => string;
  dispose: () => void;
}

export function makeProject(): Project {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-u04a-')));
  const project = join(dir, 'project');
  for (const sub of ['project', 'home', 'agent', 'agents', 'sessions']) mkdirSync(join(dir, sub));
  writeFileSync(join(dir, 'agents', 'general.md'), 'You are a pstack worker.\n');
  const git = (...args: string[]) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' }).trim();
  git('init', '--quiet', '-b', 'main');
  writeFileSync(join(project, 'README.md'), 'fixture\n');
  git('add', 'README.md');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'init');
  return {
    dir: project,
    home: join(dir, 'home'),
    agentDir: join(dir, 'agent'),
    agentsDir: join(dir, 'agents'),
    sessionFile: join(dir, 'sessions', 'parent.jsonl'),
    commit: git('rev-parse', 'HEAD'),
    runRoot: (runId) => join(project, '.pi', 'pstack', 'runs', runId),
    dispose: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
  };
}

export function makeRun(project: Project, runId: string, parentSessionFile: string | null = project.sessionFile): string {
  const root = project.runRoot(runId);
  mkdirSync(join(root, 'workers'), { recursive: true });
  writeFileSync(join(root, 'run.json'), JSON.stringify({ schemaVersion: 1, runId, title: 'test', playbook: 'feature', upstreamRevision: 'x', createdAt: new Date().toISOString(), parentSessionFile, inputCommit: project.commit }));
  return root;
}

export function writeAssignment(project: Project, runId: string, workerId: string, brief: string, fields: Record<string, unknown> = {}): string {
  const dir = join(project.runRoot(runId), 'workers', workerId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'brief.md'), brief);
  const assignment = { schemaVersion: 1, runId, workerId, kind: 'pi', role: 'general', brief: 'brief.md', model: 'scripted/echo', thinkingLevel: null, workspace: { mode: 'readonly', path: project.dir }, skills: [], ...fields };
  writeFileSync(join(dir, 'assignment.json'), JSON.stringify(assignment));
  return join(dir, 'assignment.json');
}

export const workerDir = (project: Project, runId: string, workerId: string) => join(project.runRoot(runId), 'workers', workerId);
export const readState = (project: Project, runId: string, workerId: string) => JSON.parse(readFileSync(join(workerDir(project, runId, workerId), 'state.json'), 'utf8'));

/** role:text for every message in the worker's native session file. */
export function transcript(project: Project, runId: string, workerId: string): string[] {
  const dir = join(workerDir(project, runId, workerId), 'session');
  const files = readdirSync(dir).filter((file) => file.endsWith('.jsonl'));
  if (files.length !== 1) return [];
  return readFileSync(join(dir, files[0] as string), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'message')
    .map((entry) => {
      const content = entry.message.content;
      const text =
        typeof content === 'string'
          ? content
          : content
              .filter((part: { type: string }) => part.type === 'text')
              .map((part: { text: string }) => part.text)
              .join('');
      return `${entry.message.role}:${text}`;
    });
}

export interface Entry {
  type: string;
  id: string;
  customType?: string;
  content?: unknown;
  details?: { transitionId: string; runId: string; workerId: string; phase: string } | undefined;
}

// biome-ignore lint/suspicious/noExplicitAny: each tool action returns different details; tests assert them with matchers.
type Details = any;

type Tool = { name: string; execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<{ content: { text: string }[]; details: Details }> };

export interface Parent {
  ctx: ExtensionContext;
  messages: { message: { customType: string; content: string; details: Entry['details'] }; options: unknown }[];
  call: (tool: string, params: Record<string, unknown>) => Promise<{ text: string; details: Details }>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * A parent Pi session as the extension sees it. `entries` is the session file: pass the same array to a second parent
 * to model a restart. With `persist: false`, sendMessage does not append (a follow-up still queued behind a turn).
 */
export function makeParent(project: Project, entries: Entry[], options: Partial<WorkerToolOptions> & { persist?: boolean; sessionFile?: string } = {}): Parent {
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, ((event: unknown, ctx: ExtensionContext) => unknown)[]>();
  const messages: Parent['messages'] = [];
  const pi = {
    registerTool: (tool: Tool) => tools.set(tool.name, tool),
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    sendMessage: (message: Parent['messages'][number]['message'], sendOptions: unknown) => {
      messages.push({ message, options: sendOptions });
      if (options.persist !== false) entries.push({ type: 'custom_message', id: randomBytes(4).toString('hex'), customType: message.customType, content: message.content, details: message.details as Entry['details'] });
    },
    exec: async (command: string, args: string[], execOptions: { timeout?: number } = {}) => {
      try {
        const { stdout, stderr } = await run(command, args, { timeout: execOptions.timeout ?? 0 });
        return { stdout, stderr, code: 0, killed: false, truncated: false };
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean };
        return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? String(error), code: typeof failure.code === 'number' ? failure.code : 1, killed: failure.killed === true, truncated: false };
      }
    },
  };
  const sessionFile = options.sessionFile ?? project.sessionFile;
  const ctx = { cwd: project.dir, model: undefined, sessionManager: { getSessionFile: () => sessionFile, getEntries: () => entries } } as unknown as ExtensionContext;
  registerWorkerTools(pi as unknown as ExtensionAPI, {
    tmuxSocket: TMUX,
    piCommand: [PI],
    extraPiArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-mcp', '--no-approve', '--extension', FIXTURE],
    extraEnv: { HOME: project.home, PI_CODING_AGENT_DIR: project.agentDir, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' },
    agentsDir: project.agentsDir,
    pollMs: 150,
    ...options,
  });
  registerEvidenceTool(pi as unknown as ExtensionAPI);
  const fire = async (event: string) => {
    for (const handler of handlers.get(event) ?? []) await handler({ type: event, reason: 'startup' }, ctx);
  };
  return {
    ctx,
    messages,
    call: async (name, params) => {
      const tool = tools.get(name);
      if (tool === undefined) throw new Error(`no tool ${name}`);
      const result = await tool.execute('call', params, undefined, undefined, ctx);
      return { text: result.content.map((part) => part.text).join(''), details: result.details };
    },
    start: () => fire('session_start'),
    stop: () => fire('session_shutdown'),
  };
}

export const wakes = (parent: Parent) => parent.messages.map((entry) => entry.message.details);
