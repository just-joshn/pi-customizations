import assert from 'node:assert/strict';
import test from 'node:test';
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
  assert.ok(tool);
  const todo = Object.freeze({ id: 'one', content: 'First', status: 'pending' });
  const params = Object.freeze({ todos: Object.freeze([todo]) });
  const result = await tool.execute('one', params, undefined, undefined, ctx);
  const todos = result.details as typeof params.todos;
  assert.deepEqual(todos, [{ id: 'one', content: 'First', status: 'pending' }]);
  assert.notEqual(todos, params.todos);
  assert.notEqual(todos[0], params.todos[0]);
  await tool.execute('two', { todos: [{ id: 'one', content: 'Second', status: 'completed' }] }, undefined, undefined, ctx);
  assert.equal(todos[0]?.content, 'First');
  assert.equal(store.read().todos[0]?.content, 'Second');
});

test('state snapshots never alias caller input, published entries, or previous reads', () => {
  const published: unknown[] = [];
  const pi = { appendEntry: (_type: string, data: unknown) => { published.push(data); } } as unknown as ExtensionAPI;
  const ctx = { ui: { setStatus: () => {}, setWidget: () => {} } } as unknown as ExtensionContext;
  const store = createState(pi);
  const input = { enabled: true, todos: [{ id: 'one', content: 'First', status: 'pending' as const }] };
  store.update(input, ctx);
  const snapshot = store.read();
  assert.deepEqual(snapshot, input);
  assert.notEqual(snapshot, input);
  assert.notEqual(snapshot.todos[0], input.todos[0]);
  assert.notEqual(snapshot, published[0]);
  assert.notEqual(store.read().todos, snapshot.todos);
  store.toggle(false, ctx);
  assert.equal(snapshot.enabled, true);
  assert.equal(store.read().enabled, false);
});

test('pstack_mode tool toggles mode and returns bounded confirmation', async () => {
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, registerTool: (t: ToolDefinition) => { tools.push(t); } } as unknown as ExtensionAPI;
  const ctx = { ui: { setStatus: () => {}, setWidget: () => {} } } as unknown as ExtensionContext;
  const store = createState(pi);
  registerStateTools(pi, store);
  const modeTool = tools.find(t => t.name === 'pstack_mode');
  assert.ok(modeTool);
  const on = await modeTool.execute('1', { enabled: true }, undefined, undefined, ctx);
  assert.match(JSON.stringify(on.content), /Poteto mode is on/);
  assert.equal(store.read().enabled, true);
  const off = await modeTool.execute('2', { enabled: false }, undefined, undefined, ctx);
  assert.match(JSON.stringify(off.content), /Poteto mode is off/);
  assert.equal(store.read().enabled, false);
});

test('TodoWrite registers promptSnippet, promptGuidelines, and schema descriptions', () => {
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, registerTool: (t: ToolDefinition) => { tools.push(t); } } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  const tool = tools.find(t => t.name === 'TodoWrite');
  assert.ok(tool);
  assert.equal(tool.promptSnippet, 'Replace or merge the ordered todo list.');
  assert.deepEqual(tool.promptGuidelines, [
    'Copy the selected playbook steps verbatim before task-specific steps.',
    'Keep skipped steps with a reason.',
  ]);
  const properties = (tool.parameters as { properties?: Record<string, { description?: string }> }).properties;
  assert.ok(properties?.todos?.description);
  assert.ok(properties?.merge?.description);
});

test('TodoWrite renderCall formats call summaries', () => {
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, registerTool: (t: ToolDefinition) => { tools.push(t); } } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  const tool = tools.find(t => t.name === 'TodoWrite');
  assert.ok(tool?.renderCall);
  const empty = tool.renderCall({ todos: [] }, mockTheme, {} as never);
  assert.deepEqual(empty.render(80), ['*TodoWrite* 0 items']);
  empty.invalidate();
  const single = tool.renderCall({ todos: [{ id: '1', content: 'Task', status: 'pending' }] }, mockTheme, {} as never);
  assert.deepEqual(single.render(80), ['*TodoWrite* 1 item']);
  single.invalidate();
  const merged = tool.renderCall({ todos: [{ id: '1', content: 'A', status: 'pending' }, { id: '2', content: 'B', status: 'pending' }], merge: true }, mockTheme, {} as never);
  assert.deepEqual(merged.render(80), ['*TodoWrite* 2 items, merge']);
  merged.invalidate();
});

test('TodoWrite renderResult formats empty, mixed, completed, and truncated lists', () => {
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, registerTool: (t: ToolDefinition) => { tools.push(t); } } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  const tool = tools.find(t => t.name === 'TodoWrite');
  assert.ok(tool?.renderResult);
  const empty = tool.renderResult({ content: [], details: [] }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  assert.deepEqual(empty.render(80), ['No todos']);
  empty.invalidate();
  const noDetails = tool.renderResult({ content: [], details: undefined }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  assert.deepEqual(noDetails.render(80), ['No todos']);
  noDetails.invalidate();
  const todos = [
    { id: '1', content: 'Done', status: 'completed' as const },
    { id: '2', content: 'Active', status: 'in_progress' as const },
    { id: '3', content: 'Skip', status: 'cancelled' as const },
    { id: '4', content: 'Wait', status: 'pending' as const },
  ];
  const mixed = tool.renderResult({ content: [], details: todos }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  mixed.invalidate();
  const mixedLines = mixed.render(80);
  assert.match(mixedLines[0] ?? '', /1\/4 completed • 1 in progress/);
  assert.ok(mixedLines.some(l => l.includes('✓ Done')));
  assert.ok(mixedLines.some(l => l.includes('◐ Active')));
  assert.ok(mixedLines.some(l => l.includes('⊘ Skip (cancelled)')));
  assert.ok(mixedLines.some(l => l.includes('○ Wait')));
  const allDone = tool.renderResult({ content: [], details: [{ id: '1', content: 'All', status: 'completed' as const }] }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  assert.match(allDone.render(80)[0] ?? '', /All completed/);
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, content: `Step ${i}`, status: 'pending' as const }));
  const collapsed = tool.renderResult({ content: [], details: many }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  assert.equal(collapsed.render(80).length, 10);
  assert.match(collapsed.render(80).at(-1) ?? '', /2 more/);
  const expanded = tool.renderResult({ content: [], details: many }, { expanded: true } as ToolRenderResultOptions, mockTheme, {} as never);
  assert.equal(expanded.render(80).length, 11);
});

test('showState widget uses distinct status markers for each status', () => {
  let widgetLines: string[] | undefined;
  const ctx = { ui: { setStatus: () => {}, setWidget: (_key: string, lines?: string[]) => { widgetLines = lines; } } } as unknown as ExtensionContext;
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
  assert.deepEqual(widgetLines, [
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
  assert.ok(tool?.renderResult);
  const content = 'Branch test/vitest-unit-suites; delete all node:test suites and fixtures (subtract first)';
  const result = tool.renderResult({ content: [], details: [{ id: '1', content, status: 'pending' as const }] }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  assert.deepEqual(result.render(30), [
    '*Todos* 0/1 completed',
    '  ○ Branch test/vitest-unit\x1b[0m...\x1b[0m',
  ]);
});

test('collapsed todo views keep the in-progress step visible in long lists', () => {
  const todos = Array.from({ length: 15 }, (_, i) => ({ id: `s${i + 1}`, content: `Step ${i + 1}`,
    status: i < 11 ? 'completed' as const : i === 11 ? 'in_progress' as const : 'pending' as const }));
  let widgetLines: string[] | undefined;
  const ctx = { ui: { setStatus: () => {}, setWidget: (_key: string, lines?: string[]) => { widgetLines = lines; } } } as unknown as ExtensionContext;
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, registerTool: (t: ToolDefinition) => { tools.push(t); } } as unknown as ExtensionAPI;
  const store = createState(pi);
  registerStateTools(pi, store);
  store.update({ enabled: false, todos }, ctx);
  assert.deepEqual(widgetLines, [
    '... 7 earlier',
    '[x] Step 8 (completed)', '[x] Step 9 (completed)', '[x] Step 10 (completed)', '[x] Step 11 (completed)',
    '[>] Step 12 (in_progress)',
    '[ ] Step 13 (pending)', '[ ] Step 14 (pending)', '[ ] Step 15 (pending)',
  ]);
  const tool = tools.find(t => t.name === 'TodoWrite');
  const collapsed = tool!.renderResult!({ content: [], details: todos }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  assert.deepEqual(collapsed.render(80).slice(1, 3), ['  ... 7 earlier', '  ✓ Step 8']);
  assert.ok(collapsed.render(80).includes('  ◐ Step 12'));
});
