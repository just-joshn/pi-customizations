import { createEventBus, type EventBus } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { registerStopControl } from '../src/subagents/stop-control.ts';
import { workerFixture } from './worker-fixture.ts';

test('control adapter reports stop failures instead of rejecting its event listener', async () => {
  const bus = createEventBus();
  const off = registerStopControl({ events: bus }, async () => {
    throw new Error('driver failure');
  });
  try {
    expect(await control(bus, { type: 'stop_task', task_id: 'worker', request_id: 'failure' })).toMatchObject({
      request_id: 'failure',
      result: { isError: true, details: { status: 'failed', message: 'Stop control failed: Error: driver failure' } },
    });
  } finally {
    off();
  }
});

test('detached adapter removes its listener and suppresses an in-flight reply', async () => {
  const bus = createEventBus();
  let finish: (value: unknown) => void = () => {
    throw new Error('Stop did not start');
  };
  const stop = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const replies: unknown[] = [];
  bus.on('pstack:subagent-control-result', (result) => replies.push(result));
  const off = registerStopControl({ events: bus }, stop);
  bus.emit('pstack:subagent-control', { type: 'stop_task', task_id: 'worker' });
  off();
  finish({ details: { status: 'interrupted' } });
  await Promise.resolve();
  bus.emit('pstack:subagent-control', { type: 'stop_task', task_id: 'other' });
  expect(stop).toHaveBeenCalledExactlyOnceWith('worker');
  expect(replies).toEqual([]);
});

function control(bus: EventBus, request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('Stop control did not reply'));
    }, 1000);
    const off = bus.on('pstack:subagent-control-result', (result) => {
      clearTimeout(timer);
      off();
      resolve(result);
    });
    bus.emit('pstack:subagent-control', request);
  });
}

test('[G5-01] native stop_task control stops by name through the TaskStop path', async () => {
  const fixture = await workerFixture();
  try {
    const started = await fixture.call('Agent', { description: 'control stop', prompt: 'WAIT_BLOCKED', name: 'control-worker' });
    const { agentId } = started.details as { agentId: string };
    expect(await control(fixture.eventBus, { type: 'stop_task', task_id: 'CONTROL-WORKER', request_id: 'stop-1' })).toMatchObject({
      request_id: 'stop-1',
      result: { details: { task_id: agentId, status: 'interrupted', task_type: 'local_agent', command: 'control stop' } },
    });
    expect(fixture.session.messages.filter((message) => message.role === 'custom' && message.customType === 'task_notification')).toMatchObject([{ details: { task_id: agentId, status: 'stopped' } }]);
    expect(await control(fixture.eventBus, { type: 'stop_task', task_id: 'missing' })).toMatchObject({ result: { isError: true, details: { status: 'failed', task_id: 'missing' } } });
  } finally {
    await fixture.close();
  }
});

test.each([null, undefined, [], { type: 'other', task_id: 'a' }, { type: 'stop_task', task_id: 7 }, { type: 'stop_task', task_id: '' }])('malformed stop control %j is refused before task lookup', async (request) => {
  const fixture = await workerFixture();
  try {
    expect(await control(fixture.eventBus, request)).toMatchObject({ result: { isError: true, details: { status: 'failed', message: 'Invalid stop_task control message.' } } });
    expect((await fixture.call('ListAgents', {})).details).toEqual({ agents: [] });
  } finally {
    await fixture.close();
  }
});
