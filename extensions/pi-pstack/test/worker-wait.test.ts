import { expect, test } from 'vitest';
import { waitFor } from '../src/worker-control.ts';

test('without a signal the completion is returned as is', async () => {
  await expect(waitFor(Promise.resolve('done'), undefined, 'cancelled')).resolves.toBe('done');
});

test('a completion that lands before the signal aborts resolves with its value', async () => {
  const controller = new AbortController();
  await expect(waitFor(Promise.resolve('done'), controller.signal, 'cancelled')).resolves.toBe('done');
});

test('a signal that aborts first rejects with the cancel message and leaves the completion running', async () => {
  const controller = new AbortController();
  const waiting = waitFor(new Promise<string>(() => {}), controller.signal, 'Wait cancelled.');
  controller.abort();
  await expect(waiting).rejects.toThrow('Wait cancelled.');
});

test('an already aborted signal rejects at once', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(waitFor(new Promise<string>(() => {}), controller.signal, 'Wait cancelled.')).rejects.toThrow('Wait cancelled.');
});

test('a failing completion rejects with its own error', async () => {
  const controller = new AbortController();
  await expect(waitFor(Promise.reject(new Error('worker failed')), controller.signal, 'cancelled')).rejects.toThrow('worker failed');
});
