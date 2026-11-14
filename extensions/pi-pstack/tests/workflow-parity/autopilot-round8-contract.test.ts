import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { autopilotFullFamily } from './families/pr-autopilot.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const check = (id: string, view: unknown) => autopilotFullFamily.checks.find((entry) => entry.id === id)?.run(view as RunView);
test('self-proof permits multiple step receipts and run-relative worker artifacts', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'owner-proof-'));
  const dir = join(sandbox, 'run');
  const workerDir = join(dir, 'workers/owner');
  const receipts = ['head-test', 'head-live'].map((target) => ({ runId: 'r', target, verdict: 'pass', artifacts: [{ path: 'workers/owner/proof.txt' }] }));
  try {
    mkdirSync(workerDir, { recursive: true });
    writeFileSync(join(workerDir, 'decisions.tsv'), 'ts\tphase\tdecision\twhy\tevidence\tresult\nnow\tbuild\tpush\twhy\tproof\tpass\n');
    mkdirSync(forgeDirOf(sandbox), { recursive: true });
    writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify({ repo: { trunk: 'main' }, prs: { 31: { number: 31, author: 'owner', head: 'feat', base: 'main', mergedHead: 'a'.repeat(40) } } }));
    writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), JSON.stringify({ kind: 'push', worker: 'owner', run: 'r', ref: 'refs/heads/feat' }));
    const view = { sandbox, base: 'base', runs: [{ id: 'r', dir, receipts, workers: [{ id: 'owner', dir: workerDir, assignment: { role: 'owner' } }] }] };
    const id = 'autopilot.full.owners-push-their-own-branch-and-keep-a-trail';
    expect(check(id, view)).toMatchObject({ ok: true });
    receipts.splice(0);
    expect(check(id, view)).toMatchObject({ ok: false });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('hourly watch ignores re-collects of idle workers but not newly steered work', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'hourly-watch-'));
  roots.push(sandbox);
  mkdirSync(forgeDirOf(sandbox), { recursive: true });
  writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify({ prs: {} }));
  writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), '');
  const dir = '/repo/workers/tick';
  const owner = { id: 'owner', dir: '/repo/workers/owner', assignment: { role: 'owner' } };
  const watcher = { id: 'tick', dir, assignment: { role: 'watcher', kind: 'watch', watch: { argv: ['sleep', '3600'], cwd: '/repo' } } };
  const calls = [
    { order: 1, name: 'pstack_worker', args: { action: 'spawn', assignmentPath: `${owner.dir}/assignment.json` } },
    { order: 2, name: 'pstack_worker', args: { action: 'spawn', assignmentPath: `${dir}/assignment.json` } },
    { order: 4, name: 'pstack_worker', args: { action: 'abort', runId: 'r', workerId: 'tick' } },
    { order: 5, name: 'pstack_worker', args: { action: 'collect', runId: 'r', workerId: 'owner' } },
  ];
  const view = { sandbox, repo: '/repo', runs: [{ id: 'r', workers: [owner, watcher] }], parent: { toolCalls: calls, messages: [{ order: 3, customType: 'pstack-worker', details: { runId: 'r', workerId: 'owner', phase: 'idle' } }] } };
  expect(check('autopilot.full.hourly-watch-loop-armed-on-the-go', view)).toMatchObject({ ok: true });
  calls.push({ order: 3.5, name: 'pstack_worker', args: { action: 'steer', runId: 'r', workerId: 'owner' } });
  expect(check('autopilot.full.hourly-watch-loop-armed-on-the-go', view)).toMatchObject({ ok: false });
});

test('catch-up covers topics without requiring the playbook vocabulary', () => {
  const reply = 'PR 31 and PR 32 merged. Both passed independent checks. No gates were loosened, so no extra sign-off was needed. Decisions waiting on you: none. Remaining work: none.';
  const view = { parent: { toolCalls: [{ name: 'read', args: { path: '/pkg/generated/skills/ketchup/SKILL.md' }, order: 0, resultText: 'skill' }], messages: [{ role: 'assistant', order: 1, text: reply }] } };
  expect(check('autopilot.full.reply-catches-the-operator-up', view)).toMatchObject({ ok: true });
  view.parent.messages.splice(0, 1, { role: 'assistant', order: 1, text: 'PR 31 and PR 32 merged.' });
  expect(check('autopilot.full.reply-catches-the-operator-up', view)).toMatchObject({ ok: false });
});
