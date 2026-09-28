import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
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
  const deadline = Date.now() + deadlineMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
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
  assert.ok(result?.role === 'toolResult' && !result.isError, `${name} succeeded`);
  return result.details as T;
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
  assert.equal(shell.outputFile, join(f.root, 'sessions', 'pstack-shells', session.sessionId, `${shell.id}.log`));
  await waitFor(() => custom(session, 'pstack-shell-exit').length === 1 && !session.isStreaming, 'the sleeper to exit');
  const requests = f.requests;
  assert.equal(requests.length, 3);
  const expected = `Background shell ${shell.id} (wake) matched ^AGENT_LOOP_WAKE_t.\nOutput file: ${shell.outputFile}\nLine: ${line}`;
  assert.ok(requestTexts(requests[2]).includes(expected), 'the wake request carries the matching line');
  assert.equal(custom(session, 'pstack-shell-output').length, 1);
  assert.equal(await readFile(shell.outputFile, 'utf8'), `${line}\n`);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(f.requests.length, 3);
});

shellTest('a ticking loop wakes repeatedly and stops without an exit message', async (f, session) => {
  f.calls.push(call('BackgroundShell', { command: 'while true; do sleep 0.1; echo AGENT_LOOP_TICK_t; done', title: 'tick', notify_on_output: '^AGENT_LOOP_TICK_t' }));
  await prompt(session, 'start the ticker');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  await waitFor(() => custom(session, 'pstack-shell-output').length >= 2, 'two wakes');
  f.calls.push(call('BackgroundShellStop', { id: shell.id }));
  await waitFor(() => toolResults(session, 'BackgroundShellStop').length === 1, 'the stop call');
  assert.deepEqual(detailsOf<ShellRecord>(session, 'BackgroundShellStop').status, { kind: 'stopped' });
  await waitFor(() => !groupAlive(shell.pid), 'the process group to exit');
  assert.throws(() => process.kill(-shell.pid, 0), { code: 'ESRCH' });
  await waitFor(() => !session.isStreaming, 'the agent to settle');
  f.calls.push(call('BackgroundShellList', {}));
  await prompt(session, 'list shells');
  const listed = detailsOf<ShellRecord[]>(session, 'BackgroundShellList');
  assert.deepEqual(listed.map(record => [record.id, record.status]), [[shell.id, { kind: 'stopped' }]]);
  assert.equal(custom(session, 'pstack-shell-exit').length, 0);
});

shellTest('a failing command without a pattern wakes once with its exit code', async (f, session) => {
  f.calls.push(call('BackgroundShell', { command: 'false', title: 'fail' }));
  await prompt(session, 'run false');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  await waitFor(() => f.requests.length === 3 && !session.isStreaming, 'the exit wake');
  const expected = `Background shell ${shell.id} (fail) exited with exit code 1.\nOutput file: ${shell.outputFile}`;
  assert.ok(requestTexts(f.requests[2]).includes(expected), 'the wake request names exit code 1');
  assert.equal(custom(session, 'pstack-shell-exit').length, 1);
  assert.deepEqual((custom(session, 'pstack-shell-exit')[0] as { details: ShellRecord }).details.status, { kind: 'exited', code: 1, signal: null });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(f.requests.length, 3);
});

shellTest('invalid patterns and blank commands fail before spawning', async (f, session) => {
  f.calls.push(
    [call('BackgroundShell', { command: 'echo hi', title: 'bad', notify_on_output: '(' }), call('BackgroundShell', { command: '   ', title: 'blank' })],
    call('BackgroundShellList', {}),
  );
  await prompt(session, 'start invalid shells');
  const results = toolResults(session, 'BackgroundShell').map(result => result.role === 'toolResult' ? [result.isError, JSON.stringify(result.content)] : []);
  assert.equal(results.length, 2);
  assert.ok(results.every(([isError]) => isError === true));
  assert.match(String(results[0]?.[1]), /notify_on_output is not a valid regular expression/);
  assert.match(String(results[1]?.[1]), /BackgroundShell command must not be blank/);
  assert.deepEqual(detailsOf<ShellRecord[]>(session, 'BackgroundShellList'), []);
  await assert.rejects(access(join(f.root, 'sessions', 'pstack-shells')), /ENOENT/);
});

shellTest('closing the session kills a running shell process group', async (f, session) => {
  f.calls.push(call('BackgroundShell', { command: 'sleep 30', title: 'sleeper' }));
  await prompt(session, 'start a long sleep');
  const shell = detailsOf<ShellRecord>(session, 'BackgroundShell');
  assert.equal(groupAlive(shell.pid), true);
  await shutdown(session);
  await waitFor(() => !groupAlive(shell.pid), 'the process group to exit');
  assert.throws(() => process.kill(-shell.pid, 0), { code: 'ESRCH' });
  assert.equal(custom(session, 'pstack-shell-exit').length, 0);
});

shellTest('matches during a busy turn coalesce into one queued wake', async (f, session) => {
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
  const during = custom(session, 'pstack-shell-output').filter(message => message.timestamp >= start && message.timestamp <= end);
  assert.equal(during.length, 1);
  f.calls.push(call('BackgroundShellStop', { id: shell.id }));
  await waitFor(() => toolResults(session, 'BackgroundShellStop').length === 1, 'the stop call');
  assert.ok(detailsOf<ShellRecord>(session, 'BackgroundShellStop').matches >= 10);
});

shellTest('a shell stopped in the same busy turn sends no stale wake afterwards', async (f, session) => {
  f.calls.push(
    call('BackgroundShell', { command: 'while true; do sleep 0.05; echo AGENT_LOOP_TICK_s; done', title: 'stale', notify_on_output: '^AGENT_LOOP_TICK_s' }),
    call('bash', { command: 'sleep 0.5' }),
  );
  const turn = prompt(session, 'start the ticker, wait, then stop it');
  await waitFor(() => toolResults(session, 'BackgroundShell').length === 1, 'the shell to start');
  f.calls.push(call('BackgroundShellStop', { id: detailsOf<ShellRecord>(session, 'BackgroundShell').id }));
  await turn;
  await session.waitForIdle();
  assert.equal(detailsOf<ShellRecord>(session, 'BackgroundShellStop').status.kind, 'stopped');
  assert.equal(custom(session, 'pstack-shell-output').length, 0);
});
