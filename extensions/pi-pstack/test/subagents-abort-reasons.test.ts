import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AgentSession } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { abortInfo } from '../src/subagents/abort-reasons.ts';
import { workerFixture } from './worker-fixture.ts';

test('[G5-06] child-owned ctx.abort becomes a native tool error without aborting the parent', async () => {
  const fixture = await workerFixture();
  try {
    await fixture.session.prompt('SPAWN_SELF_ABORT');
    const result = fixture.session.messages.find((message) => message.role === 'toolResult' && message.toolName === 'Agent');
    expect(result).toMatchObject({ role: 'toolResult', isError: true });
    const last = fixture.session.messages.findLast((message) => message.role === 'assistant');
    expect(last).toMatchObject({ stopReason: 'stop' });
    expect(fixture.session.isStreaming).toBe(false);
  } finally {
    await fixture.close();
  }
});

test('[G5-06] native AbortError DOMException is unwrapped but ordinary errors are not', () => {
  expect(abortInfo(new DOMException('interrupt', 'AbortError'), false)).toEqual({ reason: 'interrupt', telemetry: 'interrupt', userInitiated: true });
  expect(abortInfo(new Error('interrupt'), false)).toEqual({ reason: 'unknown', telemetry: 'turn_teardown', userInitiated: false });
  expect(abortInfo('unlisted', false)).toEqual({ reason: 'unknown', telemetry: 'turn_teardown', userInitiated: false });
});

test('[G5-06] background launch accepts a pre-aborted native interrupt DOMException', async () => {
  const fixture = await workerFixture();
  const controller = new AbortController();
  controller.abort(new DOMException('interrupt', 'AbortError'));
  try {
    const started = await fixture.call('Agent', { description: 'native interrupt', prompt: 'ordinary background' }, controller.signal);
    expect(started.details).toMatchObject({ status: 'async_launched' });
    const { agentId } = started.details as { agentId: string };
    expect((await fixture.call('TaskOutput', { task_id: agentId, block: true })).details).toMatchObject({ status: 'settled', output: 'users=1' });
  } finally {
    await fixture.close();
  }
});

test.each([
  ['interrupt', true, true],
  ['interrupt', false, false],
  ['user-cancel', true, false],
] as const)('[G5-06] startup-stage %s with background %s has allowed launch %s', async (reason, background, allowed) => {
  const fixture = await workerFixture();
  const controller = new AbortController();
  const original = AgentSession.prototype.bindExtensions;
  const spy = vi.spyOn(AgentSession.prototype, 'bindExtensions').mockImplementation(async function (this: AgentSession, options) {
    await original.call(this, options);
    controller.abort(reason);
  });
  try {
    const call = fixture.call('Agent', { description: 'startup abort', prompt: 'ordinary startup', run_in_background: background }, controller.signal);
    if (allowed) {
      const started = await call;
      expect(started.details).toMatchObject({ status: 'async_launched' });
      const { agentId } = started.details as { agentId: string };
      expect((await fixture.call('TaskOutput', { task_id: agentId, block: true })).details).toMatchObject({ status: 'settled' });
    } else {
      await expect(call).rejects.toMatchObject({ name: 'AbortError' });
      expect((await fixture.call('ListAgents', {})).details).toEqual({ agents: [] });
      await expect(readFile(join(fixture.dir, 'child-input.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    }
  } finally {
    spy.mockRestore();
    await fixture.close();
  }
});

test('[G5-06] foreground cancellation after the final model message still interrupts the call', async () => {
  const fixture = await workerFixture();
  const controller = new AbortController();
  const dispose = AgentSession.prototype.dispose;
  const spy = vi.spyOn(AgentSession.prototype, 'dispose').mockImplementation(function (this: AgentSession) {
    controller.abort('user-cancel');
    dispose.call(this);
  });
  try {
    await expect(fixture.call('Agent', { description: 'late cancellation', prompt: 'ordinary completion', run_in_background: false }, controller.signal)).rejects.toThrow('interrupted');
    expect(fixture.subagentStats.at(-1)).toEqual({ spawned: 1, completed: 0, failed: 0, killed: 1, max_depth: 1, refused: { depth_limit: 0, concurrency_limit: 0, budget: 0 } });
    expect(await readFile(join(fixture.dir, 'child-input.txt'), 'utf8')).toContain('ordinary completion');
  } finally {
    spy.mockRestore();
    await fixture.close();
  }
});

test('owner shutdown publishes a shutdown reason for its running child', async () => {
  const fixture = await workerFixture();
  const events: unknown[] = [];
  fixture.eventBus.on('pstack:subagent-abort', (event) => events.push(event));
  try {
    await fixture.call('Agent', { description: 'shutdown reason', prompt: 'WAIT_BLOCKED' });
  } finally {
    await fixture.close();
  }
  expect(events).toMatchObject([{ reason: 'shutdown', telemetry: 'shutdown', userInitiated: true }]);
});

test('successful resume does not keep the previous run abort metadata', async () => {
  const fixture = await workerFixture();
  try {
    const started = await fixture.call('Agent', { description: 'abort resume', prompt: 'WAIT_BLOCKED' });
    const { agentId } = started.details as { agentId: string };
    await fixture.call('TaskStop', { task_id: agentId });
    await fixture.call('SendMessage', { to: agentId, message: 'successful resumed run' });
    const output = await fixture.call('TaskOutput', { task_id: agentId, block: true });
    expect(output.details).toMatchObject({ status: 'settled', output: 'users=2' });
    expect(output.details).not.toHaveProperty('abort');
  } finally {
    await fixture.close();
  }
});

test.each([
  ['user-cancel', 'user_cancel', true],
  ['remote-cancel', 'remote_cancel', true],
  ['shutdown', 'shutdown', true],
  ['interrupt', 'interrupt', true],
  ['turn-abort', 'interrupt', true],
  ['background', 'background', true],
  ['recovery-timeout', 'recovery_timeout', false],
  ['permission-stop', 'turn_teardown', false],
  ['server-fallback-tombstone', 'server_fallback_tombstone', false],
  ['subagent-park', 'subagent_park', true],
] as const)('[G5-06] reason %s has the source telemetry and user classification', (reason, telemetry, userInitiated) => {
  expect(abortInfo(reason, false)).toEqual({ reason, telemetry, userInitiated });
});

test.each([
  ['permission-stop', 'permission_stop_sync'],
  ['interrupt', 'user_cancel_sync'],
] as const)('[G5-06] foreground %s publishes its native synchronous abort telemetry', async (reason, telemetry) => {
  const fixture = await workerFixture();
  const events: unknown[] = [];
  fixture.eventBus.on('pstack:subagent-abort', (event) => events.push(event));
  const controller = new AbortController();
  try {
    const rejected = expect(fixture.call('Agent', { description: 'abort classification', prompt: 'WAIT_BLOCKED', run_in_background: false }, controller.signal)).rejects.toThrow('interrupted');
    await vi.waitFor(async () => {
      expect(await readFile(join(fixture.dir, 'child-input.txt'), 'utf8')).toContain('WAIT_BLOCKED');
    });
    controller.abort(reason);
    await rejected;
    expect(fixture.subagentStats.at(-1)).toEqual({ spawned: 1, completed: 0, failed: 0, killed: reason === 'permission-stop' ? 0 : 1, max_depth: 1, refused: { depth_limit: 0, concurrency_limit: 0, budget: 0 } });
    expect(events).toMatchObject([{ reason, telemetry, userInitiated: reason === 'interrupt' }]);
    const records = (await fixture.call('ListAgents', {})).details as { agents: { agentId: string }[] };
    expect((await fixture.call('TaskOutput', { task_id: records.agents[0]?.agentId })).details).toMatchObject({ status: 'interrupted', abort: { reason, telemetry } });
    if (reason === 'permission-stop') expect(events).toMatchObject([{ cutoffNote: 'Agent stopped because permission was denied.' }]);
  } finally {
    await fixture.close();
  }
});
