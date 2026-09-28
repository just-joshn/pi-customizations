import type { ExtensionAPI, ExtensionContext, Theme, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import { truncateToWidth } from '@earendil-works/pi-tui';
import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';
import { boundedResult } from './results.ts';

const Todo = Type.Object({
  id: Type.String({ minLength: 1, description: 'Stable unique identifier for the todo item' }),
  content: Type.String({ minLength: 1, description: 'Description of the todo step or task' }),
  status: Type.String({
    enum: ['pending', 'in_progress', 'completed', 'cancelled'],
    description: 'Current execution status: pending, in_progress, completed, or cancelled',
  }),
});
const State = Type.Object({ enabled: Type.Boolean(), todos: Type.Array(Todo), verificationOffered: Type.Optional(Type.Boolean()) });
type State = Static<typeof State>;

const collapsedTodos = 8;

function todoWindow<T extends Static<typeof Todo>>(todos: readonly T[]) {
  const active = todos.findIndex((t) => t.status === 'in_progress');
  const anchor = active >= 0 ? active : todos.findIndex((t) => t.status === 'pending');
  const start = Math.max(0, Math.min(anchor - 1, todos.length - collapsedTodos));
  const visible = todos.slice(start, start + collapsedTodos);
  return { visible, earlier: start, later: todos.length - start - visible.length };
}

function marker(todo: Static<typeof Todo>): string {
  if (todo.status === 'completed') return '[x]';
  if (todo.status === 'in_progress') return '[>]';
  if (todo.status === 'cancelled') return '[-]';
  return '[ ]';
}

function widgetLines(todos: readonly Static<typeof Todo>[]): string[] {
  const { visible, earlier, later } = todoWindow(todos);
  return [...(earlier ? [`... ${earlier} earlier`] : []), ...visible.map((todo) => `${marker(todo)} ${todo.content} (${todo.status})`), ...(later ? [`... ${later} more`] : [])];
}

function todoWidget(lines: string[]) {
  return () => ({
    render: (width: number) => lines.map((line) => truncateToWidth(line, width)),
    invalidate() {},
  });
}

function renderTodoItem(t: Static<typeof Todo>, theme: Theme): string {
  if (t.status === 'completed') return `  ${theme.fg('success', '✓')} ${theme.fg('dim', t.content)}`;
  if (t.status === 'in_progress') return `  ${theme.fg('warning', '◐')} ${theme.fg('accent', t.content)}`;
  if (t.status === 'cancelled') return `  ${theme.fg('dim', '⊘')} ${theme.fg('dim', t.content)} ${theme.fg('muted', '(cancelled)')}`;
  return `  ${theme.fg('dim', '○')} ${theme.fg('text', t.content)}`;
}

function renderTodoSummary(todos: readonly Static<typeof Todo>[], theme: Theme): string {
  let completed = 0;
  let inProgress = 0;
  for (const t of todos) {
    if (t.status === 'completed') completed++;
    else if (t.status === 'in_progress') inProgress++;
  }
  const total = todos.length;
  const status = completed === total && total > 0 ? theme.fg('success', 'All completed') : theme.fg('muted', `${completed}/${total} completed${inProgress ? ` • ${inProgress} in progress` : ''}`);
  return `${theme.fg('toolTitle', theme.bold('Todos'))} ${status}`;
}

function renderTodoResult(result: { details?: unknown }, options: ToolRenderResultOptions, theme: Theme) {
  const todos = result.details as Static<typeof Todo>[] | undefined;
  if (!todos || todos.length === 0) return { render: () => [theme.fg('dim', 'No todos')], invalidate() {} };
  const header = renderTodoSummary(todos, theme);
  return {
    render: (width: number) => {
      const { visible, earlier, later } = options.expanded ? { visible: todos, earlier: 0, later: 0 } : todoWindow(todos);
      const lines = [header, ...(earlier ? [theme.fg('dim', `  ... ${earlier} earlier`)] : []), ...visible.map((t) => renderTodoItem(t, theme)), ...(later ? [theme.fg('dim', `  ... ${later} more (expand to view all)`)] : [])];
      return lines.map((line) => truncateToWidth(line, width));
    },
    invalidate() {},
  };
}

function renderTodoCall(args: { todos?: Static<typeof Todo>[]; merge?: boolean }, theme: Theme) {
  const count = args.todos?.length ?? 0;
  const mode = args.merge ? ', merge' : '';
  const line = `${theme.fg('toolTitle', theme.bold('TodoWrite'))} ${theme.fg('muted', `${count} item${count === 1 ? '' : 's'}${mode}`)}`;
  return { render: (width: number) => [truncateToWidth(line, width)], invalidate() {} };
}

export function createState(pi: ExtensionAPI) {
  let state: State = { enabled: false, todos: [] };

  const showState = (ctx: ExtensionContext) => {
    ctx.ui.setStatus('pstack', state.enabled ? 'poteto-mode' : undefined);
    ctx.ui.setWidget('pstack-todos', state.todos.length ? todoWidget(widgetLines(state.todos)) : undefined);
  };
  const restore = (ctx: ExtensionContext) => {
    state = { enabled: false, todos: [] };
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === 'custom' && entry.customType === 'pstack-state' && Check(State, entry.data) && new Set(entry.data.todos.map((todo) => todo.id)).size === entry.data.todos.length) state = structuredClone(entry.data);
    }
    showState(ctx);
  };
  const update = (next: State, ctx: ExtensionContext) => {
    state = structuredClone(next);
    pi.appendEntry('pstack-state', structuredClone(state));
    showState(ctx);
  };
  const toggle = (enabled: boolean, ctx: ExtensionContext) => {
    update({ ...state, enabled }, ctx);
  };
  return { read: () => structuredClone(state), update, toggle, restore, showState };
}

export type StateStore = ReturnType<typeof createState>;

export function registerStateTools(pi: ExtensionAPI, store: StateStore): void {
  pi.registerTool({
    executionMode: 'sequential',
    name: 'pstack_mode',
    label: 'Poteto mode',
    description: 'Set sticky Poteto mode when the user requests it or opts out. Persists on the active session branch.',
    promptSnippet: 'Turn sticky Poteto mode on or off for this session branch',
    promptGuidelines: ['pstack_mode changes sticky mode on explicit user entry or opt-out. Recognize natural-language user requests through that tool, not quoted examples.'],
    parameters: Type.Object({ enabled: Type.Boolean() }),
    async execute(_id, params, _signal, _update, ctx) {
      store.toggle(params.enabled, ctx);
      const state = store.read();
      return boundedResult(`Poteto mode is ${state.enabled ? 'on' : 'off'}.`, state, ctx);
    },
  });
  pi.registerTool({
    executionMode: 'sequential',
    name: 'TodoWrite',
    label: 'Pstack todos',
    description: 'Replace or merge the ordered todo list. Copy the selected playbook steps verbatim before task-specific steps. Keep skipped steps with a reason.',
    promptSnippet: 'Replace or merge the ordered todo list.',
    promptGuidelines: ['Copy the selected playbook steps verbatim before task-specific steps.', 'Keep skipped steps with a reason.'],
    parameters: Type.Object({
      todos: Type.Array(Todo, { description: 'The list of todo items to set or merge' }),
      merge: Type.Optional(Type.Boolean({ description: 'If true, merges with existing todos by id while preserving order; if false or omitted, replaces the entire todo list' })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      if (new Set(params.todos.map((todo) => todo.id)).size !== params.todos.length) throw new Error('Todo IDs must be unique.');
      const state = store.read();
      const todos = new Map([...(params.merge ? state.todos : []), ...params.todos].map((todo) => [todo.id, todo]));
      const next = { ...state, todos: [...todos.values()] };
      store.update(next, ctx);
      const published = store.read().todos;
      return boundedResult(JSON.stringify(published), published, ctx);
    },
    renderCall: renderTodoCall,
    renderResult: renderTodoResult,
  });
}
