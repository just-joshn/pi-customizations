import { expect, test } from 'vitest';
import { openedAt } from './lib/checks.ts';
import type { Session } from './lib/view.ts';

test('computed worktree loops prove reads only for worktrees present in their output', () => {
  const call = { order: 4, name: 'bash', args: { command: 'for w in $(git worktree list --porcelain | awk \'/worktree/{print $2}\'); do (cd $w && echo "##### $w"; cat -n src/coupon.js test/coupon.test.js); done' }, resultText: '##### /run/candidate-a/worktree\n1 export const coupon = 1;\n##### /run/candidate-b/worktree\n1 export const coupon = 2;', isError: false };
  const session = { messages: [], toolCalls: [call] } as unknown as Session;
  expect(openedAt(session, 'candidate-a/worktree/src/coupon.js')).toBe(4);
  expect(openedAt(session, 'candidate-b/worktree/src/coupon.js')).toBe(4);
  expect(openedAt(session, 'candidate-c/worktree/src/coupon.js')).toBe(-1);
  call.args.command = call.args.command.replace('cat -n src/coupon.js test/coupon.test.js', 'git status');
  expect(openedAt(session, 'candidate-a/worktree/src/coupon.js')).toBe(-1);
});
