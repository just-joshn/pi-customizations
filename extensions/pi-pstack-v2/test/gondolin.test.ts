import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ReadonlyProvider, RealFSProvider, VM } from '@earendil-works/gondolin';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, test, vi } from 'vitest';
import { createGondolinBashOps } from '../src/gondolin/bash.ts';
import { createGondolinEditOps, createGondolinLsOps, createGondolinReadOps, createGondolinWriteOps } from '../src/gondolin/fs-operations.ts';
import { executeGondolinGrep } from '../src/gondolin/grep.ts';
import gondolin, { guestSystemPrompt, HOST_BOUNDARY_NOTE } from '../src/gondolin/index.ts';
import { GUEST_WORKSPACE, toGuestPath } from '../src/gondolin/paths.ts';
import { createGondolinFindOps, matchesToolGlob } from '../src/gondolin/search.ts';

type ExecOptions = { cwd?: string; env?: Record<string, string>; signal?: AbortSignal; stdout?: string; stderr?: string };
type Exec = (argv: string[], options?: ExecOptions) => unknown;
type ToolResult = { content: { type: string; text?: string }[]; details?: unknown };
type Tool = { name: string; execute: (id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, update: undefined, ctx: unknown) => Promise<ToolResult> };
type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type Command = { description: string; handler: (args: string, ctx: unknown) => Promise<void> };

const SEP = '/';
const HOST = '/host/project';
const OUTSIDE_HOST = '/etc/hosts';
const BASH = '/bin/bash';
const VM_ID = 'aaaabbbbccccdddd';
const SHORT_ID = 'aaaabbbb';
const LONG_LINE_LENGTH = 1000;
const TWO = 2;
const THREE = 3;
const FOUR = 4;
const TIMEOUT_SECONDS = 0.01;

vi.mock('@earendil-works/gondolin', () => {
  function RealFSProviderMock(root: string) {
    return Object.create(RealFSProviderMock.prototype, { root: { value: root, enumerable: true } });
  }
  function ReadonlyProviderMock(backend: unknown) {
    return Object.create(ReadonlyProviderMock.prototype, { backend: { value: backend, enumerable: true } });
  }
  return {
    VM: { create: vi.fn() },
    RealFSProvider: RealFSProviderMock,
    ReadonlyProvider: ReadonlyProviderMock,
  };
});

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

const notFound = (guestPath: string) => Promise.reject(new Error(`ENOENT: ${guestPath}`));

/** An in-memory guest filesystem holding `tree` under the workspace mount; directories exist where files do. */
function fakeFs(tree: Readonly<Record<string, string>>, unreadable: readonly string[] = []) {
  const files = new Map(Object.entries(tree).map(([relative, content]) => [path.posix.join(GUEST_WORKSPACE, relative), content]));
  const isDirectory = (guestPath: string) => !files.has(guestPath) && (guestPath === GUEST_WORKSPACE || [...files.keys()].some((file) => file.startsWith(`${guestPath}${SEP}`)));
  const exists = (guestPath: string) => files.has(guestPath) || isDirectory(guestPath);
  return {
    stat: async (guestPath: string) => (exists(guestPath) ? { isDirectory: () => isDirectory(guestPath) } : notFound(guestPath)),
    listDir: async (guestPath: string) => [...new Set([...files.keys()].filter((file) => file.startsWith(`${guestPath}${SEP}`)).map((file) => file.slice(guestPath.length + 1).split(SEP)[0] ?? ''))],
    readFile: async (guestPath: string, options?: { encoding?: string }) => {
      const content = files.get(guestPath);
      if (content === undefined || unreadable.includes(guestPath)) return notFound(guestPath);
      return options?.encoding ? content : Buffer.from(content);
    },
    access: async (guestPath: string) => (exists(guestPath) ? undefined : notFound(guestPath)),
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
  };
}

/** Gondolin's ExecProcess is iterated for output and awaited for its result, so the fake is a thenable as well. */
const fakeProcess = (result: Promise<{ stdout: string; exitCode: number }>, output: () => AsyncGenerator<{ data: Buffer }>) => ({
  output,
  // biome-ignore lint/suspicious/noThenProperty: the code under test awaits Gondolin's thenable ExecProcess, so the fake must be thenable.
  then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => result.then(resolve, reject),
});

/** A guest process that streams `stdout` and exits with `exitCode`. */
const finishedProcess = (stdout: string, exitCode = 0) =>
  fakeProcess(Promise.resolve({ stdout, exitCode }), async function* () {
    yield { data: Buffer.from(stdout) };
  });

/** A guest process that runs until its signal aborts, then fails the way an aborted exec does. */
const hangingProcess = (signal: AbortSignal | undefined) => {
  const done = new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('exec aborted')), { once: true }));
  return fakeProcess(done, async function* () {
    yield { data: Buffer.from('started\n') };
    await done;
  });
};

const fakeVm = (tree: Readonly<Record<string, string>>, exec: Exec = () => finishedProcess(''), unreadable: readonly string[] = []) => {
  const fs = fakeFs(tree, unreadable);
  const execMock = vi.fn(exec);
  const close = vi.fn(async () => undefined);
  return { vm: { id: VM_ID, fs, exec: execMock, close } as unknown as VM, fs, exec: execMock, close };
};

const grepText = async (vm: VM, params: Record<string, unknown>, signal?: AbortSignal) => {
  const result = await executeGondolinGrep(vm, HOST, { pattern: '', ...params }, signal);
  return { text: result.content[0]?.text, details: result.details };
};

describe('guest path mapping', () => {
  test('relative paths resolve under the workspace mount', () => {
    expect(toGuestPath(HOST, 'src/a.ts')).toBe(`${GUEST_WORKSPACE}/src/a.ts`);
    expect(toGuestPath(HOST, './src/../b.ts')).toBe(`${GUEST_WORKSPACE}/b.ts`);
  });

  test('absolute host paths inside the cwd map into the workspace, and the cwd itself is the workspace', () => {
    expect(toGuestPath(HOST, `${HOST}/src/a.ts`)).toBe(`${GUEST_WORKSPACE}/src/a.ts`);
    expect(toGuestPath(HOST, HOST)).toBe(GUEST_WORKSPACE);
  });

  test('absolute paths outside the cwd name the same guest path', () => {
    expect(toGuestPath(HOST, OUTSIDE_HOST)).toBe(OUTSIDE_HOST);
    expect(toGuestPath(HOST, `${HOST}-other/x`)).toBe(`${HOST}-other/x`);
  });

  test('an @ prefix is dropped and an empty path is the workspace', () => {
    expect(toGuestPath(HOST, '@src/a.ts')).toBe(`${GUEST_WORKSPACE}/src/a.ts`);
    expect(toGuestPath(HOST, `@${HOST}/a.ts`)).toBe(`${GUEST_WORKSPACE}/a.ts`);
    expect(toGuestPath(HOST, '')).toBe(GUEST_WORKSPACE);
    expect(toGuestPath(HOST, '  @ ')).toBe(GUEST_WORKSPACE);
    expect(toGuestPath(HOST, '   ')).toBe(GUEST_WORKSPACE);
  });
});

describe('tool globs', () => {
  test('a pattern without / matches the file name at any depth', () => {
    expect(matchesToolGlob('src/deep/a.ts', '*.ts')).toBe(true);
    expect(matchesToolGlob('src/deep/a.js', '*.ts')).toBe(false);
  });

  test('a pattern with / matches from the search root, ignoring a leading ./', () => {
    expect(matchesToolGlob('src/a.ts', 'src/*.ts')).toBe(true);
    expect(matchesToolGlob('src/deep/a.ts', 'src/*.ts')).toBe(false);
    expect(matchesToolGlob('src/deep/a.ts', './src/**/*.ts')).toBe(true);
  });
});

describe('grep over the guest filesystem', () => {
  test('prints each match with its context lines, marking the match with : and context with -', async () => {
    const { vm } = fakeVm({ 'a.txt': 'one\ntwo\r\nthree\rfour\nfive' });
    expect(await grepText(vm, { pattern: 'three', context: 1 })).toEqual({ text: 'a.txt-2- two\na.txt:3: three\na.txt-4- four', details: undefined });
    expect((await grepText(vm, { pattern: 'one', context: TWO })).text).toBe('a.txt:1: one\na.txt-2- two\na.txt-3- three');
    expect((await grepText(vm, { pattern: 'five', context: 1 })).text).toBe('a.txt-4- four\na.txt:5: five');
  });

  test('stops at the match limit and says so', async () => {
    const { vm } = fakeVm({ 'a.txt': 'hit 1\nhit 2', 'b.txt': 'hit 3' });
    expect(await grepText(vm, { pattern: 'hit', limit: TWO })).toEqual({ text: 'a.txt:1: hit 1\na.txt:2: hit 2\n\n[2 matches limit reached]', details: { matchLimitReached: TWO } });
    expect((await grepText(vm, { pattern: 'hit', limit: 0 })).text).toBe('a.txt:1: hit 1\n\n[1 matches limit reached]');
    // Like upstream, reaching the limit exactly counts as reaching it.
    expect((await grepText(vm, { pattern: 'hit', limit: THREE })).details).toEqual({ matchLimitReached: THREE });
    expect((await grepText(vm, { pattern: 'hit', limit: FOUR })).details).toBeUndefined();
  });

  test('literal patterns match text, not regex, and ignoreCase folds case', async () => {
    const { vm } = fakeVm({ 'a.txt': 'a.b\naxb\nHello' });
    expect((await grepText(vm, { pattern: 'a.b', literal: true })).text).toBe('a.txt:1: a.b');
    expect((await grepText(vm, { pattern: 'a.b' })).text).toBe('a.txt:1: a.b\na.txt:2: axb');
    expect((await grepText(vm, { pattern: 'HELLO', literal: true, ignoreCase: true })).text).toBe('a.txt:3: Hello');
    expect((await grepText(vm, { pattern: '^hel', ignoreCase: true })).text).toBe('a.txt:3: Hello');
    expect((await grepText(vm, { pattern: 'HELLO', literal: true })).text).toBe('No matches found');
  });

  test('reports no matches without details', async () => {
    const { vm } = fakeVm({ 'a.txt': 'nothing here' });
    expect(await grepText(vm, { pattern: 'absent' })).toEqual({ text: 'No matches found', details: undefined });
  });

  test('skips .git, node_modules, unreadable files, and files outside the glob', async () => {
    const { vm } = fakeVm({ '.git/HEAD': 'hit', 'node_modules/x/i.js': 'hit', 'src/a.ts': 'hit', 'src/b.js': 'hit', 'bin.dat': 'hit' }, undefined, [`${GUEST_WORKSPACE}/bin.dat`]);
    expect((await grepText(vm, { pattern: 'hit' })).text).toBe('src/a.ts:1: hit\nsrc/b.js:1: hit');
    expect((await grepText(vm, { pattern: 'hit', glob: '*.ts' })).text).toBe('src/a.ts:1: hit');
  });

  test('a file root prints the file name, and a path argument narrows the search', async () => {
    const { vm } = fakeVm({ 'src/a.ts': 'hit', 'b.ts': 'hit' });
    expect((await grepText(vm, { pattern: 'hit', path: 'src/a.ts' })).text).toBe('a.ts:1: hit');
    expect((await grepText(vm, { pattern: 'hit', path: 'src' })).text).toBe('a.ts:1: hit');
  });

  test('cuts long lines and says so', async () => {
    const { vm } = fakeVm({ 'a.txt': `hit ${'x'.repeat(LONG_LINE_LENGTH)}` });
    const { text, details } = await grepText(vm, { pattern: 'hit' });
    expect(text).toMatch(/\n\n\[long lines truncated\]$/);
    expect(details).toEqual({ linesTruncated: true });
  });

  test('an aborted signal stops the search', async () => {
    const { vm } = fakeVm({ 'a.txt': 'hit' });
    const controller = new AbortController();
    controller.abort();
    await expect(grepText(vm, { pattern: 'hit' }, controller.signal)).rejects.toThrow('Operation aborted');
  });
});

describe('find and filesystem operations', () => {
  test('find globs return guest paths up to the limit and report existence', async () => {
    const { vm } = fakeVm({ 'a.ts': '', 'src/b.ts': '', 'src/c.js': '' });
    const find = createGondolinFindOps(vm, HOST);
    expect(await find.glob('*.ts', HOST, { ignore: [], limit: 1 })).toEqual([`${GUEST_WORKSPACE}/a.ts`]);
    expect(await find.glob('*.ts', 'src', { ignore: [], limit: TWO })).toEqual([`${GUEST_WORKSPACE}/src/b.ts`]);
    expect(await find.glob('*.ts', '', { ignore: [], limit: 0 })).toEqual([]);
    expect(await find.exists('src')).toBe(true);
    expect(await find.exists('missing')).toBe(false);
  });

  test('read detects image types by extension and reads through the guest path', async () => {
    const { vm } = fakeVm({ 'a.txt': 'text' });
    const read = createGondolinReadOps(vm, HOST);
    expect(await read.detectImageMimeType?.('shot.PNG')).toBe('image/png');
    expect(await read.detectImageMimeType?.('a.jpeg')).toBe('image/jpeg');
    expect(await read.detectImageMimeType?.('a.txt')).toBeNull();
    expect(String(await read.readFile(`${HOST}/a.txt`))).toBe('text');
    await expect(read.access('missing')).rejects.toThrow('ENOENT');
  });

  test('write, edit, and ls address guest paths', async () => {
    const { vm, fs } = fakeVm({ 'src/a.txt': 'text' });
    await createGondolinWriteOps(vm, HOST).mkdir('out');
    await createGondolinEditOps(vm, HOST).writeFile('src/a.txt', 'new');
    expect(fs.mkdir).toHaveBeenCalledWith(`${GUEST_WORKSPACE}/out`, { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(`${GUEST_WORKSPACE}/src/a.txt`, 'new', { encoding: 'utf8' });
    const ls = createGondolinLsOps(vm, HOST);
    expect(await ls.readdir('src')).toEqual(['a.txt']);
    expect((await ls.stat('src')).isDirectory()).toBe(true);
    expect(await ls.exists('nope')).toBe(false);
  });
});

describe('bash operations', () => {
  test('runs the command through the probed shell in the guest cwd with string env values only', async () => {
    const { vm, exec } = fakeVm({}, () => finishedProcess('out\n', THREE));
    const onData = vi.fn();
    const result = await createGondolinBashOps(vm, HOST, BASH).exec('echo hi', `${HOST}/src`, { onData, env: { KEEP: 'yes', DROP: undefined } });
    expect(result).toEqual({ exitCode: THREE });
    expect(onData).toHaveBeenCalledWith(Buffer.from('out\n'));
    expect(exec.mock.calls[0]?.[0]).toEqual([BASH, '-lc', 'echo hi']);
    expect(exec.mock.calls[0]?.[1]).toMatchObject({ cwd: `${GUEST_WORKSPACE}/src`, env: { KEEP: 'yes' }, stdout: 'pipe', stderr: 'pipe' });
  });

  test('reports a timeout, an abort, and passes other failures through', async () => {
    const { vm } = fakeVm({}, (_argv, options) => hangingProcess(options?.signal));
    const ops = createGondolinBashOps(vm, HOST, BASH);
    await expect(ops.exec('sleep', HOST, { onData: vi.fn(), timeout: TIMEOUT_SECONDS })).rejects.toThrow(`timeout:${TIMEOUT_SECONDS}`);
    const controller = new AbortController();
    const running = ops.exec('sleep', HOST, { onData: () => controller.abort(), signal: controller.signal });
    await expect(running).rejects.toThrow('aborted');
    await expect(ops.exec('sleep', HOST, { onData: vi.fn(), signal: controller.signal })).rejects.toThrow('aborted');
    const failing = createGondolinBashOps(
      fakeVm({}, () => {
        throw new Error('boom');
      }).vm,
      HOST,
      BASH,
    );
    await expect(failing.exec('x', HOST, { onData: vi.fn() })).rejects.toThrow('boom');
  });
});

describe('system prompt', () => {
  test('replaces the host cwd line, or appends the guest line when it is missing', () => {
    const guestLine = `Current working directory: ${GUEST_WORKSPACE} (Gondolin VM; host workspace mounted from ${HOST})`;
    expect(guestSystemPrompt(`Intro\nCurrent working directory: ${HOST}\nEnd`, HOST)).toBe(`Intro\n${guestLine}\nEnd\n\n${HOST_BOUNDARY_NOTE}`);
    expect(guestSystemPrompt('Intro', HOST)).toBe(`Intro\n\n${guestLine}\n\n${HOST_BOUNDARY_NOTE}`);
  });

  test('says which commands and paths exist only on the host, and how to reach them', () => {
    const prompt = guestSystemPrompt('Intro', HOST);
    expect(prompt).toContain('The VM has no `git`, `gh`, `tmux`, or `bun`');
    expect(prompt).toContain('Host paths outside the working directory, such as the Pi agent directory, do not exist in the VM');
    expect(prompt).toContain('Run what needs them on the host with `tmux_run`');
    expect(prompt).toContain('read its output with `tmux_jobs` `output`');
  });
});

type FakeCtx = { ui: { setStatus: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn>; theme: { fg: (color: string, text: string) => string } } };

/** Loads the extension against a recording fake of Pi, with VM.create returning a fake VM over a small workspace. */
function loadExtension() {
  let tools: Record<string, Tool> = {};
  let handlers: Record<string, Handler> = {};
  let commands: Record<string, Command> = {};
  const guest = fakeVm({ 'a.txt': 'hello\nworld', 'src/b.ts': 'hello' }, (argv) => finishedProcess(argv.at(-1) === 'command -v bash || true' ? `${BASH}\n` : 'ran\n'));
  vi.mocked(VM.create).mockResolvedValue(guest.vm);
  const ctx: FakeCtx = { ui: { setStatus: vi.fn(), notify: vi.fn(), theme: { fg: (_color, text) => text } } };
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
  };
  gondolin(api as unknown as ExtensionAPI);
  const run = async (name: string, params: Record<string, unknown>) => (await tools[name]?.execute('id', params, undefined, undefined, ctx))?.content[0]?.text;
  return { tools, handlers, commands, ctx, guest, run };
}

describe('the extension: lifecycle', () => {
  test('overrides the seven built-in tools and registers its command and lifecycle handlers', () => {
    const { tools, commands, handlers } = loadExtension();
    expect(Object.keys(tools).toSorted()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
    expect(Object.keys(commands)).toEqual(['gondolin']);
    expect(commands['gondolin']?.description).toBe('Show Gondolin VM status');
    expect(Object.keys(handlers).toSorted()).toEqual(['before_agent_start', 'session_shutdown', 'session_start', 'user_bash']);
  });

  test('boots the VM at session start once and reports its status', async () => {
    const { handlers, commands, ctx, guest } = loadExtension();
    await Promise.all([handlers['session_start']?.({}, ctx), handlers['session_start']?.({}, ctx)]);
    expect(ctx.ui.setStatus).toHaveBeenNthCalledWith(1, 'gondolin', `Gondolin: starting ${GUEST_WORKSPACE}`);
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith('gondolin', `Gondolin: ${SHORT_ID} (${GUEST_WORKSPACE})`);
    expect(ctx.ui.notify).toHaveBeenCalledWith(`Gondolin VM ready. ${process.cwd()} is mounted at ${GUEST_WORKSPACE}.`, 'info');
    expect(guest.exec).toHaveBeenCalledTimes(1);
    await commands['gondolin']?.handler('', ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(`Gondolin VM: ${VM_ID}\nHost workspace: ${process.cwd()}\nGuest workspace: ${GUEST_WORKSPACE}\nShell: ${BASH}`, 'info');
  });

  test('mounts this package read-only at its host path, so the skill paths Pi names resolve in the guest', async () => {
    const { handlers, ctx } = loadExtension();
    await handlers['session_start']?.({}, ctx);
    const mounts: Record<string, unknown> = vi.mocked(VM.create).mock.lastCall?.[0]?.vfs?.mounts ?? {};
    expect(Object.keys(mounts).toSorted()).toEqual([GUEST_WORKSPACE, PACKAGE_ROOT].toSorted());
    expect(mounts[PACKAGE_ROOT]).toBeInstanceOf(ReadonlyProvider);
    expect((mounts[PACKAGE_ROOT] as { backend: { root: string } }).backend).toEqual(new RealFSProvider(PACKAGE_ROOT));
    expect(toGuestPath(HOST, path.join(PACKAGE_ROOT, 'skills', 'poteto-mode', 'SKILL.md'))).toBe(`${PACKAGE_ROOT}/skills/poteto-mode/SKILL.md`);
  });

  test('closes the VM at shutdown and clears its status', async () => {
    const { handlers, ctx, guest } = loadExtension();
    await handlers['session_shutdown']?.({}, ctx);
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    await handlers['session_start']?.({}, ctx);
    await handlers['session_shutdown']?.({}, ctx);
    expect(guest.close).toHaveBeenCalledTimes(1);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith('gondolin', 'Gondolin: stopping');
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith('gondolin', undefined);
  });
});

describe('the extension: guest routing', () => {
  test('tools run against the guest filesystem and shell', async () => {
    const { run, guest } = loadExtension();
    expect(await run('read', { path: 'a.txt' })).toBe('hello\nworld');
    expect(await run('grep', { pattern: 'hello' })).toBe('a.txt:1: hello\nsrc/b.ts:1: hello');
    expect(await run('ls', { path: 'src' })).toBe('b.ts');
    expect(await run('find', { pattern: '*.ts' })).toBe('src/b.ts');
    expect(await run('bash', { command: 'echo ran' })).toBe('ran\n');
    expect(guest.exec).toHaveBeenLastCalledWith([BASH, '-lc', 'echo ran'], expect.objectContaining({ cwd: GUEST_WORKSPACE }));
    await run('write', { path: 'new.txt', content: 'x' });
    expect(guest.fs.writeFile).toHaveBeenCalledWith(`${GUEST_WORKSPACE}/new.txt`, 'x', { encoding: 'utf8' });
    await run('edit', { path: 'a.txt', edits: [{ oldText: 'world', newText: 'there' }] });
    expect(guest.fs.writeFile).toHaveBeenLastCalledWith(`${GUEST_WORKSPACE}/a.txt`, 'hello\nthere', { encoding: 'utf8' });
  });

  test('user bash and the prompt hook use the guest', async () => {
    const { handlers, ctx, guest } = loadExtension();
    const userBash = (await handlers['user_bash']?.({}, ctx)) as { operations: { exec: (command: string, cwd: string, options: { onData: () => void }) => Promise<unknown> } };
    expect(await userBash.operations.exec('ls', process.cwd(), { onData: vi.fn() })).toEqual({ exitCode: 0 });
    expect(guest.exec).toHaveBeenLastCalledWith([BASH, '-lc', 'ls'], expect.objectContaining({ cwd: GUEST_WORKSPACE }));
    const prompt = await handlers['before_agent_start']?.({ systemPrompt: `Current working directory: ${process.cwd()}` }, ctx);
    expect(prompt).toEqual({ systemPrompt: `Current working directory: ${GUEST_WORKSPACE} (Gondolin VM; host workspace mounted from ${process.cwd()})\n\n${HOST_BOUNDARY_NOTE}` });
  });
});
