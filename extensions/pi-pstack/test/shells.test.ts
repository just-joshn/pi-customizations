import { readFileSync } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test, vi } from 'vitest';
import type { Context, ToolCall } from '@earendil-works/pi-ai';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { ShellRecord } from '../src/shell-runtime.ts';
import { fixture, prompt, toolResults } from './session-fixture.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
let callCount = 0;

function call(name: string, args: ToolCall['arguments']): ToolCall {
  callCount += 1;
  return { type: 'toolCall', id: `${name}-${callCount}`, name, arguments: args };
}

async function waitFor(predicate: () => boolean, label: string, deadlineMs = 5000): Promise<void> {
  await vi.waitFor(() => {
    if (!predicate()) throw new Error(`Timed out waiting for ${label}`);
  }, { timeout: deadlineMs, interval: 20 });
}

function groupAlive(pid: number): boolean {
  try { process.kill(-pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function custom(session: AgentSession, type: string) {
  return session.messages.filter(message => message.role === 'custom' && message.customType === type);
}

function requestTexts(request: Context | undefined): string[] {
  return (request?.messages ?? []).flatMap(message => {
    if (message.role !== 'user') return [];
    if (typeof message.content === 'string') return [message.content];
    return message.content.flatMap(part => (part.type === 'text' ? [part.text] : []));
  });
}

function detailsOf<T>(session: AgentSession, name: string, index = 0): T {
  const result = toolResults(session, name)[index];
  expect(result?.role === 'toolResult' && !result.isError).toBe(true);
  return result!.details as T;
}

function shutdown(session: AgentSession) {
  return session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
}

function shellTest(name: string, scenario: (f: Fixture, session: AgentSession) => Promise<void>) {
  test(name, async () => {
    const f = await fixture({ extensionOnly: true });
    const { session } = await f.open();
    try { await scenario(f, session); }
    finally {
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
  await waitFor(() => custom(session, 'pstack-shell-exit').length === 1 && !session.isStreaming, 'the sleeper to exit');
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
  f.calls.push(call('BackgroundShellStop', { id: shell.id }));
  await waitFor(() => toolResults(session, 'BackgroundShellStop').length === 1, 'the stop call');
  expect(detailsOf<ShellRecord>(session, 'BackgroundShellStop').status).toEqual({ kind: 'stopped' });
  await waitFor(() => !groupAlive(shell.pid), 'the process group to exit');
  expect(() => process.kill(-shell.pid, 0)).toThrow();
  await waitFor(() => !session.isStreaming, 'the agent to settle');
  f.calls.push(call('BackgroundShellList', {}));
  await prompt(session, 'list shells');
  const listed = detailsOf<ShellRecord[]>(session, 'BackgroundShellList');
  expect(listed.map(record => [record.id, record.status])).toEqual([[shell.id, { kind: 'stopped' }]]);
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
  f.calls.push(
    [call('BackgroundShell', { command: 'echo hi', title: 'bad', notify_on_output: '(' }), call('BackgroundShell', { command: '   ', title: 'blank' })],
    call('BackgroundShellList', {}),
  );
  await prompt(session, 'start invalid shells');
  const results = toolResults(session, 'BackgroundShell').map(result => result.role === 'toolResult' ? [result.isError, JSON.stringify(result.content)] : []);
  expect(results.length).toBe(2);
  expect(results.every(([isError]) => isError === true)).toBe(true);
  expect(String(results[0]?.[1])).toMatch(/notify_on_output is not a valid regular expression/);
  expect(String(results[1]?.[1])).toMatch(/BackgroundShell command must not be blank/);
  expect(detailsOf<ShellRecord[]>(session, 'BackgroundShellList')).toEqual([]);
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
  session.subscribe(event => {
    if ((event.type === 'tool_execution_start' || event.type === 'tool_execution_end') && event.toolName === 'bash') window.push(Date.now());
  });
  f.calls.push(
    call('BackgroundShell', { command: 'while true; do sleep 0.05; echo AGENT_LOOP_TICK_c; done', title: 'fast', notify_on_output: '^AGENT_LOOP_TICK_c' }),
    call('bash', { command: 'sleep 1' }),
  );
  await prompt(session, 'start the fast ticker and stay busy');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  await waitFor(() => window.length === 2 && custom(session, 'pstack-shell-output').length >= 2, 'the busy turn and a later wake');
  const [start = 0, end = 0] = window;
  const wakes = custom(session, 'pstack-shell-output');
  expect(wakes.filter(message => message.timestamp >= start && message.timestamp <= end).length).toBe(0);
  expect((wakes[0]?.role === 'custom' && (wakes[0].details as ShellRecord).matches)).toBe(1);
  f.calls.push(call('BackgroundShellStop', { id: shell.id }));
  await waitFor(() => toolResults(session, 'BackgroundShellStop').length === 1, 'the stop call');
  expect(detailsOf<ShellRecord>(session, 'BackgroundShellStop').matches >= 10).toBe(true);
});

shellTest('a shell stopped in the same busy turn sends no stale wake afterwards', async (f, session) => {
  f.calls.push(
    call('BackgroundShell', { command: 'while true; do sleep 0.05; echo AGENT_LOOP_TICK_s; done', title: 'stale', notify_on_output: '^AGENT_LOOP_TICK_s' }),
    call('bash', { command: 'sleep 0.5' }),
  );
  const turn = prompt(session, 'start the ticker, wait, then stop it');
  await waitFor(() => toolResults(session, 'BackgroundShell').length === 1, 'the shell to start');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  await waitFor(() => readFileSync(shell.outputFile, 'utf8').includes('AGENT_LOOP_TICK_s'), 'a match while the parent is busy');
  f.calls.push(call('BackgroundShellStop', { id: shell.id }));
  await turn;
  await session.waitForIdle();
  const stopped = detailsOf<ShellRecord>(session, 'BackgroundShellStop');
  expect(stopped.status.kind).toBe('stopped');
  expect(stopped.matches >= 1).toBe(true);
  expect(custom(session, 'pstack-shell-output').length).toBe(0);
});

shellTest('a matching command exiting zero produces a quiet followUp message instead of a wake', async (f, session) => {
  f.calls.push(
    call('BackgroundShell', { command: 'echo AGENT_LOOP_TICK_q; sleep 0.1; exit 0', title: 'quiet', notify_on_output: '^AGENT_LOOP_TICK_q' }),
  );
  await prompt(session, 'start quiet shell');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  await waitFor(() => custom(session, 'pstack-shell-exit').length === 1 && !session.isStreaming, 'the quiet shell to exit');
  expect(custom(session, 'pstack-shell-exit').length).toBe(1);
  const exitMsg = custom(session, 'pstack-shell-exit')[0] as { details: ShellRecord };
  expect(exitMsg.details.status).toEqual({ kind: 'exited', code: 0, signal: null });
  expect(custom(session, 'pstack-shell-output').length).toBe(1);
  await session.waitForIdle();
  // The initial turn costs two requests and the match wake costs one; a quiet exit adds no turn.
  expect(f.requests.length).toBe(3);
});

shellTest('readLines delivers un-terminated tail and signal outcome on kill', async (f, session) => {
  f.calls.push(
    call('BackgroundShell', { command: 'printf "trailing-part"; sleep 0.1; kill -TERM $$', title: 'sig' }),
  );
  await prompt(session, 'start signal shell');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  await waitFor(() => custom(session, 'pstack-shell-exit').length === 1 && !session.isStreaming, 'the signal shell to exit');
  expect(custom(session, 'pstack-shell-exit').length).toBe(1);
  const exitMsg = custom(session, 'pstack-shell-exit')[0] as { details: ShellRecord };
  expect(exitMsg.details.status).toEqual({ kind: 'exited', code: null, signal: 'SIGTERM' });
  expect(await readFile(shell.outputFile, 'utf8')).toBe('trailing-part');
});

test('ShellRuntime direct unit tests: fallback dir, unknown stop, and delivered', async () => {
  const { ShellRuntime } = await import('../src/shell-runtime.ts');
  const messages: unknown[] = [];
  const pi = { sendMessage: (msg: unknown) => messages.push(msg), on: () => {} } as any;
  const runtime = new ShellRuntime(pi);
  const cwd = await mkdtemp(join(tmpdir(), 'pstack-shell-cwd-'));
  const fakeCtx = {
    cwd,
    sessionManager: { getSessionFile: () => null },
  } as any;
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
