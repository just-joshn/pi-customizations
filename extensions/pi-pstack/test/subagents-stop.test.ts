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

test('an unsettled worker requests disposal at 10000ms and permits another stop at 30000ms', async () => {
  const { session, calls } = stubborn();
  const logs: string[] = [];
  const control = workerControl(session, undefined, undefined, { taskId: 't1', log: (message) => logs.push(message) });
  control.stop();
  await vi.advanceTimersByTimeAsync(9999);
  expect(logs).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(logs).toEqual(['killEscalation: task t1 still unsettled 10000ms after stop; requesting session disposal']);
  expect(calls.dispose).toBe(1);
  await vi.advanceTimersByTimeAsync(20000);
  expect(logs[1]).toBe('killEscalation: task t1 loop never settled after kill — record retained as its stop handle; TaskStop re-fires, session restart is the final recovery');
  control.stop();
  await control.drain();
  expect(calls.abort).toBe(2);
  control.unsubscribe();
});

test('foreground explicit shutdown is not reported as synchronous parent cancellation', async () => {
  const { session } = stubborn();
  const events: unknown[] = [];
  const control = workerControl(session, undefined, undefined, { taskId: 'origin', foreground: true, log: () => {}, onAbort: (info) => events.push(info) });
  control.stop('shutdown');
  await control.drain();
  expect(events).toEqual([{ reason: 'shutdown', telemetry: 'shutdown', userInitiated: true }]);
  control.unsubscribe();
});

test('settling before the deadline clears the escalation timers', async () => {
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

test('a repeated stop before the worker is overdue does not abort twice', async () => {
  const { session, calls } = stubborn();
  const control = workerControl(session, undefined, undefined, { taskId: 't3', log: () => {} });
  control.stop();
  control.stop();
  await control.drain();
  expect(calls.abort).toBe(1);
  control.unsubscribe();
});

test('[G2-07] the turn limiter logs and stops exactly at the configured turn', async () => {
  const { turnLimit } = await import('../src/subagents/turn-limit.ts');
  const logs: string[] = [];
  const stop = vi.fn();
  const listener = turnLimit('short', 2, (message) => logs.push(message), stop);
  const continuing = { type: 'turn_end', toolResults: [{ role: 'toolResult' }] } as never;
  listener(continuing);
  expect(stop).not.toHaveBeenCalled();
  listener(continuing);
  listener(continuing);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(logs).toEqual(['[Agent: short] Reached max turns limit (2)']);
});

test('[B72] a child that finishes its report on the last allowed turn is not cut off', async () => {
  const { turnLimit } = await import('../src/subagents/turn-limit.ts');
  const stop = vi.fn();
  const listener = turnLimit('short', 1, () => {}, stop);
  listener({ type: 'turn_end', toolResults: [] } as never);
  expect(stop).toHaveBeenCalledTimes(0);
  listener({ type: 'turn_end', toolResults: [{ role: 'toolResult' }] } as never);
  expect(stop).toHaveBeenCalledTimes(1);
});
