import { expect, test } from 'vitest';
import type { ExtensionAPI, ExtensionContext, Theme, ToolDefinition, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import { createState, registerStateTools } from '../src/state.ts';

const mockTheme = {
  fg: (_role: string, text: string) => text,
  bg: (_role: string, text: string) => text,
  bold: (text: string) => `*${text}*`,
} as unknown as Theme;

test('TodoWrite publishes independent todos rather than caller-owned records', async () => {
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, registerTool: (tool: ToolDefinition) => { tools.push(tool); } } as unknown as ExtensionAPI;
  const ctx = { ui: { setStatus() {}, setWidget() {} } } as unknown as ExtensionContext;
  const store = createState(pi);
  registerStateTools(pi, store);
  const tool = tools.find(tool => tool.name === 'TodoWrite');
  expect(tool).toBeDefined();
  const todo = Object.freeze({ id: 'one', content: 'First', status: 'pending' });
  const params = Object.freeze({ todos: Object.freeze([todo]) });
  const result = await tool!.execute('one', params, undefined, undefined, ctx);
  const todos = result.details as typeof params.todos;
  expect(todos).toEqual([{ id: 'one', content: 'First', status: 'pending' }]);
  expect(todos).not.toBe(params.todos);
  expect(todos[0]).not.toBe(params.todos[0]);
  await tool!.execute('two', { todos: [{ id: 'one', content: 'Second', status: 'completed' }] }, undefined, undefined, ctx);
  expect(todos[0]?.content).toBe('First');
  expect(store.read().todos[0]?.content).toBe('Second');
});

test('state snapshots never alias caller input, published entries, or previous reads', () => {
  const published: unknown[] = [];
  const pi = { appendEntry: (_type: string, data: unknown) => { published.push(data); } } as unknown as ExtensionAPI;
  const ctx = { ui: { setStatus: () => {}, setWidget: () => {} } } as unknown as ExtensionContext;
  const store = createState(pi);
  const input = { enabled: true, todos: [{ id: 'one', content: 'First', status: 'pending' as const }] };
  store.update(input, ctx);
  const snapshot = store.read();
  expect(snapshot).toEqual(input);
  expect(snapshot).not.toBe(input);
  expect(snapshot.todos[0]).not.toBe(input.todos[0]);
  expect(snapshot).not.toBe(published[0]);
  expect(store.read().todos).not.toBe(snapshot.todos);
  store.toggle(false, ctx);
  expect(snapshot.enabled).toBe(true);
  expect(store.read().enabled).toBe(false);
});

test('pstack_mode tool toggles mode and returns bounded confirmation', async () => {
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, registerTool: (t: ToolDefinition) => { tools.push(t); } } as unknown as ExtensionAPI;
  const ctx = { ui: { setStatus: () => {}, setWidget: () => {} } } as unknown as ExtensionContext;
  const store = createState(pi);
  registerStateTools(pi, store);
  const modeTool = tools.find(t => t.name === 'pstack_mode');
  expect(modeTool).toBeDefined();
  const on = await modeTool!.execute('1', { enabled: true }, undefined, undefined, ctx);
  expect(JSON.stringify(on.content)).toMatch(/Poteto mode is on/);
  expect(store.read().enabled).toBe(true);
  const off = await modeTool!.execute('2', { enabled: false }, undefined, undefined, ctx);
  expect(JSON.stringify(off.content)).toMatch(/Poteto mode is off/);
  expect(store.read().enabled).toBe(false);
});

test('TodoWrite registers promptSnippet, promptGuidelines, and schema descriptions', () => {
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, registerTool: (t: ToolDefinition) => { tools.push(t); } } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  const tool = tools.find(t => t.name === 'TodoWrite');
  expect(tool).toBeDefined();
  expect(tool!.promptSnippet).toBe('Replace or merge the ordered todo list.');
  expect(tool!.promptGuidelines).toEqual([
    'Copy the selected playbook steps verbatim before task-specific steps.',
    'Keep skipped steps with a reason.',
  ]);
  const properties = (tool!.parameters as { properties?: Record<string, { description?: string }> }).properties;
  expect(properties?.todos?.description).toBeDefined();
  expect(properties?.merge?.description).toBeDefined();
});

test('TodoWrite renderCall formats call summaries', () => {
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, registerTool: (t: ToolDefinition) => { tools.push(t); } } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  const tool = tools.find(t => t.name === 'TodoWrite');
  expect(tool?.renderCall).toBeDefined();
  const empty = tool!.renderCall!({ todos: [] }, mockTheme, {} as never);
  expect(empty.render(80)).toEqual(['*TodoWrite* 0 items']);
  empty.invalidate();
  const single = tool!.renderCall!({ todos: [{ id: '1', content: 'Task', status: 'pending' }] }, mockTheme, {} as never);
  expect(single.render(80)).toEqual(['*TodoWrite* 1 item']);
  single.invalidate();
  const merged = tool!.renderCall!({ todos: [{ id: '1', content: 'A', status: 'pending' }, { id: '2', content: 'B', status: 'pending' }], merge: true }, mockTheme, {} as never);
  expect(merged.render(80)).toEqual(['*TodoWrite* 2 items, merge']);
  merged.invalidate();
});

test('TodoWrite renderResult formats empty, mixed, completed, and truncated lists', () => {
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, registerTool: (t: ToolDefinition) => { tools.push(t); } } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  const tool = tools.find(t => t.name === 'TodoWrite');
  expect(tool?.renderResult).toBeDefined();
  const empty = tool!.renderResult!({ content: [], details: [] }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(empty.render(80)).toEqual(['No todos']);
  empty.invalidate();
  const noDetails = tool!.renderResult!({ content: [], details: undefined }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(noDetails.render(80)).toEqual(['No todos']);
  noDetails.invalidate();
  const todos = [
    { id: '1', content: 'Done', status: 'completed' as const },
    { id: '2', content: 'Active', status: 'in_progress' as const },
    { id: '3', content: 'Skip', status: 'cancelled' as const },
    { id: '4', content: 'Wait', status: 'pending' as const },
  ];
  const mixed = tool!.renderResult!({ content: [], details: todos }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  mixed.invalidate();
  const mixedLines = mixed.render(80);
  expect(mixedLines[0] ?? '').toMatch(/1\/4 completed • 1 in progress/);
  expect(mixedLines.some(l => l.includes('✓ Done'))).toBe(true);
  expect(mixedLines.some(l => l.includes('◐ Active'))).toBe(true);
  expect(mixedLines.some(l => l.includes('⊘ Skip (cancelled)'))).toBe(true);
  expect(mixedLines.some(l => l.includes('○ Wait'))).toBe(true);
  const allDone = tool!.renderResult!({ content: [], details: [{ id: '1', content: 'All', status: 'completed' as const }] }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(allDone.render(80)[0] ?? '').toMatch(/All completed/);
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, content: `Step ${i}`, status: 'pending' as const }));
  const collapsed = tool!.renderResult!({ content: [], details: many }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(collapsed.render(80).length).toBe(10);
  expect(collapsed.render(80).at(-1) ?? '').toMatch(/2 more/);
  const expanded = tool!.renderResult!({ content: [], details: many }, { expanded: true } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(expanded.render(80).length).toBe(11);
});

type Widget = string[] | (() => { render: (width: number) => string[] });

function widgetText(content: Widget | undefined, width = 80): string[] | undefined {
  return typeof content === 'function' ? content().render(width) : content;
}

test('showState widget uses distinct status markers for each status', () => {
  let widget: Widget | undefined;
  const ctx = { ui: { setStatus: () => {}, setWidget: (_key: string, content?: Widget) => { widget = content; } } } as unknown as ExtensionContext;
  const store = createState({ appendEntry() {} } as unknown as ExtensionAPI);
  store.update({
    enabled: true,
    todos: [
      { id: '1', content: 'A', status: 'completed' },
      { id: '2', content: 'B', status: 'in_progress' },
      { id: '3', content: 'C', status: 'cancelled' },
      { id: '4', content: 'D', status: 'pending' },
    ],
  }, ctx);
  expect(widgetText(widget)).toEqual([
    '[x] A (completed)',
    '[>] B (in_progress)',
    '[-] C (cancelled)',
    '[ ] D (pending)',
  ]);
});

test('TodoWrite renderResult keeps every line within the render width', () => {
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, registerTool: (t: ToolDefinition) => { tools.push(t); } } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  const tool = tools.find(t => t.name === 'TodoWrite');
  expect(tool?.renderResult).toBeDefined();
  const content = 'Branch test/vitest-unit-suites; delete all node:test suites and fixtures (subtract first)';
  const result = tool!.renderResult!({ content: [], details: [{ id: '1', content, status: 'pending' as const }] }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(result.render(30)).toEqual([
    '*Todos* 0/1 completed',
    '  ○ Branch test/vitest-unit\x1b[0m...\x1b[0m',
  ]);
});

test('collapsed todo views keep the in-progress step visible in long lists', () => {
  const todos = Array.from({ length: 15 }, (_, i) => ({ id: `s${i + 1}`, content: `Step ${i + 1}`,
    status: i < 11 ? 'completed' as const : i === 11 ? 'in_progress' as const : 'pending' as const }));
  let widget: Widget | undefined;
  const ctx = { ui: { setStatus: () => {}, setWidget: (_key: string, content?: Widget) => { widget = content; } } } as unknown as ExtensionContext;
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, registerTool: (t: ToolDefinition) => { tools.push(t); } } as unknown as ExtensionAPI;
  const store = createState(pi);
  registerStateTools(pi, store);
  store.update({ enabled: false, todos }, ctx);
  expect(widgetText(widget)).toEqual([
    '... 7 earlier',
    '[x] Step 8 (completed)', '[x] Step 9 (completed)', '[x] Step 10 (completed)', '[x] Step 11 (completed)',
    '[>] Step 12 (in_progress)',
    '[ ] Step 13 (pending)', '[ ] Step 14 (pending)', '[ ] Step 15 (pending)',
  ]);
  const tool = tools.find(t => t.name === 'TodoWrite');
  const collapsed = tool!.renderResult!({ content: [], details: todos }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(collapsed.render(80).slice(1, 3)).toEqual(['  ... 7 earlier', '  ✓ Step 8']);
  expect(collapsed.render(80).includes('  ◐ Step 12')).toBe(true);
});

test('todo widget stays one row per step so a normal terminal does not shrink it away', () => {
  let widget: Widget | undefined;
  const ctx = { ui: { setStatus() {}, setWidget(_key: string, content?: Widget) { widget = content; } } } as unknown as ExtensionContext;
  const content = 'Pin the behavior contract first. '.repeat(20);
  createState({ appendEntry() {} } as unknown as ExtensionAPI).update({
    enabled: true,
    todos: [{ id: '1', content, status: 'pending' }],
  }, ctx);
  const lines = widgetText(widget, 40);
  expect(lines).toEqual(['[ ] Pin the behavior contract first. \x1b[0m...\x1b[0m']);
});
