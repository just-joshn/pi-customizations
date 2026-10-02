import type { ExtensionAPI, ExtensionContext, ExtensionToolContext, Theme, ToolDefinition, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { expect, test } from 'vitest';
import { registerContext } from '../src/context.ts';
import { registerQuestions } from '../src/questions.ts';
import { registerShells } from '../src/shells.ts';
import { createState, registerStateTools } from '../src/state.ts';
import { registerWorkers } from '../src/workers.ts';

const mockTheme = {
  fg: (_role: string, text: string) => text,
  bg: (_role: string, text: string) => text,
  bold: (text: string) => `*${text}*`,
} as unknown as Theme;

test('TodoWrite publishes independent todos rather than caller-owned records', async () => {
  const tools: ToolDefinition[] = [];
  const pi = {
    appendEntry() {},
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  const ctx = { ui: { setStatus() {}, setWidget() {} } } as unknown as ExtensionToolContext;
  const store = createState(pi);
  registerStateTools(pi, store);
  const tool = tools.find((tool) => tool.name === 'TodoWrite');
  expect(tool).toBeDefined();
  const todo = Object.freeze({ id: 'one', content: 'First', status: 'pending' });
  const params = Object.freeze({ todos: Object.freeze([todo]) });
  const result = await tool?.execute('one', params, undefined, undefined, ctx);
  if (!result) throw new Error('missing result');
  const todos = result.details as typeof params.todos;
  expect(todos).toEqual([{ id: 'one', content: 'First', status: 'pending' }]);
  expect(todos).not.toBe(params.todos);
  expect(todos[0]).not.toBe(params.todos[0]);
  await tool?.execute('two', { todos: [{ id: 'one', content: 'Second', status: 'completed' }] }, undefined, undefined, ctx);
  expect(todos[0]?.content).toBe('First');
  expect(store.read().todos[0]?.content).toBe('Second');
});

test('state snapshots never alias caller input, published entries, or previous reads', () => {
  const published: unknown[] = [];
  const pi = {
    appendEntry: (_type: string, data: unknown) => {
      published.push(data);
    },
  } as unknown as ExtensionAPI;
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
  const pi = {
    appendEntry() {},
    registerTool: (t: ToolDefinition) => {
      tools.push(t);
    },
  } as unknown as ExtensionAPI;
  const ctx = { ui: { setStatus: () => {}, setWidget: () => {} } } as unknown as ExtensionToolContext;
  const store = createState(pi);
  registerStateTools(pi, store);
  const modeTool = tools.find((t) => t.name === 'pstack_mode');
  expect(modeTool).toBeDefined();
  expect(modeTool?.outputSchema).toBeDefined();
  expect(modeTool?.exposure).toBe('direct');
  expect(modeTool?.annotations).toEqual({ idempotentHint: true, openWorldHint: false, destructiveHint: false });
  const on = await modeTool?.execute('1', { enabled: true }, undefined, undefined, ctx);
  expect(on?.content).toEqual([{ type: 'text', text: 'Poteto mode is on.' }]);
  expect(on?.structuredContent).toEqual({ enabled: true, todos: [] });
  expect(store.read().enabled).toBe(true);
  const off = await modeTool?.execute('2', { enabled: false }, undefined, undefined, ctx);
  expect(off?.content).toEqual([{ type: 'text', text: 'Poteto mode is off.' }]);
  expect(off?.structuredContent).toEqual({ enabled: false, todos: [] });
  expect(store.read().enabled).toBe(false);
});

test('TodoWrite registers promptSnippet, promptGuidelines, and schema descriptions', () => {
  const tools: ToolDefinition[] = [];
  const pi = {
    appendEntry() {},
    registerTool: (t: ToolDefinition) => {
      tools.push(t);
    },
  } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  const tool = tools.find((t) => t.name === 'TodoWrite');
  expect(tool).toBeDefined();
  expect(tool?.promptSnippet).toBe('Replace or merge the ordered todo list.');
  expect(tool?.promptGuidelines).toEqual(['Copy the selected playbook steps verbatim before task-specific steps.', 'Keep skipped steps with a reason.']);
  const properties = (tool?.parameters as { properties?: Record<string, { description?: string }> } | undefined)?.properties;
  expect(properties?.todos?.description).toBe('The list of todo items to set or merge');
  expect(properties?.merge?.description).toBe('If true, merges with existing todos by id while preserving order; if false or omitted, replaces the entire todo list');
});

test('TodoWrite renderCall formats call summaries', () => {
  const tools: ToolDefinition[] = [];
  const pi = {
    appendEntry() {},
    registerTool: (t: ToolDefinition) => {
      tools.push(t);
    },
  } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  const tool = tools.find((t) => t.name === 'TodoWrite');
  expect(tool?.renderCall).toBeDefined();
  const empty = tool?.renderCall?.({ todos: [] }, mockTheme, {} as never);
  expect(empty?.render(80)).toEqual(['*TodoWrite* 0 items']);
  empty?.invalidate();
  const single = tool?.renderCall?.({ todos: [{ id: '1', content: 'Task', status: 'pending' }] }, mockTheme, {} as never);
  expect(single?.render(80)).toEqual(['*TodoWrite* 1 item']);
  single?.invalidate();
  const merged = tool?.renderCall?.(
    {
      todos: [
        { id: '1', content: 'A', status: 'pending' },
        { id: '2', content: 'B', status: 'pending' },
      ],
      merge: true,
    },
    mockTheme,
    {} as never,
  );
  expect(merged?.render(80)).toEqual(['*TodoWrite* 2 items, merge']);
  merged?.invalidate();
});

test('TodoWrite renderResult formats empty, mixed, completed, and truncated lists', () => {
  const tools: ToolDefinition[] = [];
  const pi = {
    appendEntry() {},
    registerTool: (t: ToolDefinition) => {
      tools.push(t);
    },
  } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  const tool = tools.find((t) => t.name === 'TodoWrite');
  expect(tool?.renderResult).toBeDefined();
  const empty = tool?.renderResult?.({ content: [], details: [] }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(empty?.render(80)).toEqual(['No todos']);
  empty?.invalidate();
  const noDetails = tool?.renderResult?.({ content: [], details: undefined }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(noDetails?.render(80)).toEqual(['No todos']);
  noDetails?.invalidate();
  const todos = [
    { id: '1', content: 'Done', status: 'completed' as const },
    { id: '2', content: 'Active', status: 'in_progress' as const },
    { id: '3', content: 'Skip', status: 'cancelled' as const },
    { id: '4', content: 'Wait', status: 'pending' as const },
  ];
  const mixed = tool?.renderResult?.({ content: [], details: todos }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  mixed?.invalidate();
  const mixedLines = mixed?.render(80) ?? [];
  expect(mixedLines[0] ?? '').toMatch(/1\/4 completed • 1 in progress/);
  expect(mixedLines.some((l) => l.includes('✓ Done'))).toBe(true);
  expect(mixedLines.some((l) => l.includes('◐ Active'))).toBe(true);
  expect(mixedLines.some((l) => l.includes('⊘ Skip (cancelled)'))).toBe(true);
  expect(mixedLines.some((l) => l.includes('○ Wait'))).toBe(true);
  const allDone = tool?.renderResult?.({ content: [], details: [{ id: '1', content: 'All', status: 'completed' as const }] }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(allDone?.render(80)[0] ?? '').toMatch(/All completed/);
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, content: `Step ${i}`, status: 'pending' as const }));
  const collapsed = tool?.renderResult?.({ content: [], details: many }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(collapsed?.render(80).length).toBe(10);
  expect(collapsed?.render(80).at(-1) ?? '').toMatch(/2 more/);
  const expanded = tool?.renderResult?.({ content: [], details: many }, { expanded: true } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(expanded?.render(80).length).toBe(11);
});

type Widget = string[] | (() => { render: (width: number) => string[] });

function widgetText(content: Widget | undefined, width = 80): string[] | undefined {
  return typeof content === 'function' ? content().render(width) : content;
}

const multilineStatusTodos = Object.freeze([
  Object.freeze({ id: 'lf', content: 'First line\nSecond line', status: 'pending' as const }),
  Object.freeze({ id: 'crlf', content: 'First line\r\nSecond line', status: 'in_progress' as const }),
  Object.freeze({ id: 'cr', content: 'First line\rSecond line', status: 'completed' as const }),
  Object.freeze({ id: 'repeated', content: 'First line\r\n\n\rSecond line', status: 'cancelled' as const }),
]);

const multilineWindowTodos = Object.freeze([
  Object.freeze({ id: 'one', content: 'Done one\nwrapped', status: 'completed' as const }),
  Object.freeze({ id: 'two', content: 'Done two\r\nwrapped', status: 'completed' as const }),
  Object.freeze({ id: 'three', content: 'Cancel\rwrapped', status: 'cancelled' as const }),
  Object.freeze({ id: 'four', content: 'Done four\r\n\n\rwrapped', status: 'completed' as const }),
  Object.freeze({ id: 'five', content: 'Done five', status: 'completed' as const }),
  Object.freeze({ id: 'six', content: 'Done six', status: 'completed' as const }),
  Object.freeze({ id: 'active', content: 'Active\nnow', status: 'in_progress' as const }),
  Object.freeze({ id: 'eight', content: 'Done eight', status: 'completed' as const }),
  Object.freeze({ id: 'nine', content: 'Done nine', status: 'completed' as const }),
  Object.freeze({ id: 'ten', content: 'Pending\r\nnext', status: 'pending' as const }),
  Object.freeze({ id: 'eleven', content: 'Pending eleven', status: 'pending' as const }),
  Object.freeze({ id: 'twelve', content: 'Pending twelve', status: 'pending' as const }),
]);

const addedMultilineTodo = Object.freeze({ id: 'added', content: 'Added\r\nline\nagain', status: 'pending' as const });
const mergedMultilineTodos = [...multilineStatusTodos, addedMultilineTodo];
const initialMultilineRpcRows = ['[ ] First line\nSecond line (pending)', '[>] First line\r\nSecond line (in_progress)', '[x] First line\rSecond line (completed)', '[-] First line\r\n\n\rSecond line (cancelled)'];
const mergedMultilineRpcRows = [
  '[ ] First line\nSecond line (pending)',
  '[>] First line\r\nSecond line (in_progress)',
  '[x] First line\rSecond line (completed)',
  '[-] First line\r\n\n\rSecond line (cancelled)',
  '[ ] Added\r\nline\nagain (pending)',
];

function createRpcTodoWriteFixture() {
  const published: unknown[] = [];
  const tools: ToolDefinition[] = [];
  let rpcWidget: Widget | undefined;
  const pi = {
    appendEntry: (_type: string, data: unknown) => {
      published.push(data);
    },
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  const rpcContext = {
    mode: 'rpc',
    ui: {
      setStatus() {},
      setWidget(_key: string, content?: Widget) {
        rpcWidget = content;
      },
    },
  } as unknown as ExtensionToolContext;
  const store = createState(pi);
  registerStateTools(pi, store);
  const tool = tools.find((entry) => entry.name === 'TodoWrite');
  if (!tool) throw new Error('missing TodoWrite tool');
  return {
    published,
    rpcContext,
    store,
    tool,
    get widget() {
      return rpcWidget;
    },
  };
}

test('TodoWrite preserves raw multiline content across state, merge, and RPC', async () => {
  const fixture = createRpcTodoWriteFixture();
  const { published, rpcContext, store, tool } = fixture;
  const result = await tool.execute('initial', { todos: [...multilineStatusTodos] }, undefined, undefined, rpcContext);
  if (!result) throw new Error('missing result');
  expect(store.read().todos).toEqual(multilineStatusTodos);
  expect(published).toEqual([{ enabled: false, todos: multilineStatusTodos }]);
  expect(result.details).toEqual(multilineStatusTodos);
  expect(result.structuredContent).toEqual(multilineStatusTodos);
  expect(result.content).toEqual([
    {
      type: 'text',
      text: '[{"id":"lf","content":"First line\\nSecond line","status":"pending"},{"id":"crlf","content":"First line\\r\\nSecond line","status":"in_progress"},{"id":"cr","content":"First line\\rSecond line","status":"completed"},{"id":"repeated","content":"First line\\r\\n\\n\\rSecond line","status":"cancelled"}]',
    },
  ]);
  expect(fixture.widget).toEqual(initialMultilineRpcRows);

  const merged = await tool.execute('merge', { todos: [addedMultilineTodo], merge: true }, undefined, undefined, rpcContext);
  if (!merged) throw new Error('missing merged result');
  expect(store.read().todos).toEqual(mergedMultilineTodos);
  expect(published).toEqual([
    { enabled: false, todos: multilineStatusTodos },
    { enabled: false, todos: mergedMultilineTodos },
  ]);
  expect(merged.details).toEqual(mergedMultilineTodos);
  expect(merged.structuredContent).toEqual(mergedMultilineTodos);
  expect(merged.content).toEqual([
    {
      type: 'text',
      text: '[{"id":"lf","content":"First line\\nSecond line","status":"pending"},{"id":"crlf","content":"First line\\r\\nSecond line","status":"in_progress"},{"id":"cr","content":"First line\\rSecond line","status":"completed"},{"id":"repeated","content":"First line\\r\\n\\n\\rSecond line","status":"cancelled"},{"id":"added","content":"Added\\r\\nline\\nagain","status":"pending"}]',
    },
  ]);
  expect(fixture.widget).toEqual(mergedMultilineRpcRows);
});

test('TodoWrite restores raw multiline content to state and RPC', async () => {
  const fixture = createRpcTodoWriteFixture();
  await fixture.tool.execute('initial', { todos: [...multilineStatusTodos] }, undefined, undefined, fixture.rpcContext);
  await fixture.tool.execute('merge', { todos: [addedMultilineTodo], merge: true }, undefined, undefined, fixture.rpcContext);
  let restoredWidget: Widget | undefined;
  const restoreContext = {
    mode: 'rpc',
    sessionManager: {
      getBranch: () => fixture.published.map((data) => ({ type: 'custom', customType: 'pstack-state', data })),
    },
    ui: {
      setStatus() {},
      setWidget(_key: string, content?: Widget) {
        restoredWidget = content;
      },
    },
  } as unknown as ExtensionContext;
  const restored = createState({ appendEntry() {} } as unknown as ExtensionAPI);
  restored.restore(restoreContext);
  expect(restored.read().todos).toEqual(mergedMultilineTodos);
  expect(restoredWidget).toEqual(mergedMultilineRpcRows);
});

test('TodoWrite compacts each newline form in captured TUI rows', async () => {
  const tools: ToolDefinition[] = [];
  const pi = {
    appendEntry() {},
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  let widget: Widget | undefined;
  const context = {
    mode: 'tui',
    ui: {
      setStatus() {},
      setWidget(_key: string, content?: Widget) {
        widget = content;
      },
    },
  } as unknown as ExtensionToolContext;
  const store = createState(pi);
  registerStateTools(pi, store);
  const todoTool = tools.find((tool) => tool.name === 'TodoWrite');
  const result = await todoTool?.execute('render', { todos: [...multilineStatusTodos] }, undefined, undefined, context);
  expect(result?.details).toEqual(multilineStatusTodos);
  expect(widgetText(widget)).toEqual(['[ ] First line Second line (pending)', '[>] First line Second line (in_progress)', '[x] First line Second line (completed)', '[-] First line Second line (cancelled)']);
});

test('multiline widget rows compact before narrow-width truncation', () => {
  let widget: Widget | undefined;
  const context = {
    mode: 'tui',
    ui: {
      setStatus() {},
      setWidget(_key: string, content?: Widget) {
        widget = content;
      },
    },
  } as unknown as ExtensionContext;
  createState({ appendEntry() {} } as unknown as ExtensionAPI).update({ enabled: false, todos: [{ id: 'narrow', content: 'Alpha\nBeta gamma', status: 'pending' }] }, context);
  const widgetRows = widgetText(widget, 18) ?? [];
  expect(widgetRows.map(stripTerminalSequences)).toEqual(['[ ] Alpha Beta ...']);
  expect(widgetRows.every((row) => visibleWidth(row) <= 18)).toBe(true);
});

test('TodoWrite renderResult truncates compact multiline rows to the requested width', () => {
  const tools: ToolDefinition[] = [];
  const pi = {
    appendEntry() {},
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  const todoTool = tools.find((tool) => tool.name === 'TodoWrite');
  const result = todoTool?.renderResult?.({ content: [], details: [{ id: 'long', content: 'Long\ncontent to truncate', status: 'pending' }] }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  const rows = result?.render(22) ?? [];
  expect(rows.map(stripTerminalSequences)).toEqual(['*Todos* 0/1 completed', '  ○ Long content to...']);
  expect(rows.every((row) => visibleWidth(row) <= 22)).toBe(true);
});

test('collapsed TUI todo window keeps the active multiline item visible', () => {
  let widget: Widget | undefined;
  const context = {
    mode: 'tui',
    ui: {
      setStatus() {},
      setWidget(_key: string, content?: Widget) {
        widget = content;
      },
    },
  } as unknown as ExtensionContext;
  const store = createState({ appendEntry() {} } as unknown as ExtensionAPI);
  store.update({ enabled: false, todos: [...multilineWindowTodos] }, context);
  expect(widgetText(widget)).toEqual([
    '... 4 earlier',
    '[x] Done five (completed)',
    '[x] Done six (completed)',
    '[>] Active now (in_progress)',
    '[x] Done eight (completed)',
    '[x] Done nine (completed)',
    '[ ] Pending next (pending)',
    '[ ] Pending eleven (pending)',
    '[ ] Pending twelve (pending)',
  ]);
});

test.each([
  {
    view: 'collapsed',
    expanded: false,
    expected: ['*Todos* 7/12 completed • 1 in progress', '  ... 4 earlier', '  ✓ Done five', '  ✓ Done six', '  ◐ Active now', '  ✓ Done eight', '  ✓ Done nine', '  ○ Pending next', '  ○ Pending eleven', '  ○ Pending twelve'],
  },
  {
    view: 'expanded',
    expanded: true,
    expected: [
      '*Todos* 7/12 completed • 1 in progress',
      '  ✓ Done one wrapped',
      '  ✓ Done two wrapped',
      '  ⊘ Cancel wrapped (cancelled)',
      '  ✓ Done four wrapped',
      '  ✓ Done five',
      '  ✓ Done six',
      '  ◐ Active now',
      '  ✓ Done eight',
      '  ✓ Done nine',
      '  ○ Pending next',
      '  ○ Pending eleven',
      '  ○ Pending twelve',
    ],
  },
])('TodoWrite $view renderResult compacts line breaks and keeps the active window', ({ expanded, expected }) => {
  const tools: ToolDefinition[] = [];
  const pi = {
    appendEntry() {},
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  const todoTool = tools.find((tool) => tool.name === 'TodoWrite');
  const result = todoTool?.renderResult?.({ content: [], details: multilineWindowTodos }, { expanded } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(result?.render(80)).toEqual(expected);
});

test('showState widget uses distinct status markers for each status', () => {
  let widget: Widget | undefined;
  const ctx = {
    ui: {
      setStatus: () => {},
      setWidget: (_key: string, content?: Widget) => {
        widget = content;
      },
    },
  } as unknown as ExtensionContext;
  const store = createState({ appendEntry() {} } as unknown as ExtensionAPI);
  store.update(
    {
      enabled: true,
      todos: [
        { id: '1', content: 'A', status: 'completed' },
        { id: '2', content: 'B', status: 'in_progress' },
        { id: '3', content: 'C', status: 'cancelled' },
        { id: '4', content: 'D', status: 'pending' },
      ],
    },
    ctx,
  );
  expect(widgetText(widget)).toEqual(['[x] A (completed)', '[>] B (in_progress)', '[-] C (cancelled)', '[ ] D (pending)']);
});

test('a non-TUI session receives widget lines instead of a component factory', () => {
  const widgets: Widget[] = [];
  const ctx = {
    mode: 'rpc',
    ui: {
      setStatus: () => {},
      setWidget: (_key: string, content?: Widget) => {
        widgets.push(content as Widget);
      },
    },
  } as unknown as ExtensionContext;
  const store = createState({ appendEntry() {} } as unknown as ExtensionAPI);
  store.update({ enabled: false, todos: [{ id: '1', content: 'A', status: 'pending' }] }, ctx);
  expect(widgets.at(-1)).toEqual(['[ ] A (pending)']);
});

test('a TUI session receives a component factory for the todo widget', () => {
  const widgets: Widget[] = [];
  const ctx = {
    mode: 'tui',
    ui: {
      setStatus: () => {},
      setWidget: (_key: string, content?: Widget) => {
        widgets.push(content as Widget);
      },
    },
  } as unknown as ExtensionContext;
  const store = createState({ appendEntry() {} } as unknown as ExtensionAPI);
  store.update({ enabled: false, todos: [{ id: '1', content: 'A', status: 'pending' }] }, ctx);
  expect(typeof widgets.at(-1)).toBe('function');
});

test('TodoWrite renderResult keeps every line within the render width', () => {
  const tools: ToolDefinition[] = [];
  const pi = {
    appendEntry() {},
    registerTool: (t: ToolDefinition) => {
      tools.push(t);
    },
  } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  const tool = tools.find((t) => t.name === 'TodoWrite');
  expect(tool?.renderResult).toBeDefined();
  const content = 'Branch test/vitest-unit-suites; delete all node:test suites and fixtures (subtract first)';
  const result = tool?.renderResult?.({ content: [], details: [{ id: '1', content, status: 'pending' as const }] }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(result?.render(30)).toEqual(['*Todos* 0/1 completed', '  ○ Branch test/vitest-unit\x1b[0m...\x1b[0m']);
});

test('collapsed todo views keep the in-progress step visible in long lists', () => {
  const todos = Array.from({ length: 15 }, (_, i) => ({ id: `s${i + 1}`, content: `Step ${i + 1}`, status: i < 11 ? ('completed' as const) : i === 11 ? ('in_progress' as const) : ('pending' as const) }));
  let widget: Widget | undefined;
  const ctx = {
    ui: {
      setStatus: () => {},
      setWidget: (_key: string, content?: Widget) => {
        widget = content;
      },
    },
  } as unknown as ExtensionContext;
  const tools: ToolDefinition[] = [];
  const pi = {
    appendEntry() {},
    registerTool: (t: ToolDefinition) => {
      tools.push(t);
    },
  } as unknown as ExtensionAPI;
  const store = createState(pi);
  registerStateTools(pi, store);
  store.update({ enabled: false, todos }, ctx);
  expect(widgetText(widget)).toEqual([
    '... 7 earlier',
    '[x] Step 8 (completed)',
    '[x] Step 9 (completed)',
    '[x] Step 10 (completed)',
    '[x] Step 11 (completed)',
    '[>] Step 12 (in_progress)',
    '[ ] Step 13 (pending)',
    '[ ] Step 14 (pending)',
    '[ ] Step 15 (pending)',
  ]);
  const tool = tools.find((t) => t.name === 'TodoWrite');
  const collapsed = tool?.renderResult?.({ content: [], details: todos }, { expanded: false } as ToolRenderResultOptions, mockTheme, {} as never);
  expect(collapsed?.render(80).slice(1, 3)).toEqual(['  ... 7 earlier', '  ✓ Step 8']);
  expect(collapsed?.render(80).includes('  ◐ Step 12')).toBe(true);
});

test('todo widget stays one row per step so a normal terminal does not shrink it away', () => {
  let widget: Widget | undefined;
  const ctx = {
    mode: 'tui',
    ui: {
      setStatus() {},
      setWidget(_key: string, content?: Widget) {
        widget = content;
      },
    },
  } as unknown as ExtensionContext;
  const content = 'Pin the behavior contract first. '.repeat(20);
  createState({ appendEntry() {} } as unknown as ExtensionAPI).update(
    {
      enabled: true,
      todos: [{ id: '1', content, status: 'pending' }],
    },
    ctx,
  );
  const lines = widgetText(widget, 40);
  expect(lines).toEqual(['[ ] Pin the behavior contract first. \x1b[0m...\x1b[0m']);
});

test('all pstack tools declare outputSchema, exposure, and annotations conforming to Pi 0.99 mechanisms', () => {
  const tools: ToolDefinition[] = [];
  const pi = {
    events: {
      emit() {},
      on() {
        return () => {};
      },
    },
    appendEntry() {},
    registerTool: (t: ToolDefinition) => {
      tools.push(t);
    },
    on() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;
  registerStateTools(pi, createState(pi));
  registerContext(pi);
  registerQuestions(pi);
  registerShells(pi);
  registerWorkers(pi);
  expect(tools.map((t) => t.name).sort()).toEqual([
    'AskQuestion',
    'BackgroundShell',
    ...['List', 'Stop'].map((action) => `BackgroundShell${action}`),
    'Task',
    'TaskAttach',
    'TaskList',
    'TaskMessage',
    'TaskOutput',
    'TaskStop',
    'TodoWrite',
    'list_agents',
    'pstack_context',
    'pstack_mode',
    'read_agent',
    'task',
    'write_agent',
  ]);
  expect(tools.length).toBe(17);
  for (const tool of tools) {
    expect(tool.outputSchema).toBeDefined();
    expect(tool.exposure).toBeDefined();
    expect(tool.annotations).toBeDefined();
  }
  const questionTool = tools.find((t) => t.name === 'AskQuestion');
  expect(questionTool?.exposure).toBe('model-only');
});
