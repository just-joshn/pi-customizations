import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    const commands = await reopened.send({ type: 'get_commands' });
    expect(commands.success).toBe(true);
    if (!commands.success || commands.command !== 'get_commands') throw new Error('Expected successful command discovery.');
    expect(JSON.stringify(commands.data)).toContain('poteto-mode');
    const state = await reopened.send({ type: 'get_state' });
    expect(state.success).toBe(true);
    if (!state.success || state.command !== 'get_state') throw new Error('Expected successful state response.');
    expect(state.data).toMatchObject({ isStreaming: false, messageCount: 0 });
    const bad = await reopened.send({ type: 'set_model', provider: 'missing', modelId: 'missing' });
    expect(bad.success).toBe(false);
    if (bad.success) throw new Error('Expected model selection failure.');
    expect(bad.error).toContain('Model not found');
    const simultaneous = await Promise.all([reopened.send({ type: 'get_state' }), handle.send({ type: 'get_commands' })]);
    expect(simultaneous.map((response) => response.command)).toEqual(['get_state', 'get_commands']);
    expect(simultaneous.every((response) => response.success)).toBe(true);
    expect(new Set(simultaneous.map((response) => response.id)).size).toBe(2);
    const output = await reopened.send({ type: 'bash', command: "printf 'detached-output-ok\\n'", excludeFromContext: true });
    if (!output.success || output.command !== 'bash') throw new Error('Expected shell output.');
    expect(output.data).toMatchObject({ output: 'detached-output-ok\n', exitCode: 0, cancelled: false });
    const running = reopened.send({ type: 'bash', command: 'printf ready > rpc-ready; exec sleep 300', excludeFromContext: true });
    await expect.poll(() => readFile(join(directory, 'rpc-ready'), 'utf8').catch(() => ''), { timeout: 5000 }).toBe('ready');
    expect((await handle.send({ type: 'abort_bash' })).success).toBe(true);
    const aborted = await running;
    if (!aborted.success || aborted.command !== 'bash') throw new Error('Expected an aborted shell result.');
    expect(aborted.data.cancelled).toBe(true);
    const stats = await reopened.send({ type: 'get_session_stats' });
    if (!stats.success || stats.command !== 'get_session_stats') throw new Error('Expected session statistics.');
    expect(stats.data.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
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

test('detached RPC startup reports a CLI failure without leaving a ready handle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-detached-invalid-'));
  try {
    await expect(startDetachedRpc({ directory, cwd: directory, agentDir: join(directory, 'agent'), args: ['--not-a-pi-option'] })).rejects.toThrow(/failed|exited/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
