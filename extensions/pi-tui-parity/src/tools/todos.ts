/**
 * Reference TodosUI as a model-callable todo tool. Research:
 * source-conversation.md §3 (Update/ReadTodos -> TodosUI): rows ordered
 * completed, then in progress, then pending; "✔" green + dim strikethrough,
 * "◐" yellow + yellow text, "○" uncolored + dim text; header "To-do" with
 * "Working on N to-do(s) • M done" or "All done".
 *
 * State lives in tool-result details (official todo.ts example pattern), so it
 * follows the active session branch.
 */

import { type JsonValue, StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI, Theme } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';

export interface TuiTodo {
  readonly id: string;
  readonly content: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}

export interface TodosDetails {
  readonly todos: readonly TuiTodo[];
}

const STATUS_ORDER: Record<TuiTodo['status'], number> = { completed: 0, in_progress: 1, pending: 2 };

const TodoParams = Type.Object({
  todos: Type.Array(
    Type.Object({
      id: Type.String({ description: 'Stable todo id' }),
      content: Type.String({ description: 'What to do' }),
      status: StringEnum(['pending', 'in_progress', 'completed'] as const),
    }),
    { description: 'The complete todo list; replaces the previous list' },
  ),
});

const TodosOutput = Type.Object({
  todos: Type.Array(
    Type.Object({
      id: Type.String({ description: 'Stable todo id' }),
      content: Type.String({ description: 'What to do' }),
      status: StringEnum(['pending', 'in_progress', 'completed'] as const),
    }),
  ),
});

export function sortTodos(todos: readonly TuiTodo[]): TuiTodo[] {
  return [...todos].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.id.localeCompare(b.id));
}

export function todoStatusLine(todos: readonly TuiTodo[], done: boolean): string {
  if (done) return 'All done';
  const completed = todos.filter((t) => t.status === 'completed').length;
  return `Working on ${todos.length} to-do(s) • ${completed} done`;
}

export function todoRows(theme: Theme, todos: readonly TuiTodo[]): string[] {
  const rows: string[] = [];
  for (const todo of sortTodos(todos)) {
    if (todo.status === 'completed') {
      rows.push(`  ${theme.fg('success', '✔')} ${theme.fg('dim', theme.strikethrough(todo.content))}`);
    } else if (todo.status === 'in_progress') {
      rows.push(`  ${theme.fg('warning', '◐')} ${theme.fg('warning', todo.content)}`);
    } else {
      rows.push(`  ○ ${theme.fg('dim', todo.content)}`);
    }
  }
  return rows;
}

export function registerTodosTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'todo_update',
    label: 'todo_update',
    description: 'Write the current to-do list. Provide the complete list every time; statuses are pending, in_progress, or completed. Use one in_progress todo at a time.',
    parameters: TodoParams,
    outputSchema: TodosOutput,
    exposure: 'direct',
    annotations: { idempotentHint: true, openWorldHint: false, destructiveHint: false },
    renderCall: (_args, theme, _context) => new Text(theme.fg('toolTitle', theme.bold('To-do')) + theme.fg('dim', ' Updating to-dos...'), 2, 0),
    async execute(_toolCallId, params) {
      const todos: TuiTodo[] = params.todos.map((t) => ({ id: t.id, content: t.content, status: t.status }));
      const completed = todos.filter((t) => t.status === 'completed').length;
      return {
        content: [{ type: 'text', text: `Updated ${todos.length} to-do(s); ${completed} completed.` }],
        details: { todos } satisfies TodosDetails,
        structuredContent: { todos } as unknown as JsonValue,
      };
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg('dim', 'Updating to-dos...'), 2, 0);
      const details = result.details as TodosDetails | undefined;
      if (!details || details.todos.length === 0) return new Text(theme.fg('dim', 'No to-dos found'), 2, 0);
      const done = details.todos.every((t) => t.status === 'completed');
      const header = `${theme.fg('toolTitle', theme.bold('To-do'))} ${done ? theme.fg('success', 'All done') : theme.fg('dim', todoStatusLine(details.todos, false))}`;
      return new Text([header, ...todoRows(theme, details.todos)].join('\n'), 2, 0);
    },
  });
}
