import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import { boundedResult } from './results.ts';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

const Todo = Type.Object({
  id: Type.String({ minLength: 1 }),
  content: Type.String({ minLength: 1 }),
  status: Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('cancelled')]),
});
const State = Type.Object({ enabled: Type.Boolean(), todos: Type.Array(Todo), verificationOffered: Type.Optional(Type.Boolean()) });
type State = Static<typeof State>;

export function createState(pi: ExtensionAPI) {
  let state: State = { enabled: false, todos: [] };

  const showState = (ctx: ExtensionContext) => {
    ctx.ui.setStatus('pstack', state.enabled ? 'poteto-mode' : undefined);
    ctx.ui.setWidget('pstack-todos', state.todos.length
      ? state.todos.map((todo) => `${todo.status === 'completed' ? '[x]' : '[ ]'} ${todo.content} (${todo.status})`)
      : undefined);
  };
  const restore = (ctx: ExtensionContext) => {
    state = { enabled: false, todos: [] };
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === 'custom' && entry.customType === 'pstack-state' && Check(State, entry.data)
        && new Set(entry.data.todos.map(todo => todo.id)).size === entry.data.todos.length) state = structuredClone(entry.data);
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
    name: 'pstack_mode', label: 'Poteto mode',
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
    name: 'TodoWrite', label: 'Pstack todos',
    description: 'Replace or merge the ordered todo list. Copy the selected playbook steps verbatim before task-specific steps. Keep skipped steps with a reason.',
    promptSnippet: 'Replace or merge the ordered pstack todo list',
    promptGuidelines: ['TodoWrite keeps the verbatim ordered playbook steps.'],
    parameters: Type.Object({ todos: Type.Array(Todo), merge: Type.Optional(Type.Boolean()) }),
    async execute(_id, params, _signal, _update, ctx) {
      if (new Set(params.todos.map((todo) => todo.id)).size !== params.todos.length) throw new Error('Todo IDs must be unique.');
      const state = store.read();
      const todos = new Map([...(params.merge ? state.todos : []), ...params.todos].map((todo) => [todo.id, todo]));
      const next = { ...state, todos: [...todos.values()] };
      store.update(next, ctx);
      const published = store.read().todos;
      return boundedResult(JSON.stringify(published), published, ctx);
    },
  });
}
