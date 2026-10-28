import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';

import { PLAN_BASH, PLAN_ENTRY, parsePlanArgs, planBlockReason, planFromBranch, planSection, planTools, registerPlanMode } from '../src/plan.ts';

type Handler = (event: unknown, ctx: unknown) => unknown;

function harness(initialTools = ['read', 'bash', 'edit', 'write', 'Task', 'TodoWrite', 'AskQuestion', 'mcp']) {
  const tools: ToolDefinition[] = [];
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const entries: { type: string; customType: string; data: unknown }[] = [];
  const sent: { text: string; options: unknown }[] = [];
  const notes: string[] = [];
  const status = new Map<string, string | undefined>();
  let active = [...initialTools];
  const pi = {
    registerTool: (tool: ToolDefinition) => tools.push(tool),
    on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, options),
    getActiveTools: () => [...active],
    setActiveTools: (names: string[]) => {
      active = [...names];
    },
    appendEntry: (customType: string, data: unknown) => entries.push({ type: 'custom', customType, data: structuredClone(data) }),
    sendUserMessage: (text: string, options: unknown) => sent.push({ text, options }),
  } as unknown as ExtensionAPI;
  const ctx = {
    hasUI: true,
    isIdle: () => true,
    ui: { notify: (text: string) => notes.push(text), setStatus: (key: string, text: string | undefined) => status.set(key, text), theme: { fg: (_color: string, text: string) => text } },
    sessionManager: { getBranch: () => entries },
  };
  const plan = registerPlanMode(pi);
  const emit = (event: string, payload: unknown = {}) => (handlers.get(event) ?? []).map((handler) => handler(payload, ctx));
  const run = (args: string) => commands.get('plan')!.handler(args, ctx);
  return { plan, tools, entries, sent, notes, status, emit, run, active: () => active, setActive: (names: string[]) => (active = names) };
}

test('parses the command forms', () => {
  expect(parsePlanArgs('')).toEqual({ kind: 'status' });
  expect(parsePlanArgs(' off ')).toEqual({ kind: 'off' });
  expect(parsePlanArgs('on')).toEqual({ kind: 'on', task: '' });
  expect(parsePlanArgs('add a cache layer')).toEqual({ kind: 'on', task: 'add a cache layer' });
});

test('registers the sandboxed shell inactive under its own name', () => {
  const { tools } = harness();
  expect(tools.map((tool) => [tool.name, tool.defaultActive])).toEqual([[PLAN_BASH, false]]);
  expect(tools[0]?.description).toContain('denies filesystem writes and network access');
});

test('/plan restricts the tools and /plan off restores the exact earlier set', async () => {
  const h = harness();
  const before = h.active();
  await h.run('');
  expect(h.notes.at(-1)).toContain('off');
  expect(h.plan.section()).toBeUndefined();

  await h.run('on');
  expect(h.active().toSorted()).toEqual(['AskQuestion', PLAN_BASH, 'Task', 'TodoWrite', 'find', 'grep', 'ls', 'read'].toSorted());
  expect(h.status.get('pstack-plan')).toBe('plan');
  expect(h.plan.section()).toBe(planSection());
  expect(h.sent).toEqual([]);

  await h.run('off');
  expect(h.active()).toEqual(before);
  expect(h.status.get('pstack-plan')).toBeUndefined();
  expect(h.plan.section()).toBeUndefined();
  expect(h.entries.map((entry) => entry.data)).toEqual([{ enabled: true, toolsBefore: before }, { enabled: false }]);
});

test('/plan <task> sends the task, and a second /plan keeps the first saved tool set', async () => {
  const h = harness();
  const before = h.active();
  await h.run('investigate the flaky test');
  expect(h.sent).toEqual([{ text: 'investigate the flaky test', options: { expandPromptTemplates: true } }]);
  await h.run('another task');
  await h.run('off');
  expect(h.active()).toEqual(before);
});

test('plan mode never activates Task when it was off before', async () => {
  expect(planTools(['read', 'bash', 'edit'])).toEqual(['read', 'grep', 'find', 'ls', PLAN_BASH]);
});

test('blocks writers and unknown tools, and lets Task run unchanged for it to restrict (C-M1)', async () => {
  const h = harness();
  const call = (toolName: string, input: Record<string, unknown> = {}) => ({ result: h.emit('tool_call', { toolName, input })[0], input });
  expect(call('write').result).toBeUndefined();

  await h.run('on');
  expect(call('write').result).toEqual({ block: true, reason: planBlockReason('write') });
  expect(planBlockReason('edit')).toContain('/plan off');
  expect((call('bash').result as { reason: string }).reason).toContain(PLAN_BASH);
  expect((call('mcp').result as { block: boolean }).block).toBe(true);
  expect(call('read').result).toBeUndefined();
  const task = call('Task', { prompt: 'look', description: 'x', readonly: false });
  expect([task.result, task.input]).toEqual([undefined, { prompt: 'look', description: 'x', readonly: false }]);
  expect(h.plan.enabled()).toBe(true);
  await h.run('off');
  expect(h.plan.enabled()).toBe(false);
});

test('restores plan mode from the session and drops a stray plan shell when off', async () => {
  const h = harness();
  await h.run('on');
  const saved = h.entries.at(-1)!.data as { toolsBefore: string[] };
  h.setActive(['read', 'bash', 'edit']);
  h.emit('session_start');
  expect(h.active()).toContain(PLAN_BASH);
  expect(h.active()).not.toContain('edit');
  await h.run('off');
  expect(h.active()).toEqual(saved.toolsBefore);

  h.setActive([...h.active(), PLAN_BASH]);
  h.emit('session_start');
  expect(h.active()).not.toContain(PLAN_BASH);
});

test('reads the last plan entry and treats malformed data as off', () => {
  const entry = (data: unknown) => ({ type: 'custom', customType: PLAN_ENTRY, data });
  expect(planFromBranch([])).toEqual({ enabled: false });
  expect(planFromBranch([entry({ enabled: true, toolsBefore: ['read'] }), entry({ enabled: false })])).toEqual({ enabled: false });
  expect(planFromBranch([entry({ enabled: true, toolsBefore: ['read', 3] })])).toEqual({ enabled: true });
  expect(planFromBranch([entry(null)])).toEqual({ enabled: false });
});
