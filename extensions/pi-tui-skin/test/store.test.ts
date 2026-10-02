import { describe, expect, test, vi } from 'vitest';
import { toolTarget } from '../src/state/presentation-state.ts';
import { createPresentationStore } from '../src/state/presentation-store.ts';

function start(store: ReturnType<typeof createPresentationStore>, id: string, toolName: string, args: unknown): void {
  store.startTool({ toolCallId: id, toolName, args, startedAt: 1 });
}

function finish(store: ReturnType<typeof createPresentationStore>, id: string, toolName: string, isError: boolean): void {
  store.finishTool({ toolCallId: id, toolName, isError, finishedAt: 2 });
}

describe('presentation store', () => {
  test('reports idle then running then idle', () => {
    const store = createPresentationStore();
    expect(store.getSnapshot().phase).toEqual({ kind: 'idle' });
    store.setAgentRunning(1000);
    expect(store.getSnapshot().phase).toEqual({ kind: 'running', startedAt: 1000 });
    store.setAgentIdle();
    expect(store.getSnapshot().phase).toEqual({ kind: 'idle' });
  });

  test('keeps snapshot identity between mutations', () => {
    const store = createPresentationStore();
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    store.setAgentRunning(5);
    expect(store.getSnapshot()).not.toBe(first);
  });

  test('keeps two concurrent tool calls active', () => {
    const store = createPresentationStore();
    start(store, 'a', 'read', { path: 'a.ts' });
    start(store, 'b', 'grep', { pattern: 'x' });
    expect([...store.getSnapshot().activeTools.keys()]).toEqual(['a', 'b']);
    finish(store, 'a', 'read', false);
    expect([...store.getSnapshot().activeTools.keys()]).toEqual(['b']);
  });

  test('overwrites a retried tool call id', () => {
    const store = createPresentationStore();
    start(store, 'a', 'read', { path: 'one.ts' });
    start(store, 'a', 'read', { path: 'two.ts' });
    expect(store.getSnapshot().activeTools.size).toBe(1);
    expect(store.getSnapshot().activeTools.get('a')?.args).toEqual({ path: 'two.ts' });
  });

  test('ignores a finish for an unknown tool call', () => {
    const store = createPresentationStore();
    const listener = vi.fn();
    store.subscribe(listener);
    finish(store, 'missing', 'edit', false);
    expect(listener.mock.calls.length).toBe(0);
  });
});

describe('presentation store reset, subscriptions', () => {
  test('reset returns the idle presentation state', () => {
    const store = createPresentationStore();
    start(store, 'a', 'edit', { path: 'src/a.ts' });
    finish(store, 'a', 'edit', false);
    store.setAgentRunning(1);
    store.reset();
    const snapshot = store.getSnapshot();
    expect(snapshot.phase).toEqual({ kind: 'idle' });
    expect(snapshot.activeTools.size).toBe(0);
  });

  test('notifies once per state-changing mutation', () => {
    const store = createPresentationStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setAgentRunning(1);
    store.setAgentIdle();
    store.setAgentIdle();
    expect(listener.mock.calls.length).toBe(2);
  });

  test('notifyChanged re-notifies without replacing the snapshot', () => {
    const store = createPresentationStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();
    store.notifyChanged();
    expect(listener.mock.calls.length).toBe(1);
    expect(store.getSnapshot()).toBe(before);
  });

  test('stops notifying after unsubscribe', () => {
    const store = createPresentationStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setAgentRunning(1);
    unsubscribe();
    unsubscribe();
    store.setAgentIdle();
    expect(listener.mock.calls.length).toBe(1);
  });
});

describe('toolTarget', () => {
  test('prefers path over the other fields', () => {
    expect(toolTarget({ path: 'p', pattern: 'q', command: 'r' })).toBe('p');
  });

  test('falls back to pattern then command', () => {
    expect(toolTarget({ pattern: 'q' })).toBe('q');
    expect(toolTarget({ command: 'r' })).toBe('r');
  });

  test('skips unusable field values', () => {
    expect(toolTarget({ path: '' })).toBeUndefined();
    expect(toolTarget({ command: 42 })).toBeUndefined();
    expect(toolTarget(['echo'])).toBeUndefined();
    expect(toolTarget('echo')).toBeUndefined();
    expect(toolTarget(null)).toBeUndefined();
    expect(toolTarget({ depth: 2 })).toBeUndefined();
    expect(toolTarget({ path: 'ok' })).toBe('ok');
  });
});
