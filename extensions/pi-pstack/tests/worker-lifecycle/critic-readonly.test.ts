import { expect, test } from 'vitest';
import { ENGINEERING_CAPABILITIES, parseAssignment } from '../../src/run-files.ts';

const defaults = { capabilities: ENGINEERING_CAPABILITIES, projectRoot: process.cwd() };
const critic = {
  runId: 'critic-review',
  workerId: 'critic',
  role: 'comment-sicko',
  kind: 'pi',
  model: 'inherit-parent',
  brief: 'brief.md',
};

test.each(['worktree', 'container'])('the comment critic refuses a writable %s workspace', (mode) => {
  expect(() => parseAssignment({ ...critic, workspace: { mode, inputCommit: 'abcdef1' } }, defaults)).toThrow(/comment-sicko requires a readonly workspace/);
});

test('the critic refuses a watch command in place of an independent Pi process', () => {
  expect(() => parseAssignment({ ...critic, kind: 'watch', workspace: { mode: 'readonly' }, watch: { argv: ['echo', 'not a critic'] } }, defaults)).toThrow(/comment-sicko requires a readonly workspace and a Pi critic process/);
});

test('the read-only critic uses the scoped repository without gaining a writing workspace', () => {
  expect(parseAssignment({ ...critic, workspace: { mode: 'readonly' } }, defaults).workspace).toEqual({ mode: 'readonly', path: process.cwd() });
});
