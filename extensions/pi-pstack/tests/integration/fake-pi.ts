// A minimal ExtensionAPI over a real in-memory Pi SessionManager: custom entries and messages land in the session as
// Pi would put them there, so branch and compaction behavior is Pi's own.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ExtensionAPI, ExtensionCommandContext, SessionManager, SlashCommandInfo } from '@earendil-works/pi-coding-agent';
import { SessionManager as PiSessionManager } from '@earendil-works/pi-coding-agent';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { controlHost, hostTarget } from '../../src/rpc-client.ts';
import { loadAssignment } from '../../src/run-files.ts';
import { generatedSkillNames } from '../../src/skill-routing.ts';

const run = promisify(execFile);

type Handler = (event: Record<string, unknown>, ctx: unknown) => unknown;
type Command = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };

/** What Pi itself lists: every generated skill as `skill:<name>` and its prompt as `/name`. */
export function packageCommands(): SlashCommandInfo[] {
  const sourceInfo = (path: string) => ({ path, source: 'local', scope: 'temporary' as const, origin: 'top-level' as const });
  return generatedSkillNames().flatMap((name): SlashCommandInfo[] => [
    { name: `skill:${name}`, source: 'skill', sourceInfo: sourceInfo(join(PACKAGE_ROOT, 'generated', 'skills', name, 'SKILL.md')) },
    { name, source: 'prompt', sourceInfo: sourceInfo(join(PACKAGE_ROOT, 'generated', 'prompts', `${name}.md`)) },
  ]);
}

export interface FakePi {
  pi: ExtensionAPI;
  session: SessionManager;
  tools: Map<string, unknown>;
  commands: Map<string, Command>;
  handlers: Map<string, Handler[]>;
  notices: { text: string; level: string }[];
  sent: { message: { customType: string; content: string; details?: unknown }; options: unknown }[];
  ctx: () => ExtensionCommandContext;
  fire: (event: string, payload: Record<string, unknown>) => Promise<unknown[]>;
  /** Runs `/pstack <args>` and returns what it notified. */
  pstack: (args: string) => Promise<{ text: string; level: string }>;
}

export function fakePi(options: { cwd: string; commands?: SlashCommandInfo[]; session?: SessionManager; toolNames?: string[]; model?: unknown; thinkingLevel?: string; modelRegistry?: unknown }): FakePi {
  const session = options.session ?? PiSessionManager.inMemory(options.cwd);
  const tools = new Map<string, unknown>();
  const commands = new Map<string, Command>();
  const handlers = new Map<string, Handler[]>();
  const notices: FakePi['notices'] = [];
  const sent: FakePi['sent'] = [];
  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    registerTool: (tool: { name: string }) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: Command) => commands.set(name, command),
    getCommands: () => [...(options.commands ?? packageCommands()), ...[...commands.keys()].map((name) => ({ name, source: 'extension', sourceInfo: { path: 'fake', source: 'local', scope: 'temporary', origin: 'top-level' } }))],
    getAllTools: () => [...tools.keys(), ...(options.toolNames ?? [])].map((name) => ({ name })),
    appendEntry: (customType: string, data: unknown) => session.appendCustomEntry(customType, data),
    sendMessage: (message: FakePi['sent'][number]['message'], sendOptions: unknown) => {
      sent.push({ message, options: sendOptions });
      session.appendCustomMessageEntry(message.customType, message.content, true, message.details);
    },
    exec: async (command: string, args: string[], execOptions: { timeout?: number } = {}) => {
      try {
        const { stdout, stderr } = await run(command, args, { timeout: execOptions.timeout ?? 0 });
        return { stdout, stderr, code: 0, killed: false };
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean };
        return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? String(error), code: typeof failure.code === 'number' ? failure.code : 1, killed: failure.killed === true };
      }
    },
  } as unknown as ExtensionAPI;
  const ctx = () =>
    ({
      cwd: options.cwd,
      hasUI: false,
      mode: 'rpc',
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      modelRegistry: options.modelRegistry ?? { getAvailable: () => [] },
      sessionManager: session,
      ui: { notify: (text: string, level = 'info') => notices.push({ text, level }), setStatus: () => undefined },
      isIdle: () => true,
    }) as unknown as ExtensionCommandContext;
  const fire = async (event: string, payload: Record<string, unknown>) => {
    const results: unknown[] = [];
    for (const handler of handlers.get(event) ?? []) results.push(await handler({ type: event, ...payload }, ctx()));
    return results;
  };
  const pstack = async (args: string) => {
    const before = notices.length;
    await commands.get('pstack')?.handler(args, ctx());
    const notice = notices.slice(before).at(-1);
    if (notice === undefined) throw new Error(`/pstack ${args} notified nothing`);
    return notice;
  };
  return { pi, session, tools, commands, handlers, notices, sent, ctx, fire, pstack };
}

/** Ends every worker under the project's runs and waits until each host and child process has exited. */
export async function stopWorkers(project: string): Promise<void> {
  const runs = join(project, '.pi', 'pstack', 'runs');
  const pids: number[] = [];
  for (const runId of existsSync(runs) ? readdirSync(runs) : []) {
    const workers = join(runs, runId, 'workers');
    for (const workerId of existsSync(workers) ? readdirSync(workers) : []) {
      const statePath = join(workers, workerId, 'state.json');
      if (!existsSync(statePath)) continue;
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as { hostPid?: number; childPid?: number | null };
      for (const pid of [state.hostPid, state.childPid]) if (typeof pid === 'number') pids.push(pid);
      try {
        await controlHost(hostTarget(loadAssignment(join(workers, workerId, 'assignment.json'))), 'shutdown');
      } catch {
        // Already gone.
      }
    }
  }
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (let attempt = 0; attempt < 100 && pids.some(alive); attempt += 1) await new Promise((done) => setTimeout(done, 100));
}
