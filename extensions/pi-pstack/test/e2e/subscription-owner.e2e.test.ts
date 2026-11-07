import { once } from 'node:events';
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
  pending: { subscriptionId: string; deliveredTo?: string }[];
} {
  return JSON.parse(readFileSync(registryPath(sandbox), 'utf8'));
}

test('a detached webhook routine runs with no owner chat and records its outcome', async ({ onTestFinished }) => {
  const sandbox = makeSandbox({ defaultProvider: 'scripted', defaultModel: 'echo' });
  const owner = startRpc(sandbox);
  onTestFinished(() => dispose(sandbox, [owner]));
  const marker = join(sandbox.workDir, 'detached-routine-result');
  owner.send({
    type: 'prompt',
    message: script([{ tool: 'subscribe_webhook', args: { name: 'Detached Bot', prompt: script([{ tool: 'write', args: { path: marker, content: 'DETACHED-ROUTINE-RESULT' } }]), sessionStrategy: 'new_session' } }]),
  });
  await owner.waitFor((event) => event.type === 'agent_settled');
  const created = toolEnds(owner.events, 'subscribe_webhook')[0];
  expect(created?.isError).toBe(false);
  const url = (created?.details as { url?: string } | undefined)?.url ?? '';
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/routines\/detached-bot$/);
  const key = (JSON.parse(readFileSync(join(sandbox.agentDir, 'pstack/routines/detached-bot/credentials.json'), 'utf8')) as { key: string }).key;
  await owner.close();
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-automation-key': key }, body: '{"action":"go"}' });
  expect(response.status).toBe(200);
  // Pi's write tool creates the file before it writes the content, so poll the content, not the file's existence.
  await expect.poll(() => ({ content: existsSync(marker) ? readFileSync(marker, 'utf8') : undefined, error: registry(sandbox).subscriptions[0]?.lastError?.text }), { timeout: 20_000 }).toMatchObject({ content: 'DETACHED-ROUTINE-RESULT' });
  await expect.poll(() => registry(sandbox).subscriptions[0]?.lastOutcome?.text, { timeout: 10_000 }).toMatch(/^RESULTS:\n\[write\] /);
});

test('two workspaces each serve their routines, falling back off a busy default port', async ({ onTestFinished }) => {
  const sandboxes = [makeSandbox(), makeSandbox()];
  const owners = sandboxes.map((sandbox) => startRpc(sandbox));
  onTestFinished(async () => {
    for (const [index, sandbox] of sandboxes.entries()) await dispose(sandbox, [owners[index] as ReturnType<typeof startRpc>]);
  });
  const created: { url: string; key: string }[] = [];
  for (const [index, owner] of owners.entries()) {
    owner.send({ type: 'prompt', message: script([{ tool: 'subscribe_webhook', args: { name: `Workspace ${index}`, prompt: `WORKSPACE-${index}-WAKE` } }]) });
    await owner.waitFor((event) => event.type === 'agent_settled');
    const result = toolEnds(owner.events, 'subscribe_webhook')[0];
    expect(result?.isError).toBe(false);
    const url = (result?.details as { url?: string } | undefined)?.url ?? '';
    const slug = `workspace-${index}`;
    const key = (JSON.parse(readFileSync(join(sandboxes[index]?.agentDir ?? '', `pstack/routines/${slug}/credentials.json`), 'utf8')) as { key: string }).key;
    created.push({ url, key });
  }
  const ports = created.map((item) => Number(new URL(item.url).port));
  expect(new Set(ports).size).toBe(2);
  for (const [index, item] of created.entries()) {
    const response = await fetch(item.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-automation-key': item.key }, body: '{}' });
    expect(response.status).toBe(200);
    const wake = await owners[index]?.waitFor((event) => {
      const message = event['message'] as { customType?: string } | undefined;
      return event.type === 'message_end' && message?.customType === 'pstack/subscription';
    }, 8_000);
    if (wake === undefined) throw new Error(`workspace ${index} received no routine wake`);
    expect(contentText((wake['message'] as { content: string }).content)).toContain(`WORKSPACE-${index}-WAKE`);
  }
});

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
          return state.subscriptions[0]?.lifecycle === 'completed' && state.pending[0]?.deliveredTo !== undefined;
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
  await expect.poll(() => registry(sandbox).pending, { timeout: 5_000 }).toEqual([]);
});

test('an accepted wake survives an owner crash before notification persistence', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const owner = startRpc(sandbox);
  const resumedSessions: ReturnType<typeof startRpc>[] = [];
  const release = join(sandbox.workDir, 'release-crashed-owner');
  const started = join(sandbox.workDir, 'crashed-tool-started');
  const finished = join(sandbox.workDir, 'crashed-tool-finished');
  onTestFinished(async () => {
    writeFileSync(release, 'continue');
    if (owner.child.exitCode === null && owner.child.signalCode === null) await owner.close();
    if (existsSync(started)) await expect.poll(() => existsSync(finished), { timeout: 5_000 }).toBe(true);
    await dispose(sandbox, resumedSessions);
  });
  owner.send({ type: 'prompt', message: script([{ tool: 'subscribe_timer', args: { name: 'crash-owner', prompt: 'CRASH-RECOVERED-WAKE', delaySeconds: 2, once: true } }]) });
  await owner.waitFor((event) => event.type === 'agent_settled');
  expect(toolEnds(owner.events, 'subscribe_timer')[0]?.isError).toBe(false);
  const file = registry(sandbox).subscriptions[0]?.ownerSessionFile;
  expect(file).toEqual(expect.any(String));
  const mark = owner.events.length;
  owner.send({ type: 'prompt', message: script([{ tool: 'bash', args: { command: `printf STARTED > '${started}'; while [ ! -f '${release}' ]; do sleep 0.01; done; printf DONE > '${finished}'; printf RELEASED` } }]) });
  await owner.waitFor((event) => event.type === 'tool_execution_start' && event['toolName'] === 'bash' && owner.events.indexOf(event) >= mark);
  await expect.poll(() => registry(sandbox).subscriptions[0]?.lifecycle, { timeout: 6_000 }).toBe('completed');
  expect(owner.events.slice(mark).filter((event) => event.type === 'message_end' && (event['message'] as { customType?: string } | undefined)?.customType === 'pstack/subscription')).toEqual([]);
  const closed = once(owner.child, 'close');
  owner.child.kill('SIGKILL');
  await closed;
  writeFileSync(release, 'continue');

  const resumed = startRpc(sandbox, ['--session', String(file)]);
  resumedSessions.push(resumed);
  const wake = await resumed.waitFor((event) => event.type === 'message_end' && (event['message'] as { customType?: string } | undefined)?.customType === 'pstack/subscription', 8_000);
  expect(contentText((wake['message'] as { content: string }).content)).toContain('CRASH-RECOVERED-WAKE');
  await resumed.waitFor((event) => event.type === 'agent_settled');
  await expect.poll(() => registry(sandbox).pending.length, { timeout: 5_000 }).toBe(0);
  await resumed.close();

  const reopened = startRpc(sandbox, ['--session', String(file)]);
  resumedSessions.push(reopened);
  reopened.send({ type: 'prompt', message: 'go\n@@say NOTHING-PENDING' });
  await reopened.waitFor((event) => event.type === 'agent_settled');
  expect(reopened.events.filter((event) => event.type === 'message_end' && (event['message'] as { customType?: string } | undefined)?.customType === 'pstack/subscription')).toEqual([]);
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
  // The write tool can create the file before its content lands, so the poll waits for the content.
  await expect.poll(() => ({ content: existsSync(marker) ? readFileSync(marker, 'utf8') : undefined, error: registry(sandbox).subscriptions[0]?.lastError?.text }), { timeout: 20_000 }).toMatchObject({ content: 'DETACHED-FRESH-RESULT' });
  // A detached run records its own final message, which is the run output an automation reports status in.
  await expect.poll(() => registry(sandbox).subscriptions[0]?.lastOutcome?.text, { timeout: 10_000 }).toMatch(/^RESULTS:\n\[write\] /);
});

test('creating a webhook routine waits for the user to confirm, and a refusal creates nothing (G4, G14)', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const owner = startRpc(sandbox, [], false);
  onTestFinished(() => dispose(sandbox, [owner]));
  owner.send({ type: 'prompt', message: script([{ tool: 'subscribe_webhook', args: { name: 'Refused Bot', prompt: 'act' } }]) });
  await owner.waitFor((event) => event.type === 'agent_settled');
  const asked = owner.events.find((event) => event.type === 'extension_ui_request' && event['method'] === 'confirm');
  expect(asked?.['title']).toBe('Create webhook routine "Refused Bot"?');
  const result = toolEnds(owner.events, 'subscribe_webhook')[0];
  expect([result?.isError, result?.text]).toEqual([true, 'The user declined to create the webhook routine "Refused Bot". Nothing was created.']);
  expect(existsSync(registryPath(sandbox)) ? registry(sandbox).subscriptions : []).toEqual([]);
});
