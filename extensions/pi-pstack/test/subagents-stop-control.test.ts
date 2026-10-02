import { createEventBus } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { registerStopControl } from '../src/subagents/stop-control.ts';

function control(stop: (reference: string) => Promise<unknown>) {
  const bus = createEventBus();
  const results: unknown[] = [];
  let resolveResult: (value: unknown) => void = () => {};
  const nextResult = new Promise<unknown>((resolve) => {
    resolveResult = resolve;
  });
  bus.on('pstack:subagent-control-result', (data) => {
    results.push(data);
    resolveResult(data);
  });
  const detach = registerStopControl({ events: bus }, stop);
  return { bus, results, nextResult, detach };
}

const failure = (message: string) => ({ isError: true, content: [{ type: 'text', text: message }], details: { status: 'failed', message } });

test('a valid stop_task forwards the reference and publishes the stop result', async () => {
  const stop = vi.fn(async () => ({ stopped: true }));
  const pipe = control(stop);
  pipe.bus.emit('pstack:subagent-control', { type: 'stop_task', task_id: 'a1' });
  await expect(pipe.nextResult).resolves.toEqual({ result: { stopped: true } });
  expect(stop).toHaveBeenCalledWith('a1');
  expect(stop).toHaveBeenCalledTimes(1);
});

test('a request_id is echoed on the published result', async () => {
  const pipe = control(async () => ({ stopped: true }));
  pipe.bus.emit('pstack:subagent-control', { type: 'stop_task', task_id: 'a1', request_id: 'r-7' });
  await expect(pipe.nextResult).resolves.toEqual({ request_id: 'r-7', result: { stopped: true } });
});

test.for([
  { name: 'a missing type', request: { task_id: 'a1' } },
  { name: 'a wrong type', request: { type: 'stop', task_id: 'a1' } },
  { name: 'a missing task id', request: { type: 'stop_task' } },
  { name: 'an empty task id', request: { type: 'stop_task', task_id: '' } },
  { name: 'an extra field', request: { type: 'stop_task', task_id: 'a1', extra: true } },
  { name: 'a non-object', request: 'stop_task' },
])('$name is refused without calling stop', async ({ request }) => {
  const stop = vi.fn(async () => ({}));
  const pipe = control(stop);
  pipe.bus.emit('pstack:subagent-control', request);
  await expect(pipe.nextResult).resolves.toEqual({ result: failure('Invalid stop_task control message.') });
  expect(stop).not.toHaveBeenCalled();
});

test('a refused stop is reported as a failed control result', async () => {
  const pipe = control(async () => {
    throw new Error('boom');
  });
  pipe.bus.emit('pstack:subagent-control', { type: 'stop_task', task_id: 'a1' });
  await expect(pipe.nextResult).resolves.toEqual({ result: failure('Stop control failed: Error: boom') });
});

test('detaching before a slow stop resolves publishes nothing', async () => {
  let resolveStop: (value: unknown) => void = () => {};
  const pipe = control(
    () =>
      new Promise<unknown>((resolve) => {
        resolveStop = resolve;
      }),
  );
  pipe.bus.emit('pstack:subagent-control', { type: 'stop_task', task_id: 'a1' });
  pipe.detach();
  resolveStop({ stopped: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(pipe.results).toEqual([]);
});
