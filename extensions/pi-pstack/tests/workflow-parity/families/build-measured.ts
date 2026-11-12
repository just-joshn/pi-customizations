// Families: refactoring, perf-issue, hillclimb, prototype (spec 12.3).
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Parent, proofSteps, scenario, Worker } from '../fixtures/dsl.ts';
import { BENCH_JS, cartHistory, DEDUPE_JS, perfHistory, quadraticComparisons, SET_DEDUPE_JS } from '../fixtures/repos.ts';
import { check, fail, pass, src, when } from '../lib/check.ts';
import {
  allWorkers,
  artifactsText,
  assignmentOf,
  branchCommits,
  delegateCommits,
  delegateOf,
  delegateOwnCommits,
  everyCommitGreen,
  namesCommit,
  collectOrder,
  openedAt,
  ranBefore,
  recordOrder,
  spawnOrder,
  stepReceipts,
  fanOutBeforeCollect,
  filesChanged,
  finalReply,
  noToolErrors,
  parentReads,
  pinBeforeChange,
  parentWritesOnlyScratch,
  playbookReads,
  primaryRun,
  promptRoutes,
  repoUntouched,
  runAtCommit,
  settledAndCollected,
  todoChecks,
  worktreeIsolation,
  workersCheck,
  writableWorkerRecords,
} from '../lib/checks.ts';
import { SCRIPTED_ROLES } from '../lib/driver.ts';
import { appendToolCall, corruptArtifact, rewriteSession, deleteReceipt, dirtyRepo, parentSession, patchAssignment, patchGit, patchReceipt, refreshGit, rewriteFinalReply, setStep, squashBranch, squashBranchWithout, stripEvidence } from '../lib/mutate.ts';
import { taskItems, todoNegatives, worktreeOf, writer } from './shared.ts';
import type { RunView, WorkerView } from '../lib/view.ts';
import type { Family } from './types.ts';

const model = (line: string) => String(SCRIPTED_ROLES[line]);
const readFile = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};
const comparisons = (text: string): number => Number(/comparisons=(\d+)/.exec(text)?.[1] ?? Number.NaN);
/** The receipts of steps 1 and 3 that carry the benchmark's comparisons: the baseline and the post-fix run, whatever ids the run gave them. */
function perfReceipts(view: RunView) {
  const run = primaryRun(view, 'perf-issue');
  const measured = (step: number) => stepReceipts(run, step).find((receipt) => !Number.isNaN(comparisons(artifactsText(run, receipt))));
  return { run, before: measured(1), after: measured(3) };
}
const BENCH = 'node bench/bench.js';

// ---- refactoring

const PIN_TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCoupon, subtotal, total } from '../src/cart.js';

const grid = [
  [[{ price: 2.5, qty: 2 }], 0],
  [[{ price: 1.25, qty: 4 }, { price: 3, qty: 1 }], 15],
  [[{ price: 0.1, qty: 3 }], 33],
  [[], 50],
];

test('pins subtotal, applyCoupon and total over a grid', () => {
  assert.deepEqual(
    grid.map(([items, percent]) => [subtotal(items), applyCoupon(subtotal(items), percent), total(items, percent)]),
    [[5, 5, 5], [8, 6.8, 6.8], [0.3, 0.2, 0.2], [0, 0, 0]],
  );
});
`;

const REFACTORED_CART = `import { roundCents } from './money.js';

export function subtotal(items) {
  return items.reduce((sum, item) => sum + roundCents(item.price * item.qty), 0);
}

export function applyCoupon(amount, percent) {
  return roundCents(amount - (amount * percent) / 100);
}

export function total(items, couponPercent = 0) {
  return applyCoupon(subtotal(items), couponPercent);
}
`;

const EQUIV_MJS = `import { pathToFileURL } from 'node:url';
const [oldDir, newDir] = process.argv.slice(2);
const load = (dir) => import(pathToFileURL(dir + '/src/cart.js').href);
const [before, after] = await Promise.all([load(oldDir), load(newDir)]);
const grid = [[[{ price: 2.5, qty: 2 }], 0], [[{ price: 1.25, qty: 4 }, { price: 3, qty: 1 }], 15], [[{ price: 0.1, qty: 3 }], 33], [[], 50], [[{ price: 9.99, qty: 7 }], 100]];
let same = 0;
for (const [items, percent] of grid) {
  const a = JSON.stringify([before.subtotal(items), before.total(items, percent)]);
  const b = JSON.stringify([after.subtotal(items), after.total(items, percent)]);
  if (a !== b) { console.log('DIFFERENT', a, b); process.exit(1); }
  same += 1;
}
console.log('equivalent: ' + same + ' cases identical');
`;

const loadOf = (dir: string) => `node -e "const fs=require('fs');const n=(d)=>{const t=fs.readFileSync(d+'/src/cart.js','utf8');return {lines:t.split('\\n').length,functions:(t.match(/function /g)||[]).length}};const a=n('${dir}/old'),b=n('.');console.log('old',JSON.stringify(a),'new',JSON.stringify(b));process.exit(b.lines<a.lines&&b.functions<a.functions?0:1)"`;

const REFACTOR_REPLY = `Structure changed: the one-caller wrapper lineTotal was inlined into subtotal and its export deleted, with no shim.
Pin: test/pin.test.js, committed first and green before and after.
Equivalence proof: the old and new src/cart.js give identical subtotal and total over 5 cases.
Reader-load delta: 1 fewer function and 4 fewer lines in src/cart.js.
Shipped: two commits, the pin then the subtraction. Reverted: nothing. No new behavior.`;

export const refactoringFamily: Family = {
  id: 'refactoring',
  title: 'Refactoring playbook: pin first, subtract, small green steps, independent equivalence, lower reader load (spec 12.3)',
  spec: {
    family: 'refactoring',
    runId: 'refactor-cart',
    history: cartHistory,
    prompt: () => '/poteto-mode refactor src/cart.js: lineTotal has one caller, so inline it. Behavior must not change.',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      parent.beginPlaybook('refactoring', 'Refactoring: inline the one-caller lineTotal');
      for (const leaf of ['principle-model-the-domain', 'principle-foundational-thinking', 'principle-redesign-from-first-principles', 'principle-subtract-before-you-add', 'principle-laziness-protocol', 'principle-migrate-callers-then-delete-legacy-apis', 'principle-prove-it-works', 'principle-minimize-reader-load', 'principle-sequence-verifiable-units', 'how']) parent.readSkill(leaf);
      parent.spawn('explainer', { role: 'general', model: model('how explainer'), workspace: parent.readonly() }, 'Simple path: learn the contract of src/cart.js: subtotal, applyCoupon, total, and who calls lineTotal.');
      workers['explainer'] = new Worker().read(join(ctx.repo, 'src/cart.js')).call('bash_readonly', { command: 'grep -rn lineTotal src test' }).text('### Overview\nlineTotal has exactly one caller, subtotal.');
      parent.wait('explainer').collect('explainer');
      parent.spawn('mover', { role: 'poteto', model: model('feature, refactoring'), workspace: parent.worktree() }, 'First commit a characterization test, test/pin.test.js, that pins subtotal, applyCoupon and total before any structure moves. Then inline lineTotal into subtotal and delete its export in the same wave. Scope: src/cart.js, test/pin.test.js. Behavior to hold: every output of subtotal, applyCoupon and total.');
      const tree = worktreeOf(parent, 'mover');
      workers['mover'] = writer(parent, 'mover', { units: [{ files: { 'test/pin.test.js': PIN_TEST }, commit: 'test: pin cart totals' }, { files: { 'src/cart.js': REFACTORED_CART }, commit: 'refactor: inline the one-caller lineTotal' }], test: 'node --test', report: 'The pin landed first and was green. The wrapper was inlined, no shim.' });
      parent.wait('mover').collect('mover');
      const artifacts = join(parent.runDir, 'verification', 'artifacts');
      parent.proof({ id: 'ref-pin', target: 'step-1', command: `git log --reverse --format=%s ${ctx.base}..HEAD | head -1 | grep -q '^test:'`, cwd: tree, kind: 'command', gitDir: tree });
      parent.done('refactoring', 1, 'ref-pin');
      parent.proof({ id: 'ref-structure', target: 'step-2', command: `grep -c 'function ' src/cart.js`, cwd: tree, kind: 'review' });
      parent.done('refactoring', 2, 'ref-structure');
      parent.skip('refactoring', 3, 'the reshape stays inside one module and crosses no function boundary, so parallel design exploration is not needed');
      parent.proof({ id: 'ref-subtract', target: 'step-4', command: `! grep -rn 'lineTotal' src test`, cwd: tree, kind: 'command' });
      parent.done('refactoring', 4, 'ref-subtract');
      parent.done('refactoring', 5, 'mover-check');
      parent.bash(`mkdir -p ${artifacts}/old && git -C ${ctx.repo} archive ${ctx.base} | tar -x -C ${artifacts}/old`);
      parent.write(join(artifacts, 'equiv.mjs'), EQUIV_MJS);
      parent.proof({ id: 'ref-equivalence', target: 'step-6', command: `node ${artifacts}/equiv.mjs ${artifacts}/old ${tree}`, cwd: tree, kind: 'command', gitDir: tree });
      parent.done('refactoring', 6, 'ref-equivalence');
      parent.proof({ id: 'ref-reader-load', target: 'step-7', command: loadOf(artifacts), cwd: tree, kind: 'measurement', gitDir: tree });
      parent.done('refactoring', 7, 'ref-reader-load');
      parent.skip('refactoring', 8, 'this repository has no remote, so no PR is opened here');
      parent.text(REFACTOR_REPLY);
      return scenario(parent, workers);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('refactoring', ['architect', 'figure-it-out']),
    ...todoChecks({ playbook: 'refactoring', skipReason: { 8: /PR|remote/i } }),
    workersCheck('refactoring.contract-learned-with-how', 'step 1: how ran to learn the contract, a readonly explainer on the repository root', src('poteto-mode/playbooks/refactoring.md', 'Run the **how** skill over the affected subsystem to learn the contract'), { role: 'general', min: 1, mode: 'readonly', rootPath: true, modelLine: 'how explainer', id: /explainer/ }),
    workersCheck('refactoring.mechanical-edits-delegated', 'step 5: the mechanical edits go to a poteto worker in its own worktree on the "feature, refactoring" model line', src('poteto-mode/playbooks/refactoring.md', 'Delegate the mechanical edits to a subagent using your configured refactoring model'), { role: 'poteto', min: 1, max: 1, mode: 'worktree', modelLine: 'feature, refactoring' }),
    check('refactoring.pin-lands-first-and-holds', 'step 1: a pin that executes the changed code was green before each structural commit, never in the same commit as the change, and no later commit edits it', src('poteto-mode/playbooks/refactoring.md', 'write a characterization test, snapshot, or equivalence harness that captures current behavior before any structure moves'), pinBeforeChange),
    everyCommitGreen('refactoring.small-steps-keep-the-pin-green', src('poteto-mode/playbooks/refactoring.md', 'Move in small behavior-preserving steps, each keeping the pin green'), (view) => primaryRun(view, 'refactoring')?.id ?? '', (view) => delegateOf(view)?.id ?? '', { min: 1, commits: delegateCommits }),
    check('refactoring.behavior-is-unchanged', 'step 6: the old and new src/cart.js give identical subtotal and total over a grid the checker runs itself', src('poteto-mode/playbooks/refactoring.md', 'Prove behavior is unchanged on the real artifact'), (view) => {
      const head = delegateCommits(view).at(-1);
      if (head === undefined) return fail('no refactor commit');
      const dir = mkdtempSync(join(tmpdir(), 'wf-equiv-'));
      try {
        mkdirSync(join(dir, 'old'));
        mkdirSync(join(dir, 'new'));
        for (const [name, sha] of [['old', view.base], ['new', head]] as const) spawnSync('sh', ['-c', `git -C ${JSON.stringify(view.repo)} archive ${sha} | tar -x -C ${join(dir, name)}`]);
        writeFileSync(join(dir, 'equiv.mjs'), EQUIV_MJS);
        const run = spawnSync('node', [join(dir, 'equiv.mjs'), join(dir, 'old'), join(dir, 'new')], { encoding: 'utf8' });
        return when(run.status === 0, run.stdout.trim(), `${run.stdout}${run.stderr}`.trim());
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }),
    check('refactoring.old-api-deleted-callers-migrated', 'the old API is deleted in the same wave: no lineTotal remains and no compatibility shim was added', src('poteto-mode/playbooks/refactoring.md', 'migrate every caller and delete the old API in the same wave'), (view) => {
      const head = delegateCommits(view).at(-1) ?? '';
      if (head === '') return fail('no delegate commit to examine');
      const grep = runAtCommit(view, head, "grep -rn -E 'lineTotal|deprecated|legacy|compat' src test");
      return when(grep.status === 1, 'no lineTotal and no shim wording at the delivered commit', `still present: ${grep.output.trim().slice(0, 160)}`);
    }),
    check('refactoring.reader-load-is-lower-and-no-new-behavior', 'step 7: src/cart.js has fewer lines and fewer functions, and exports nothing new', src('poteto-mode/playbooks/refactoring.md', 'The success measure is reduced reader load'), (view) => {
      const head = delegateCommits(view).at(-1) ?? '';
      if (head === '') return fail('no delegate commit to examine');
      const read = (sha: string) => runAtCommit(view, sha, 'cat src/cart.js').output;
      const [before, after] = [read(view.base), read(head)];
      const exportsOf = (text: string) => [...text.matchAll(/export function (\w+)/g)].map((match) => match[1] as string);
      const added = exportsOf(after).filter((name) => !exportsOf(before).includes(name));
      const count = (text: string) => ({ lines: text.split('\n').length, functions: (text.match(/function /g) ?? []).length });
      return when(count(after).lines < count(before).lines && count(after).functions < count(before).functions && added.length === 0, `lines ${count(before).lines} to ${count(after).lines}, functions ${count(before).functions} to ${count(after).functions}, new exports none`, `before ${JSON.stringify(count(before))}, after ${JSON.stringify(count(after))}, new exports ${added.join(', ')}`);
    }),
    parentWritesOnlyScratch('refactoring.parent-stays-in-the-lead', 'the parent wrote no production code: the contract is its, the edits are the worker\'s (the pin it writes under test/ is step 1)', src('poteto-mode/playbooks/refactoring.md', '**You own the contract.'), /^test\//),
    writableWorkerRecords('refactoring.worker-records', src('poteto-mode/playbooks/refactoring.md', 'Delegate the mechanical edits'), ['poteto']),
    settledAndCollected('refactoring.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
    noToolErrors('refactoring.no-tool-errors', src('poteto-mode/playbooks/refactoring.md', '**Reply:** the structure that changed')),
  ],
  negatives: [
    ...todoNegatives('refactor-cart', 'refactoring', { done: [1, 2, 4, 5, 6, 7], receipts: { 1: 'ref-pin', 2: 'ref-structure', 4: 'ref-subtract', 5: 'mover-check', 6: 'ref-equivalence', 7: 'ref-reader-load' } }),
    { name: 'the pin and the refactor landed as one commit', mutate: (sandbox) => squashBranch(sandbox, 'pstack-run/refactor-cart/mover'), fails: ['refactoring.pin-lands-first-and-holds'] },
    { name: 'the delegate made one focused commit and the existing tests were the pin', mutate: (sandbox) => squashBranchWithout(sandbox, 'pstack-run/refactor-cart/mover', 'test/pin.test.js'), fails: [], passes: ['refactoring.pin-lands-first-and-holds', 'refactoring.small-steps-keep-the-pin-green', 'refactoring.behavior-is-unchanged', 'refactoring.old-api-deleted-callers-migrated'] },
    { name: 'the refactor changed behavior', mutate: (sandbox) => changeBehavior(sandbox), fails: ['refactoring.behavior-is-unchanged', 'refactoring.small-steps-keep-the-pin-green'] },
    { name: 'the old API was left behind as a shim', mutate: (sandbox) => addShim(sandbox), fails: ['refactoring.old-api-deleted-callers-migrated'] },
    { name: 'the diff did not lower reader load', mutate: (sandbox) => addBulk(sandbox), fails: ['refactoring.reader-load-is-lower-and-no-new-behavior'] },
    { name: 'the parent wrote the edit itself', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['refactoring.parent-stays-in-the-lead'] },
    { name: 'the delegate ran on the wrong model line', mutate: (sandbox) => patchAssignment(sandbox, 'refactor-cart', 'mover', (assignment) => (assignment['model'] = 'sim/claude-sim')), fails: ['refactoring.mechanical-edits-delegated'] },
  ],
};

function onBranch(sandbox: string, branch: string, change: (dir: string) => void): void {
  const repo = join(sandbox, 'repo');
  const dir = mkdtempSync(join(tmpdir(), 'wf-mutate-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=m', '-c', 'user.email=m@x', ...args], { encoding: 'utf8' });
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', dir, branch]);
    change(dir);
    git('add', '-A');
    git('commit', '-q', '-m', 'mutation');
    execFileSync('git', ['-C', repo, 'update-ref', `refs/heads/${branch}`, git('rev-parse', 'HEAD').trim()]);
  } finally {
    spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', dir]);
    rmSync(dir, { recursive: true, force: true });
  }
  refreshGit(sandbox);
}

function changeBehavior(sandbox: string): void {
  onBranch(sandbox, 'pstack-run/refactor-cart/mover', (dir) => writeFileSync(join(dir, 'src/cart.js'), readFile(join(dir, 'src/cart.js')).replace('(amount * percent) / 100', '(amount * percent) / 100 + 0.01')));
}
function addShim(sandbox: string): void {
  onBranch(sandbox, 'pstack-run/refactor-cart/mover', (dir) => writeFileSync(join(dir, 'src/cart.js'), `${readFile(join(dir, 'src/cart.js'))}\n/** legacy shim */\nexport const lineTotal = (item) => item.price * item.qty;\n`));
}
function addBulk(sandbox: string): void {
  onBranch(sandbox, 'pstack-run/refactor-cart/mover', (dir) => writeFileSync(join(dir, 'src/cart.js'), `${readFile(join(dir, 'src/cart.js'))}\nfunction unused() {\n  return 1;\n}\nfunction unusedToo() {\n  return 2;\n}\n`));
}

// ---- perf issue

const MANTRAS = ["Don't do it.", "Do it, but don't do it again.", 'Do it less.', 'Do it later.', "Do it when they're not looking.", 'Do it concurrently.', 'Do it cheaper.'];
const delta = (before: number, after: number) => Math.round(((before - after) / before) * 1000) / 10;

const COMPARE = (artifacts: string) => `node -e "const f=(p)=>Number(/comparisons=(\\d+)/.exec(require('fs').readFileSync(p,'utf8'))[1]);const b=f('${artifacts}/perf-baseline.txt'),a=f('${artifacts}/perf-after.txt');console.log('baseline='+b+' after='+a+' delta='+(Math.round((b-a)/b*1000)/10)+'%');process.exit(a<b?0:1)"`;

export const perfFamily: Family = {
  id: 'perf-issue',
  title: 'Perf issue playbook: baseline before the fix, vetted harness, mantras in order, post-fix on the same command, explained number (spec 12.3)',
  spec: {
    family: 'perf-issue',
    runId: 'perf-dedupe',
    history: perfHistory,
    prompt: () => '/poteto-mode perf: dedupe() in src/dedupe.js does far too many comparisons. Measure it, fix it, and give me the numbers.',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      const artifacts = join(parent.runDir, 'verification', 'artifacts');
      parent.beginPlaybook('perf-issue', 'Perf: dedupe comparisons');
      for (const skill of ['benchmark-checklist', 'control-cli', 'principle-sequence-verifiable-units', 'how']) parent.readSkill(skill);
      parent.proof({ id: 'perf-baseline', target: 'step-1', command: BENCH, kind: 'measurement', commit: ctx.base });
      parent.proof({ id: 'perf-vetted', target: 'step-1-vet', command: `grep -q 'errors=0 work=400' ${artifacts}/perf-baseline.txt`, kind: 'review' });
      parent.done('perf-issue', 1, 'perf-baseline', 'perf-vetted');
      parent.spawn('explainer', { role: 'general', model: model('how explainer'), workspace: parent.readonly() }, 'Simple path: explain src/dedupe.js and where the comparisons come from.');
      workers['explainer'] = new Worker().read(join(ctx.repo, 'src/dedupe.js')).text('### Overview\nThe inner loop scans the output for each value.');
      parent.wait('explainer').collect('explainer');
      parent.proof({ id: 'perf-grounded', target: 'step-2', command: `ls ${parent.workerDir('explainer')}/assignment.json`, kind: 'review' });
      parent.done('perf-issue', 2, 'perf-grounded');
      parent.spawn('fix', { role: 'poteto', model: model('perf-issue'), workspace: parent.worktree() }, `Baseline: ${BENCH} printed comparisons=${quadraticComparisons()}.\nTry the performance mantras in order, cheapest first, and stop when an earlier one meets the target:\n${MANTRAS.map((mantra, index) => `${index + 1}. ${mantra}`).join('\n')}\nScope: src/dedupe.js only. Keep the benchmark in bench/ untouched. Commit the fix.`);
      const tree = worktreeOf(parent, 'fix');
      workers['fix'] = writer(parent, 'fix', { units: [{ files: { 'src/dedupe.js': SET_DEDUPE_JS }, commit: 'perf: dedupe with a Set, mantra 3 do it less' }], test: 'node --test', report: 'Mantra 3. A Set lookup replaces the scan of the output.' });
      parent.wait('fix').collect('fix');
      parent.bash(`git -C ${JSON.stringify(tree)} diff ${ctx.base}..HEAD --stat`);
      parent.proof({ id: 'perf-after', target: 'step-3', command: BENCH, cwd: tree, kind: 'measurement', gitDir: tree });
      parent.done('perf-issue', 3, 'perf-after', 'fix-check');
      parent.proof({ id: 'perf-compare', target: 'step-4', command: COMPARE(artifacts), kind: 'measurement', gitDir: tree });
      parent.done('perf-issue', 4, 'perf-compare');
      parent.skip('perf-issue', 5, 'no PR is opened here, so the measurement is cited in this reply and its artifact');
      parent.skip('perf-issue', 6, 'this repository has no remote, so no PR is opened here');
      parent.bash(`cat ${artifacts}/perf-compare.txt`);
      parent.text(`Baseline ${quadraticComparisons()} comparisons, post-fix 400, delta ${delta(quadraticComparisons(), 400)}% fewer. The same command ran at the base and at the delivered commit. Artifact: ${artifacts}/perf-compare.txt`);
      return scenario(parent, workers);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('perf-issue', ['architect']),
    ...todoChecks({ playbook: 'perf-issue', skipReason: { 5: /PR|reply/i, 6: /PR|remote/i } }),
    check('perf-issue.baseline-before-the-fix-and-vetted', 'step 1: the baseline ran before any fix was spawned, at the delegate\'s input commit (or the base), with the harness printing its error count and work done', src('poteto-mode/playbooks/perf-issue.md', 'Capture a baseline trace via the matching control skill'), (view) => {
      const { run, before } = perfReceipts(view);
      const delegate = delegateOf(view);
      const spawn = delegate === undefined ? -1 : spawnOrder(view, delegate.id);
      const recorded = before === undefined ? -1 : recordOrder(view, before.id);
      const early = ranBefore(view, before, delegate);
      const text = artifactsText(run, before);
      // The parent may commit the frozen harness before it spawns the delegate: the baseline is then at that input commit, not the original base.
      const inputs = [view.base, String(delegate === undefined ? '' : assignmentOf(delegate).workspace?.inputCommit)];
      return when(before !== undefined && namesCommit(before.commit, inputs) && early && /errors=0 work=\d+ comparisons=\d+/.test(text), `${before?.id} ${text.trim().slice(0, 60)} at ${before?.commit?.slice(0, 8)}, ran before the fix spawn (recorded at ${recorded}, spawn at ${spawn})`, `step 1 baseline receipt ${before?.id ?? 'none'}: commit ${String(before?.commit).slice(0, 8)} vs ${inputs.map((input) => input.slice(0, 8)).join('/')}, ran before the spawn ${String(early)} (recorded ${recorded}, spawn ${spawn}), output ${text.trim().slice(0, 80)}`);
    }),
    check('perf-issue.same-command-after-on-the-delivered-commit', 'step 3: the post-fix number is the same benchmark on a delivered commit, with no errors, and lower', src('poteto-mode/playbooks/perf-issue.md', 'Capture a post-fix trace'), (view) => {
      const { run, before, after } = perfReceipts(view);
      const delivered = [...delegateCommits(view), ...view.git.commitsSinceBase, view.git.head];
      const [b, a] = [comparisons(artifactsText(run, before)), comparisons(artifactsText(run, after))];
      const scripts = (receipt: typeof before) => new Set((receipt?.command ?? []).join(' ').match(/bench\/[\w.-]+\.m?js/g) ?? []);
      const sameCommand = JSON.stringify(before?.command) === JSON.stringify(after?.command) || [...scripts(before)].some((script) => scripts(after).has(script));
      return when(before !== undefined && after !== undefined && sameCommand && namesCommit(after.commit, delivered) && a < b && /errors=0/.test(artifactsText(run, after)), `same benchmark, ${b} to ${a} comparisons, after-commit ${after?.commit?.slice(0, 8)} is delivered`, `same benchmark ${sameCommand}, commit ${String(after?.commit).slice(0, 8)} delivered ${namesCommit(after?.commit, delivered)}, ${b} to ${a}`);
    }),
    check('perf-issue.numbers-reproduce', 'the recorded numbers reproduce when the checker runs the benchmark at the base and at the delivered commit', src('poteto-mode/playbooks/perf-issue.md', 'Tie every fix to a measurement'), (view) => {
      const head = delegateCommits(view).at(-1) ?? '';
      const { run, before, after } = perfReceipts(view);
      const [b, a] = [comparisons(runAtCommit(view, view.base, BENCH).output), comparisons(runAtCommit(view, head, BENCH).output)];
      const [rb, ra] = [comparisons(artifactsText(run, before)), comparisons(artifactsText(run, after))];
      return when(head !== '' && b === rb && a === ra, `reproduced ${b} and ${a}`, `rerun ${b}/${a}, recorded ${rb}/${ra}`);
    }),
    check('perf-issue.reply-explains-the-number', 'the reply gives the baseline number, the post-fix number, a delta that matches them, and an artifact path that exists', src('poteto-mode/playbooks/perf-issue.md', '**Reply:** baseline number, post-fix number, delta, artifact path'), (view) => {
      const reply = finalReply(view);
      const { run, before, after } = perfReceipts(view);
      const [b, a] = [comparisons(artifactsText(run, before)), comparisons(artifactsText(run, after))];
      // Numbers may be written with thousands separators (40,000).
      const plain = reply.replace(/(\d),(?=\d{3}\b)/g, '$1');
      const claimed = [...plain.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
      const candidates = [...reply.matchAll(/`?((?:\/|\.{0,2}\/)?[\w.\/-]+\.(?:txt|json|md|tsv))`?/g)].map((match) => match[1] as string);
      const path = candidates.find((candidate) => [candidate, join(view.repo, candidate), join(run?.dir ?? view.repo, candidate)].some((full) => existsSync(full)));
      // The skill asks for "delta" without a unit: a percent that matches, or the drop as a difference ("from 40000 to 0", "39600 fewer").
      const deltaStated = claimed.some((value) => Math.abs(Math.abs(value) - Math.abs(delta(b, a))) < 0.5) || (plain.includes(String(b - a)) && /\b(fewer|less|drop(ped)?|down|reduc\w+|saved|cut|from)\b/i.test(plain));
      return when(plain.includes(String(b)) && plain.includes(String(a)) && deltaStated && path !== undefined, `reply states ${b}, ${a}, a matching delta and the artifact ${path}`, `reply ${reply.slice(0, 160)}; computed ${delta(b, a)}%; percentages ${claimed.join(', ') || 'none'}; artifact ${path ?? 'none'}`);
    }),
    check('perf-issue.mantras-in-order', 'the mantras were tried in the playbook order: the delegate brief lists all seven in order, or the run\'s own notes (TODO.md, the brief, the reply) walk "Mantra 1", "Mantra 2", ... upward from the cheapest', src('poteto-mode/playbooks/perf-issue.md', "Try the performance mantras in order, cheapest first"), (view) => {
      const brief = allWorkers(view).find((worker) => assignmentOf(worker).role === 'poteto')?.brief ?? '';
      const positions = MANTRAS.map((mantra) => brief.indexOf(mantra));
      if (!positions.includes(-1) && positions.every((position, index) => index === 0 || position > (positions[index - 1] as number))) return pass('seven mantras in order');
      // "Mantra 1 declined ... Mantra 2 ... Meets the target, so mantras 3 through 7 stay unused": the numbers a note cites, in order of first mention.
      const notes = `${primaryRun(view, 'perf-issue')?.todoText ?? ''}\n${brief}\n${finalReply(view)}`;
      const cited: number[] = [];
      for (const match of notes.matchAll(/mantras?\s+(\d)(?:\s*(?:,|and|through|to|-)\s*(\d))?/gi)) for (const digit of [match[1], match[2]]) if (digit !== undefined && !cited.includes(Number(digit))) cited.push(Number(digit));
      return when(cited[0] === 1 && cited.length >= 2 && cited.every((number, index) => index === 0 || number > (cited[index - 1] as number)), `the notes try mantras ${cited.join(', ')} in order`, `no ordered list in the brief (positions ${positions.join(',')}) and the notes cite mantras ${cited.join(', ') || 'none'}`);
    }),
    workersCheck('perf-issue.fix-delegated', 'step 3: the fix is delegated to a poteto worker in its own worktree on the "perf-issue" model line', src('poteto-mode/playbooks/perf-issue.md', 'Delegate implementation to a subagent using your configured perf-issue model'), { role: 'poteto', min: 1, max: 1, mode: 'worktree', modelLine: 'perf-issue' }),
    check('perf-issue.harness-untouched', 'the benchmark is frozen: the delivered commit leaves bench/ as it was', src('poteto-mode/playbooks/perf-issue.md', 'Vet the baseline, and each later number'), (view) => {
      // The frozen harness may be committed by the parent before it spawns the delegate; the fix leaves it as it found it.
      const commits = delegateOwnCommits(view);
      const touched = commits.flatMap((sha) => filesChanged(view, sha)).filter((file) => file.startsWith('bench/'));
      return when(commits.length > 0 && touched.length === 0, 'no commit touches bench/', `touched ${touched.join(', ')}`);
    }),
    everyCommitGreen('perf-issue.commits-green', src('poteto-mode/playbooks/perf-issue.md', 'verifying each attempt before trying the next'), (view) => primaryRun(view, 'perf-issue')?.id ?? '', (view) => delegateOf(view)?.id ?? '', { min: 1, commits: delegateCommits }),
    parentWritesOnlyScratch('perf-issue.parent-stays-in-the-lead', 'the parent wrote no production code (the benchmark and test files it writes under bench/ and test/ are step 1)', src('poteto-mode/playbooks/perf-issue.md', '**You own the measurement story.'), /^(bench|test)\//),
    writableWorkerRecords('perf-issue.worker-records', src('poteto-mode/playbooks/perf-issue.md', 'Review the diff'), ['poteto']),
    settledAndCollected('perf-issue.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    ...todoNegatives('perf-dedupe', 'perf-issue', { done: [1, 2, 3, 4], receipts: { 1: 'perf-baseline', 2: 'perf-grounded', 3: 'perf-after', 4: 'perf-compare' } }),
    { name: 'the baseline was taken at the fixed commit', mutate: (sandbox) => patchReceipt(sandbox, 'perf-dedupe', 'perf-baseline', { commit: 'deadbeefdeadbeef' }), fails: ['perf-issue.baseline-before-the-fix-and-vetted'] },
    { name: 'the post-fix run used another command', mutate: (sandbox) => patchReceipt(sandbox, 'perf-dedupe', 'perf-after', { command: ['sh', '-c', 'node other.js'] }), fails: ['perf-issue.same-command-after-on-the-delivered-commit'] },
    { name: 'the recorded baseline is not what the benchmark prints', mutate: (sandbox) => lieAboutBaseline(sandbox), fails: ['perf-issue.numbers-reproduce'] },
    { name: 'the reply claims a delta the numbers do not give', mutate: (sandbox) => rewriteFinalReply(sandbox, /-?\d+(\.\d+)?%/, '-50%'), fails: ['perf-issue.reply-explains-the-number'] },
    { name: 'the reply states a drop that is not the baseline minus the post-fix number, with no percent', mutate: (sandbox) => rewriteFinalReply(sandbox, /delta [\d.]+% fewer/, '123 fewer'), fails: ['perf-issue.reply-explains-the-number'] },
    { name: 'the reply states the delta as a drop from the baseline to the post-fix number, with no percent', mutate: (sandbox) => rewriteFinalReply(sandbox, /delta [\d.]+% fewer/, `${quadraticComparisons() - 400} fewer`), fails: [], passes: ['perf-issue.reply-explains-the-number'] },
    { name: 'the mantras were handed over out of order', mutate: (sandbox) => rewriteBriefMantras(sandbox), fails: ['perf-issue.mantras-in-order'] },
    { name: 'the brief does not list the mantras, and the run notes walk them upward: Mantra 1 declined, Mantra 2 meets the target', mutate: (sandbox) => { writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/perf-dedupe/workers/fix/brief.md'), 'Fix src/dedupe.js.'); appendFileSync(join(sandbox, 'repo/.pi/pstack/runs/perf-dedupe/TODO.md'), '\n- [x] Pick the mantra. Mantra 1 declined, nothing is unused. Mantra 2 meets the target, so mantras 3 through 7 stay unused.\n'); }, fails: [], passes: ['perf-issue.mantras-in-order'] },
    { name: 'the run notes cite the mantras downward: Mantra 3 first, then Mantra 1', mutate: (sandbox) => { writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/perf-dedupe/workers/fix/brief.md'), 'Fix src/dedupe.js.'); appendFileSync(join(sandbox, 'repo/.pi/pstack/runs/perf-dedupe/TODO.md'), '\n- [x] Pick the mantra. Mantra 3 first, then mantra 1.\n'); }, fails: ['perf-issue.mantras-in-order'] },
    { name: 'the reply writes the baseline with a thousands separator', mutate: (sandbox) => rewriteFinalReply(sandbox, String(quadraticComparisons()), quadraticComparisons().toLocaleString('en-US')), fails: [], passes: ['perf-issue.reply-explains-the-number'] },
    { name: 'the reply names an artifact that does not exist', mutate: (sandbox) => rewriteFinalReply(sandbox, /Artifact: \S+/, 'Artifact: nowhere/none.txt'), fails: ['perf-issue.reply-explains-the-number'] },
    { name: 'the parent committed its benchmark harness on the checkout before spawning the delegate', mutate: (sandbox) => { execFileSync('sh', ['-c', 'mkdir -p bench && echo harness > bench/time.js && git add bench/time.js && git -c user.name=m -c user.email=m@x commit -q -m "bench: timing harness"'], { cwd: join(sandbox, 'repo') }); refreshGit(sandbox); }, fails: [], passes: ['perf-issue.parent-stays-in-the-lead'] },
    { name: 'the parent committed an empty commit on the checkout', mutate: (sandbox) => { execFileSync('git', ['-c', 'user.name=m', '-c', 'user.email=m@x', 'commit', '-q', '--allow-empty', '-m', 'edits'], { cwd: join(sandbox, 'repo') }); refreshGit(sandbox); }, fails: ['perf-issue.parent-stays-in-the-lead'] },
    { name: 'the parent wrote its timing harness under bench/', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'write', { path: `${sandbox}/repo/bench/time.js`, content: 'x' }), fails: [], passes: ['perf-issue.parent-stays-in-the-lead'] },
    { name: 'the benchmark was edited', mutate: (sandbox) => onBranch(sandbox, 'pstack-run/perf-dedupe/fix', (dir) => writeFileSync(join(dir, 'bench/bench.js'), `${BENCH_JS}// tuned\n`)), fails: ['perf-issue.harness-untouched'] },
    { name: 'the parent edited production code', mutate: (sandbox) => dirtyRepo(sandbox, 'src/dedupe.js'), fails: ['perf-issue.parent-stays-in-the-lead'] },
    { name: 'the fix ran on the wrong model line', mutate: (sandbox) => patchAssignment(sandbox, 'perf-dedupe', 'fix', (assignment) => (assignment['model'] = 'sim/claude-sim')), fails: ['perf-issue.fix-delegated'] },
  ],
};

function lieAboutBaseline(sandbox: string): void {
  const dir = join(sandbox, 'repo/.pi/pstack/runs/perf-dedupe/verification/artifacts');
  const path = join(dir, 'perf-baseline.txt');
  writeFileSync(path, readFile(path).replace(/comparisons=\d+/, 'comparisons=99999'));
  const receipt = join(sandbox, 'repo/.pi/pstack/runs/perf-dedupe/verification/receipts/perf-baseline.json');
  const recorded = JSON.parse(readFile(receipt)) as { receipt: { artifacts: { sha256: string }[] } };
  recorded.receipt.artifacts[0]!.sha256 = execFileSync('shasum', ['-a', '256', path], { encoding: 'utf8' }).split(' ')[0] as string;
  writeFileSync(receipt, JSON.stringify(recorded));
}

function rewriteBriefMantras(sandbox: string): void {
  const path = join(sandbox, 'repo/.pi/pstack/runs/perf-dedupe/workers/fix/brief.md');
  writeFileSync(path, readFile(path).replace('1. Don\'t do it.', '9. Don\'t do it.').replace("2. Do it, but don't do it again.", '0. Do it, but dont do it again.'));
}

void [parentReads, fanOutBeforeCollect, repoUntouched, setStep, stripEvidence, deleteReceipt, corruptArtifact, patchGit, parentSession, worktreeIsolation];

// ---- hillclimb

/** An attempt is a poteto worker in its own worktree; the playbook names no ids, so a run's attempts are whatever it called them. */
const isAttempt = (worker: WorkerView) => assignmentOf(worker).kind !== 'watch' && assignmentOf(worker).role === 'poteto' && assignmentOf(worker).workspace?.mode === 'worktree';
const attemptsOf = (view: RunView) => allWorkers(view).filter(isAttempt);
/** The baseline: a receipt of step 1 or 2 whose artifacts carry the metric, or the scripted run's hill-baseline. */
function hillBaseline(view: RunView) {
  const run = primaryRun(view, 'hillclimb');
  const candidates = [...stepReceipts(run, 1), ...stepReceipts(run, 2), ...(run?.receipts.filter((receipt) => receipt.id === 'hill-baseline') ?? [])];
  return { run, receipt: candidates.find((receipt) => !Number.isNaN(comparisons(artifactsText(run, receipt)))), gates: candidates.filter((receipt) => receipt.exitCode === 0 && (receipt.kind === 'test' || receipt.artifacts.some((artifact) => /test/i.test(artifact.path)))) };
}
/** An attempt's own measurement: the scripted hill-<id>-bench, or the measurement receipt that targets the attempt. */
const attemptBench = (view: RunView, id: string) => primaryRun(view, 'hillclimb')?.receipts.find((receipt) => receipt.id === `hill-${id}-bench`) ?? primaryRun(view, 'hillclimb')?.receipts.find((receipt) => receipt.target === id && receipt.kind === 'measurement');
const attemptComparisons = (view: RunView, id: string) => comparisons(artifactsText(primaryRun(view, 'hillclimb'), attemptBench(view, id)));
const HILL_HEADER = ['id', 'hypothesis', 'change', 'before', 'after', 'delta', 'tests', 'verdict', 'note'];
const NOOP_DEDUPE = DEDUPE_JS.replace('const out = [];', 'const out = []; // same work');
const BROKEN_DEDUPE = `export const counter = { comparisons: 0 };

export function dedupe(values) {
  counter.comparisons += values.length;
  return [...new Set(values)].sort((a, b) => a - b);
}
`;

const HILL_REPLY = (before: string, after: string, drop: number, log: string) => `Metric: comparisons, lower is better. Target: at least 90% fewer than baseline and at least 3 iterations.
Baseline ${before} to final ${after}, a ${drop}% drop.
Iterations run: 3, kept 1, reverted 2.
Accepted: h1 replaces the output scan with a Set lookup in src/dedupe.js.
Decision log: ${log}
Next idea if pushed further: skip the counter in the hot loop.`;

export const hillclimbFamily: Family = {
  id: 'hillclimb',
  title: 'Hillclimb playbook: frozen harness, baseline and gate first, one change per attempt in its own worktree, keep or revert, decision log (spec 12.3)',
  spec: {
    family: 'hillclimb',
    runId: 'hill-dedupe',
    history: perfHistory,
    prompt: () => '/poteto-mode hillclimb the comparisons metric of dedupe() until it is at least 90% better than baseline after at least 3 attempts',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      const artifacts = join(parent.runDir, 'verification', 'artifacts');
      const log = join(parent.runDir, 'decision.tsv');
      const base = quadraticComparisons();
      const after = 400;
      const drop = delta(base, after);
      const row = (cells: string[]) => `printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' ${cells.map((cell) => JSON.stringify(cell)).join(' ')} >> ${JSON.stringify(log)}`;
      parent.beginPlaybook('hillclimb', 'Hillclimb: dedupe comparisons');
      for (const skill of ['how', 'principle-build-the-lever', 'benchmark-checklist', 'show-me-your-work', 'principle-prove-it-works', 'principle-guard-the-context-window', 'principle-separate-before-serializing-shared-state', 'principle-sequence-verifiable-units', 'principle-laziness-protocol']) parent.readSkill(skill);
      parent.spawn('explainer', { role: 'general', model: model('how explainer'), workspace: parent.readonly() }, 'Simple path: explain dedupe and the realistic workloads that move its comparisons.');
      workers['explainer'] = new Worker().read(join(ctx.repo, 'src/dedupe.js')).text('### Overview\nComparisons grow with distinct values times inputs.');
      parent.wait('explainer').collect('explainer');
      parent.proof({ id: 'hill-baseline', target: 'baseline', command: BENCH, kind: 'measurement', commit: ctx.base });
      parent.proof({ id: 'hill-gate', target: 'gate', command: 'node --test', kind: 'test', commit: ctx.base });
      parent.proof({ id: 'hill-harness', target: 'step-2', command: `grep -q 'errors=0 work=400' ${artifacts}/hill-baseline.txt`, kind: 'review' });
      parent.done('hillclimb', 1, 'hill-baseline');
      parent.done('hillclimb', 2, 'hill-harness', 'hill-gate');
      parent.bash(`printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' ${HILL_HEADER.join(' ')} > ${JSON.stringify(log)}`);
      parent.proof({ id: 'hill-log', target: 'step-3', command: `head -1 ${log} | awk -F'\\t' '$1 == "id" && $2 == "hypothesis" { found = 1 } END { exit !found }'`, kind: 'review' });
      parent.done('hillclimb', 3, 'hill-log');
      parent.skip('hillclimb', 4, 'the hypotheses are ordered by the mantras in each attempt brief, with no separate output');
      const attempts: [string, string, string][] = [
        ['h1', SET_DEDUPE_JS, 'Do it less: a Set lookup replaces the scan of the output'],
        ['h2', BROKEN_DEDUPE, 'Do it cheaper: sort and skip comparisons'],
        ['h3', NOOP_DEDUPE, 'Do it cheaper: a comment-level tweak'],
      ];
      const staged = attempts.map(([id, , hypothesis]) => parent.stage(id, { role: 'poteto', model: model('hillclimb'), workspace: parent.worktree() }, `Hypothesis: ${hypothesis}.\nScope: src/dedupe.js only. The frozen harness is bench/bench.js, do not touch it. Change one thing and leave it uncommitted, because the parent applies the verdict.`));
      parent.fire(...staged);
      for (const [id, content] of attempts) {
        const tree = worktreeOf(parent, id);
        const worker = new Worker().write(join(tree, 'src/dedupe.js'), content);
        proofSteps(worker, ctx, { id: `hill-${id}-self`, target: id, command: BENCH, cwd: tree, kind: 'measurement', dir: join(parent.workerDir(id), 'evidence') }, join(parent.workerDir(id), 'evidence'));
        worker.write(join(parent.workerDir(id), 'report.md'), `${id}: change written in src/dedupe.js, self-measured, uncommitted.`);
        workers[id] = worker.text(`${id}: change written in src/dedupe.js, self-measured.`);
      }
      for (const [id] of attempts) parent.wait(id);
      parent.collect(...attempts.map(([id]) => id));
      for (const [id] of attempts) {
        const tree = worktreeOf(parent, id);
        parent.proof({ id: `hill-${id}-bench`, target: id, command: BENCH, cwd: tree, kind: 'measurement' });
        parent.proof({ id: `hill-${id}-gate`, target: id, command: 'node --test', cwd: tree, kind: 'test' });
      }
      parent.bash(`cd ${JSON.stringify(worktreeOf(parent, 'h1'))} && git add src/dedupe.js && git -c user.name=hill -c user.email=h@example.com commit -q -m "perf: Set lookup instead of scanning the output"`);
      for (const id of ['h2', 'h3']) parent.bash(`cd ${JSON.stringify(worktreeOf(parent, id))} && git checkout -- . && git clean -fdq`);
      parent.bash(row(['h1', 'Do it less: a Set lookup', 'src/dedupe.js', String(base), String(after), `-${drop}%`, 'green', 'kept', 'moved far past noise']));
      parent.bash(row(['h2', 'Do it cheaper: sort and skip', 'src/dedupe.js', String(base), String(after), `-${drop}%`, 'red', 'reverted', 'the regression gate failed']));
      parent.bash(row(['h3', 'Do it cheaper: comment tweak', 'src/dedupe.js', String(base), String(base), '0%', 'green', 'reverted', 'inside noise']));
      parent.done('hillclimb', 5, 'hill-h1-bench', 'hill-h1-gate');
      parent.skip('hillclimb', 6, 'no plateau: the first accepted fix met the target, so there is nothing to push past');
      parent.proof({ id: 'hill-stop', target: 'step-7', command: `node -e "process.exit(${drop} >= 90 && 3 >= 3 ? 0 : 1)"`, kind: 'measurement' });
      parent.done('hillclimb', 7, 'hill-stop');
      parent.skip('hillclimb', 8, 'this repository has no remote, so no PR is opened here');
      parent.text(HILL_REPLY(String(base), String(after), drop, log));
      return scenario(parent, workers);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('hillclimb', ['architect'], ['principle-separate-before-serializing-shared-state']),
    check('reads.hillclimb.separate-before-serializing', 'when attempts fan out in parallel, the parent opens principle-separate-before-serializing-shared-state: "fan them to parallel subagents, each in its own worktree (the separate-before-serializing-shared-state principle skill)"', src('poteto-mode/playbooks/hillclimb.md', 'fan them to parallel subagents, each in its own worktree'), (view) => {
      const spawns = attemptsOf(view).map((worker) => spawnOrder(view, worker.id)).filter((order) => order !== -1);
      const firstCollect = Math.min(...attemptsOf(view).map((worker) => collectOrder(view, worker.id)).filter((order) => order !== -1));
      const fannedOut = spawns.filter((order) => order < firstCollect).length >= 2;
      if (!fannedOut) return pass('the attempts ran one at a time, so there was no shared state to separate');
      return when(openedAt(view.parent, 'generated/skills/principle-separate-before-serializing-shared-state/SKILL.md') !== -1, 'attempts fanned out and the leaf was opened', 'attempts fanned out in parallel and the parent never opened principle-separate-before-serializing-shared-state');
    }),
    ...todoChecks({ playbook: 'hillclimb', skipReason: { 4: /.+/ } }),
    check('hillclimb.baseline-and-green-gate-before-any-change', 'step 2: the baseline metric and a green run of the regression gate are recorded at the base commit before the first attempt is spawned', src('poteto-mode/playbooks/hillclimb.md', 'Record the baseline metric and a green run of the regression gate'), (view) => {
      const { receipt: baseline, gates } = hillBaseline(view);
      const spawn = Math.min(...attemptsOf(view).map((worker) => spawnOrder(view, worker.id) === -1 ? Number.POSITIVE_INFINITY : spawnOrder(view, worker.id)));
      const first = attemptsOf(view).sort((a, b) => spawnOrder(view, a.id) - spawnOrder(view, b.id))[0];
      const early = baseline !== undefined && gates.length > 0 && ranBefore(view, baseline, first) && gates.some((gate) => ranBefore(view, gate, first));
      const recorded = Math.max(baseline === undefined ? -1 : recordOrder(view, baseline.id), ...gates.map((gate) => recordOrder(view, gate.id)));
      const inputs = [view.base, ...attemptsOf(view).map((worker) => String(assignmentOf(worker).workspace?.inputCommit))];
      return when(baseline !== undefined && gates.length > 0 && namesCommit(baseline.commit, inputs) && gates.some((gate) => namesCommit(gate.commit, inputs)) && early, 'baseline and a green gate at the base, run before the first attempt', `baseline ${baseline?.id ?? 'none'} commit ${String(baseline?.commit).slice(0, 8)}, green gates ${gates.map((gate) => gate.id).join(', ') || 'none'}, ran before the first attempt ${String(early)} (recorded ${recorded}, first spawn ${spawn})`);
    }),
    check('hillclimb.decision-log-shape', 'step 3: decision.tsv has the nine columns, one row per attempt, verdicts kept or reverted, and stays out of git', src('poteto-mode/playbooks/hillclimb.md', 'A `decision.tsv`, one row per attempt'), (view) => {
      const run = primaryRun(view, 'hillclimb');
      const text = readFile(join(run?.dir ?? '', 'decision.tsv'));
      const rows = text.split('\n').filter(Boolean).map((line) => line.split('\t'));
      const [header, ...body] = rows;
      const attempts = attemptsOf(view);
      const tracked = spawnSync('git', ['-C', view.repo, 'log', '--all', '--format=%H', '--', '.pi'], { encoding: 'utf8' }).stdout.trim();
      const problems: string[] = [];
      if (JSON.stringify(header) !== JSON.stringify(HILL_HEADER)) problems.push(`header ${JSON.stringify(header)}`);
      if (body.length !== attempts.length) problems.push(`${body.length} rows for ${attempts.length} attempts`);
      const baseline = comparisons(artifactsText(run, hillBaseline(view).receipt));
      for (const row of body) {
        if (row.length !== 9 || !['kept', 'reverted'].includes(String(row[7]))) problems.push(`bad row ${JSON.stringify(row)}`);
        const measured = attemptComparisons(view, String(row[0]));
        const percent = Number(String(row[5]).replace('%', ''));
        if (String(row[3]) !== String(baseline) || String(row[4]) !== String(measured) || Math.abs(Math.abs(percent) - Math.abs(delta(baseline, measured))) > 0.5) problems.push(`${row[0]}: logged ${row[3]} to ${row[4]} (${row[5]}), measured ${baseline} to ${measured}`);
      }
      if (new Set(body.map((row) => row[0])).size !== body.length) problems.push('duplicate ids');
      if (tracked !== '') problems.push('the log is tracked in git history');
      return when(problems.length === 0, `${body.length} rows, header exact, untracked`, problems.join('; '));
    }),
    check('hillclimb.keep-or-revert-matches-the-measurements', 'each attempt is kept only when its metric moved past noise and its gate stayed green; the log row and the branch agree with the receipts the checker re-verifies', src('poteto-mode/playbooks/hillclimb.md', 'Accept only when the metric moves past noise and the gate stays green'), (view) => {
      const run = primaryRun(view, 'hillclimb');
      const rows = readFile(join(run?.dir ?? '', 'decision.tsv')).split('\n').filter(Boolean).slice(1).map((line) => line.split('\t'));
      const baseline = comparisons(artifactsText(run, hillBaseline(view).receipt));
      const problems = rows.flatMap((row) => {
        const id = row[0] as string;
        const after = attemptComparisons(view, id);
        const gate = run?.receipts.find((entry) => entry.id === `hill-${id}-gate`)?.exitCode === 0;
        const moved = (baseline - after) / baseline > 0.05;
        const commits = branchCommits(view, run?.id ?? '', id);
        const dirty = view.git.worktreeDirty[join(run?.dir ?? '', 'workers', id, 'worktree')] ?? [];
        const kept = row[7] === 'kept';
        const should = moved && gate;
        return [
          ...(kept === should ? [] : [`${id}: logged ${row[7]} but measured moved=${moved} gate=${gate}`]),
          ...(kept && commits.length !== 1 ? [`${id}: kept with ${commits.length} commits`] : []),
          ...(!kept && (commits.length !== 0 || dirty.length !== 0) ? [`${id}: reverted but the branch holds ${commits.length} commits and ${dirty.length} dirty files`] : []),
        ];
      });
      return when(rows.length === 3 && problems.length === 0, `${rows.length} attempts: log, measurements, gates and branches agree`, problems.join('; ') || `${rows.length} rows`);
    }),
    check('hillclimb.accepted-commit-stages-only-its-files', 'one commit per accepted fix, touching only the files its row names, and never the frozen harness', src('poteto-mode/playbooks/hillclimb.md', 'One commit per accepted fix, staging only the files you changed'), (view) => {
      const run = primaryRun(view, 'hillclimb');
      const rows = readFile(join(run?.dir ?? '', 'decision.tsv')).split('\n').filter(Boolean).slice(1).map((line) => line.split('\t'));
      const problems = rows.filter((row) => row[7] === 'kept').flatMap((row) => {
        const commits = branchCommits(view, run?.id ?? '', row[0] as string);
        const files = commits.flatMap((sha) => filesChanged(view, sha));
        const named = String(row[2]).split(/[ ,]+/);
        return [...files.filter((file) => !named.includes(file)).map((file) => `${row[0]} commit touches ${file}, not named in the log`), ...files.filter((file) => file.startsWith('bench/')).map((file) => `${row[0]} touched the harness ${file}`)];
      });
      return when(rows.some((row) => row[7] === 'kept') && problems.length === 0, 'kept commits touch only their named files', problems.join('; ') || 'nothing was kept');
    }),
    check('hillclimb.harness-is-frozen', 'no attempt touched the frozen harness in its worktree or its commits', src('poteto-mode/playbooks/hillclimb.md', 'prove its sensitivity, then freeze it'), (view) => {
      const touched = attemptsOf(view).flatMap((worker) => {
        const run = view.runs.find((entry) => entry.workers.includes(worker));
        const dirty = view.git.worktreeDirty[join(worker.dir, 'worktree')] ?? [];
        return [...branchCommits(view, run?.id ?? '', worker.id).flatMap((sha) => filesChanged(view, sha)), ...dirty].filter((file) => file.startsWith('bench/')).map((file) => `${worker.id}:${file}`);
      });
      return when(touched.length === 0, 'bench/ is identical in every attempt', `harness touched: ${touched.join(', ')}`);
    }),
    workersCheck('hillclimb.attempts-delegated', 'step 5: each attempt is a poteto worker on the "hillclimb" model line, in its own worktree', src('poteto-mode/playbooks/hillclimb.md', 'Hand the change to a subagent using your configured hillclimb model'), { role: 'poteto', min: 3, mode: 'worktree', modelLine: 'hillclimb' }),
    worktreeIsolation('hillclimb.parallel-hypotheses-own-worktrees', src('poteto-mode/playbooks/hillclimb.md', 'fan them to parallel subagents, each in its own worktree')),
    check('hillclimb.reply-states-the-result', 'the reply names the metric and target, baseline to final with a percent that matches the receipts, kept versus reverted, the decision.tsv path, and the next idea', src('poteto-mode/playbooks/hillclimb.md', '**Reply:** the metric and target'), (view) => {
      const reply = finalReply(view);
      const run = primaryRun(view, 'hillclimb');
      const baseline = comparisons(artifactsText(run, hillBaseline(view).receipt));
      const keptRow = readFile(join(run?.dir ?? '', 'decision.tsv')).split('\n').filter(Boolean).slice(1).map((line) => line.split('\t')).find((row) => row[7] === 'kept');
      const final = keptRow === undefined ? Number.NaN : attemptComparisons(view, String(keptRow[0]));
      const claimed = Number(/(\d+(?:\.\d+)?)% drop/.exec(reply)?.[1] ?? Number.NaN);
      return when(reply.includes(String(baseline)) && reply.includes(String(final)) && Math.abs(claimed - delta(baseline, final)) < 1 && /kept 1, reverted 2/.test(reply) && reply.includes(join(run?.dir ?? '', 'decision.tsv')) && /Next idea/i.test(reply), `reply states ${baseline} to ${final} (${claimed}%), 1 kept and 2 reverted, the log path, and a next idea`, `reply: ${reply.slice(0, 200)}; computed ${delta(baseline, final)}%`);
    }),
    writableWorkerRecords('hillclimb.worker-records', src('poteto-mode/playbooks/hillclimb.md', 'Supervise and review the diff rather than typing it'), ['poteto']),
    settledAndCollected('hillclimb.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    ...todoNegatives('hill-dedupe', 'hillclimb', { done: [1, 2, 3], receipts: { 1: 'hill-baseline', 2: 'hill-harness', 3: 'hill-harness' } }),
    { name: 'the parent never opened the separate-before-serializing leaf although the attempts ran in parallel', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'principle-separate-before-serializing-shared-state', 'principle-zzz'), fails: ['reads.hillclimb.separate-before-serializing'] },
    { name: 'the baseline and gate receipts target the steps as "1" and "2"', mutate: (sandbox) => { patchReceipt(sandbox, 'hill-dedupe', 'hill-baseline', { target: '1' }); patchReceipt(sandbox, 'hill-dedupe', 'hill-gate', { target: '2' }); }, fails: [], passes: ['hillclimb.baseline-and-green-gate-before-any-change'] },
    { name: 'a reverted attempt kept its commit', mutate: (sandbox) => onBranch(sandbox, 'pstack-run/hill-dedupe/h3', (dir) => writeFileSync(join(dir, 'src/dedupe.js'), `${readFile(join(dir, 'src/dedupe.js'))}// kept anyway\n`)), fails: ['hillclimb.keep-or-revert-matches-the-measurements'] },
    { name: 'a win was logged as reverted', mutate: (sandbox) => relog(sandbox, 'kept', 'reverted'), fails: ['hillclimb.keep-or-revert-matches-the-measurements'] },
    { name: 'the log row lies about the measurement', mutate: (sandbox) => relog(sandbox, /\t-\d+(\.\d+)?%/, '\t-12%'), fails: ['hillclimb.decision-log-shape'] },
    { name: 'a failing attempt was kept', mutate: (sandbox) => relog(sandbox, /^h2\t(.*)\treverted/m, 'h2\t$1\tkept'), fails: ['hillclimb.keep-or-revert-matches-the-measurements'] },
    { name: 'the decision log lost a column', mutate: (sandbox) => relog(sandbox, '\tnote', ''), fails: ['hillclimb.decision-log-shape'] },
    { name: 'the frozen harness was edited', mutate: (sandbox) => onBranch(sandbox, 'pstack-run/hill-dedupe/h1', (dir) => writeFileSync(join(dir, 'bench/bench.js'), `${BENCH_JS}// tuned\n`)), fails: ['hillclimb.harness-is-frozen', 'hillclimb.accepted-commit-stages-only-its-files'] },
    { name: 'an accepted commit staged an unrelated file', mutate: (sandbox) => onBranch(sandbox, 'pstack-run/hill-dedupe/h1', (dir) => writeFileSync(join(dir, 'README.md'), 'stray\n')), fails: ['hillclimb.accepted-commit-stages-only-its-files', 'hillclimb.keep-or-revert-matches-the-measurements'] },
    { name: 'the baseline was never recorded at the base commit', mutate: (sandbox) => patchReceipt(sandbox, 'hill-dedupe', 'hill-baseline', { commit: null }), fails: ['hillclimb.baseline-and-green-gate-before-any-change'] },
    { name: 'the gate was never green before the first attempt', mutate: (sandbox) => patchReceipt(sandbox, 'hill-dedupe', 'hill-gate', { exitCode: 1 }), fails: ['hillclimb.baseline-and-green-gate-before-any-change'] },
    { name: 'the reply overstates the win', mutate: (sandbox) => rewriteFinalReply(sandbox, '99% drop', '40% drop'), fails: ['hillclimb.reply-states-the-result'] },
  ],
};

function relog(sandbox: string, from: string | RegExp, to: string): void {
  const path = join(sandbox, 'repo/.pi/pstack/runs/hill-dedupe/decision.tsv');
  writeFileSync(path, readFile(path).replace(from as string, to));
}

// ---- prototype

const VARIANTS_JS = `export const variants = {
  A: { label: 'half up', round: (value) => Math.round(value * 100) / 100 },
  B: { label: "banker's", round: (value) => { const x = value * 100; const f = Math.floor(x); const d = x - f; const r = d === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(x); return r / 100; } },
  C: { label: 'truncate', round: (value) => Math.trunc(value * 100) / 100 },
};
`;
const SWITCH_JS = `import { variants } from './variants.js';
const [name = 'A', ...inputs] = process.argv.slice(2);
const variant = variants[name];
console.log(name + ' ' + variant.label + ': ' + inputs.map((input) => variant.round(Number(input))).join(' '));
`;
const SAMPLES = ['1.005', '2.675', '0.125', '1.115'];
const RECOMMENDS = /\*{0,2}Recommendation\*{0,2}\s*[:.]|\bI recommend\b|\brecommended?\b/i;

/**
 * The prototype's scratch directory as the reply names it: `Scratch path: <dir>`, or any scratch path in a code span (a file's directory).
 * A relative path is read against the run directory, the repository, and the sandbox.
 */
function scratchOf(view: RunView): string {
  const reply = finalReply(view);
  // "Scratch path: <dir>", else the first code span that names a scratch location (`scratch/probe.mjs`).
  const labelled = /Scratch (?:path|dir(?:ectory)?|folder)\s*:\s*`?([^`\s]+)`?/i.exec(reply)?.[1]?.replace(/[.,;]+$/, '');
  const named = labelled ?? [...reply.matchAll(/`([^`\n]*scratch[^`\n]*\/[^`\n]*)`/gi)].map((match) => match[1] as string)[0];
  if (named === undefined) return '';
  const run = primaryRun(view, 'prototype');
  const found = [named, join(run?.dir ?? view.repo, named), join(view.repo, named), join(view.sandbox, named)].find((candidate) => existsSync(candidate));
  if (found === undefined) return named;
  return statSync(found).isDirectory() ? found : dirname(found);
}
/** A step's receipts, or the scripted receipt of that id. */
const stepText = (view: RunView, step: number, scriptedId: string) => {
  const run = primaryRun(view, 'prototype');
  return [...stepReceipts(run, step), ...(run?.receipts.filter((receipt) => receipt.id === scriptedId) ?? [])].map((receipt) => artifactsText(run, receipt)).join('\n');
};

const PROTO_REPLY = (scratch: string) => `Variants explored: A half up, B banker's, C truncate, behind one switcher.
Evidence: on 1.005, 2.675, 0.125 and 1.115 the variants differ, the observed output is in the receipts.
| variant | tradeoff |
| A half up | familiar, biased upward on halves |
| B banker's | unbiased, surprises shoppers |
| C truncate | never overcharges, undercharges by up to a cent |
Recommendation: A half up, because it matches what shoppers expect, and the observed outputs show B only differs on exact halves.
Scratch path: ${scratch}. This prototype is throwaway, not shippable. The real build follows Feature.`;

export const prototypeFamily: Family = {
  id: 'prototype',
  title: 'Prototype playbook: settle an empirical fork by observing a throwaway, not by asking the human (spec 12.3)',
  spec: {
    family: 'prototype',
    runId: 'prototype-rounding',
    history: cartHistory,
    prompt: () => "/poteto-mode prototype: should coupon rounding be half up, banker's, or truncate? Sketch it and decide by what it prints.",
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const scratch = join(ctx.sandbox, 'scratch', 'rounding');
      const artifacts = join(parent.runDir, 'verification', 'artifacts');
      parent.beginPlaybook('prototype', 'Prototype: coupon rounding');
      parent.readSkill('principle-exhaust-the-design-space');
      parent.task('Decision this prototype makes: which rounding rule the coupon total uses, half up, banker\'s, or truncate, settled by the printed outputs');
      parent.proof({ id: 'proto-scope', target: 'step-1', command: `grep -c 'Decision this prototype makes' ${join(parent.runDir, 'TODO.md')}`, kind: 'review' });
      parent.done('prototype', 1, 'proto-scope');
      parent.skip('prototype', 2, 'the direction is set: three rounding rules, no moodboard needed');
      parent.write(join(scratch, 'variants.js'), VARIANTS_JS).write(join(scratch, 'switch.js'), SWITCH_JS);
      parent.proof({ id: 'proto-built', target: 'step-3', command: `ls ${scratch}`, kind: 'command' });
      parent.done('prototype', 3, 'proto-built');
      parent.proof({ id: 'proto-switcher', target: 'step-4', command: `grep -c "label:" ${scratch}/variants.js | grep -qx 3`, kind: 'command' });
      parent.done('prototype', 4, 'proto-switcher');
      parent.proof({ id: 'proto-observed', target: 'step-5', command: `for v in A B C; do node ${scratch}/switch.js $v ${SAMPLES.join(' ')}; done`, kind: 'measurement' });
      parent.done('prototype', 5, 'proto-observed');
      parent.proof({ id: 'proto-presented', target: 'step-6', command: `test -s ${artifacts}/proto-observed.txt`, kind: 'review' });
      parent.done('prototype', 6, 'proto-presented');
      parent.text(PROTO_REPLY(scratch));
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('prototype', ['architect']),
    ...todoChecks({ playbook: 'prototype', skipReason: { 2: /.+/ } }),
    check('prototype.decision-scoped', 'step 1: the decision the prototype makes is written down before building: a task item of TODO.md, or the artifact of the step 1 receipt', src('poteto-mode/playbooks/prototype.md', 'Scope the decision the prototype exists to make'), (view) => {
      const run = primaryRun(view, 'prototype');
      const items = taskItems(run).map((item) => item.text);
      const written = items.find((item) => /decision/i.test(item)) ?? (/decision/i.test(artifactsText(run, stepReceipts(run, 1)[0])) ? 'the step 1 artifact' : undefined);
      return when(written !== undefined, `the decision is written down: ${String(written).slice(0, 80)}`, 'no task item and no step 1 artifact states the decision');
    }),
    check('prototype.throwaway-scratch-outside-production', 'step 3: the prototype lives in an isolated scratch directory, outside production source (outside the repository, or under .pi/), with no tests, no dependencies, no production edits', src('poteto-mode/playbooks/prototype.md', 'Build throwaway in an isolated scratch dir, separate from production source'), (view) => {
      const scratch = scratchOf(view);
      const files = scratch !== '' && existsSync(scratch) ? readdirSync(scratch) : [];
      const tests = files.filter((file) => /test|spec/.test(file));
      const isolated = scratch !== '' && (!scratch.startsWith(view.repo) || scratch.startsWith(join(view.repo, '.pi')));
      return when(isolated && files.length >= 1 && tests.length === 0 && !files.includes('node_modules') && !files.includes('package.json') && view.git.dirty.length === 0 && view.git.commitsSinceBase.length === 0, `scratch ${scratch} holds ${files.join(', ')}; the repository is untouched`, `scratch ${scratch || 'not named in the reply'}; files ${files.join(', ')}; dirty ${view.git.dirty.join(', ') || 'none'}`);
    }),
    check('prototype.variants-behind-one-switcher', 'step 4: at least two labeled variants run behind one switcher', src('poteto-mode/playbooks/prototype.md', 'build them behind one switcher'), (view) => {
      const scratch = scratchOf(view);
      const variants = readFile(join(scratch, 'variants.js'));
      const labels = [...variants.matchAll(/label: '([^']+)'|label: "([^"]+)"/g)];
      const runs = spawnSync('node', [join(scratch, 'switch.js'), 'B', '1.005'], { encoding: 'utf8' });
      return when(labels.length >= 2 && runs.status === 0 && /^B /.test(runs.stdout), `${labels.length} labeled variants, the switcher runs: ${runs.stdout.trim()}`, `labels ${labels.length}, switcher exit ${runs.status}`);
    }),
    check('prototype.observation-is-the-evidence', 'step 5: the decision rests on observed output: the step 5 receipt holds every variant\'s output, and the variants differ', src('poteto-mode/playbooks/prototype.md', 'The observation is the test here, not an assertion'), (view) => {
      const lines = stepText(view, 5, 'proto-observed').split('\n').map((line) => line.trim()).filter(Boolean);
      // "A half up: 1 1 1 1" is a variant, its label, and its outputs on the shared inputs; the outputs are what the variants must not share.
      const outputs = lines.map((line) => (line.includes(': ') ? line.slice(line.indexOf(': ') + 2) : line));
      return when(lines.length >= 2 && new Set(outputs).size >= 2, `${lines.length} lines observed, ${new Set(outputs).size} distinct outputs`, `observed ${JSON.stringify(lines.slice(0, 4))}`);
    }),
    check('prototype.decides-without-asking-the-human', 'an empirical fork is settled by running it: the reply gives a recommendation and does not hand the choice back as a question', src('poteto-mode/SKILL.md', 'it is not the human\'s to answer'), (view) => {
      const reply = finalReply(view).trim();
      return when(RECOMMENDS.test(reply) && !reply.endsWith('?') && !/which would you like|should I\b.*\?/i.test(reply), 'the reply recommends and asks nothing', `reply ends: ${reply.slice(-100)}`);
    }),
    check('prototype.reply-names-tradeoffs-scratch-and-throwaway', 'the reply gives the variants, tradeoffs, the scratch path, says the prototype is throwaway, and hands the real build to Feature', src('poteto-mode/playbooks/prototype.md', 'Say plainly that the prototype is throwaway'), (view) => {
      const reply = finalReply(view);
      const missing = [{ name: 'variants', pattern: /variants?/i }, { name: 'tradeoffs', pattern: /trade-?offs?/i }, { name: 'recommendation', pattern: RECOMMENDS }, { name: 'throwaway', pattern: /throwaway/i }, { name: 'Feature', pattern: /Feature/ }, { name: 'a scratch path', pattern: /scratch/i }].filter(({ pattern }) => !pattern.test(reply)).map(({ name }) => name);
      return when(missing.length === 0, 'reply has variants, tradeoffs, recommendation, throwaway, Feature', `missing ${missing.join(', ')}`);
    }),
    repoUntouched('prototype.repository-untouched', 'no prototype code entered the repository', src('poteto-mode/playbooks/prototype.md', 'The output is the decision plus the throwaway artifact, not shippable code')),
    noToolErrors('prototype.no-tool-errors', src('poteto-mode/playbooks/prototype.md', '**Reply:** the variants explored')),
  ],
  negatives: [
    ...todoNegatives('prototype-rounding', 'prototype', { done: [1, 3, 4, 5, 6], receipts: { 1: 'proto-scope', 3: 'proto-built', 4: 'proto-switcher', 5: 'proto-observed', 6: 'proto-presented' } }),
    { name: 'the prototype was built inside the repository', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['prototype.repository-untouched'] },
    { name: 'the prototype grew a test suite', mutate: (sandbox) => writeFileSync(join(sandbox, 'scratch/rounding/variants.test.js'), 'x\n'), fails: ['prototype.throwaway-scratch-outside-production'] },
    { name: 'only one variant was built', mutate: (sandbox) => writeFileSync(join(sandbox, 'scratch/rounding/variants.js'), "export const variants = { A: { label: 'half up', round: (v) => Math.round(v * 100) / 100 } };\n"), fails: ['prototype.variants-behind-one-switcher'] },
    { name: 'the variants printed the same output', mutate: (sandbox) => collapseObservation(sandbox), fails: ['prototype.observation-is-the-evidence'] },
    { name: 'the decision is written only in a step 1 artifact, not as a task item', mutate: (sandbox) => { const path = join(sandbox, 'repo/.pi/pstack/runs/prototype-rounding/TODO.md'); writeFileSync(path, readFile(path).split('\n').filter((line) => !line.includes('Decision this prototype makes')).join('\n')); }, fails: ['prototype.decision-scoped'] },
    { name: 'the reply recommends in bold with a period and states tradeoffs in prose, naming the scratch folder in a code span', mutate: (sandbox) => rewriteFinalReply(sandbox, /Variants explored[\s\S]*$/, 'Three variants, A half up, B banker\'s, C truncate, behind one switcher. Tradeoffs: A is biased upward, B surprises shoppers, C undercharges. **Recommendation.** A half up. The scratch is `scratch/rounding/variants.js`, a throwaway. The real build follows Feature.'), fails: [], passes: ['prototype.decides-without-asking-the-human', 'prototype.reply-names-tradeoffs-scratch-and-throwaway', 'prototype.throwaway-scratch-outside-production'] },
    { name: 'the reply names no scratch location at all', mutate: (sandbox) => rewriteFinalReply(sandbox, /Scratch path: [^\n]*/, 'This prototype is throwaway. The real build follows Feature.'), fails: ['prototype.throwaway-scratch-outside-production'] },
    { name: 'the reply asks the human to pick', mutate: (sandbox) => rewriteFinalReply(sandbox, 'The real build follows Feature.', 'Which would you like me to pick?'), fails: ['prototype.decides-without-asking-the-human'] },
    { name: 'the reply forgot to call the prototype throwaway', mutate: (sandbox) => rewriteFinalReply(sandbox, 'throwaway', 'kept'), fails: ['prototype.reply-names-tradeoffs-scratch-and-throwaway'] },
  ],
};

function collapseObservation(sandbox: string): void {
  const dir = join(sandbox, 'repo/.pi/pstack/runs/prototype-rounding/verification/artifacts');
  writeFileSync(join(dir, 'proto-observed.txt'), `A half up: 1 1 1 1\nB banker's: 1 1 1 1\nC truncate: 1 1 1 1\n`);
}

void [Parent, fail];

export const measuredFamilies: Family[] = [refactoringFamily, perfFamily, hillclimbFamily, prototypeFamily];
