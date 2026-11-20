import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { BASH, BASH_PROBE_COMMAND, finishedProcess, type GondolinHost, GUEST, HOST, hangingProcess, loadGondolin, VM_ID } from './core-gondolin-host.ts';

vi.mock('@earendil-works/gondolin', async (importOriginal) => ({ ...(await importOriginal<typeof import('@earendil-works/gondolin')>()), VM: { create: vi.fn() } }));

const POSIX_SHELL = '/bin/sh';
const SHORT_ID = 'aaaabbbb';
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const OUTSIDE_HOST = '/etc/hosts';
const EXIT_CODE = 3;
const TIMEOUT_SECONDS = 0.01;
const NOTE_SNIPPETS = [
  'The VM has no `git`, `gh`, `tmux`, or `bun`',
  'Host paths outside the working directory, such as the Pi agent directory, do not exist in the VM',
  'Run what needs them on the host with `tmux_run`',
  'read its output with `tmux_jobs` `output`',
];

afterEach(() => {
  vi.restoreAllMocks();
});

const guestLine = `Current working directory: ${GUEST} (Gondolin VM; host workspace mounted from ${HOST})`;
const PromptResult = z.object({ systemPrompt: z.string() });
const prompt = async (host: GondolinHost, systemPrompt: string) => PromptResult.parse(await host.fire('before_agent_start', { systemPrompt })).systemPrompt;

type UserBashExec = (command: string, cwd: string, options: { onData: (data: Buffer) => void }) => Promise<unknown>;
const UserBashResult = z.object({ operations: z.object({ exec: z.custom<UserBashExec>((value) => typeof value === 'function') }) });

describe('the Gondolin VM across a session', () => {
  test('overrides the seven built-in tools and adds /gondolin', () => {
    const host = loadGondolin();
    expect(host.tools()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
    expect(Object.keys(host.commands())).toEqual(['gondolin']);
    expect(host.commands()['gondolin']?.description).toBe('Show Gondolin VM status');
  });

  test('boots one VM at session start however many calls race, and shows its status', async () => {
    const host = loadGondolin({ tree: { 'a.txt': 'hello' } });
    await Promise.all([host.fire('session_start'), host.fire('session_start'), host.text('read', { path: 'a.txt' })]);
    expect(host.exec.mock.calls.filter(([argv]) => argv.at(-1) === BASH_PROBE_COMMAND)).toHaveLength(1);
    expect(host.setStatus).toHaveBeenNthCalledWith(1, 'gondolin', `Gondolin: starting ${GUEST}`);
    expect(host.setStatus).toHaveBeenLastCalledWith('gondolin', `Gondolin: ${SHORT_ID} (${GUEST})`);
    expect(host.notify).toHaveBeenCalledWith(`Gondolin VM ready. ${HOST} is mounted at ${GUEST}.`, 'info');
  });

  test('the gondolin command reports the VM, both workspaces, and the shell commands run in', async () => {
    const host = loadGondolin();
    await host.commands()['gondolin']?.handler('', host.ctx);
    expect(host.notify).toHaveBeenLastCalledWith(`Gondolin VM: ${VM_ID}\nHost workspace: ${HOST}\nGuest workspace: ${GUEST}\nShell: ${BASH}`, 'info');
  });

  test('a guest image without bash runs commands in the POSIX shell', async () => {
    const host = loadGondolin({ probeAnswer: '\n', exec: () => finishedProcess('ok\n') });
    await host.text('bash', { command: 'echo ok' });
    expect(host.exec).toHaveBeenLastCalledWith([POSIX_SHELL, '-lc', 'echo ok'], expect.anything());
  });

  test('the first tool call boots the VM when the session start was missed', async () => {
    const host = loadGondolin({ tree: { 'a.txt': 'hello' } });
    expect(await host.text('read', { path: 'a.txt' })).toBe('hello');
    expect(host.notify).toHaveBeenCalledTimes(1);
  });
});

describe('the Gondolin VM at shutdown', () => {
  test('shutdown closes the VM and clears its status, and does nothing when none ran', async () => {
    const host = loadGondolin();
    await host.fire('session_shutdown');
    expect(host.setStatus).not.toHaveBeenCalled();
    await host.fire('session_start');
    await host.fire('session_shutdown');
    expect(host.close).toHaveBeenCalledTimes(1);
    expect(host.setStatus).toHaveBeenCalledWith('gondolin', 'Gondolin: stopping');
    expect(host.setStatus).toHaveBeenLastCalledWith('gondolin', undefined);
  });

  test('a VM that fails to close still clears its status, and the failure reaches Pi', async () => {
    const host = loadGondolin({ closeFails: true });
    await host.fire('session_start');
    await expect(host.fire('session_shutdown')).rejects.toThrow('qemu is gone');
    expect(host.setStatus).toHaveBeenLastCalledWith('gondolin', undefined);
  });

  test('a call after shutdown boots a fresh VM', async () => {
    const host = loadGondolin({ tree: { 'a.txt': 'hello' } });
    await host.fire('session_start');
    await host.fire('session_shutdown');
    await host.text('read', { path: 'a.txt' });
    expect(host.notify).toHaveBeenCalledTimes(2);
  });
});

describe('the system prompt in the guest', () => {
  test('points the model at the guest workspace instead of the host directory', async () => {
    const host = loadGondolin();
    const rewritten = await prompt(host, `Intro\nCurrent working directory: ${HOST}\nEnd`);
    expect(rewritten.startsWith(`Intro\n${guestLine}\nEnd\n\n`)).toBe(true);
  });

  test('adds the workspace line when Pi sent none', async () => {
    const host = loadGondolin();
    expect((await prompt(host, 'Intro')).startsWith(`Intro\n\n${guestLine}\n\n`)).toBe(true);
  });

  test('says which commands and paths exist only on the host, and how to reach them', async () => {
    const rewritten = await prompt(loadGondolin(), 'Intro');
    for (const snippet of NOTE_SNIPPETS) expect(rewritten).toContain(snippet);
  });

  test('boots the VM before the first turn', async () => {
    const host = loadGondolin();
    await prompt(host, 'Intro');
    expect(host.notify).toHaveBeenCalledTimes(1);
  });
});

describe('file tools act on the guest filesystem', () => {
  const tree = { 'a.txt': 'hello\nworld', 'src/b.ts': 'hello', 'shot.PNG': 'not-really-a-png', 'photo.jpeg': 'not-really-a-jpeg', 'notes.png.txt': 'plain' };

  test.for([
    ['a workspace-relative path', 'a.txt'],
    ['a host path inside the project', `${HOST}/a.txt`],
    ['an @-prefixed path', '@a.txt'],
    ['an @-prefixed host path', `@${HOST}/a.txt`],
    ['a path with dot segments', './src/../a.txt'],
  ])('read finds a file by %s', async ([, requested]) => {
    expect(await loadGondolin({ tree }).text('read', { path: requested })).toBe('hello\nworld');
  });

  test('read reaches a guest path outside the project by the same absolute path', async () => {
    const host = loadGondolin({ tree: { [OUTSIDE_HOST]: 'localhost' } });
    expect(await host.text('read', { path: OUTSIDE_HOST })).toBe('localhost');
    expect(await loadGondolin({ tree: { [`${HOST}-other/x`]: 'sibling' } }).text('read', { path: `${HOST}-other/x` })).toBe('sibling');
  });

  test('read opens a skill file by the host path Pi names, because the package is mounted at that path', async () => {
    const skill = path.join(PACKAGE_ROOT, 'skills', 'poteto-mode', 'SKILL.md');
    const host = loadGondolin({ tree: { [skill]: '# Poteto mode' } });
    expect(await host.text('read', { path: skill })).toBe('# Poteto mode');
  });

  test('read of a missing file fails with the guest path', async () => {
    await expect(loadGondolin({ tree }).call('read', { path: 'missing.txt' })).rejects.toThrow('ENOENT: /workspace/missing.txt');
  });

  test.for([
    ['shot.PNG', 'image/png'],
    ['photo.jpeg', 'image/jpeg'],
  ])('read treats %s as an %s image', async ([file, mime]) => {
    expect(await loadGondolin({ tree }).text('read', { path: file })).toContain(`Read image file [${mime}]`);
  });

  test('read treats a file that only has an image extension in its name as text', async () => {
    expect(await loadGondolin({ tree }).text('read', { path: 'notes.png.txt' })).toBe('plain');
  });
});

describe('write, edit, and ls act on the guest filesystem', () => {
  const tree = { 'a.txt': 'hello\nworld', 'src/b.ts': 'hello' };

  test('write creates the folder and writes the file in the guest', async () => {
    const host = loadGondolin({ tree });
    expect(await host.text('write', { path: 'out/new.txt', content: 'x' })).toBe('Successfully wrote to out/new.txt');
    expect(await host.text('read', { path: 'out/new.txt' })).toBe('x');
    expect(await host.text('ls', { path: 'out' })).toBe('new.txt');
  });

  test('edit rewrites the matched text in the guest file', async () => {
    const host = loadGondolin({ tree });
    expect(await host.text('edit', { path: 'a.txt', edits: [{ oldText: 'world', newText: 'there' }] })).toBe('Successfully replaced 1 block(s) in a.txt.');
    expect(await host.text('read', { path: 'a.txt' })).toBe('hello\nthere');
  });

  test('ls lists a guest directory, and says when it is missing', async () => {
    const host = loadGondolin({ tree });
    expect(await host.text('ls', { path: 'src' })).toBe('b.ts');
    expect(await host.text('ls', {})).toContain('src');
    await expect(host.call('ls', { path: 'nope' })).rejects.toThrow('Path not found: /workspace/nope');
  });
});

describe('the bash tool runs commands in the guest', () => {
  test('through the probed shell, in the guest cwd, with the tool environment', async () => {
    const host = loadGondolin({ exec: () => finishedProcess('ran\n') });
    expect(await host.text('bash', { command: 'echo ran' })).toBe('ran\n');
    expect(host.exec).toHaveBeenLastCalledWith([BASH, '-lc', 'echo ran'], expect.objectContaining({ cwd: GUEST, stdout: 'pipe', stderr: 'pipe' }));
  });

  test('only string environment values reach the guest', async () => {
    const host = loadGondolin({ exec: () => finishedProcess('') });
    vi.stubEnv('PSTACK_GONDOLIN_PROBE', 'present');
    await host.text('bash', { command: 'env' });
    const options = host.exec.mock.lastCall?.[1];
    expect(options?.env).toMatchObject({ PSTACK_GONDOLIN_PROBE: 'present' });
    expect(Object.values(options?.env ?? {}).every((value) => typeof value === 'string')).toBe(true);
  });

  test('a failing command reports its exit code and output as an error result', async () => {
    const host = loadGondolin({ exec: () => finishedProcess('partial\n', EXIT_CODE) });
    const result = await host.call('bash', { command: 'false' });
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]?.text).toBe(`partial\n\n\nCommand exited with code ${EXIT_CODE}`);
  });
});

describe('the bash tool ends commands in the guest', () => {
  test('a command that outlives its timeout is reported as timed out', async () => {
    const host = loadGondolin({ exec: (_argv, options) => hangingProcess(options?.signal) });
    await expect(host.call('bash', { command: 'sleep 9', timeout: TIMEOUT_SECONDS })).rejects.toThrow(`started\n\n\nCommand timed out after ${TIMEOUT_SECONDS} seconds`);
  });

  test('aborting a running command reports it as aborted', async () => {
    const host = loadGondolin({ exec: (_argv, options) => hangingProcess(options?.signal) });
    const controller = new AbortController();
    const running = host.call('bash', { command: 'sleep 9' }, controller.signal);
    await vi.waitFor(() => expect(host.exec.mock.calls.length).toBeGreaterThan(1));
    controller.abort();
    await expect(running).rejects.toThrow('aborted');
  });

  test('a command is not started when the call was already aborted', async () => {
    const host = loadGondolin({ exec: () => finishedProcess('never\n') });
    await expect(host.call('bash', { command: 'echo never' }, AbortSignal.abort())).rejects.toThrow('aborted');
  });

  test('a failure of the VM itself reaches the user unchanged', async () => {
    const host = loadGondolin({
      exec: () => {
        throw new Error('boom');
      },
    });
    await expect(host.call('bash', { command: 'x' })).rejects.toThrow('boom');
  });

  test('the user bash command (!) runs in the guest too', async () => {
    const host = loadGondolin({ exec: () => finishedProcess('listing\n') });
    const result = UserBashResult.parse(await host.fire('user_bash'));
    const onData = vi.fn<(data: Buffer) => void>();
    expect(await result.operations.exec('ls', `${HOST}/src`, { onData })).toEqual({ exitCode: 0 });
    expect(onData).toHaveBeenCalledWith(Buffer.from('listing\n'));
    expect(host.exec).toHaveBeenLastCalledWith([BASH, '-lc', 'ls'], expect.objectContaining({ cwd: `${GUEST}/src` }));
  });
});
