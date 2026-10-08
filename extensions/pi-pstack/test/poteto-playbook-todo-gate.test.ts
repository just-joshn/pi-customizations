import { expect, test } from 'vitest';

import {
  playbookTodoWriteStarted,
  potetoModeSkillPrompt,
  potetoPlaybookTodoGateMessage,
  potetoPlaybookTodoUsageBlock,
  registerPotetoPlaybookTodoGate,
  todosHavePlaybookSteps,
} from '../src/poteto-playbook-todo-gate.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { StateStore } from '../src/state.ts';

const potetoPrompt = `<skill name="poteto-mode" location="/pkg/skills/poteto-mode/SKILL.md">\n# Poteto mode\n</skill>\n\nfix the off-by-one in src/inc.js`;

const bugFixTodos = [
  { id: '1', content: '1. Reproduce it yourself on the matching surface via the control skill', status: 'in_progress' },
  { id: '2', content: '2. Binary-search the cause.', status: 'pending' },
];

function harness(store: StateStore) {
  const handlers = new Map<string, (event: never, ctx?: never) => unknown>();
  const pi = {
    on: (name: string, handler: (event: never, ctx?: never) => unknown) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
  } as unknown as ExtensionAPI;
  registerPotetoPlaybookTodoGate(pi, store);
  return handlers;
}

function storeOf(state: { enabled: boolean; todos: Array<{ id: string; content: string; status: string }> }): StateStore {
  return {
    read: () => structuredClone(state),
    update: () => {},
    toggle: () => {},
    restore: () => {},
    showState: () => {},
  } as unknown as StateStore;
}

test('potetoModeSkillPrompt detects an expanded poteto-mode skill turn and ignores other skills', () => {
  expect(potetoModeSkillPrompt(potetoPrompt)).toBe(true);
  expect(potetoModeSkillPrompt('<skill name="how" location="/pkg/skills/how/SKILL.md">\nbody\n</skill>')).toBe(false);
  expect(potetoModeSkillPrompt('/poteto-mode fix it')).toBe(false);
});

test('todosHavePlaybookSteps matches capture-recognized playbook step text', () => {
  expect(todosHavePlaybookSteps(bugFixTodos)).toBe(true);
  expect(todosHavePlaybookSteps([{ content: 'edit src/inc.js' }])).toBe(false);
  expect(todosHavePlaybookSteps([])).toBe(false);
});

test('playbookTodoWriteStarted accepts TodoWrite with playbook steps only', () => {
  expect(playbookTodoWriteStarted('TodoWrite', { todos: bugFixTodos })).toBe(true);
  expect(playbookTodoWriteStarted('TodoWrite', { todos: [{ id: 'a', content: 'tweak the file', status: 'pending' }] })).toBe(false);
  expect(playbookTodoWriteStarted('write', { path: 'src/inc.js', content: 'x' })).toBe(false);
});

test('a poteto-mode skill turn blocks product mutation until playbook TodoWrite lands', () => {
  const handlers = harness(storeOf({ enabled: false, todos: [] }));
  const sections: Record<string, string> = {};
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: potetoPrompt,
    systemPrompt: '',
    systemPromptOptions: { sections },
  } as never);

  expect(sections['pstack_poteto_playbook_todos']).toBe(potetoPlaybookTodoUsageBlock);
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '1', toolName: 'bash', input: { command: 'sed -i "" "s/+0/+1/" src/inc.js' } } as never)).toEqual({
    block: true,
    reason: potetoPlaybookTodoGateMessage,
  });
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '2', toolName: 'edit', input: { path: 'src/inc.js', oldText: 'a', newText: 'b' } } as never)).toEqual({
    block: true,
    reason: potetoPlaybookTodoGateMessage,
  });
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '3', toolName: 'read', input: { path: 'playbooks/bug-fix.md' } } as never)).toBe(undefined);

  expect(
    handlers.get('tool_call')?.({
      type: 'tool_call',
      toolCallId: '4',
      toolName: 'TodoWrite',
      input: { todos: bugFixTodos },
    } as never),
  ).toBe(undefined);

  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '5', toolName: 'edit', input: { path: 'src/inc.js', oldText: 'a', newText: 'b' } } as never)).toBe(undefined);
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '6', toolName: 'bash', input: { command: 'node -e "process.stdout.write(\\"1\\")"' } } as never)).toBe(undefined);
});

test('sticky poteto mode arms the gate even without a skill marker in the prompt', () => {
  const handlers = harness(storeOf({ enabled: true, todos: [] }));
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: 'fix the off-by-one in src/inc.js',
    systemPrompt: '',
    systemPromptOptions: { sections: {} },
  } as never);
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '1', toolName: 'write', input: { path: 'src/inc.js', content: 'x' } } as never)).toEqual({
    block: true,
    reason: potetoPlaybookTodoGateMessage,
  });
});

test('existing playbook todos from an earlier turn already satisfy the gate', () => {
  const handlers = harness(storeOf({ enabled: true, todos: bugFixTodos }));
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: 'continue the fix',
    systemPrompt: '',
    systemPromptOptions: { sections: {} },
  } as never);
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '1', toolName: 'edit', input: { path: 'src/inc.js', oldText: 'a', newText: 'b' } } as never)).toBe(undefined);
});

test('a non-poteto turn does not arm the playbook-todo gate', () => {
  const handlers = harness(storeOf({ enabled: false, todos: [] }));
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: 'fix the store loader',
    systemPrompt: '',
    systemPromptOptions: { sections: {} },
  } as never);
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '1', toolName: 'write', input: { path: 'src/inc.js', content: 'x' } } as never)).toBe(undefined);
});

test('settling a poteto turn without playbook todos continues once with a reminder', () => {
  const handlers = harness(storeOf({ enabled: false, todos: [] }));
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: potetoPrompt,
    systemPrompt: '',
    systemPromptOptions: { sections: {} },
  } as never);

  const first = handlers.get('agent_before_settle')?.({ type: 'agent_before_settle', outcome: 'completed' } as never) as {
    continue: boolean;
    entries: Array<{ customType: string; content: string }>;
  };
  expect(first.continue).toBe(true);
  expect(first.entries[0]?.customType).toBe('pstack-poteto-playbook-todos');
  expect(first.entries[0]?.content).toContain('TodoWrite');

  expect(handlers.get('agent_before_settle')?.({ type: 'agent_before_settle', outcome: 'completed' } as never)).toBe(undefined);
});
