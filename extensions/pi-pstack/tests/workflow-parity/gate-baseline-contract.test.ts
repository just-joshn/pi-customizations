import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { autopilotLanesFamily } from './families/pr-autopilot.ts';
import { bareOf, forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

test.for([false])('a gate raise is measured across the PR, including a later follow-up commit (%s)', (followUp) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'gate-baseline-'));
  const repo = join(sandbox, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'test');
    git('config', 'user.email', 'test@example.com');
    writeFileSync(join(repo, 'budget.json'), '{"maxKb":10}');
    git('add', '.');
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'baseline');
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'feat-table');
    writeFileSync(join(repo, 'budget.json'), '{"maxKb":20}');
    git('add', '.');
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'raise budget');
    if (followUp) git('-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'follow-up');
    const head = git('rev-parse', 'HEAD');
    mkdirSync(join(sandbox, 'forge'));
    git('clone', '-q', '--bare', '.', bareOf(sandbox));
    mkdirSync(forgeDirOf(sandbox));
    writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify({ repo: { trunk: 'main' }, prs: { 33: { number: 33, author: 'owner', head: 'feat-table', base: 'main', title: 'unit' } } }));
    const dir = join(sandbox, 'run');
    const owner = { id: 'owner', dir: join(dir, 'workers/owner'), assignment: { role: 'owner' } };
    mkdirSync(join(owner.dir, 'out'), { recursive: true });
    writeFileSync(join(owner.dir, 'out/decisions.tsv'), `countersign budget.json ${head}\n`);
    const lanes = ['gates', 'live', 'audit'].map((lane) => ({ id: `verify-${lane}`, dir: join(dir, `workers/verify-${lane}`), brief: `${lane} lane`, assignment: { role: 'verifier', workspace: { inputCommit: head } } }));
    const proof = { id: 'proof', runId: 'r', verdict: 'pass', target: 'pr-33', artifacts: [{ path: join(dir, 'workers/verify-audit/proof.txt') }] };
    const actions = [...lanes.map((lane) => ({ kind: 'comment', pr: 33, worker: lane.id, body: `PASS head ${head}` })), { kind: 'comment', pr: 33, worker: 'verify-audit', body: `Gate budget.json raised from 10 to 20 at ${head}. Proof receipt proof.` }, { kind: 'comment', pr: 33, worker: '', actor: '', container: false, body: `Countersign at ${head}. budget.json raised from 10 to 20. Proof receipt proof.` }, { kind: 'merge', pr: 33, worker: 'owner', head }];
    const save = () => writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), actions.map((action) => JSON.stringify(action)).join('\n'));
    save();
    const view = { sandbox, base, runs: [{ id: 'r', dir, workers: [owner, ...lanes], receipts: [proof] }], parent: { toolCalls: [{ name: 'pstack_worker', args: { action: 'steer', workerId: 'owner', message: 'Countersign is ready.' } }] } } as unknown as RunView;
    const check = autopilotLanesFamily.checks.find((entry) => entry.id === 'autopilot.lanes.a-loosened-gate-got-the-verifiers-proof-and-the-roots-fresh-countersign');
    expect(check?.run(view)).toMatchObject({ ok: true });
    actions[4]!.body = actions[4]!.body?.replace('from 10 to 20', 'from 20 to 20');
    save();
    expect(check?.run(view)).toMatchObject({ ok: false });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
