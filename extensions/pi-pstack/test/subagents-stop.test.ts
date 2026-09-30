import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { workerControl } from '../src/worker-control.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function stubborn() {
  const calls = { abort: 0, dispose: 0 };
  const session = {
    abort: async () => {
      calls.abort += 1;
    },
    dispose: () => {
      calls.dispose += 1;
    },
    subscribe: () => () => {},
  } as never;
  return { session, calls };
}

test('[G5-04] an unsettled worker is force closed at 10000ms and kept as a stop handle at 30000ms', async () => {
  const { session, calls } = stubborn();
  const logs: string[] = [];
  const control = workerControl(session, undefined, undefined, { taskId: 't1', log: (message) => logs.push(message) });
  control.stop();
  await vi.advanceTimersByTimeAsync(9999);
  expect(logs).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(logs).toEqual(['killEscalation: task t1 still unsettled 10000ms after kill; killed process groups of 1 agent(s)']);
  expect(calls.dispose).toBe(1);
  await vi.advanceTimersByTimeAsync(20000);
  expect(logs[1]).toBe('killEscalation: task t1 loop never settled after kill — record retained as its stop handle; TaskStop re-fires, session restart is the final recovery');
  control.stop();
  await control.drain();
  expect(calls.abort).toBe(2);
  control.unsubscribe();
});

test('[G5-04] settling before the deadline clears the escalation timers', async () => {
  const { session, calls } = stubborn();
  const logs: string[] = [];
  const control = workerControl(session, undefined, undefined, { taskId: 't2', log: (message) => logs.push(message) });
  control.stop();
  await vi.advanceTimersByTimeAsync(5000);
  control.unsubscribe();
  await vi.advanceTimersByTimeAsync(60000);
  expect(logs).toEqual([]);
  expect(calls.dispose).toBe(0);
});

test('[G5-04] a repeated stop before the worker is overdue does not abort twice', async () => {
  const { session, calls } = stubborn();
  const control = workerControl(session, undefined, undefined, { taskId: 't3', log: () => {} });
  control.stop();
  control.stop();
  await control.drain();
  expect(calls.abort).toBe(1);
  control.unsubscribe();
});
