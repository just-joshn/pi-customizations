import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { Context, ToolCall } from '@earendil-works/pi-ai';
import type { AgentSession, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { expect, test, vi } from 'vitest';
import { type ShellRecord, ShellRuntime } from '../src/shell-runtime.ts';
import { fixture, prompt, toolResults } from './session-fixture.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
let callCount = 0;

function call(name: string, args: ToolCall['arguments']): ToolCall {
  callCount += 1;
  return { type: 'toolCall', id: `${name}-${callCount}`, name, arguments: args };
}

async function waitFor(predicate: () => boolean, label: string, deadlineMs = 5000): Promise<void> {
  await vi.waitFor(
    () => {
      if (!predicate()) throw new Error(`Timed out waiting for ${label}`);
    },
    { timeout: deadlineMs, interval: 20 },
  );
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function escapedDescendant(leaderPid: number): number | undefined {
  try {
    const pid = Number(execFileSync('pgrep', ['-f', 'POSIX::setsid']).toString().trim().split('\n')[0]);
    if (!pid) return undefined;
    return execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)])
      .toString()
      .trim() === String(leaderPid)
      ? undefined
      : pid;
  } catch {
    return undefined;
  }
}

/** Kills one process this suite started. A pid that already exited is the expected case. */
function killByPid(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if ((error as { code?: string }).code !== 'ESRCH') throw error;
  }
}

function custom(session: AgentSession, type: string) {
  return session.messages.filter((message) => message.role === 'custom' && message.customType === type);
}

function requestTexts(request: Context | undefined): string[] {
  return (request?.messages ?? []).flatMap((message) => {
    if (message.role !== 'user') return [];
    if (typeof message.content === 'string') return [message.content];
    return message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []));
  });
}

const BG_SHELL_STOP = 'Background' + 'ShellStop';
const BG_SHELL_LIST = 'Background' + 'ShellList';

function detailsOf<T>(session: AgentSession, name: string, index = 0): T {
  const result = toolResults(session, name)[index];
  expect(result?.role === 'toolResult' && !result.isError).toBe(true);
  return result?.details as T;
}

function shutdown(session: AgentSession) {
  return session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
}

function shellTest(name: string, scenario: (f: Fixture, session: AgentSession) => Promise<void>) {
  test(name, async () => {
    const f = await fixture({ extensionOnly: true });
    const { session } = await f.open();
    try {
      await scenario(f, session);
    } finally {
      await shutdown(session);
      await f.close();
    }
  });
}

shellTest('a matching output line wakes the agent once with the line and log path', async (f, session) => {
  const line = 'AGENT_LOOP_WAKE_t {"prompt":"check"}';
  f.calls.push(call('BackgroundShell', { command: `sleep 0.2; echo '${line}'`, title: 'wake', notify_on_output: '^AGENT_LOOP_WAKE_t' }));
  await prompt(session, 'start the sleeper');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  expect(shell.outputFile).toBe(join(f.root, 'sessions', 'pstack-shells', session.sessionId, `${shell.id}.log`));
  await waitFor(() => !groupAlive(shell.pid), 'the sleeper process to exit');
  await waitFor(() => f.requests.length === 3 && !session.isStreaming, 'the match request to settle');
  const requests = f.requests;
  expect(requests.length).toBe(3);
  const expected = `Background shell ${shell.id} (wake) matched ^AGENT_LOOP_WAKE_t.\nOutput file: ${shell.outputFile}\nLine: ${line}`;
  expect(requestTexts(requests[2]).includes(expected)).toBe(true);
  expect(custom(session, 'pstack-shell-output').length).toBe(1);
  expect(await readFile(shell.outputFile, 'utf8')).toBe(`${line}\n`);
  await waitFor(() => !groupAlive(shell.pid), 'the shell process group to exit');
  expect(f.requests.length).toBe(3);
});

shellTest('a ticking loop wakes repeatedly and stops without an exit message', async (f, session) => {
  f.calls.push(call('BackgroundShell', { command: 'while true; do sleep 0.1; echo AGENT_LOOP_TICK_t; done', title: 'tick', notify_on_output: '^AGENT_LOOP_TICK_t' }));
  await prompt(session, 'start the ticker');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  await waitFor(() => custom(session, 'pstack-shell-output').length >= 2, 'two wakes');
  f.calls.push(call(BG_SHELL_STOP, { id: shell.id }));
  await waitFor(() => toolResults(session, BG_SHELL_STOP).length === 1, 'the stop call');
  expect(detailsOf<ShellRecord>(session, BG_SHELL_STOP).status).toEqual({ kind: 'stopped' });
  await waitFor(() => !groupAlive(shell.pid), 'the process group to exit');
  expect(() => process.kill(-shell.pid, 0)).toThrow();
  await waitFor(() => !session.isStreaming, 'the agent to settle');
  f.calls.push(call(BG_SHELL_LIST, {}));
  await prompt(session, 'list shells');
  const listed = detailsOf<ShellRecord[]>(session, BG_SHELL_LIST);
  expect(listed.map((record) => [record.id, record.status])).toEqual([[shell.id, { kind: 'stopped' }]]);
  expect(custom(session, 'pstack-shell-exit').length).toBe(0);
});

shellTest('a failing command without a pattern wakes once with its exit code', async (f, session) => {
  f.calls.push(call('BackgroundShell', { command: 'false', title: 'fail' }));
  await prompt(session, 'run false');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  await waitFor(() => f.requests.length === 3 && !session.isStreaming, 'the exit wake');
  const expected = `Background shell ${shell.id} (fail) exited with exit code 1.\nOutput file: ${shell.outputFile}`;
  expect(requestTexts(f.requests[2]).includes(expected)).toBe(true);
  expect(custom(session, 'pstack-shell-exit').length).toBe(1);
  expect((custom(session, 'pstack-shell-exit')[0] as { details: ShellRecord }).details.status).toEqual({ kind: 'exited', code: 1, signal: null });
  await waitFor(() => !groupAlive(shell.pid), 'the shell process group to exit');
  expect(f.requests.length).toBe(3);
});

shellTest('invalid patterns and blank commands fail before spawning', async (f, session) => {
  f.calls.push([call('BackgroundShell', { command: 'echo hi', title: 'bad', notify_on_output: '(' }), call('BackgroundShell', { command: '   ', title: 'blank' })], call(BG_SHELL_LIST, {}));
  await prompt(session, 'start invalid shells');
  const results = toolResults(session, 'BackgroundShell').map((result) => (result.role === 'toolResult' ? [result.isError, JSON.stringify(result.content)] : []));
  expect(results.length).toBe(2);
  expect(results.every(([isError]) => isError === true)).toBe(true);
  expect(String(results[0]?.[1])).toMatch(/notify_on_output is not a valid regular expression/);
  expect(String(results[1]?.[1])).toMatch(/BackgroundShell command must not be blank/);
  expect(detailsOf<ShellRecord[]>(session, BG_SHELL_LIST)).toEqual([]);
  await expect(access(join(f.root, 'sessions', 'pstack-shells'))).rejects.toThrow(/ENOENT/);
});

shellTest('closing the session kills a running shell process group', async (f, session) => {
  f.calls.push(call('BackgroundShell', { command: 'sleep 30', title: 'sleeper' }));
  await prompt(session, 'start a long sleep');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  expect(groupAlive(shell.pid)).toBe(true);
  await shutdown(session);
  await waitFor(() => !groupAlive(shell.pid), 'the process group to exit');
  expect(() => process.kill(-shell.pid, 0)).toThrow();
  expect(custom(session, 'pstack-shell-exit').length).toBe(0);
});

shellTest('matches during a busy turn coalesce into one wake delivered when the turn ends', async (f, session) => {
  const window: number[] = [];
  session.subscribe((event) => {
    if ((event.type === 'tool_execution_start' || event.type === 'tool_execution_end') && event.toolName === 'bash') window.push(Date.now());
  });
  f.calls.push(call('BackgroundShell', { command: 'while true; do sleep 0.05; echo AGENT_LOOP_TICK_c; done', title: 'fast', notify_on_output: '^AGENT_LOOP_TICK_c' }), call('bash', { command: 'sleep 1' }));
  await prompt(session, 'start the fast ticker and stay busy');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  await waitFor(() => window.length === 2 && custom(session, 'pstack-shell-output').length >= 2, 'the busy turn and a later wake');
  const [start = 0, end = 0] = window;
  const wakes = custom(session, 'pstack-shell-output');
  expect(wakes.filter((message) => message.timestamp >= start && message.timestamp <= end).length).toBe(0);
  expect(wakes[0]?.role === 'custom' && (wakes[0].details as ShellRecord).matches).toBe(1);
  f.calls.push(call(BG_SHELL_STOP, { id: shell.id }));
  await waitFor(() => toolResults(session, BG_SHELL_STOP).length === 1, 'the stop call');
  expect(detailsOf<ShellRecord>(session, BG_SHELL_STOP).matches >= 10).toBe(true);
});

shellTest('a shell stopped in the same busy turn sends no stale wake afterwards', async (f, session) => {
  f.calls.push(call('BackgroundShell', { command: 'while true; do sleep 0.05; echo AGENT_LOOP_TICK_s; done', title: 'stale', notify_on_output: '^AGENT_LOOP_TICK_s' }), call('bash', { command: 'sleep 0.5' }));
  const turn = prompt(session, 'start the ticker, wait, then stop it');
  await waitFor(() => toolResults(session, 'BackgroundShell').length === 1, 'the shell to start');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  await waitFor(() => readFileSync(shell.outputFile, 'utf8').includes('AGENT_LOOP_TICK_s'), 'a match while the parent is busy');
  f.calls.push(call(BG_SHELL_STOP, { id: shell.id }));
  await turn;
  await session.waitForIdle();
  const stopped = detailsOf<ShellRecord>(session, BG_SHELL_STOP);
  expect(stopped.status.kind).toBe('stopped');
  expect(stopped.matches >= 1).toBe(true);
  expect(custom(session, 'pstack-shell-output').length).toBe(0);
});

shellTest('a matching command exiting zero records its status without an extra response', async (f, session) => {
  f.calls.push(call('BackgroundShell', { command: 'echo AGENT_LOOP_TICK_q; sleep 0.1; exit 0', title: 'quiet', notify_on_output: '^AGENT_LOOP_TICK_q' }));
  await prompt(session, 'start quiet shell');
  const _shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  await waitFor(() => !groupAlive(detailsOf<ShellRecord>(session, 'BackgroundShell').pid), 'the quiet shell process to exit');
  await waitFor(() => !session.isStreaming && custom(session, 'pstack-shell-output').length === 1, 'the match wake');
  expect(custom(session, 'pstack-shell-exit').length).toBe(0);
  f.calls.push(call(BG_SHELL_LIST, {}));
  await prompt(session, 'list completed shells');
  const listed = detailsOf<ShellRecord[]>(session, BG_SHELL_LIST);
  expect(listed[0]?.status).toEqual({ kind: 'exited', code: 0, signal: null });
  expect(custom(session, 'pstack-shell-output').length).toBe(1);
  expect(f.requests.length).toBe(5);
});

const heldExitTool = 'HoldUntil' + 'ShellExit';

function heldShellFactory(): ExtensionFactory {
  return (pi) => {
    const runtime = new ShellRuntime(pi);
    pi.registerTool({
      name: 'StartHeldShell',
      label: 'Start held shell',
      description: 'Start a shell and return its record.',
      parameters: Type.Object({ command: Type.String(), title: Type.String(), notify_on_output: Type.String() }),
      execute: async (_id, params, _signal, _update, ctx) => {
        const record = await runtime.start(params, ctx);
        return { content: [{ type: 'text', text: 'started' }], details: record };
      },
    });
    pi.registerTool({
      name: heldExitTool,
      label: 'Wait for held shell exit',
      description: 'Wait until the shell has exited.',
      parameters: Type.Object({}),
      execute: async () => {
        await waitFor(() => runtime.list()[0]?.status.kind === 'exited', 'the held shell to exit');
        return { content: [{ type: 'text', text: 'exited' }], details: runtime.list()[0] };
      },
    });
    pi.on('session_shutdown', () => runtime.stopAll());
  };
}

test('a quiet exit during a held parent turn produces only the match request', async () => {
  const f = await fixture({ extensionOnly: true, extensionFactories: [heldShellFactory()] });
  const { session } = await f.open();
  try {
    const shellCall = call('StartHeldShell', { command: 'echo HELD_MATCH; sleep 0.1', title: 'held', notify_on_output: '^HELD_MATCH$' });
    const waitCall = call(heldExitTool, {});
    f.calls.push([shellCall, waitCall]);
    await prompt(session, 'start and await the shell in one turn');
    const shell = detailsOf<ShellRecord>(session, 'StartHeldShell');
    expect(detailsOf<ShellRecord>(session, heldExitTool).status).toEqual({ kind: 'exited', code: 0, signal: null });
    const classifications = f.requests.flatMap((request) => {
      const body = requestTexts(request).at(-1) ?? '';
      if (body.includes(`Background shell ${shell.id} (held) matched ^HELD_MATCH$`)) return ['match'];
      if (body.includes(`Background shell ${shell.id} (held) exited with`)) return ['exit'];
      return [];
    });
    expect(classifications).toEqual(['match']);
    expect(custom(session, 'pstack-shell-exit').length).toBe(0);
  } finally {
    await shutdown(session);
    await f.close();
  }
});

shellTest('a failed output log write still reports a matched successful exit', async (f, session) => {
  const release = join(f.root, 'release-output');
  f.calls.push(call('BackgroundShell', { command: `while [ ! -e '${release}' ]; do sleep 0.01; done; echo OUTPUT_FAILURE_MATCH`, title: 'write failure', notify_on_output: '^OUTPUT_FAILURE_MATCH$' }));
  await prompt(session, 'start the output failure shell');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  await rm(shell.outputFile);
  await mkdir(shell.outputFile);
  await writeFile(release, 'ready');
  await waitFor(() => custom(session, 'pstack-shell-exit').length === 1 && !session.isStreaming, 'the output write failure exit report');
  const exitMessage = custom(session, 'pstack-shell-exit')[0] as { content: string; details: ShellRecord };
  expect(exitMessage.content).toContain('Output file write failed:');
  expect(exitMessage.content).toContain('EISDIR');
  expect(exitMessage.details.status).toEqual({ kind: 'exited', code: 0, signal: null });
  expect(exitMessage.details.matches).toBe(1);
  await waitFor(() => requestTexts(f.requests.at(-1)).some((body) => body.includes('Output file write failed:')) && !session.isStreaming, 'the write failure model request');
  const classifications = f.requests.flatMap((request) => {
    const body = requestTexts(request).at(-1) ?? '';
    if (body.includes(`Background shell ${shell.id} (write failure) matched ^OUTPUT_FAILURE_MATCH$`)) return ['match'];
    if (body.includes(`Background shell ${shell.id} (write failure) exited with`)) return ['exit'];
    return [];
  });
  expect(classifications).toEqual(['match', 'exit']);
  expect(f.requests.length).toBe(4);
  await rm(shell.outputFile, { recursive: true, force: true });
});

shellTest('readLines delivers un-terminated tail and signal outcome on kill', async (f, session) => {
  f.calls.push(call('BackgroundShell', { command: 'printf "trailing-part"; sleep 0.1; kill -TERM $$', title: 'sig' }));
  await prompt(session, 'start signal shell');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  await waitFor(() => custom(session, 'pstack-shell-exit').length === 1 && !session.isStreaming, 'the signal shell to exit');
  expect(custom(session, 'pstack-shell-exit').length).toBe(1);
  const exitMsg = custom(session, 'pstack-shell-exit')[0] as { details: ShellRecord };
  expect(exitMsg.details.status).toEqual({ kind: 'exited', code: null, signal: 'SIGTERM' });
  expect(await readFile(shell.outputFile, 'utf8')).toBe('trailing-part');
});

test('a descendant that escaped the process group does not block the stop', async () => {
  const { ShellRuntime } = await import('../src/shell-runtime.ts');
  const runtime = new ShellRuntime({ sendMessage: () => {}, on: () => {} } as never);
  const cwd = await mkdtemp(join(tmpdir(), 'pstack-shell-cwd-'));
  const ctx = { cwd, sessionManager: { getSessionFile: () => null }, isIdle: () => true } as never;
  const record = await runtime.start({ command: `perl -MPOSIX -e 'POSIX::setsid(); sleep 300' & sleep 0.3`, title: 'escape' }, ctx);
  let escaped: number | undefined;
  try {
    await vi.waitFor(
      () => {
        escaped = escapedDescendant(record.pid);
        if (escaped === undefined) throw new Error('the descendant has not left the process group yet');
      },
      { timeout: 5000, interval: 50 },
    );
    expect((await runtime.stop(record.id)).status).toEqual({ kind: 'stopped' });
  } finally {
    // Kill the descendant this test started, by pid. A name match would reach every process on the
    // machine that carries the same command line, including a parallel run of this suite.
    if (escaped !== undefined) killByPid(escaped);
    await runtime.stopAll();
    await rm(dirname(record.outputFile), { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
}, 40000);

test('a process group that refuses the signal does not fail the stop', async () => {
  const { ShellRuntime } = await import('../src/shell-runtime.ts');
  const runtime = new ShellRuntime({ sendMessage: () => {}, on: () => {} } as never);
  const cwd = await mkdtemp(join(tmpdir(), 'pstack-shell-cwd-'));
  const ctx = { cwd, sessionManager: { getSessionFile: () => null }, isIdle: () => true } as never;
  const record = await runtime.start({ command: 'sleep 0.6', title: 'unsignallable' }, ctx);
  const realKill = process.kill.bind(process);
  const groupSignal = vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
    if (typeof pid === 'number' && pid < 0) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    return realKill(pid, signal as NodeJS.Signals);
  });
  try {
    expect((await runtime.stop(record.id)).status).toEqual({ kind: 'stopped' });
  } finally {
    groupSignal.mockRestore();
    await runtime.stopAll();
    await rm(dirname(record.outputFile), { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test('ShellRuntime direct unit tests: fallback dir, unknown stop, and delivered', async () => {
  const { ShellRuntime } = await import('../src/shell-runtime.ts');
  const messages: unknown[] = [];
  const pi = { sendMessage: (msg: unknown) => messages.push(msg), on: () => {} } as never;
  const runtime = new ShellRuntime(pi);
  const cwd = await mkdtemp(join(tmpdir(), 'pstack-shell-cwd-'));
  const fakeCtx = {
    cwd,
    sessionManager: { getSessionFile: () => null },
  } as never;
  const record = await runtime.start({ command: 'echo direct-test', title: 'direct' }, fakeCtx);
  const fallbackDir = dirname(record.outputFile);
  try {
    expect(record.title).toBe('direct');
    expect(dirname(fallbackDir)).toBe(tmpdir());
    expect(runtime.list().length).toBe(1);
    runtime.delivered('non-existent');
    runtime.delivered(record.id);
    await expect(runtime.stop('non-existent')).rejects.toThrow(/Unknown background shell/);
  } finally {
    await runtime.stopAll();
    await rm(fallbackDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});
