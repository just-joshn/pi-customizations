import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { maintainVerificationFamily } from './families/maintain.ts';
import { runtimeForensicsFamily } from './families/forensics.ts';
import { refactoringFamily } from './families/build-measured.ts';
import type { RunView, ToolCall, WorkerView } from './lib/view.ts';

const repo = '/repo';
const profile = '/evidence/spin.cpuprofile';
const worker = (id: string, path: string, brief = '', command = '') => ({
  id, brief, assignment: { role: 'general', model: 'model', workspace: { mode: 'readonly', path: repo } },
  session: { toolCalls: [{ name: command ? 'bash_readonly' : 'read', args: command ? { command } : { path }, isError: false }] },
}) as unknown as WorkerView;
const view = (workers: WorkerView[]) => ({ repo, runs: [{ workers, receipts: [{ id: 'rt-capture', artifacts: [{ path: profile }] }] }], parent: { models: [] }, models: { 'how explorer': 'model', 'how explainer': 'model' } }) as unknown as RunView;
const cases = [
  { family: maintainVerificationFamily, id: 'maintain-verification-skill.one-reader-per-feature-file', workers: () => ['totals', 'coupons', 'checkout'].map((name, i) => worker(`renamed-${i}`, `${repo}/.pi/skills/verify-cart/features/${name}.md`)) },
  { family: runtimeForensicsFamily, id: 'rt.reduction-in-a-subagent', workers: () => [worker('analysis-7', '', '', `node -e "const p=JSON.parse(require('fs').readFileSync('${profile}'));console.log(p.samples)"`)] },
  { family: refactoringFamily, id: 'refactoring.contract-learned-with-how', workers: () => [worker('source-7', `${repo}/src/cart.js`, 'Explain the contract of src/cart.js and its callers.')] },
];
for (const entry of cases) {
  const check = entry.family.checks.find((candidate) => candidate.id === entry.id)!;
  test(`${entry.id} accepts renamed responsible workers`, () => {
    expect(check.run(view(entry.workers()))).toMatchObject({ ok: true });
  });
  test(`${entry.id} rejects unrelated readonly work`, () => {
    expect(check.run(view([worker('reader-reducer-explainer', `${repo}/README.md`, 'Explain the README.')]))).toMatchObject({ ok: false });
  });
  test(`${entry.id} rejects ambiguous responsibility`, () => {
    const workers = entry.workers();
    expect(check.run(view([...workers, { ...workers[0]!, id: 'duplicate' }]))).toMatchObject({ ok: false });
  });
  test(`${entry.id} requires successful observed source work`, () => {
    const workers = entry.workers();
    workers[0]!.session!.toolCalls[0]!.isError = true;
    expect(check.run(view(workers))).toMatchObject({ ok: false });
  });
  for (const defect of ['role', 'workspace', 'root', 'model']) {
    if (entry.family === maintainVerificationFamily && defect === 'model') continue;
    test(`${entry.id} preserves ${defect}`, () => {
      const workers = entry.workers();
      const assignment = workers[0]!.assignment;
      if (defect === 'role') assignment['role'] = 'reviewer';
      if (defect === 'model') assignment['model'] = 'wrong';
      if (defect === 'workspace') assignment['workspace'] = { mode: 'worktree', path: repo };
      if (defect === 'root') assignment['workspace'] = { mode: 'readonly', path: '/elsewhere' };
      expect(check.run(view(workers))).toMatchObject({ ok: false });
    });
  }
}

test('maintain live drives follow collection of renamed feature readers', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'source-order-'));
  try {
    mkdirSync(join(sandbox, 'evidence'));
    const names = ['totals', 'coupons', 'checkout'];
    for (const name of names) writeFileSync(join(sandbox, 'evidence', `${name}.txt`), name);
    const workers = cases[0]!.workers();
    const calls = workers.map((worker, i) => ({ name: 'pstack_worker', args: { action: 'collect', workerId: worker.id }, order: i + 1, isError: false, resultText: '' }));
    const toolCalls = calls as unknown as ToolCall[];
    toolCalls.push(...names.map((name, i) => ({ name: 'bash', args: { command: `doctor.sh && sh drive.sh ${name}` }, order: i + 4, isError: false, resultText: 'doctor-ok' })) as ToolCall[]);
    toolCalls.push({ name: 'bash', args: { command: 'teardown.sh' }, order: 7, isError: false, resultText: 'torn-down' } as ToolCall);
    const run = { ...view(workers), sandbox, parent: { models: [], toolCalls: calls } } as unknown as RunView;
    const check = maintainVerificationFamily.checks.find((entry) => entry.id === 'maintain-verification-skill.live-pass-doctors-first-and-tears-down-last')!;
    expect(check.run(run)).toMatchObject({ ok: true });
    calls[2]!.order = 5;
    expect(check.run(run)).toMatchObject({ ok: false });
    calls[2]!.order = 3;
    calls[0]!.isError = true;
    expect(check.run(run)).toMatchObject({ ok: false });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
