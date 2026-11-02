import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { workspaceSlug } from '../../src/paths.ts';
import { contentText, makeSandbox, script, startRpc, toolEnds } from './harness.ts';

test('a detached timer wakes its idle owning Pi session', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const rpc = startRpc(sandbox);
  onTestFinished(async () => {
    await rpc.close();
    const lock = join(sandbox.agentDir, 'pstack/durable', workspaceSlug(sandbox.workDir), 'runtime/supervisor.lock');
    if (existsSync(lock)) {
      const { pid } = JSON.parse(readFileSync(lock, 'utf8'));
      try {
        process.kill(pid, 'SIGTERM');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
      await expect.poll(() => existsSync(lock), { timeout: 5_000 }).toBe(false);
    }
    sandbox.dispose();
  });
  rpc.send({
    id: 'create-owner-timer',
    type: 'prompt',
    message: script([{ tool: 'subscribe_timer', args: { name: 'owner-wake', prompt: 'OWNER-WAKE-MARKER', delaySeconds: 1, once: true } }]),
  });
  await rpc.waitFor((event) => event.type === 'agent_settled');
  expect(toolEnds(rpc.events, 'subscribe_timer').map((result) => result.isError)).toEqual([false]);
  const wake = await rpc.waitFor((event) => {
    const message = event['message'] as { customType?: string } | undefined;
    return event.type === 'message_end' && message?.customType === 'pstack/subscription';
  }, 8_000);
  const message = wake['message'] as { content: string; details: { kind: string; name: string } };
  expect(contentText(message.content)).toContain('OWNER-WAKE-MARKER');
  expect(message.details).toMatchObject({ kind: 'timer', name: 'owner-wake' });
  await rpc.waitFor((event) => event.type === 'agent_settled' && rpc.events.indexOf(event) > rpc.events.indexOf(wake));
});

function registryPath(sandbox: ReturnType<typeof makeSandbox>): string {
  return join(sandbox.agentDir, 'pstack/durable', workspaceSlug(sandbox.workDir), 'subscriptions.json');
}

function registry(sandbox: ReturnType<typeof makeSandbox>): {
  subscriptions: { id: string; lifecycle: string; ownerSessionFile?: string; lastError?: { text: string }; lastOutcome?: { text: string } }[];
  pending: { subscriptionId: string }[];
} {
  return JSON.parse(readFileSync(registryPath(sandbox), 'utf8'));
}

async function dispose(sandbox: ReturnType<typeof makeSandbox>, sessions: ReturnType<typeof startRpc>[]): Promise<void> {
  await Promise.all(sessions.map((session) => session.close()));
  const lock = join(sandbox.agentDir, 'pstack/durable', workspaceSlug(sandbox.workDir), 'runtime/supervisor.lock');
  if (existsSync(lock)) {
    const { pid } = JSON.parse(readFileSync(lock, 'utf8'));
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    await expect.poll(() => existsSync(lock), { timeout: 5_000 }).toBe(false);
  }
  sandbox.dispose();
}

test('offline wake backlog waits for the exact saved owner rather than a workspace peer', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const owner = startRpc(sandbox);
  const sessions = [owner];
  onTestFinished(() => dispose(sandbox, sessions));
  owner.send({ type: 'prompt', message: script([{ tool: 'subscribe_timer', args: { name: 'offline-owner', prompt: 'EXACT-OWNER-BACKLOG', delaySeconds: 2, once: true } }]) });
  await owner.waitFor((event) => event.type === 'agent_settled');
  expect(toolEnds(owner.events, 'subscribe_timer')[0]?.isError).toBe(false);
  const file = registry(sandbox).subscriptions[0]?.ownerSessionFile;
  expect(file).toEqual(expect.any(String));
  await owner.close();
  await expect.poll(() => registry(sandbox).pending.length, { timeout: 6_000 }).toBe(1);

  const peer = startRpc(sandbox);
  sessions.push(peer);
  peer.send({ type: 'prompt', message: script([{ tool: 'list_subscriptions', args: {} }]) });
  await peer.waitFor((event) => event.type === 'agent_settled');
  expect(toolEnds(peer.events, 'list_subscriptions')[0]?.text).toContain('delivery: pending');
  expect(peer.events.filter((event) => (event['message'] as { customType?: string } | undefined)?.customType === 'pstack/subscription')).toEqual([]);
  expect(registry(sandbox).pending).toHaveLength(1);

  const resumed = startRpc(sandbox, ['--session', String(file)]);
  sessions.push(resumed);
  const wake = await resumed.waitFor((event) => event.type === 'message_end' && (event['message'] as { customType?: string } | undefined)?.customType === 'pstack/subscription');
  expect(contentText((wake['message'] as { content: string }).content)).toContain('EXACT-OWNER-BACKLOG');
  await expect.poll(() => registry(sandbox).pending.length, { timeout: 5_000 }).toBe(0);
});

test('a busy owner receives its native follow-up after the current tool finishes', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const owner = startRpc(sandbox);
  onTestFinished(() => dispose(sandbox, [owner]));
  const release = join(sandbox.workDir, 'release-busy');
  owner.send({ type: 'prompt', message: script([{ tool: 'subscribe_timer', args: { name: 'busy-owner', prompt: 'BUSY-OWNER-WAKE', delaySeconds: 2, once: true } }]) });
  await owner.waitFor((event) => event.type === 'agent_settled');
  const mark = owner.events.length;
  owner.send({ type: 'prompt', message: script([{ tool: 'bash', args: { command: `while [ ! -f '${release}' ]; do sleep 0.01; done; printf BUSY-DONE` } }]) });
  await owner.waitFor((event) => event.type === 'tool_execution_start' && event['toolName'] === 'bash' && owner.events.indexOf(event) >= mark);
  try {
    await expect
      .poll(
        () => {
          const state = registry(sandbox);
          return state.subscriptions[0]?.lifecycle === 'completed' && state.pending.length === 0;
        },
        { timeout: 6_000 },
      )
      .toBe(true);
    expect(owner.events.slice(mark).filter((event) => event.type === 'message_end' && (event['message'] as { customType?: string } | undefined)?.customType === 'pstack/subscription')).toEqual([]);
  } finally {
    writeFileSync(release, 'continue');
  }
  const wake = await owner.waitFor((event) => event.type === 'message_end' && (event['message'] as { customType?: string } | undefined)?.customType === 'pstack/subscription');
  const completed = owner.events.findIndex((event) => event.type === 'tool_execution_end' && event['toolName'] === 'bash');
  expect(completed).toBeGreaterThan(-1);
  expect(owner.events.indexOf(wake)).toBeGreaterThan(completed);
  expect(contentText((wake['message'] as { content: string }).content)).toContain('BUSY-OWNER-WAKE');
});

test('a live fresh timer keeps the Task completion notification path', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const owner = startRpc(sandbox);
  onTestFinished(() => dispose(sandbox, [owner]));
  owner.send({ type: 'prompt', message: script([{ tool: 'subscribe_timer', args: { name: 'live-fresh', prompt: 'go\n@@say FRESH-TASK-RESULT', delaySeconds: 1, once: true, sessionStrategy: 'new_session' } }]) });
  await owner.waitFor((event) => event.type === 'agent_settled');
  expect(toolEnds(owner.events, 'subscribe_timer')[0]?.isError).toBe(false);
  const notice = await owner.waitFor((event) => event.type === 'message_end' && (event['message'] as { customType?: string } | undefined)?.customType === 'pstack/task', 12_000);
  expect(contentText((notice['message'] as { content: string }).content)).toContain('FRESH-TASK-RESULT');
  expect(registry(sandbox).subscriptions[0]?.lastOutcome?.text).toBe('live Task callback accepted');
  expect(owner.events.filter((event) => (event['message'] as { customType?: string } | undefined)?.customType === 'pstack/subscription')).toEqual([]);
});

test('an explicit offline fresh timer uses the detached runner and records its outcome', async ({ onTestFinished }) => {
  const sandbox = makeSandbox({ defaultProvider: 'scripted', defaultModel: 'echo' });
  const owner = startRpc(sandbox);
  onTestFinished(() => dispose(sandbox, [owner]));
  const marker = join(sandbox.workDir, 'offline-fresh-result');
  owner.send({
    type: 'prompt',
    message: script([{ tool: 'subscribe_timer', args: { name: 'offline-fresh', prompt: script([{ tool: 'write', args: { path: marker, content: 'DETACHED-FRESH-RESULT' } }]), delaySeconds: 2, once: true, sessionStrategy: 'new_session' } }]),
  });
  await owner.waitFor((event) => event.type === 'agent_settled');
  expect(toolEnds(owner.events, 'subscribe_timer')[0]?.isError).toBe(false);
  await owner.close();
  await expect.poll(() => ({ exists: existsSync(marker), error: registry(sandbox).subscriptions[0]?.lastError?.text }), { timeout: 10_000 }).toMatchObject({ exists: true });
  expect(readFileSync(marker, 'utf8')).toBe('DETACHED-FRESH-RESULT');
  await expect.poll(() => registry(sandbox).subscriptions[0]?.lastOutcome?.text, { timeout: 5_000 }).toBe('detached run completed');
});
