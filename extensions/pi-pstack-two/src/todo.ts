import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
type TodoStatus = (typeof STATUSES)[number];

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface TodoInput {
  id: string;
  content?: string;
  status?: TodoStatus;
}

interface TodoDetails {
  todos: TodoItem[];
}

const WIDGET_KEY = 'pstack-two-todos';
const MARKS: Record<TodoStatus, string> = { pending: '[ ]', in_progress: '[>]', completed: '[x]', cancelled: '[-]' };
const GLYPHS: Record<TodoStatus, string> = { pending: '○', in_progress: '▶', completed: '✓', cancelled: '✗' };

const TodoParams = Type.Object({
  todos: Type.Array(
    Type.Object({
      id: Type.String({ description: 'Unique identifier for the TODO item' }),
      content: Type.Optional(Type.String({ description: 'The description/content of the TODO item. Required for a new item; may be omitted when merging an update.' })),
      status: Type.Optional(StringEnum(STATUSES, { description: 'The current status of the TODO item. Required for a new item; may be omitted when merging an update.' })),
    }),
    { minItems: 1, description: 'Array of TODO items to update or create' },
  ),
  merge: Type.Boolean({
    description:
      'Whether to merge the todos with the existing todos. If true, the todos will be merged into the existing todos based on the id field. You can leave unchanged properties undefined. If false, the new todos will replace the existing todos.',
  }),
});

function complete(item: TodoInput, existing: TodoItem | undefined): TodoItem {
  const content = item.content ?? existing?.content;
  const status = item.status ?? existing?.status;
  if (content === undefined || status === undefined) throw new Error(`Todo "${item.id}" is new, so it needs both content and status.`);
  return { id: item.id, content, status };
}

/** Cursor's TodoWrite rule: merge updates by id and appends new ids; otherwise the call replaces the list. */
export function applyTodoWrite(current: readonly TodoItem[], todos: readonly TodoInput[], merge: boolean): TodoItem[] {
  const seen = new Set<string>();
  for (const item of todos) {
    if (seen.has(item.id)) throw new Error(`Todo id "${item.id}" appears more than once in this call.`);
    seen.add(item.id);
  }
  if (!merge) return todos.map((item) => complete(item, undefined));
  const updates = new Map(todos.map((item) => [item.id, item]));
  const merged = current.map((existing) => {
    const update = updates.get(existing.id);
    return update === undefined ? existing : complete(update, existing);
  });
  const known = new Set(current.map((item) => item.id));
  return [...merged, ...todos.filter((item) => !known.has(item.id)).map((item) => complete(item, undefined))];
}

export function formatTodos(todos: readonly TodoItem[]): string {
  if (todos.length === 0) return 'Todos: none.';
  const done = todos.filter((item) => item.status === 'completed').length;
  const active = todos.filter((item) => item.status === 'in_progress').length;
  const header = `Todos (${done}/${todos.length} completed${active > 0 ? `, ${active} in progress` : ''}):`;
  return [header, ...todos.map((item) => `${MARKS[item.status]} ${item.id}: ${item.content}`)].join('\n');
}

interface BranchEntry {
  type: string;
  message?: { role?: string; toolName?: string; isError?: boolean; details?: unknown };
}

/** The list as of the active branch: the details of the last successful TodoWrite on it. A failed call stores `details: {}`. */
export function todosFromBranch(entries: readonly BranchEntry[]): TodoItem[] {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = entries[index]?.message;
    const todos = (message?.details as Partial<TodoDetails> | undefined)?.todos;
    if (entries[index]?.type === 'message' && message?.role === 'toolResult' && message.toolName === 'TodoWrite' && message.isError !== true && Array.isArray(todos)) return todos;
  }
  return [];
}

function widgetLines(todos: readonly TodoItem[]): string[] | undefined {
  if (todos.length === 0) return undefined;
  return [`Todos ${todos.filter((item) => item.status === 'completed').length}/${todos.length}`, ...todos.map((item) => `${GLYPHS[item.status]} ${item.content}`)];
}

export function registerTodoWrite(pi: ExtensionAPI): void {
  let todos: TodoItem[] = [];
  const show = (ctx: ExtensionContext) => {
    if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, widgetLines(todos));
  };
  const restore = (ctx: ExtensionContext) => {
    todos = todosFromBranch(ctx.sessionManager.getBranch());
    show(ctx);
  };
  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));

  pi.registerTool({
    name: 'TodoWrite',
    label: 'Todos',
    description: 'Use this tool to create and manage a structured task list for your current coding session. Each item has an id, content, and status (pending, in_progress, completed, cancelled).',
    promptSnippet: 'Create and update the todo list for this session',
    promptGuidelines: ['When a skill or playbook says to open a todolist or todo list, call TodoWrite before other work, with the steps it names as the first items.'],
    parameters: TodoParams,
    executionMode: 'sequential',
    annotations: { readOnlyHint: true, openWorldHint: false },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      todos = applyTodoWrite(todos, params.todos, params.merge);
      show(ctx);
      return { content: [{ type: 'text', text: formatTodos(todos) }], details: { todos } };
    },
  });
}
