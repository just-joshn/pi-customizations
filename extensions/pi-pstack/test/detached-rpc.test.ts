import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { expect, test } from 'vitest';
import { openDetachedRpc, startDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { packageRoot } from './session-fixture.ts';

test('a detached Pi RPC process accepts control from a reopened handle without model calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-detached-test-'));
  let handle: Awaited<ReturnType<typeof startDetachedRpc>> | undefined;
  try {
    const launched = execFileSync(process.execPath, [join(packageRoot, 'test/detached-rpc-fixture.mjs'), directory, packageRoot], { encoding: 'utf8', timeout: 20000 }).trim();
    expect(launched.startsWith(directory)).toBe(true);
    handle = openDetachedRpc(launched);
    const reopened = openDetachedRpc(handle.directory);
    expect(await reopened.activity()).toEqual({ kind: 'idle' });
    const commands = await reopened.send({ type: 'get_commands' });
    if (!commands.success || commands.command !== 'get_commands') throw new Error('Expected successful command discovery.');
    expect(JSON.stringify(commands.data)).toContain('poteto-mode');
    const state = await reopened.send({ type: 'get_state' });
    if (!state.success || state.command !== 'get_state') throw new Error('Expected successful state response.');
    expect(state.data).toMatchObject({ isStreaming: false, messageCount: 0 });
    const bad = await reopened.send({ type: 'set_model', provider: 'missing', modelId: 'missing' });
    if (bad.success) throw new Error('Expected model selection failure.');
    expect(bad.error).toContain('Model not found');
    const simultaneous = await Promise.all([reopened.send({ type: 'get_state' }), handle.send({ type: 'get_commands' })]);
    expect(simultaneous.map(({ command, success }) => ({ command, success }))).toEqual([{ command: 'get_state', success: true }, { command: 'get_commands', success: true }]);
    expect(new Set(simultaneous.map((response) => response.id)).size).toBe(2);
    const output = await reopened.send({ type: 'bash', command: "printf 'detached-output-ok\\n'", excludeFromContext: true });
    expect(output).toMatchObject({ success: true, command: 'bash', data: { output: 'detached-output-ok\n', exitCode: 0, cancelled: false } });
    const running = reopened.send({ type: 'bash', command: 'printf ready > rpc-ready; exec sleep 300', excludeFromContext: true });
    await expect.poll(() => readFile(join(directory, 'rpc-ready'), 'utf8').catch(() => ''), { timeout: 5000 }).toBe('ready');
    expect((await handle.send({ type: 'abort_bash' })).success).toBe(true);
    const aborted = await running;
    expect(aborted).toMatchObject({ success: true, command: 'bash', data: { cancelled: true } });
    const stats = await reopened.send({ type: 'get_session_stats' });
    expect(stats).toMatchObject({ success: true, command: 'get_session_stats', data: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    expect(await reopened.activity()).toEqual({ kind: 'idle' });
    const handled = await reopened.send({ type: 'prompt', message: '/pstack' });
    expect(handled).toMatchObject({ success: true, command: 'prompt', data: { disposition: 'handled' } });
    expect(await reopened.activity()).toEqual({ kind: 'settled', invocation: handled.id });
    expect((await reopened.send({ type: 'clear_queue' })).success).toBe(true);
    expect((await reopened.send({ type: 'abort' })).success).toBe(true);
    await Promise.all([handle.close(), reopened.close()]);
    expect(await reopened.status()).toBe('exited');
    await reopened.close();
    await expect(reopened.send({ type: 'get_state' })).rejects.toThrow('exited');
  } finally {
    await handle?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test('final settlement survives goal continuation in a scripted main-session fixture without Task calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-detached-goal-'));
  let handle: Awaited<ReturnType<typeof startDetachedRpc>> | undefined;
  try {
    handle = await startDetachedRpc({
      directory,
      cwd: directory,
      agentDir: join(directory, 'agent'),
      args: ['--no-session', '--no-extensions', '-e', packageRoot, '-e', join(packageRoot, 'test/journey-provider.ts'), '--provider', 'journey-test', '--model', 'recorder'],
    });
    const accepted = await handle.send({ type: 'prompt', message: 'JOURNEY:goalcontinue' });
    expect(accepted.success).toBe(true);
    const reopened = openDetachedRpc(handle.directory);
    await expect.poll(() => reopened.activity(), { timeout: 5000 }).toEqual({ kind: 'settled', invocation: accepted.id });
    const messages = await reopened.send({ type: 'get_messages' });
    if (!messages.success || messages.command !== 'get_messages') throw new Error('Expected completed goal messages.');
    expect(messages.data.messages.filter((message) => message.role === 'toolResult').map((message) => message.toolName)).toEqual(['CreateGoal', 'UpdateGoal']);
    const stats = await reopened.send({ type: 'get_session_stats' });
    if (!stats.success || stats.command !== 'get_session_stats') throw new Error('Expected fixture statistics.');
    expect(stats.data.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
  } finally {
    await handle?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test('RPC goal delivery waits for its independent active turn to settle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-detached-held-'));
  const agentDir = join(directory, 'agent');
  let handle: Awaited<ReturnType<typeof startDetachedRpc>> | undefined;
  try {
    handle = await startDetachedRpc({
      directory,
      cwd: directory,
      agentDir,
      args: ['--no-session', '--no-extensions', '-e', packageRoot, '-e', join(packageRoot, 'test/held-journey-provider.ts'), '--provider', 'journey-test', '--model', 'recorder'],
    });
    const submitted = handle.send({ type: 'prompt', message: '/goal Prove automatic goal continuation' });
    await expect.poll(async () => {
      const state = await handle!.send({ type: 'get_state' });
      return state.success && state.command === 'get_state' && state.data.isStreaming;
    }, { timeout: 5000 }).toBe(true);
    expect((await handle.activity()).kind).toBe('running');
    await writeFile(join(agentDir, 'release-scripted-reply'), 'release');
    const handled = await submitted;
    expect(handled.success).toBe(true);
    const reopened = openDetachedRpc(handle.directory);
    await expect.poll(() => reopened.activity(), { timeout: 5000 }).toEqual({ kind: 'settled', invocation: handled.id });
    const messages = await reopened.send({ type: 'get_messages' });
    if (!messages.success || messages.command !== 'get_messages') throw new Error('Expected finished goal messages.');
    expect(messages.data.messages.filter((message) => message.role === 'toolResult')).toEqual([]);
    const last = messages.data.messages.findLast((message) => message.role === 'assistant');
    expect(last?.content.find((block) => block.type === 'text')?.text).toContain('recorded <skill name="goal"');
  } finally {
    await handle?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test('headless delivery waits for settlement and leaves a snapshot after automatic shutdown', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-detached-snapshot-'));
  const agentDir = join(directory, 'agent');
  let handle: Awaited<ReturnType<typeof startDetachedRpc>> | undefined;
  try {
    handle = await startDetachedRpc({
      directory,
      cwd: directory,
      agentDir,
      headless: true,
      closeAfterSettle: true,
      args: ['--no-session', '--no-extensions', '-e', packageRoot, '-e', join(packageRoot, 'test/held-journey-provider.ts'), '--provider', 'journey-test', '--model', 'recorder'],
    });
    const submitted = handle.send({ type: 'prompt', message: '/goal Prove automatic goal continuation' });
    const reopened = openDetachedRpc(handle.directory);
    await expect
      .poll(
        async () => {
          const response = await reopened.send({ type: 'get_state' });
          return response.success && response.command === 'get_state' && response.data.isStreaming;
        },
        { timeout: 5000 },
      )
      .toBe(true);
    const early = await Promise.race([submitted.then(() => true), reopened.send({ type: 'get_state' }).then(() => false)]);
    expect(early).toBe(false);
    await writeFile(join(agentDir, 'release-scripted-reply'), 'release');
    const completed = await submitted;
    expect(completed.success).toBe(true);
    await expect.poll(() => reopened.status(), { timeout: 5000 }).toBe('exited');
    const snapshot = await reopened.snapshot();
    expect(snapshot?.invocation).toBe(completed.id);
    expect(JSON.stringify(snapshot?.entries)).toContain('recorded <skill name=');
    expect(snapshot?.error).toBeUndefined();
    await expect(reopened.send({ type: 'get_state' })).rejects.toThrow('exited');
  } finally {
    await handle?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test('headless dialogs are cancelled rather than implicitly approved', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-detached-dialog-'));
  let handle: Awaited<ReturnType<typeof startDetachedRpc>> | undefined;
  try {
    handle = await startDetachedRpc({
      directory,
      cwd: directory,
      agentDir: join(directory, 'agent'),
      headless: true,
      closeAfterSettle: true,
      args: ['--no-session', '--no-extensions', '-e', packageRoot, '-e', join(packageRoot, 'test/detached-dialog.ts')],
    });
    const response = await handle.send({ type: 'prompt', message: '/detached-confirm-fixture' });
    expect(response.success).toBe(true);
    const reopened = openDetachedRpc(handle.directory);
    await expect.poll(() => reopened.status(), { timeout: 5000 }).toBe('exited');
    const snapshot = await reopened.snapshot();
    expect(JSON.stringify(snapshot?.entries)).toContain('"approved":false');
    expect(JSON.stringify(snapshot?.entries)).toContain('denied');
  } finally {
    await handle?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test('a completed snapshot remains readable after the coordinator, supervisor, and Pi process exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-detached-orphan-'));
  let handle: Awaited<ReturnType<typeof startDetachedRpc>> | undefined;
  try {
    const raw: unknown = JSON.parse(execFileSync(process.execPath, [join(packageRoot, 'test/detached-rpc-fixture.mjs'), directory, packageRoot, 'snapshot'], { encoding: 'utf8', timeout: 20000 }));
    const identity = Type.Object({ directory: Type.String(), coordinatorPid: Type.Integer({ minimum: 1 }), supervisorPid: Type.Integer({ minimum: 1 }), piPid: Type.Integer({ minimum: 1 }) });
    if (!Check(identity, raw)) throw new Error('Invalid fixture process identity.');
    handle = openDetachedRpc(raw.directory);
    await expect.poll(() => handle?.status(), { timeout: 5000 }).toBe('exited');
    for (const pid of [raw.coordinatorPid, raw.supervisorPid, raw.piPid]) {
      await expect
        .poll(
          () => {
            try {
              process.kill(pid, 0);
              return true;
            } catch (error) {
              if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') return false;
              throw error;
            }
          },
          { timeout: 5000 },
        )
        .toBe(false);
    }
    const snapshot = await handle.snapshot();
    expect(JSON.stringify(snapshot?.entries)).toContain('UpdateGoal');
    expect(snapshot?.error).toBeUndefined();
    if (process.env.PSTACK_EVIDENCE_DIRECTORY) {
      const evidence = join(process.env.PSTACK_EVIDENCE_DIRECTORY, 'durable-snapshot');
      await mkdir(evidence, { recursive: true });
      await cp(handle.directory, evidence, { recursive: true });
      await writeFile(join(evidence, 'identity.json'), JSON.stringify(raw, null, 2));
    }
  } finally {
    await handle?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test('detached RPC startup reports a CLI failure without leaving a ready handle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-detached-invalid-'));
  try {
    await expect(startDetachedRpc({ directory, cwd: directory, agentDir: join(directory, 'agent'), args: ['--not-a-pi-option'] })).rejects.toThrow(/failed|exited/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
