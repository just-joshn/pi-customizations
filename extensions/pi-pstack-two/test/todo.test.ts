import { describe, expect, test } from 'vitest';
import { applyTodoWrite, formatTodos, type TodoItem, todosFromBranch } from '../src/todo.ts';

const list: TodoItem[] = [
  { id: 'frame', content: 'Frame', status: 'completed' },
  { id: 'fan-out', content: 'Fan out', status: 'in_progress' },
];

describe('applyTodoWrite (TODO-001)', () => {
  test('replaces the list when merge is false', () => {
    expect(applyTodoWrite(list, [{ id: 'x', content: 'Only', status: 'pending' }], false)).toEqual([{ id: 'x', content: 'Only', status: 'pending' }]);
  });

  test('merges by id, keeps order, fills omitted fields, and appends new ids', () => {
    expect(
      applyTodoWrite(
        list,
        [
          { id: 'fan-out', status: 'completed' },
          { id: 'report', content: 'Report', status: 'pending' },
        ],
        true,
      ),
    ).toEqual([
      { id: 'frame', content: 'Frame', status: 'completed' },
      { id: 'fan-out', content: 'Fan out', status: 'completed' },
      { id: 'report', content: 'Report', status: 'pending' },
    ]);
  });

  test('rejects a new item without content or status', () => {
    expect(() => applyTodoWrite(list, [{ id: 'new', status: 'pending' }], true)).toThrow('Todo "new" is new, so it needs both content and status.');
    expect(() => applyTodoWrite([], [{ id: 'a', content: 'A' }], false)).toThrow('Todo "a" is new, so it needs both content and status.');
  });

  test('rejects duplicate ids in one call', () => {
    expect(() =>
      applyTodoWrite(
        [],
        [
          { id: 'a', content: 'A', status: 'pending' },
          { id: 'a', content: 'B', status: 'pending' },
        ],
        false,
      ),
    ).toThrow('Todo id "a" appears more than once in this call.');
  });
});

describe('formatTodos', () => {
  test('summarizes counts and marks each status', () => {
    const text = formatTodos([...list, { id: 'skip', content: 'skip: not needed', status: 'cancelled' }, { id: 'later', content: 'Later', status: 'pending' }]);
    expect(text).toBe('Todos (1/4 completed, 1 in progress):\n[x] frame: Frame\n[>] fan-out: Fan out\n[-] skip: skip: not needed\n[ ] later: Later');
  });

  test('reports an empty list', () => {
    expect(formatTodos([])).toBe('Todos: none.');
  });
});

describe('todosFromBranch (TODO-002)', () => {
  test('takes the last TodoWrite result on the branch and ignores other tools', () => {
    const entry = (toolName: string, todos: TodoItem[]) => ({ type: 'message', message: { role: 'toolResult', toolName, details: { todos } } });
    const branch = [entry('TodoWrite', list), entry('read', []), entry('TodoWrite', [list[0] as TodoItem]), { type: 'custom', customType: 'x' }];
    expect(todosFromBranch(branch)).toEqual([list[0]]);
    expect(todosFromBranch([])).toEqual([]);
  });

  test('skips a failed TodoWrite, whose details Pi stores as {} (reviews: parity 2, architecture 1)', () => {
    const ok = { type: 'message', message: { role: 'toolResult', toolName: 'TodoWrite', details: { todos: list } } };
    const failed = { type: 'message', message: { role: 'toolResult', toolName: 'TodoWrite', isError: true, details: {} } };
    expect(todosFromBranch([ok, failed])).toEqual(list);
  });
});
