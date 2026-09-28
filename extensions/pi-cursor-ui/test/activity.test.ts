import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { describe, expect, test, vi } from 'vitest';
import type { RunningToolActivity } from '../src/state/presentation-state.ts';
import { createPresentationStore } from '../src/state/presentation-store.ts';
import { createActivityComponent, describeActivity, installActivityWidget } from '../src/ui/activity-widget.ts';

const HOME = '/home/u';

const theme = { fg: (_role: string, text: string) => text };

function fakeTui() {
  return { requestRender: vi.fn(), terminal: { rows: 40, columns: 120 } } as never;
}

function activity(id: string, toolName: string, args: unknown): RunningToolActivity {
  return { kind: 'running', toolCallId: id, toolName, startedAt: 1, args };
}

describe('describeActivity', () => {
  test('renders nothing when no tool is running', () => {
    expect(describeActivity([], HOME)).toBe('');
  });

  test('names the target for a single read', () => {
    expect(describeActivity([activity('a', 'read', { path: '/tmp/a.ts' })], HOME)).toBe('Reading /tmp/a.ts');
  });

  test('shortens a home-relative path', () => {
    expect(describeActivity([activity('a', 'read', { path: '/home/u/src/a.ts' })], HOME)).toBe('Reading ~/src/a.ts');
  });

  test('counts repeated reads', () => {
    const activities = [activity('a', 'read', { path: '/tmp/a.ts' }), activity('b', 'read', { path: '/tmp/b.ts' })];
    expect(describeActivity(activities, HOME)).toBe('Reading 2 files');
  });

  test('quotes a grep pattern', () => {
    expect(describeActivity([activity('a', 'grep', { pattern: 'ExtensionContext' })], HOME)).toBe('Searching "ExtensionContext"');
  });

  test('joins mixed activity segments', () => {
    const activities = [activity('a', 'read', { path: '/tmp/a.ts' }), activity('b', 'grep', { pattern: 'one' }), activity('c', 'grep', { pattern: 'two' })];
    expect(describeActivity(activities, HOME)).toBe('Reading file, Searching 2 matches');
  });

  test('falls back to a generic step for an unknown tool', () => {
    expect(describeActivity([activity('a', 'frobnicate', {})], HOME)).toBe('Running step');
  });

  test('falls back to a generic command for null arguments', () => {
    expect(describeActivity([activity('a', 'bash', null)], HOME)).toBe('Running command');
  });
});

describe('createActivityComponent', () => {
  test('renders nothing while no tool is active', () => {
    const component = createActivityComponent({ tui: fakeTui(), theme: theme as never, store: createPresentationStore(), home: HOME });
    expect(component.render(40).length).toBe(0);
  });

  test('renders one line for the running tools', () => {
    const store = createPresentationStore();
    store.startTool({ toolCallId: 'a', toolName: 'read', args: { path: '/tmp/a.ts' }, startedAt: 1 });
    store.startTool({ toolCallId: 'b', toolName: 'grep', args: { pattern: 'one' }, startedAt: 1 });
    store.startTool({ toolCallId: 'c', toolName: 'grep', args: { pattern: 'two' }, startedAt: 1 });
    const component = createActivityComponent({ tui: fakeTui(), theme: theme as never, store, home: HOME });

    const lines = component.render(40);
    expect(lines.length).toBe(1);
    expect(stripTerminalSequences(lines[0] ?? '').trimEnd()).toBe('● Reading file, Searching 2 matches');
  });

  test('requests a render when the store changes', () => {
    const store = createPresentationStore();
    const tui = fakeTui();
    const component = createActivityComponent({ tui, theme: theme as never, store, home: HOME });

    store.startTool({ toolCallId: 'a', toolName: 'read', args: { path: '/tmp/a.ts' }, startedAt: 1 });
    expect(component.render(40).length).toBe(1);
    expect((tui as { requestRender: ReturnType<typeof vi.fn> }).requestRender.mock.calls.length).toBe(1);
  });

  test('stops requesting renders once disposed', () => {
    const store = createPresentationStore();
    const tui = fakeTui();
    const component = createActivityComponent({ tui, theme: theme as never, store, home: HOME });

    component.dispose();
    component.dispose();
    store.setAgentRunning(1);
    expect((tui as { requestRender: ReturnType<typeof vi.fn> }).requestRender.mock.calls.length).toBe(0);
  });
});

describe('installActivityWidget', () => {
  test('registers the activity key above the editor', () => {
    const calls: unknown[][] = [];
    const ctx = { ui: { setWidget: (...args: unknown[]) => calls.push(args) } } as never;
    installActivityWidget(ctx, createPresentationStore());

    expect(calls.length).toBe(1);
    expect(calls[0]?.[0]).toBe('cursor-ui.activity');
    expect(calls[0]?.[2]).toEqual({ placement: 'aboveEditor' });
  });

  test('builds the component through the registered factory', () => {
    const calls: unknown[][] = [];
    const ctx = { ui: { setWidget: (...args: unknown[]) => calls.push(args) } } as never;
    const onTui = vi.fn();
    installActivityWidget(ctx, createPresentationStore(), onTui);

    const tui = fakeTui();
    const factory = calls[0]?.[1] as (tui: never, theme: never) => { render(width: number): string[] };
    const component = factory(tui as never, theme as never);
    expect(onTui.mock.calls.length).toBe(1);
    expect(onTui.mock.calls[0]?.[0]).toBe(tui);
    expect(component.render(40).length).toBe(0);
  });
});
