import { expect, test } from 'vitest';
import { createTodo, immutableTodoBlock, readTodoLedger, upstreamSteps } from '../../src/todo.ts';

test.for(['\n', '\r\n'])('source span retains Unicode, whitespace, continuations and fenced examples (%j)', (newline) => {
  const raw = ['1. First step.  ', '   - Nested instruction.', '', 'Continuation paragraph.', '', '2. Second step.', '   ```text', '   99. Example, not a step.', '   ```', ''].join(newline) + newline;
  const source = Buffer.from(`### Unicode π${newline}${newline}${raw}**Reply:** Not a step.${newline}`);
  const result = upstreamSteps(source);
  expect(result.block.equals(Buffer.from(raw))).toBe(true);
  expect(result.steps.map((step) => [step.n, step.line])).toEqual([
    [1, 3],
    [2, 8],
  ]);
  const todo = createTodo('Unicode', 'custom', 'pin', source);
  expect(immutableTodoBlock(Buffer.from(todo)).equals(Buffer.from(raw))).toBe(true);
  expect(readTodoLedger(todo).map((entry) => entry.n)).toEqual([1, 2]);
});

test('unindented fenced code is not a source step', () => {
  const source = Buffer.from('### Example\n\n```text\n99. Not a step.\n```\n\n1. Real step.\n\n**Reply:** End.\n');
  expect(upstreamSteps(source).block.equals(Buffer.from('1. Real step.\n\n'))).toBe(true);
  expect(upstreamSteps(source).steps.map((step) => step.n)).toEqual([1]);
});
