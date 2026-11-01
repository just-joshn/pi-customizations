import { expect, test } from 'vitest';
import { taskCardText, taskNotificationCardText } from '../src/task/card.ts';

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

test('a cloud agent card names its worktree branch (TASK-010)', () => {
  const details = { subagentType: 'poteto-agent', model: null, worktree: { path: '/w', cwd: '/w', branch: 'pstack/x', base: 'HEAD', commit: 'c' } };
  expect(taskCardText({ content: [{ type: 'text', text: 'done' }], details }, true).split('\n')[0]).toBe("poteto-agent · Pi's default model · branch pstack/x");
});

test('the card leads with the Task description, as Cursor names the subagent by it', () => {
  const details = { subagentType: 'poteto-agent', model: null, description: 'Audit skill corpus' };
  expect(taskCardText({ content: [{ type: 'text', text: 'done' }], details }, true).split('\n')[0]).toBe("Audit skill corpus · poteto-agent · Pi's default model");
});

test('formats background notification header with collapsible detail', () => {
  const long = Array.from({ length: 15 }, (_, index) => `line ${index}`).join('\n');
  const details = { status: 'success' as const, agentId: '11111111-2222-4333-8444-555555555555', title: 'Audit repo', detail: long };
  const collapsed = taskNotificationCardText({ content: 'raw', details }, false).split('\n');
  expect(collapsed[0]).toBe('Audit repo · success · agent 11111111-2222-4333-8444-555555555555');
  expect(collapsed.at(-1)).toBe('… 5 more lines');
  expect(taskNotificationCardText({ content: 'raw', details }, true).split('\n')).toHaveLength(16);
});
