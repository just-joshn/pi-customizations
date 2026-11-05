import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
type TodoStatus = (typeof STATUSES)[number];

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  dependencies?: string[];
}

export interface TodoInput {
  id: string;
  content?: string;
  status?: TodoStatus;
  dependencies?: string[];
}

interface TodoDetails {
  todos: TodoItem[];
}

const TODO_ENTRY = 'pstack/todos';
const WIDGET_KEY = 'pstack-todos';
const MARKS: Record<TodoStatus, string> = { pending: '[ ]', in_progress: '[>]', completed: '[x]', cancelled: '[-]' };
const GLYPHS: Record<TodoStatus, string> = { pending: '○', in_progress: '▶', completed: '✓', cancelled: '✗' };

const TodoParams = Type.Object({
  todos: Type.Array(
    Type.Object({
      id: Type.String({ description: 'Unique identifier for the TODO item' }),
      content: Type.Optional(Type.String({ description: 'The description/content of the TODO item. Required for a new item; may be omitted when merging an update.' })),
      status: Type.Optional(Type.Enum(STATUSES, { type: 'string', description: 'The current status of the TODO item. Required for a new item; may be omitted when merging an update.' })),
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
  const dependencies = item.dependencies ?? existing?.dependencies;
  return { id: item.id, content, status, ...(dependencies === undefined ? {} : { dependencies }) };
}

/** TodoWrite: merge updates by id and appends new ids; otherwise the call replaces the list. */
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
  return [header, ...todos.map((item) => `${MARKS[item.status]} ${item.id}: ${item.content}${item.dependencies === undefined || item.dependencies.length === 0 ? '' : ` (depends on ${item.dependencies.join(', ')})`}`)].join('\n');
}

interface BranchEntry {
  type: string;
  customType?: string;
  data?: unknown;
  message?: { role?: string; toolName?: string; isError?: boolean; details?: unknown };
}

/** The list as of the active branch, from a plan import or the last successful TodoWrite. */
export function todosFromBranch(entries: readonly BranchEntry[]): TodoItem[] {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === 'custom' && entry.customType === TODO_ENTRY) {
      const todos = (entry.data as Partial<TodoDetails> | undefined)?.todos;
      if (Array.isArray(todos)) return todos;
    }
    const message = entry?.message;
    const todos = (message?.details as Partial<TodoDetails> | undefined)?.todos;
    if (entries[index]?.type === 'message' && message?.role === 'toolResult' && message.toolName === 'TodoWrite' && message.isError !== true && Array.isArray(todos)) return todos;
  }
  return [];
}

function widgetLines(todos: readonly TodoItem[]): string[] | undefined {
  if (todos.length === 0) return undefined;
  return [`Todos ${todos.filter((item) => item.status === 'completed').length}/${todos.length}`, ...todos.map((item) => `${GLYPHS[item.status]} ${item.content}`)];
}

/** The list as of the active branch, for the system prompt. Cursor keeps todos in conversation state; Pi keeps them here. */
export function todoSection(todos: readonly TodoItem[]): string | undefined {
  return todos.length === 0 ? undefined : `Current todo list, owned by this session:\n${formatTodos(todos)}`;
}

// Cursor's TodoWrite rules: when to keep a list, the four states, one task in progress at a time, and batching.
// Cursor's TodoWrite description, as a live Cursor CLI session declared it.
const TODO_DESCRIPTION = [
  'Use this tool to create and manage a structured task list for your current coding session. This helps track progress, organize complex tasks, and demonstrate thoroughness.',
  '',
  "Note: Other than when first creating todos, don't tell the user you're updating todos, just do it.",
  '',
  '### When to Use This Tool',
  '',
  'Use proactively for:',
  '1. Complex multi-step tasks (3+ distinct steps)',
  '2. Non-trivial tasks requiring careful planning',
  '3. User explicitly requests todo list',
  '4. User provides multiple tasks (numbered/comma-separated)',
  '5. After receiving new instructions - capture requirements as todos (use merge=false to add new ones)',
  '6. After completing tasks - mark complete with merge=true and add follow-ups',
  '7. When starting new tasks - mark as in_progress (ideally only one at a time)',
  '',
  '### When NOT to Use',
  '',
  'Skip for:',
  '1. Single, straightforward tasks',
  '2. Trivial tasks with no organizational benefit',
  '3. Tasks completable in < 3 trivial steps',
  '4. Purely conversational/informational requests',
  "5. Don't add a task to test the change unless asked, or you'll overfocus on testing",
  '',
  '### Examples',
  '',
  '<example>',
  '  User: Add dark mode toggle to settings',
  '  Assistant:',
  '    - *Creates todo list:*',
  '      1. Add state management [in_progress]',
  '      2. Implement styles',
  '      3. Create toggle component',
  '      4. Update components',
  '    - [Immediately begins working on todo 1 in the same tool call batch]',
  '<reasoning>',
  '  Multi-step feature with dependencies.',
  '</reasoning>',
  '</example>',
  '',
  '<example>',
  '  User: Rename getCwd to getCurrentWorkingDirectory across my project',
  '  Assistant: *Searches codebase, finds 15 instances across 8 files*',
  '  *Creates todo list with specific items for each file that needs updating*',
  '',
  '<reasoning>',
  '  Complex refactoring requiring systematic tracking across multiple files.',
  '</reasoning>',
  '</example>',
  '',
  '<example>',
  '  User: Implement user registration, product catalog, shopping cart, checkout flow.',
  '  Assistant: *Creates todo list breaking down each feature into specific tasks*',
  '',
  '<reasoning>',
  '  Multiple complex features provided as list requiring organized task management.',
  '</reasoning>',
  '</example>',
  '',
  '<example>',
  "  User: Optimize my React app - it's rendering slowly.",
  '  Assistant: *Analyzes codebase, identifies issues*',
  '  *Creates todo list: 1) Memoization, 2) Virtualization, 3) Image optimization, 4) Fix state loops, 5) Code splitting*',
  '',
  '<reasoning>',
  '  Performance optimization requires multiple steps across different components.',
  '</reasoning>',
  '</example>',
  '',
  '### Examples of When NOT to Use the Todo List',
  '',
  '<example>',
  '  User: What does git status do?',
  '  Assistant: Shows current state of working directory and staging area...',
  '',
  '<reasoning>',
  '  Informational request with no coding task to complete.',
  '</reasoning>',
  '</example>',
  '',
  '<example>',
  '  User: Add comment to calculateTotal function.',
  '  Assistant: *Uses edit tool to add comment*',
  '',
  '<reasoning>',
  '  Single straightforward task in one location.',
  '</reasoning>',
  '</example>',
  '',
  '<example>',
  '  User: Run npm install for me.',
  '  Assistant: *Executes npm install* Command completed successfully...',
  '',
  '<reasoning>',
  '  Single command execution with immediate results.',
  '</reasoning>',
  '</example>',
  '',
  '### Task States and Management',
  '',
  '1. **Task States:**',
  '  - pending: Not yet started',
  '  - in_progress: Currently working on',
  '  - completed: Finished successfully',
  '  - cancelled: No longer needed',
  '',
  '2. **Task Management:**',
  '  - Update status in real-time',
  '  - Mark complete IMMEDIATELY after finishing',
  '  - Only ONE task in_progress at a time',
  '  - Complete current tasks before starting new ones',
  '',
  '3. **Task Breakdown:**',
  '  - Create specific, actionable items',
  '  - Break complex tasks into manageable steps',
  '  - Use clear, descriptive names',
  '',
  '4. **Parallel Todo Writes:**',
  '  - Prefer creating the first todo as in_progress',
  '  - Start working on todos by using tool calls in the same tool call batch as the todo write',
  '  - Batch todo updates with other tool calls for better latency and lower costs for the user',
  '',
  'When in doubt, use this tool. Proactive task management demonstrates attentiveness and ensures complete requirements.',
].join('\n');

export function registerTodoWrite(pi: ExtensionAPI, options: { onWrite?: (todos: readonly TodoItem[]) => void } = {}) {
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
    description: TODO_DESCRIPTION,
    promptSnippet: 'Create and update the todo list for this session',
    promptGuidelines: ['When a skill or playbook says to open a todolist or todo list, call TodoWrite before other work, with the steps it names as the first items.'],
    parameters: TodoParams,
    executionMode: 'sequential',
    annotations: { readOnlyHint: true, openWorldHint: false },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      todos = applyTodoWrite(todos, params.todos, params.merge);
      try {
        options.onWrite?.(todos);
      } catch (error) {
        ctx.ui.notify(`The todo list was updated, but its plan file could not be synchronized: ${error instanceof Error ? error.message : String(error)}`, 'warning');
      }
      show(ctx);
      return { content: [{ type: 'text', text: formatTodos(todos) }], details: { todos } };
    },
  });
  return {
    section: () => todoSection(todos),
    replace: (items: readonly TodoItem[], ctx: ExtensionContext) => {
      todos = applyTodoWrite([], items, false);
      pi.appendEntry(TODO_ENTRY, { todos });
      show(ctx);
    },
  };
}
