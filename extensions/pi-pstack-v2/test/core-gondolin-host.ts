import * as path from 'node:path';

import { VM } from '@earendil-works/gondolin';
import { vi } from 'vitest';
import gondolin from '../src/gondolin/index.ts';
import { extensionApiFrom, hasMethods } from './fake-guards.ts';

const SEP = '/';
export const HOST = '/host/project';
export const GUEST = '/workspace';
export const BASH = '/bin/bash';
export const VM_ID = 'aaaabbbbccccdddd';
export const BASH_PROBE_COMMAND = 'command -v bash || true';

type ExecOptions = { cwd?: string; env?: Record<string, string>; signal?: AbortSignal; stdout?: string; stderr?: string };
export type Exec = (argv: string[], options?: ExecOptions) => unknown;
export type ToolResult = { content: { type: string; text?: string }[]; details?: unknown };
type Tool = { name: string; execute: (id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, update: undefined, ctx: unknown) => Promise<ToolResult> };
type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type Command = { description: string; handler: (args: string, ctx: unknown) => Promise<void> };

const notFound = (guestPath: string) => Promise.reject(new Error(`ENOENT: ${guestPath}`));

/**
 * An in-memory guest filesystem. Keys of `tree` are workspace-relative, or absolute for files elsewhere in the guest.
 * Like a real filesystem, a file can only be written inside a folder that exists, and a write is visible to later reads.
 */
function fakeFs(tree: Readonly<Record<string, string>>, unreadable: readonly string[]) {
  let files = new Map(Object.entries(tree).map(([name, content]) => [name.startsWith(SEP) ? name : path.posix.join(GUEST, name), content]));
  let folders: ReadonlySet<string> = new Set();
  const isDirectory = (guestPath: string) => !files.has(guestPath) && (guestPath === GUEST || folders.has(guestPath) || [...files.keys()].some((file) => file.startsWith(`${guestPath}${SEP}`)));
  const exists = (guestPath: string) => files.has(guestPath) || isDirectory(guestPath);
  return {
    stat: async (guestPath: string) => (exists(guestPath) ? { isDirectory: () => isDirectory(guestPath) } : notFound(guestPath)),
    listDir: async (guestPath: string) => [...new Set([...files.keys(), ...folders].filter((file) => file.startsWith(`${guestPath}${SEP}`)).map((file) => file.slice(guestPath.length + 1).split(SEP)[0] ?? ''))],
    readFile: async (guestPath: string, options?: { encoding?: string }) => {
      const content = files.get(guestPath);
      if (content === undefined || unreadable.includes(guestPath)) return notFound(guestPath);
      return options?.encoding ? content : Buffer.from(content);
    },
    access: async (guestPath: string) => (exists(guestPath) ? undefined : notFound(guestPath)),
    writeFile: async (guestPath: string, content: string, _options: unknown) => {
      if (!isDirectory(path.posix.dirname(guestPath))) return notFound(guestPath);
      files = new Map([...files, [guestPath, content]]);
      return undefined;
    },
    mkdir: async (guestPath: string, _options: unknown) => {
      folders = new Set([...folders, guestPath]);
      return undefined;
    },
  };
}

/** Gondolin's ExecProcess is iterated for output and awaited for its result, so the fake is a promise that also has `output`. */
const fakeProcess = (result: Promise<{ stdout: string; exitCode: number }>, streamOutput: () => AsyncGenerator<{ data: Buffer }>) => {
  class FakeExecProcess extends Promise<{ stdout: string; exitCode: number }> {
    readonly output = streamOutput;
  }
  return new FakeExecProcess((resolve, reject) => {
    result.then(resolve).catch(reject);
  });
};

/** A guest process that streams `stdout` and exits with `exitCode`. */
export const finishedProcess = (stdout: string, exitCode = 0) =>
  fakeProcess(Promise.resolve({ stdout, exitCode }), async function* () {
    yield { data: Buffer.from(stdout) };
  });

/** A guest process that runs until its signal aborts, then fails the way an aborted exec does. */
export const hangingProcess = (signal: AbortSignal | undefined) => {
  const done = new Promise<never>((_, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('exec aborted')), { once: true });
  });
  return fakeProcess(done, async function* () {
    yield { data: Buffer.from('started\n') };
    await done;
  });
};

/** The shell probe answers with bash unless a test says the image has none; every other command is `exec`'s business. */
const withShellProbe =
  (exec: Exec, probeAnswer: string): Exec =>
  (argv, options) =>
    argv.at(-1) === BASH_PROBE_COMMAND ? finishedProcess(probeAnswer) : exec(argv, options);

export type GondolinOptions = { tree?: Readonly<Record<string, string>>; exec?: Exec; unreadable?: readonly string[]; probeAnswer?: string; closeFails?: boolean; cwd?: string; flags?: Readonly<Record<string, boolean | string>> };

const isVm = (fake: object): fake is VM => 'id' in fake && 'fs' in fake && hasMethods(fake, ['exec', 'close']);

/** Gives the extension a fake VM, after checking it carries the parts of a VM the extension uses. */
const vmFrom = (fake: object): VM => {
  if (!isVm(fake)) throw new Error('The fake VM lacks an id, an fs, exec or close.');
  return fake;
};

/**
 * Loads the gondolin extension into a recording fake of Pi. `VM.create` hands out a fake VM over an in-memory guest
 * filesystem, which is the one thing the test replaces: the VM itself.
 */
export function loadGondolin({ tree = {}, exec = () => finishedProcess(''), unreadable = [], probeAnswer = `${BASH}\n`, closeFails = false, cwd = HOST, flags = {} }: GondolinOptions = {}) {
  vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  let tools: Record<string, Tool> = {};
  let handlers: Record<string, Handler> = {};
  let commands: Record<string, Command> = {};
  let flagDefaults: Record<string, boolean | string | undefined> = {};
  const fs = fakeFs(tree, unreadable);
  const execMock = vi.fn(withShellProbe(exec, probeAnswer));
  const close = vi.fn(async () => (closeFails ? Promise.reject(new Error('qemu is gone')) : undefined));
  const vm = vmFrom({ id: VM_ID, fs, exec: execMock, close });
  vi.mocked(VM).create.mockResolvedValue(vm);
  const setStatus = vi.fn();
  const notify = vi.fn();
  const ctx = { ui: { setStatus, notify, theme: { fg: (_color: string, text: string) => text } } };
  const api = {
    on: (event: string, handler: Handler) => {
      handlers = { ...handlers, [event]: handler };
    },
    registerTool: (tool: Tool) => {
      tools = { ...tools, [tool.name]: tool };
    },
    registerCommand: (name: string, command: Command) => {
      commands = { ...commands, [name]: command };
    },
    registerFlag: (name: string, options: { default?: boolean | string }) => {
      flagDefaults = { ...flagDefaults, [name]: options.default };
    },
    getFlag: (name: string) => flags[name] ?? flagDefaults[name],
  };
  gondolin(extensionApiFrom(api));
  const call = (name: string, params: Record<string, unknown>, signal?: AbortSignal) => {
    const tool = tools[name];
    if (!tool) throw new Error(`gondolin registered no ${name} tool`);
    return tool.execute('call', params, signal, undefined, ctx);
  };
  return {
    tools: () => Object.keys(tools).toSorted(),
    commands: () => commands,
    fire: (event: string, payload: unknown = {}) => handlers[event]?.(payload, ctx),
    ctx,
    setStatus,
    notify,
    fs,
    exec: execMock,
    close,
    call,
    text: async (name: string, params: Record<string, unknown>, signal?: AbortSignal) => (await call(name, params, signal)).content[0]?.text,
    /** The options the extension gave Gondolin when it created the VM. */
    vmOptions: () => vi.mocked(VM).create.mock.lastCall?.[0],
  };
}

export type GondolinHost = ReturnType<typeof loadGondolin>;
