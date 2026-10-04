import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, test, vi } from 'vitest';
import { registerLifecycle } from '../src/lifecycle/register-lifecycle.ts';
import { createPresentationStore } from '../src/state/presentation-store.ts';

type Handler = (event: unknown, ctx: unknown) => unknown;

function fakeApi() {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
  } as unknown as ExtensionAPI;
  const emit = (event: string, payload: unknown = {}): void => {
    for (const handler of handlers.get(event) ?? []) handler(payload, {} as never);
  };
  return { pi, handlers, emit };
}

function setup() {
  const store = createPresentationStore();
  const { pi, handlers, emit } = fakeApi();
  const onSessionStart = vi.fn();
  const onSessionShutdown = vi.fn();
  registerLifecycle(pi, { store, onSessionStart, onSessionShutdown });
  return { store, handlers, emit, onSessionStart, onSessionShutdown };
}

describe('registerLifecycle', () => {
  test('agent phase stays running until final settlement', () => {
    const { store, emit } = setup();
    emit('agent_start');
    expect(store.getSnapshot().phase.kind).toBe('running');
    emit('agent_end');
    expect(store.getSnapshot().phase.kind).toBe('running');
    emit('agent_start');
    expect(store.getSnapshot().phase.kind).toBe('running');
    emit('agent_settled');
    expect(store.getSnapshot().phase.kind).toBe('idle');
  });

  test('tool events track concurrent calls', () => {
    const { store, emit } = setup();
    emit('tool_execution_start', { toolCallId: 'a', toolName: 'read', args: { path: 'a.ts' } });
    emit('tool_execution_start', { toolCallId: 'b', toolName: 'grep', args: { pattern: 'x' } });
    expect(store.getSnapshot().activeTools.size).toBe(2);
    emit('tool_execution_end', { toolCallId: 'a', toolName: 'read', isError: false });
    expect([...store.getSnapshot().activeTools.keys()]).toEqual(['b']);
  });

  test('model select re-notifies subscribers once', () => {
    const { store, emit } = setup();
    const listener = vi.fn();
    store.subscribe(listener);
    emit('model_select', { model: {} });
    expect(listener.mock.calls.length).toBe(1);
  });

  test('thinking level select re-notifies subscribers once', () => {
    const { store, emit } = setup();
    const listener = vi.fn();
    store.subscribe(listener);
    emit('thinking_level_select', { level: 'high' });
    expect(listener.mock.calls.length).toBe(1);
  });

  test('session events call the supplied callbacks', () => {
    const { emit, onSessionStart, onSessionShutdown } = setup();
    emit('session_start', { reason: 'startup' });
    emit('session_shutdown', { reason: 'quit' });
    expect(onSessionStart.mock.calls.length).toBe(1);
    expect(onSessionShutdown.mock.calls.length).toBe(1);
  });

  test('registers only the allowed event set', () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual(['agent_settled', 'agent_start', 'model_select', 'session_shutdown', 'session_start', 'thinking_level_select', 'tool_execution_end', 'tool_execution_start']);
  });
});
