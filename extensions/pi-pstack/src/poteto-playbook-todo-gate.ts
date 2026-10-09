import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import type { StateStore } from './state.ts';

const potetoModeSkillMarker = /<skill\s+name="poteto-mode"(?:\s|>)/;
const blockedUntilPlaybookTodos = new Set(['bash', 'powershell', 'edit', 'write']);

const playbookStepPatterns: ReadonlyArray<RegExp> = [
  /Reproduce it yourself|Binary-search the cause|Plan the fix|Verify on the same surface|Opening a PR/i,
  /throughput checkpoint|Blocking first steps|Independent workstreams/i,
  /Phase [A-E]\b|falsifiable done predicate|show-me-your-work/i,
  /Pin the behavior contract|characterization test|Subtract before you add/i,
  /Scope the decision|throwaway|scratch dir/i,
  /\bRED\b|\bGREEN\b|failing regression|red before green/i,
];

export const potetoPlaybookTodoGateMessage =
  'Poteto mode is active. Open a TodoWrite whose first items are the matched playbook steps copied in verbatim before any product edit, write, or bash mutation.';

export const potetoPlaybookTodoUsageBlock = `<pstack_poteto_playbook_todos>
Poteto mode is active for this turn. The deliverable before any product code is a TodoWrite of the matched playbook steps.
1. Match the task to a playbook and read that playbook file.
2. Call TodoWrite with those steps copied in verbatim as the first todos (skipped steps stay with skip: reason).
3. Only after that TodoWrite may you edit product code or run bash that mutates the tree.
Readonly read/grep/find/ls are allowed before the todolist lands. Do not batch product mutation into bash before TodoWrite.
</pstack_poteto_playbook_todos>`;

const playbookTodoReminder =
  'Poteto mode requires a TodoWrite of the matched playbook steps before product work. Call TodoWrite with those steps now. Do not edit src/ or run mutating bash until that list exists.';

export function potetoModeSkillPrompt(prompt: string): boolean {
  return potetoModeSkillMarker.test(prompt);
}

export function todosHavePlaybookSteps(todos: readonly { content?: unknown }[]): boolean {
  const blob = todos.map((todo) => (typeof todo.content === 'string' ? todo.content : '')).join('\n');
  return playbookStepPatterns.some((re) => re.test(blob));
}

export function playbookTodoWriteStarted(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName !== 'TodoWrite') return false;
  const todos = input['todos'];
  if (!Array.isArray(todos)) return false;
  return todosHavePlaybookSteps(todos as { content?: unknown }[]);
}

export function registerPotetoPlaybookTodoGate(pi: ExtensionAPI, store: StateStore): void {
  let armed = false;
  let playbookTodosLanded = false;
  let nudged = false;

  pi.on('before_agent_start', (event) => {
    const state = store.read();
    armed = state.enabled || potetoModeSkillPrompt(event.prompt);
    playbookTodosLanded = todosHavePlaybookSteps(state.todos);
    nudged = false;
    if (!armed) return;
    event.systemPromptOptions.sections['pstack_poteto_playbook_todos'] = potetoPlaybookTodoUsageBlock;
  });

  pi.on('tool_call', (event) => {
    if (!armed) return;
    if (playbookTodoWriteStarted(event.toolName, event.input as Record<string, unknown>)) {
      playbookTodosLanded = true;
      return;
    }
    if (playbookTodosLanded || !blockedUntilPlaybookTodos.has(event.toolName)) return;
    return { block: true, reason: potetoPlaybookTodoGateMessage };
  });

  pi.on('agent_before_settle', (event) => {
    if (!armed || playbookTodosLanded || nudged || event.outcome !== 'completed') return;
    nudged = true;
    return {
      entries: [{ type: 'custom_message', customType: 'pstack-poteto-playbook-todos', display: true, content: playbookTodoReminder }],
      continue: true,
    };
  });

  pi.on('agent_end', () => {
    armed = false;
    playbookTodosLanded = false;
    nudged = false;
  });
}
