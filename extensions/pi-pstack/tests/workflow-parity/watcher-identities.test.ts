import { expect, test } from 'vitest';
import { codemodeFamily } from './families/codemode.ts';
import { cleanupFamily } from './families/ops.ts';
import { babysitQueuedFamily, babysitBackgroundFamily, babysitSingleWatcherFamily } from './families/pr-babysit.ts';
import { evaluate } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

const call = (order: number, action: string, resultText = '') => ({ order, name: 'pstack_worker', args: { action, runId: 'observed-run', workerId: 'observed-worker', assignmentPath: '/workers/observed-worker/assignment.json' }, resultText, isError: false });
function evidence(): RunView {
  return {
    repo: '/repo', sandbox: '/sandbox', parent: { messages: [], toolCalls: [], path: '' },
    runs: [{ id: 'observed-run', dir: '/run', workers: [{ id: 'observed-worker', dir: '/worker', assignment: { kind: 'watch', role: 'watcher', watch: { argv: ['watch-pr', '--pr', '15'] } }, state: { kind: 'watch', exit: { code: 0 } }, session: { messages: [], toolCalls: [], path: '' } }], steps: [], receipts: [], decisions: [], events: [] }],
  } as unknown as RunView;
}
const cases = [
  [codemodeFamily, 'codemode.worker-isolated', (v: RunView) => {
    const w = v.runs[0]!.workers[0]!;
    w.assignment = { role: 'general', workspace: { mode: 'worktree' } };
    w.state = {};
    w.session!.toolCalls = [{ order: 1, name: 'codemode', args: { code: 'slow_echo' }, resultText: JSON.stringify({ who: 'worker', slots: [...['A', 'B', 'C'].map(x => ({ label: `worker-${x}` })), { status: 'isError', text: 'failed: worker-failure' }, { status: 'rejected' }] }), isError: false }];
  }],
  [cleanupFamily, 'cleanup.pinned-set-wins-and-usage-was-verified', (v: RunView) => {
    const w = v.runs[0]!.workers[0]!;
    w.assignment = { role: 'general', workspace: { mode: 'readonly' } };
    w.state = {};
    w.session!.toolCalls = [{ order: 1, name: 'bash_readonly', args: { command: 'grep sessions/--active-chat--/transcript' }, resultText: '', isError: false }];
    v.runs[0]!.todoText = '## Task-specific work\n- [x] Pinned set from the user: /wts/wt-active';
    v.runs[0]!.runJson = { playbook: 'worktree-cleanup' };
  }],
  [babysitQueuedFamily, 'babysit.queued.watcher-stopped-after-the-report', (v: RunView) => {
    const worker = v.runs[0]!.workers[0]!;
    worker.assignment['watch'] = { argv: ['watch-pr', '--queued-stack', '--stack-prs', '51,52'] };
    worker.state = { kind: 'watch', settles: [{ phase: 'aborted' }], exit: { code: null } };
    v.parent.toolCalls = [call(1, 'inspect', '{"kind":"WAITING","reason":"merge-queue"}'), call(2, 'abort')];
  }],
  [babysitQueuedFamily, 'babysit.queued.watcher-verdict-is-readable-through-pstack-worker', (v: RunView) => {
    v.runs[0]!.workers[0]!.assignment['watch'] = { argv: ['watch-pr', '--queued-stack', '--stack-prs', '51,52'] };
    v.parent.toolCalls = [call(1, 'inspect', '{"kind":"WAITING","reason":"merge-queue"}'), call(2, 'abort')];
  }],
  [babysitSingleWatcherFamily, 'babysit.single.the-second-request-armed-no-second-watcher', (v: RunView) => {
    v.runs[0]!.workers[0]!.assignment['watch'] = { argv: ['watch-pr', '--pr', '16'] };
    v.parent.messages = [{ order: 1, role: 'user', text: 'babysit' }, { order: 3, role: 'user', text: 'babysit again' }];
    v.parent.toolCalls = [{ order: 4, name: 'bash', args: { command: 'grep -rl watch-pr assignments' }, resultText: '/runs/observed-run/workers/observed-worker/assignment.json', isError: false }, call(5, 'inspect', 'running')];
  }],
  [babysitBackgroundFamily, 'babysit.background.plan-work-continues-while-the-watcher-runs', (v: RunView) => {
    v.parent.toolCalls = [call(1, 'spawn'), { order: 2, name: 'write', args: {}, resultText: '', isError: false }, { order: 3, name: 'write', args: {}, resultText: '', isError: false }];
    v.parent.messages = [{ order: 4, role: 'custom', text: '', customType: 'pstack-worker', details: { runId: 'observed-run', workerId: 'observed-worker', phase: 'exited' } }];
  }],
] as const;
for (const [family, id, prepare] of cases) {
  test(`watcher-identities ${id} accepts renamed evidence and rejects ambiguity`, () => {
    const view = evidence();
    prepare(view);
    const check = family.checks.find(c => c.id === id)!;
    expect(evaluate([check], view)[0]).toMatchObject({ verdict: 'PASS' });
    const identityCall = view.parent.toolCalls.find(c => c.name === 'pstack_worker' && c.args['action'] === 'inspect');
    if (identityCall !== undefined) {
      identityCall.args['runId'] = 'other-run';
      expect(evaluate([check], view)[0]).toMatchObject({ verdict: 'FAIL' });
      identityCall.args['runId'] = 'observed-run';
    }
    const worker = view.runs[0]!.workers[0]!;
    view.runs[0]!.workers.push({ ...worker, id: 'second-candidate' });
    expect(evaluate([check], view)[0]).toMatchObject({ verdict: 'FAIL', evidence: expect.stringMatching(/candidates:.*observed-worker.*second-candidate/) });
  });
}
