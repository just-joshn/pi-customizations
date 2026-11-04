import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test } from 'vitest';
import { PLAN_BASH, PLAN_ENTRY, PLAN_SAVE, parsePlanArgs, planBlockReason, planFileName, planFromBranch, planSection, planTools, registerPlanMode, savePlan } from '../src/plan.ts';

type Handler = (event: unknown, ctx: unknown) => unknown;

function harness(initialTools = ['read', 'bash', 'edit', 'write', 'Task', 'TodoWrite', 'AskQuestion', 'stop_agent', 'mcp']) {
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
  const run = (args: string) => (commands.get('plan') as { handler: (args: string, ctx: unknown) => Promise<void> }).handler(args, ctx);
  return { plan, tools, entries, sent, notes, status, emit, run, active: () => active, setActive: (names: string[]) => (active = names) };
}

test('parses the command forms', () => {
  expect(parsePlanArgs('')).toEqual({ kind: 'on', task: '' });
  expect(parsePlanArgs(' off ')).toEqual({ kind: 'off' });
  expect(parsePlanArgs('on')).toEqual({ kind: 'on', task: '' });
  expect(parsePlanArgs('add a cache layer')).toEqual({ kind: 'on', task: 'add a cache layer' });
});

test('registers the sandboxed shell and the plan saver inactive under their own names', () => {
  const { tools } = harness();
  expect(tools.map((tool) => [tool.name, tool.defaultActive])).toEqual([
    [PLAN_BASH, false],
    [PLAN_SAVE, false],
  ]);
  expect(tools[0]?.description).toContain('denies filesystem writes and network access');
});

test('a bare /plan enters plan mode, as Cursor does, and /plan off restores the exact earlier set', async () => {
  const h = harness();
  const before = h.active();
  expect(h.plan.section()).toBeUndefined();

  await h.run('');
  expect(h.notes.at(-1)).toContain('on');
  expect(h.active().toSorted()).toEqual(['AskQuestion', PLAN_BASH, PLAN_SAVE, 'Task', 'TodoWrite', 'find', 'grep', 'ls', 'read', 'stop_agent'].toSorted());
  expect(h.status.get('pstack-plan')).toBe('plan');
  expect(h.plan.section()).toBe(planSection(undefined));
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
  expect(planTools(['read', 'bash', 'edit'])).toEqual(['read', 'grep', 'find', 'ls', PLAN_BASH, PLAN_SAVE]);
});

test('a saved plan is named in Cursor shape and records its id', () => {
  expect(planFileName('Ship the /plan flow!', '0123456789abcdef')).toBe('Ship the plan flow-01234567.plan.md');
  expect(planFileName('   ', '0123456789abcdef')).toBe('Plan-01234567.plan.md');
  const dir = mkdtempSync(join(tmpdir(), 'pstack-plans-'));
  try {
    const path = savePlan('Tiny plan', '# Tiny plan\n\n- [ ] step', dir);
    expect(path.startsWith(dir)).toBe(true);
    expect(path.endsWith('.plan.md')).toBe(true);
    expect(readFileSync(path, 'utf8')).toMatch(/^<!-- plan: [0-9a-f-]{36} -->\n\n# Tiny plan\n\n- \[ \] step\n$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('/plan build needs a saved plan, and otherwise hands the file content to the next turn', async () => {
  const h = harness();
  await h.run('build');
  expect(h.notes.at(-1)).toContain('No saved plan to build');
  expect(h.sent).toEqual([]);

  await h.run('on');
  const save = h.tools.find((tool) => tool.name === PLAN_SAVE) as unknown as { execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<{ details: { planFile: string } }> };
  const saved = await save.execute('call', { name: 'Build it', content: '# Build it\n\n- [ ] first' }, undefined, undefined, {});
  const path = saved.details.planFile;
  onTestFinished(() => rmSync(path, { force: true }));
  expect(path.endsWith('.plan.md')).toBe(true);
  expect(h.plan.section()).toContain(`Saved plan is ${path}`.replace('Saved', 'The saved'));

  const before = h.active();
  await h.run('build');
  expect(h.notes.at(-1)).toBe(`Building ${path}.`);
  expect(h.active()).not.toContain(PLAN_BASH);
  expect(h.active()).not.toContain(PLAN_SAVE);
  expect(h.status.get('pstack-plan')).toBeUndefined();
  expect(before).toContain(PLAN_SAVE);
  expect(h.sent).toEqual([{ text: [`Build the plan saved at ${path}. Follow it.`, '', '# Build it', '', '- [ ] first'].join('\n'), options: { expandPromptTemplates: true } }]);
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
  const saved = (h.entries.at(-1) as { data: unknown }).data as { toolsBefore: string[] };
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

test('a stored plan path outside the plans folder never reaches a build', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-plans-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const outside = join(dir, 'secret.txt');
  const inside = join(dir, 'plans', 'Plan-01234567.plan.md');
  expect(planFromBranch([{ type: 'custom', customType: PLAN_ENTRY, data: { enabled: false, planFile: outside } }], join(dir, 'plans'))).toEqual({ enabled: false });
  expect(planFromBranch([{ type: 'custom', customType: PLAN_ENTRY, data: { enabled: false, planFile: inside } }], join(dir, 'plans'))).toEqual({ enabled: false, planFile: inside });
});
