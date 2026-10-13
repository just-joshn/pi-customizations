import { expect, test } from 'vitest';
import { taskCardText } from '../src/task/card.ts';

const result = (model: unknown, text: string) => ({ content: [{ type: 'text' as const, text }], details: { subagentType: 'poteto-agent', model } });

test('the task card names the model that ran, with its thinking level (TASK-017)', () => {
  expect(taskCardText(result({ provider: 'claude-subscription', id: 'claude-opus-5-5', thinking: 'high' }, 'done'), true).split('\n')[0]).toBe('poteto-agent · claude-subscription/claude-opus-5-5:high');
});

test('a card without a resolved model says Pi picked its default (TASK-017)', () => {
  expect(taskCardText(result(null, 'done'), true).split('\n')[0]).toBe("poteto-agent · Pi's default model");
});

test('the card keeps the result text, shortened until expanded (TASK-017)', () => {
  const long = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n');
  expect(taskCardText(result(null, long), true).split('\n')).toHaveLength(31);
  const collapsed = taskCardText(result(null, long), false).split('\n');
  expect(collapsed.slice(1, 3)).toEqual(['line 0', 'line 1']);
  expect(collapsed.at(-1)).toBe('… 20 more lines');
});

test('a result without Task details renders its text alone (TASK-017)', () => {
  expect(taskCardText({ content: [{ type: 'text', text: 'Invalid model' }], details: undefined }, false)).toBe('Invalid model');
});
