import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { createDelivery } from '../src/deliver.ts';

function fakePi() {
  const handlers = new Map<string, () => void>();
  const sent: string[] = [];
  const pi = {
    on: (event: string, handler: () => void) => handlers.set(event, handler),
    sendUserMessage: (text: string) => sent.push(text),
  } as unknown as ExtensionAPI;
  return { pi, sent, emit: (event: string) => handlers.get(event)?.() };
}

const printCtx = { hasUI: false } as ExtensionContext;
const flush = async () => {
  for (let hop = 0; hop < 10; hop += 1) await Promise.resolve();
};

test('interactive delivery queues the message and returns at once', async () => {
  const { pi, sent } = fakePi();
  await createDelivery(pi)({ hasUI: true, mode: 'tui' } as ExtensionContext, 'task');
  expect(sent).toEqual(['task']);
});

test.each([
  { hasUI: false, mode: 'print' },
  { hasUI: true, mode: 'rpc' },
])('$mode delivery holds the command until its forwarded turn settles', async (context) => {
  const { pi, sent, emit } = fakePi();
  const events: string[] = [];
  const done = createDelivery(pi)(context as ExtensionContext, 'task').then(() => events.push('returned'));
  await flush();
  expect(sent).toEqual(['task']);
  emit('agent_settled');
  await flush();
  expect(events).toEqual([]);
  emit('agent_start');
  await flush();
  expect(events).toEqual([]);
  emit('agent_end');
  await flush();
  expect(events).toEqual([]);
  emit('agent_settled');
  await done;
  expect(events).toEqual(['returned']);
});

test('print delivery returns when no turn starts within the start timeout', async () => {
  const { pi, sent } = fakePi();
  await createDelivery(pi, 10)(printCtx, 'task');
  expect(sent).toEqual(['task']);
});

test('a turn that starts before the timeout still settles through its own completion', async () => {
  const { pi, sent, emit } = fakePi();
  const events: string[] = [];
  const done = createDelivery(pi, 10)(printCtx, 'task').then(() => events.push('returned'));
  await flush();
  emit('agent_start');
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(events).toEqual([]);
  emit('agent_settled');
  await done;
  expect(events).toEqual(['returned']);
  expect(sent).toEqual(['task']);
});
