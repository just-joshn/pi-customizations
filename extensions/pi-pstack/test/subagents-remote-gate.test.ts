import { expect, test } from 'vitest';
import { type RemoteInputs, remoteOptIn, routeRemote } from '../src/subagents/remote-gate.ts';

const eligible: RemoteInputs = { env: {}, restricted: false, hasDisk: true, piResolvable: true, optedIn: true, hasGitRoot: true };

test('an eligible session routes remote isolation to the remote destination', () => {
  expect(routeRemote(eligible)).toEqual({ effective: 'remote' });
});

test.for([
  { name: 'restricted mode with a git root', change: { restricted: true }, effective: 'worktree', log: "[remote agent] isolation:'remote' is unavailable (--restricted); falling back to isolation:'worktree'" },
  { name: 'no pi binary with a git root', change: { piResolvable: false }, effective: 'worktree', log: "[remote agent] isolation:'remote' is unavailable (no resolvable pi binary or remote isolation is not enabled); falling back to isolation:'worktree'" },
  { name: 'not opted in without a git root', change: { optedIn: false, hasGitRoot: false }, effective: undefined, log: "[remote agent] isolation:'remote' is unavailable (no resolvable pi binary or remote isolation is not enabled) and no git root; running as a local agent" },
  { name: 'restricted mode without a git root', change: { restricted: true, hasGitRoot: false }, effective: undefined, log: "[remote agent] isolation:'remote' is unavailable (--restricted) and no git root; running as a local agent" },
  { name: 'a session with no disk', change: { hasDisk: false }, effective: undefined, log: "[remote agent] isolation:'remote' is unavailable (the session has no disk); running as a local agent" },
  { name: 'already inside a remote session', change: { env: { CLAUDE_CODE_REMOTE: '1' } }, effective: undefined, log: "[remote agent] isolation:'remote' is unavailable (already inside a CCR session); running as a local agent" },
  { name: 'a confined evaluation', change: { env: { CLAUDE_CODE_EVAL_CONFINED: '1' } }, effective: undefined, log: "[remote agent] isolation:'remote' is unavailable (no resolvable pi binary or remote isolation is not enabled) and no git root; running as a local agent" },
])('$name falls back with the recovered log line', ({ change, effective, log }) => {
  expect(routeRemote({ ...eligible, ...change })).toEqual({ effective, log });
});

test('remote isolation is opted into by environment or the pstack setting', () => {
  expect([remoteOptIn({}, undefined), remoteOptIn({ PSTACK_REMOTE_ISOLATION: '1' }, undefined), remoteOptIn({}, true), remoteOptIn({}, 'yes')]).toEqual([false, true, true, false]);
});
