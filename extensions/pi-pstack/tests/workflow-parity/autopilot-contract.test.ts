import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { autopilotFamilies } from './families/pr-autopilot.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  }),
);
const sha = 'a'.repeat(40);
function view(): RunView {
  const sandbox = mkdtempSync(join(tmpdir(), 'autopilot-contract-'));
  roots.push(sandbox);
  mkdirSync(forgeDirOf(sandbox), { recursive: true });
  writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify({ repo: { trunk: 'main' }, prs: { 31: { number: 31, title: 'feat(greet): add greet', author: 'owner', head: 'feat-greet', base: 'main', mergedHead: sha } } }));
  writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), JSON.stringify({ kind: 'merge', pr: 31, worker: 'owner', head: sha, ts: '2026-01-01T00:00:10Z' }));
  const owner = { id: 'owner', dir: '/workers/owner', assignment: { role: 'owner', model: 'sim/one' } };
  const lanes = ['gates and diff audit', 'live driver'].map((brief, index) => ({
    id: `lane-${index}`,
    dir: `/workers/lane-${index}`,
    brief,
    assignment: { role: 'verifier', model: 'sim/one', workspace: { mode: 'worktree', inputCommit: sha } },
    finalText: `VERDICT clean ${sha}`,
  }));
  return {
    sandbox,
    base: 'base',
    prompt: 'autopilot this queue and merge each verified PR',
    runs: [{ id: 'r', workers: [owner, ...lanes], events: [] }],
    parent: {
      messages: [{ role: 'custom', customType: 'pstack-worker', order: 1, details: { workerId: 'owner', runId: 'r' } }],
      toolCalls: [
        ...lanes.map((lane) => ({ name: 'pstack_worker', order: 2, args: { action: 'spawn', assignmentPath: `${lane.dir}/assignment.json` } })),
        { name: 'pstack_worker', order: 3, args: { action: 'steer', workerId: 'owner', message: 'Continue self-proof. Do not merge yet.' } },
        ...lanes.map((lane, index) => ({ name: 'pstack_worker', order: 4 + index, args: { action: 'collect', workerId: lane.id, runId: 'r' } })),
        { name: 'pstack_evidence', order: 6, args: { action: 'verify' } },
        { name: 'pstack_worker', order: 7, at: '2026-01-01T00:00:09Z', args: { action: 'steer', workerId: 'owner', message: `CLEAN at ${sha}. Merge now.` } },
      ],
    },
  } as unknown as RunView;
}
const run = (suffix: string, value: RunView) =>
  autopilotFamilies
    .find((entry) => entry.id === 'autopilot-full')
    ?.checks.find((entry) => entry.id === `autopilot.full.${suffix}`)
    ?.run(value);

test('stack handoff recognizes an upstream verdict and still rejects subsequent pushes', () => {
  const value = view();
  writeFileSync(join(forgeDirOf(value.sandbox), 'state.json'), JSON.stringify({ repo: { trunk: 'main' }, prs: { 41: { number: 41, state: 'OPEN', author: 'owner' } } }));
  const runDir = value.runs[0]!;
  runDir.workers.push({ id: 'verifier', assignment: { role: 'verifier', workspace: { inputCommit: sha } } } as never);
  const actions = [{ kind: 'push', worker: 'owner' }, { kind: 'comment', pr: 41, worker: 'verifier', body: 'PASS: ran the user behavior.' }];
  const file = join(forgeDirOf(value.sandbox), 'actions.jsonl');
  const check = autopilotFamilies.find((family) => family.id === 'autopilot-stack')!.checks.find((entry) => entry.id === 'autopilot.stack.nothing-merges-and-nobody-pushes-after-the-handoff')!;
  writeFileSync(file, actions.map((action) => JSON.stringify(action)).join('\n'));
  expect(check.run(value)).toMatchObject({ ok: true });
  writeFileSync(file, [...actions, { kind: 'push', worker: 'owner' }].map((action) => JSON.stringify(action)).join('\n'));
  expect(check.run(value)).toMatchObject({ ok: false });
});

test('an empty forge cannot pass owner execution or owner evidence checks on rescore', () => {
  const value = view();
  writeFileSync(join(forgeDirOf(value.sandbox), 'state.json'), JSON.stringify({ repo: { trunk: 'main' }, prs: {} }));
  const current = value.runs[0];
  if (current === undefined) throw new Error('Missing run');
  current.workers = [];
  expect(run('one-container-owner-per-pr-off-trunk', value)).toMatchObject({ ok: false });
  expect(run('owners-push-their-own-branch-and-keep-a-trail', value)).toMatchObject({ ok: false });
});

test('independent same-family worktree lanes can verify a PR without posting an invented comment', () => {
  expect(run('independent-verifier-per-pr-on-another-family-at-the-head', view())).toMatchObject({ ok: true });
});
test('a self-proof steer is not the per-PR merge authorization', () => {
  expect(run('root-audits-receipts-before-any-go', view())).toMatchObject({ ok: true });
});
test('an owner can merge the clean head after collected lane reports instead of forge comments', () => {
  expect(run('no-merge-without-a-verdict-at-that-head', view())).toMatchObject({ ok: true });
});
test('an owner can force-push its own branch with a lease pinned to its last pushed SHA', () => {
  const value = view();
  const runDir = value.runs[0];
  const owner = runDir?.workers[0];
  if (runDir === undefined || owner === undefined) throw new Error('Missing owner');
  owner.dir = join(value.sandbox, 'owner');
  mkdirSync(join(owner.dir, 'out'), { recursive: true });
  writeFileSync(join(owner.dir, 'out/decisions.tsv'), 'ts\tphase\tdecision\twhy\tevidence\tresult\nnow\tbuild\topen the PR early\tCI\tPR 31\topen\n');
  const old = 'b'.repeat(40);
  owner.session = { toolCalls: [{ name: 'bash', args: { command: `git push --force-with-lease=feat-greet:${old} origin HEAD:feat-greet` } }] } as unknown as RunView['parent'];
  runDir.receipts = [{ id: 'proof', runId: 'r', target: 'pr-31', kind: 'test', verdict: 'pass', commit: sha, artifacts: [{ path: join(owner.dir, 'proof.txt'), sha256: '' }] }];
  writeFileSync(join(forgeDirOf(value.sandbox), 'actions.jsonl'), JSON.stringify({ kind: 'force-push', worker: 'owner', run: 'r', ref: 'refs/heads/feat-greet', old, new: sha }));
  expect(run('owners-push-their-own-branch-and-keep-a-trail', value)).toMatchObject({ ok: true });
  const push = owner.session.toolCalls[0];
  if (push === undefined) throw new Error('Missing push');
  push.args['command'] = 'git push --force origin HEAD:feat-greet';
  expect(run('owners-push-their-own-branch-and-keep-a-trail', value)).toMatchObject({ ok: false });
});
test('the operator catch-up can say clean and combine gates with countersigns', () => {
  const value = view();
  value.parent.messages = [{ order: 20, role: 'assistant', text: 'PR 31 and PR 32 are merged. Both verifier lanes were clean. Gates and countersigns: none. Parked follow-ups: docs.' }];
  value.parent.toolCalls.push({ order: 0, name: 'read', args: { path: '/generated/skills/ketchup/SKILL.md' }, resultText: '', isError: false });
  expect(run('reply-catches-the-operator-up', value)).toMatchObject({ ok: true });
  const reply = value.parent.messages[0];
  if (reply === undefined) throw new Error('Missing reply');
  reply.text = 'PR 31 and PR 32 are merged. Both verifier lanes were clean. Parked follow-ups: docs.';
  expect(run('reply-catches-the-operator-up', value)).toMatchObject({ ok: false });
  reply.text = 'PR 31 and PR 32 are merged. Gates and countersigns: none. Parked follow-ups: docs.';
  expect(run('reply-catches-the-operator-up', value)).toMatchObject({ ok: false });
  reply.text = 'PR 31 and PR 32 are merged. Both verifier lanes were clean. Gates and countersigns: none. Parked follow-ups: docs.';
  value.parent.toolCalls = [];
  expect(run('reply-catches-the-operator-up', value)).toMatchObject({ ok: false });
});
test('a failing lane, an ambiguous duplicate, and an audit after the go still fail', () => {
  const value = view();
  const runDir = value.runs[0];
  if (runDir === undefined || runDir.workers[1] === undefined) throw new Error('Missing fixture lane');
  runDir.workers[1].finalText = `VERDICT FAIL ${sha}`;
  expect(run('independent-verifier-per-pr-on-another-family-at-the-head', value)).toMatchObject({ ok: false });
  expect(run('no-merge-without-a-verdict-at-that-head', value)).toMatchObject({ ok: false });
  runDir.workers[1].finalText = `VERDICT clean ${sha}`;
  runDir.workers.push(structuredClone(runDir.workers[1]));
  expect(run('independent-verifier-per-pr-on-another-family-at-the-head', value)).toMatchObject({ ok: false });
  const audit = value.parent.toolCalls.find((call) => call.name === 'pstack_evidence');
  if (audit === undefined) throw new Error('Missing audit');
  audit.order = 8;
  expect(run('root-audits-receipts-before-any-go', value)).toMatchObject({ ok: false });
});
