import { expect, test } from 'vitest';
import { continuationPrompt, parseGoalArgs } from '../src/goal.ts';

test('goal arguments drop a leading time limit and keep the objective', () => {
  expect(parseGoalArgs('30m ship the queue')).toEqual({ objective: 'ship the queue', droppedTimeLimit: true });
  expect(parseGoalArgs('2h fix all tests')).toEqual({ objective: 'fix all tests', droppedTimeLimit: true });
  expect(parseGoalArgs('  ship 30m of work ')).toEqual({ objective: 'ship 30m of work', droppedTimeLimit: false });
  expect(parseGoalArgs('   ')).toEqual({ objective: '', droppedTimeLimit: false });
});

test('continuation prompt carries the full objective and the completion gate', () => {
  const text = continuationPrompt('land PR 5');
  expect(text).toContain('land PR 5');
  expect(text).toMatch(/UpdateGoal with status complete only when the audit passes/);
});
