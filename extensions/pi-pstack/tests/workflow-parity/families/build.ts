// Families: feature, bug-fix, tdd (spec 12.3). Refactoring, perf-issue, hillclimb and prototype live in build-measured.ts.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { cartHistory, lineOf } from '../fixtures/repos.ts';
import { check, fail, pass, src, when } from '../lib/check.ts';
import {
  allWorkers,
  assignmentOf,
  artifactText,
  branchCommits,
  redFirst,
  delegateCommits,
  delegateOf,
  everyCommitGreen,
  namesCommit,
  ranBefore,
  recordOrder,
  spawnOrder,
  stepReceipts,
  filesChanged,
  finalReply,
  noToolErrors,
  parentReads,
  parentWritesOnlyScratch,
  playbookReads,
  primaryRun,
  promptRoutes,
  runAtCommit,
  settledAndCollected,
  skillFile,
  openedAt,
  todoChecks,
  workersCheck,
  writableWorkerRecords,
} from '../lib/checks.ts';
import { PI, SCRIPTED_ROLES } from '../lib/driver.ts';
import { appendToolCall, dirtyRepo, overwrite, rewriteSession, parentSession, patchAssignment, patchGit, patchReceipt, refreshGit, removeWorker, rewriteFinalReply, setStep, squashBranch, squashMain, stripEvidence } from '../lib/mutate.ts';
import type { RunView, ToolCall } from '../lib/view.ts';
import { taskItems, todoNegatives, worktreeOf, writer } from './shared.ts';
import type { Family } from './types.ts';

const model = (line: string) => String(SCRIPTED_ROLES[line]);
void PI;

// ---- feature

const CSV_JS = `export function csvRow(cells) {
  return cells
    .map((cell) => {
      const text = String(cell);
      return /[",\\n]/.test(text) ? \`"\${text.replaceAll('"', '""')}"\` : text;
    })
    .join(',');
}
`;
const CSV_TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csvRow } from '../src/csv.js';

test('joins cells', () => assert.equal(csvRow(['a', 1]), 'a,1'));
test('quotes a comma', () => assert.equal(csvRow(['a,b']), '"a,b"'));
`;
const EXPORT_JS = `import { lineTotal } from './cart.js';
import { csvRow } from './csv.js';

export const COLUMNS = ['name', 'qty', 'price', 'line_total'];

export function exportCsv(items) {
  const rows = items.map((item) => csvRow([item.name ?? '', item.qty, item.price, lineTotal(item)]));
  return \`\${[csvRow(COLUMNS), ...rows].join('\\n')}\\n\`;
}
`;
const EXPORT_TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportCsv } from '../src/export.js';

test('exports a header and one row per item', () => {
  assert.equal(exportCsv([{ name: 'pen', price: 2.5, qty: 2 }]), 'name,qty,price,line_total\\npen,2,2.5,5\\n');
});
`;

const SURFACE = `node --input-type=module -e "import('./src/export.js').then((m)=>process.stdout.write(m.exportCsv([{name:'pen',price:2.5,qty:2}])))"`;
const FEATURE_CHECKPOINT = ['Blocking first steps. Gates run before fan-out: none, one worker owns the change.', 'Independent workstreams. n/a: one module, no disjoint slices.', 'Shared mutable state. n/a: one worker writes src/csv.js and src/export.js, nothing is shared.', 'Smallest safe decomposition. One worker is best: two small units in one module, each verified before the next.'];

const FEATURE_REPLY = `Built exportCsv(items) in src/export.js:${lineOf([{ message: 'x', files: { 'src/export.js': EXPORT_JS } }], 'src/export.js', 'export function exportCsv')} on top of csvRow in src/csv.js. The data shape is a Row of name, qty, price, line_total, organized as a COLUMNS table so a new column is one entry.
Throughput checkpoint
- Blocking first steps: none.
- Independent workstreams: n/a, one module.
- Shared mutable state: n/a.
- Smallest safe decomposition: one worker, two units.
Open decisions: whether name should be required on cart items.`;

/** The delegate the playbook's step 4 spawns: the poteto worker, whatever the parent named it. */
const featureWriter = (view: RunView): string => allWorkers(view).find((worker) => assignmentOf(worker).role === 'poteto')?.id ?? 'impl';

/** The brief names the data shape and how it is organized (feature.md step 4: "a state machine over scattered booleans, a table/registry over branching, a typed model"); it needs not say "data shape". */
const DATA_SHAPE = /data (shape|model|structure)|state machine|\b(table|registry|schema|typed model)\b/i;

/** The brief says what done means. The playbook names "success criteria" as content, so a labelled section, an exact contract, or a stated test or exit condition each say it. */
const SUCCESS_CRITERIA = /success criteria|acceptance (criteria|tests?)|definition of done|done when|exact contract|\bmust (pass|return|keep|stay|exit)\b|\bcover at least\b|(node --test|npm test) passes|exits? (0|zero)\b/i;

export const featureFamily: Family = {
  id: 'feature',
  title: 'Feature playbook: ground with how, checkpoint, delegate to one worker, verify units and the surface (spec 12.3)',
  spec: {
    family: 'feature',
    runId: 'feature-export',
    history: cartHistory,
    prompt: () => '/poteto-mode add a CSV export of the cart: exportCsv(items) with name, qty, price and line total columns',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      parent.beginPlaybook('feature', 'Feature: export the cart as CSV');
      for (const leaf of ['principle-separate-before-serializing-shared-state', 'principle-model-the-domain', 'principle-sequence-verifiable-units']) parent.readSkill(leaf);
      parent.readSkill('how');
      parent.spawn('explainer', { role: 'general', model: model('how explainer'), workspace: parent.readonly() }, 'Simple path: explain how src/cart.js and src/checkout.js produce line totals.');
      workers['explainer'] = new Worker().read(join(ctx.repo, 'src/cart.js')).text(`### Overview\nlineTotal() in src/cart.js:${lineOf(cartHistory, 'src/cart.js', 'export function lineTotal')} prices one line.`);
      parent.wait('explainer').collect('explainer');
      parent.proof({ id: 'feat-grounded', target: 'step-1', command: `ls ${parent.workerDir('explainer')}/assignment.json`, kind: 'review' });
      parent.done('feature', 1, 'feat-grounded');
      parent.skip('feature', 2, 'a single-module addition: no function boundary is crossed, so parallel design exploration adds nothing');
      for (const item of FEATURE_CHECKPOINT) parent.task(item);
      parent.proof({ id: 'feat-checkpoint', target: 'step-3', command: `grep -c -E '^- \\[ \\] (Blocking first steps|Independent workstreams|Shared mutable state|Smallest safe decomposition)' ${join(parent.runDir, 'TODO.md')} | grep -qx 4`, kind: 'review' });
      parent.done('feature', 3, 'feat-checkpoint');
      parent.spawn('impl', { role: 'poteto', model: model('feature, refactoring'), workspace: parent.worktree(), skills: ['poteto-mode'] }, `Build exportCsv(items) in src/export.js using csvRow from src/csv.js.\nFile paths: src/csv.js, src/export.js, test/csv.test.js, test/export.test.js.\nData shape: a Row of name, qty, price, line_total, organized as a COLUMNS table, chosen before any logic.\nSuccess criteria: node --test passes at each commit, exportCsv([{name:'pen',price:2.5,qty:2}]) returns the header and the row pen,2,2.5,5.\nCommit each small unit after its tests pass.`);
      workers['impl'] = writer(parent, 'impl', {
        units: [
          { files: { 'src/csv.js': CSV_JS, 'test/csv.test.js': CSV_TEST }, commit: 'feat: csvRow quotes cells' },
          { files: { 'src/export.js': EXPORT_JS, 'test/export.test.js': EXPORT_TEST }, commit: 'feat: exportCsv builds the table' },
        ],
        test: 'node --test',
        report: 'Two units, each green before its commit. Data shape is the COLUMNS table.',
      });
      parent.wait('impl').collect('impl');
      parent.done('feature', 4, 'impl-check');
      const tree = worktreeOf(parent, 'impl');
      parent.proof({ id: 'feat-surface', target: 'step-5', command: `${SURFACE} | grep -qx 'pen,2,2.5,5' && ${SURFACE}`, cwd: tree, kind: 'command', gitDir: tree });
      parent.done('feature', 5, 'feat-surface');
      parent.proof({ id: 'feat-units', target: 'step-6', command: `test $(git rev-list --count ${ctx.base}..HEAD) -ge 2`, cwd: tree, kind: 'command', gitDir: tree });
      parent.done('feature', 6, 'feat-units');
      parent.skip('feature', 7, 'the design is not contested, so interrogate is not needed before shipping');
      parent.skip('feature', 8, 'this repository has no remote, and opening a PR belongs to the PR workflow, so no PR is opened here');
      parent.text(FEATURE_REPLY);
      return scenario(parent, workers);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('feature', ['architect', 'interrogate', 'arena']),
    ...todoChecks({ playbook: 'feature', mandatory: [4], skipReason: { 8: /PR|remote/i } }),
    workersCheck('feature.grounded-with-how', 'step 1: how ran over the subsystem, a readonly explainer on the repository root', src('poteto-mode/playbooks/feature.md', '`how` over the affected subsystem'), { role: 'general', min: 1, mode: 'readonly', rootPath: true, modelLine: 'how explainer' }),
    check('feature.architect-step-honest', 'step 2 is either done with the architect skill opened, or skipped with a reason', src('poteto-mode/playbooks/feature.md', '`architect` for parallel design exploration'), (view) => {
      const step = primaryRun(view, 'feature')?.steps.find((entry) => entry.n === 2);
      if (step === undefined) return fail('no step 2');
      if (step.state === 'skipped') return when((step.skip ?? '').trim() !== '', `skipped: ${step.skip}`, 'skipped with no reason');
      return when(step.state === 'done' && openedAt(view.parent, skillFile('architect')) !== -1, 'done and the architect skill was opened', `state ${step.state}, architect opened: ${openedAt(view.parent, skillFile('architect')) !== -1}`);
    }),
    check('feature.throughput-checkpoint-four-items', 'step 3: the throughput checkpoint is four todo items, none dropped', src('poteto-mode/playbooks/feature.md', 'Write the throughput checkpoint as four todo items'), (view) => {
      const items = taskItems(primaryRun(view, 'feature')).map((item) => item.text);
      // An item may carry its own ordinal ("C1. Blocking first steps"): the dimension is what the item names, not its numbering.
      const named = items.map((item) => item.replace(/^[A-Za-z]{0,3}\d+[.):]\s+/, ''));
      const missing = ['Blocking first steps', 'Independent workstreams', 'Shared mutable state', 'Smallest safe decomposition'].filter((name) => !named.some((item) => item.startsWith(name)));
      const empty = named.filter((item) => /^(Blocking|Independent|Shared|Smallest)/.test(item) && item.replace(/^[^.:]*[.:]\s*/, '').trim() === '');
      return when(missing.length === 0 && empty.length === 0, 'all four dimensions kept, each with content or n/a: <reason>', `missing ${missing.join(', ') || 'none'}; empty ${empty.join(', ') || 'none'}`);
    }),
    workersCheck('feature.delegated-to-one-writer', 'step 4: code-writing is delegated to a fresh poteto worker in its own worktree at the base commit, on the "feature, refactoring" model line', src('poteto-mode/playbooks/feature.md', 'Delegate code-writing to a subagent using your configured feature model'), { role: 'poteto', min: 1, max: 1, mode: 'worktree', modelLine: 'feature, refactoring' }),
    check('feature.brief-names-scope', 'the delegate brief carries file paths, the named data shape, and success criteria', src('poteto-mode/playbooks/feature.md', 'with a specific scope (file paths, named data shape'), (view) => {
      const worker = allWorkers(view).find((entry) => assignmentOf(entry).role === 'poteto');
      const brief = worker?.brief ?? '';
      const missing = [{ name: 'file paths', pattern: /src\/\w+\.js/ }, { name: 'a named data shape and its organizing structure', pattern: DATA_SHAPE }, { name: 'success criteria', pattern: SUCCESS_CRITERIA }].filter(({ pattern }) => !pattern.test(brief)).map(({ name }) => name);
      return when(missing.length === 0 && assignmentOf(worker as never).workspace?.inputCommit === view.base, 'the brief names paths, the data shape, success criteria, and the base commit is the input', `brief lacks ${missing.join(', ')}`);
    }),
    parentWritesOnlyScratch('feature.parent-stays-in-the-lead', 'the parent wrote no production code and the main checkout is clean: it plans, reviews, verifies', src('poteto-mode/playbooks/feature.md', 'Delegate implementation. Stay in the lead.')),
    everyCommitGreen('feature.small-ordered-verified-commits', src('poteto-mode/playbooks/feature.md', 'building, verifying, and committing each small unit before the next'), (view) => primaryRun(view, 'feature')?.id ?? '', featureWriter, { min: 2, commits: delegateCommits }),
    check('feature.surface-receipt-is-the-delivered-commit', 'the surface receipt (the one step 5 cites) records the commit the worker delivered', src('poteto-mode/playbooks/feature.md', 'Verify on the matching surface'), (view) => {
      const run = primaryRun(view, 'feature');
      const head = branchCommits(view, run?.id ?? '', featureWriter(view)).at(-1);
      const cited = run?.steps.find((step) => step.n === 5)?.evidence ?? [];
      const receipts = (run?.receipts ?? []).filter((entry) => cited.includes(entry.id));
      // The parent may merge the worker's commits into the checkout; the receipt then names the checkout's head, which is the worker's head.
      const delivered = (sha: string | null | undefined) => sha !== undefined && sha !== null && (sha === head || (head !== undefined && sha === view.git.head && view.git.commitsSinceBase.includes(head)));
      return when(head !== undefined && receipts.length > 0 && receipts.every((receipt) => delivered(receipt.commit)), `${receipts.map((receipt) => `${receipt.id}@${receipt.commit?.slice(0, 10)}`).join(', ')} is the worker head ${head?.slice(0, 10)}`, `step 5 cites ${receipts.length} recorded receipt(s) (${cited.join(', ') || 'none'}); commits ${receipts.map((receipt) => String(receipt.commit)).join(', ') || 'none'} are not the worker head ${String(head)}`);
    }),
    writableWorkerRecords('feature.worker-records', src('poteto-mode/playbooks/feature.md', 'Commit liberally'), ['poteto']),
    settledAndCollected('feature.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
    check('feature.reply-has-the-contract', 'the reply carries what was built, the throughput checkpoint, and open decisions', src('poteto-mode/playbooks/feature.md', '**Reply:** what you built'), (view) => {
      const reply = finalReply(view);
      const missing = [{ name: 'checkpoint', pattern: /Throughput checkpoint/i }, { name: 'open decisions', pattern: /Open decisions?/i }, { name: 'what was built', pattern: /\b(built|build|added|implemented|delivered|shipped)\b|what you (got|built)/i }].filter(({ pattern }) => !pattern.test(reply)).map(({ name }) => name);
      return when(missing.length === 0, 'reply has built, checkpoint, open decisions', `reply lacks ${missing.join(', ')}`);
    }),
    noToolErrors('feature.no-tool-errors', src('poteto-mode/playbooks/feature.md', '**Reply:** what you built')),
  ],
  negatives: [
    ...todoNegatives('feature-export', 'feature', { done: [1, 3, 4, 5, 6], receipts: { 1: 'feat-grounded', 3: 'feat-checkpoint', 4: 'impl-check', 5: 'feat-surface', 6: 'feat-units' } }),
    { name: 'the mandatory delegation step was skipped with a reason', mutate: (sandbox) => setStep(sandbox, 'feature-export', 4, '~', (line) => `${stripEvidence(line)} (skip: faster to write it myself)`), fails: ['todo.feature.skips-explained'] },
    { name: 'the parent wrote production code itself', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'write', { path: `${sandbox}/repo/src/export.js`, content: 'x' }), fails: ['feature.parent-stays-in-the-lead'] },
    { name: 'the main checkout was edited', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['feature.parent-stays-in-the-lead'] },
    { name: 'the delegate ran on the wrong model line', mutate: (sandbox) => patchAssignment(sandbox, 'feature-export', 'impl', (assignment) => (assignment['model'] = 'sim/claude-sim')), fails: ['feature.delegated-to-one-writer'] },
    { name: 'the delegate was a general worker, not a poteto worker', mutate: (sandbox) => patchAssignment(sandbox, 'feature-export', 'impl', (assignment) => (assignment['role'] = 'general')), fails: ['feature.delegated-to-one-writer'] },
    { name: 'the work landed as one commit', mutate: (sandbox) => squashBranch(sandbox, 'pstack-run/feature-export/impl'), fails: ['feature.small-ordered-verified-commits'] },
    { name: 'a throughput item was dropped', mutate: (sandbox) => removeTodoItem(sandbox, 'feature-export', 'Shared mutable state'), fails: ['feature.throughput-checkpoint-four-items'] },
    { name: 'the surface receipt names a commit nobody delivered', mutate: (sandbox) => patchReceipt(sandbox, 'feature-export', 'feat-surface', { commit: 'deadbeefdeadbeef' }), fails: ['feature.surface-receipt-is-the-delivered-commit'] },
    { name: 'the delegate brief has no success criteria', mutate: (sandbox) => rewriteBrief(sandbox, 'feature-export', 'impl', /Success criteria:[^\n]*/g, 'Hope it works.'), fails: ['feature.brief-names-scope'] },
    { name: 'the brief names the structure as a table and never says "data shape"', mutate: (sandbox) => rewriteBrief(sandbox, 'feature-export', 'impl', /Data shape:[^\n]*/g, 'Organize the columns as a table, chosen before any logic.'), fails: [], passes: ['feature.brief-names-scope'] },
    { name: 'the brief names no data shape or structure', mutate: (sandbox) => rewriteBrief(sandbox, 'feature-export', 'impl', /Data shape:[^\n]*/g, 'Make it work.'), fails: ['feature.brief-names-scope'] },
    { name: 'the reply says nothing of what was built', mutate: (sandbox) => rewriteFinalReply(sandbox, /Built exportCsv\(items\)[^\n]*\n/, 'Here you go.\n'), fails: ['feature.reply-has-the-contract'] },
    { name: 'the reply says "implemented" instead of "Built"', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Built exportCsv', 'Implemented exportCsv'), fails: [], passes: ['feature.reply-has-the-contract'] },
    { name: 'the delegate left no commit', mutate: (sandbox) => patchGit(sandbox, (git) => (git['branchCommits'] = {})), fails: ['feature.small-ordered-verified-commits'] },
    { name: 'the throughput items carry ordinals, C1 to C4', mutate: (sandbox) => overwrite(join(sandbox, 'repo/.pi/pstack/runs/feature-export/TODO.md'), (text) => ['Blocking first steps', 'Independent workstreams', 'Shared mutable state', 'Smallest safe decomposition'].reduce((acc, name, index) => acc.replace(`- [ ] ${name}`, `- [ ] C${index + 1}. ${name}`), text)), fails: [], passes: ['feature.throughput-checkpoint-four-items'] },
    { name: 'the brief states an exact contract instead of a success criteria heading', mutate: (sandbox) => rewriteBrief(sandbox, 'feature-export', 'impl', /Success criteria:[^\n]*/g, 'Exact contract: exportCsv returns the header and the row.'), fails: [], passes: ['feature.brief-names-scope'] },
    { name: 'the delegate\'s commits were fast-forwarded into the checkout', mutate: (sandbox) => mergeBranch(sandbox, 'pstack-run/feature-export/impl'), fails: [], passes: ['feature.parent-stays-in-the-lead'] },
    { name: 'the parent committed on the checkout itself', mutate: (sandbox) => commitOnMain(sandbox), fails: ['feature.parent-stays-in-the-lead'] },
  ],
};


function removeTodoItem(sandbox: string, runId: string, prefix: string): void {
  const path = join(sandbox, 'repo/.pi/pstack/runs', runId, 'TODO.md');
  writeFileSync(path, readFileSync(path, 'utf8').split('\n').filter((line) => !line.startsWith(`- [ ] ${prefix}`)).join('\n'));
}

export function rewriteBrief(sandbox: string, runId: string, workerId: string, from: RegExp, to: string): void {
  const path = join(sandbox, 'repo/.pi/pstack/runs', runId, 'workers', workerId, 'brief.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace(from, to));
}

// ---- bug fix

const REPRO = `node --input-type=module -e "import('./src/cart.js').then((m)=>{const t=m.total([{price:10,qty:1}],150);console.log((t<0?'FAIL total is negative: ':'')+'total='+t);process.exit(t<0?1:0)})"`;

const FIX_TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { total } from '../src/cart.js';

test('a coupon over 100 percent never pays the customer', () => {
  assert.ok(total([{ price: 10, qty: 1 }], 150) >= 0);
});
`;

const FIXED_CART = (cart: string) => cart.replace('export function applyCoupon(amount, percent) {\n  return roundCents(amount - (amount * percent) / 100);', 'export function applyCoupon(amount, percent) {\n  const bounded = Math.min(100, Math.max(0, percent));\n  return roundCents(amount - (amount * bounded) / 100);');

const INVESTIGATION_REPORT = `H1 rounding drift in lineTotal: ruled out. Command: node -e "total([{price:10,qty:1}],0)" printed total=10.
H2 a coupon above 100 percent is not bounded in applyCoupon: confirmed. Command: ${REPRO} printed total=-5.
Surviving mechanism: applyCoupon at src/cart.js:${lineOf(cartHistory, 'src/cart.js', 'export function applyCoupon')} subtracts more than the whole amount.`;

const BUGFIX_REPLY = `Broken: total() with a coupon over 100 percent returned a negative amount.
Root cause: applyCoupon at src/cart.js:${lineOf(cartHistory, 'src/cart.js', 'export function applyCoupon')} did not bound the percent.
Fix: the percent is bounded to 0..100 before it is applied.
Verified on the same surface. Before:
FAIL total is negative: total=-5
After:
total=0`;

export const bugFixFamily: Family = {
  id: 'bug-fix',
  title: 'Bug fix playbook: reproduce first, eliminate hypotheses with runtime evidence, failing repro before the fix, same repro passes after (spec 12.3)',
  spec: {
    family: 'bug-fix',
    runId: 'bugfix-coupon',
    history: cartHistory,
    prompt: () => '/poteto-mode bug: a coupon of 150 percent makes the cart total negative, so the store pays the customer. Fix it.',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      parent.beginPlaybook('bug-fix', 'Bug fix: coupon over 100 percent pays the customer');
      for (const skill of ['principle-sequence-verifiable-units', 'control-cli', 'how', 'why', 'tdd']) parent.readSkill(skill);
      parent.proof({ id: 'bug-repro-before', target: 'step-1', command: REPRO, kind: 'command', commit: ctx.base, verdict: 'pass', expectedFail: true, expectedFailTests: ['total is negative'], expectedFailReason: 'total=-5', reason: 'defect reproduced: total=-5' });
      parent.done('bug-fix', 1, 'bug-repro-before');
      parent.spawn('hunter', { role: 'investigator', model: model('why investigators'), workspace: parent.readonly(), capabilities: { mcp: 'inherit', env: 'inherit', externalWrite: false } }, 'Rule hypotheses out with runtime evidence. H1 rounding drift. H2 coupon above 100 percent is not bounded. Report each with the command you ran.');
      workers['hunter'] = new Worker().call('bash_readonly', { command: 'node --input-type=module -e "import(\'./src/cart.js\').then((m)=>console.log(\'total=\'+m.total([{price:10,qty:1}],0)))"' }).call('bash_readonly', { command: REPRO }).text(INVESTIGATION_REPORT);
      parent.wait('hunter').collect('hunter');
      parent.write(join(parent.runDir, 'verification', 'artifacts', 'hypotheses.md'), `${INVESTIGATION_REPORT}\n`);
      parent.proof({ id: 'bug-hypotheses', target: 'step-2', command: `grep -c -E 'ruled out|confirmed' ${join(parent.runDir, 'verification/artifacts/hypotheses.md')} | grep -qx 2`, kind: 'review' });
      parent.done('bug-fix', 2, 'bug-hypotheses');
      parent.spawn('fix', { role: 'poteto', model: model('bug-fix'), workspace: parent.worktree() }, `Fix src/cart.js applyCoupon so a percent above 100 cannot make the total negative.\nScope: src/cart.js and one regression test, test/coupon-over-100.test.js.\nFirst commit the failing regression test alone, then commit the smallest fix.\nSuccess criteria: the repro prints total=0 and node --test passes.`);
      const tree = worktreeOf(parent, 'fix');
      workers['fix'] = writer(parent, 'fix', {
        units: [
          { files: { 'test/coupon-over-100.test.js': FIX_TEST }, commit: 'test: a coupon over 100 percent pays the customer' },
          { files: { 'src/cart.js': FIXED_CART(readCart(ctx.repo)) }, commit: 'fix: bound the coupon percent' },
        ],
        test: 'node --test',
        report: 'Failing regression test committed first, then the one-line bound.',
      });
      parent.wait('fix').collect('fix');
      parent.done('bug-fix', 3, 'fix-check');
      parent.proof({ id: 'bug-repro-after', target: 'step-4', command: REPRO, cwd: tree, kind: 'command', gitDir: tree });
      parent.done('bug-fix', 4, 'bug-repro-after');
      parent.proof({ id: 'bug-order', target: 'step-5', command: `git log --reverse --format=%s ${ctx.base}..HEAD | head -1 | grep -q '^test:'`, cwd: tree, kind: 'command', gitDir: tree });
      parent.done('bug-fix', 5, 'bug-order');
      parent.skip('bug-fix', 6, 'this repository has no remote, so no PR is opened here');
      parent.text(BUGFIX_REPLY);
      return scenario(parent, workers);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('bug-fix', ['architect']),
    ...todoChecks({ playbook: 'bug-fix', skipReason: { 6: /PR|remote/i } }),
    check('bug-fix.reproduced-first-on-the-surface', 'step 1: the parent reproduced the defect itself and recorded it, before any worker fixed it; the receipt shows the defect (a failing exit status or the wrong output)', src('poteto-mode/playbooks/bug-fix.md', 'Reproduce it yourself on the matching surface'), (view) => {
      const run = primaryRun(view, 'bug-fix');
      const [before] = stepReceipts(run, 1);
      const delegate = delegateOf(view);
      const fixSpawn = delegate === undefined ? -1 : spawnOrder(view, delegate.id);
      const recorded = before === undefined ? -1 : recordOrder(view, before.id);
      const early = ranBefore(view, before, delegate);
      const output = artifactText(run, before);
      // A repro that exits 0 may still print the wrong result: the receipt shows the defect either way.
      const showsDefect = before !== undefined && ((before.exitCode !== undefined && before.exitCode !== 0) || (before.exitCode === undefined && before['expectedFail'] === true) || /-\d|fail|wrong|negative|expected|but got|defect|bug|violat/i.test(output));
      return when(before !== undefined && showsDefect && early, `${before?.id} ran before the fix spawn (recorded at ${recorded}, spawn at ${fixSpawn}), exit ${String(before?.exitCode)}, output ${output.trim().slice(0, 80)}`, `step 1 receipt ${before?.id ?? 'none'} (exit ${String(before?.exitCode)}, shows the defect ${String(showsDefect)}) ran before the fix spawn: ${String(early)} (recorded at ${recorded}, spawn at ${fixSpawn})`);
    }),
    check('bug-fix.hypotheses-eliminated-with-runtime-evidence', 'step 2: an investigator ruled hypotheses out and confirmed the survivor, each with a command it ran', src('poteto-mode/playbooks/bug-fix.md', 'Binary-search the cause'), (view) => {
      const hunter = allWorkers(view).find((worker) => assignmentOf(worker).role === 'investigator');
      const text = hunter?.finalText ?? '';
      const ranCommands = (hunter?.session?.toolCalls ?? []).filter((call) => call.name === 'bash_readonly').length;
      return when(/ruled out/i.test(text) && /confirmed/i.test(text) && (text.match(/^H\d/gm) ?? []).length >= 2 && ranCommands >= 2, `${(text.match(/^H\d/gm) ?? []).length} hypotheses, ${ranCommands} commands run`, `report ${text.slice(0, 80)}; commands ${ranCommands}`);
    }),
    workersCheck('bug-fix.investigator-readonly', 'the investigator is readonly on the repository root', src('poteto-mode/playbooks/bug-fix.md', 'Delegate investigation and the fix to subagents'), { role: 'investigator', min: 1, mode: 'readonly', rootPath: true, mcpInherit: true }),
    workersCheck('bug-fix.fix-delegated', 'step 3: the fix is delegated to a poteto worker in its own worktree on the "bug-fix" model line', src('poteto-mode/playbooks/bug-fix.md', 'Delegate implementation to a subagent using your configured bug-fix model'), { role: 'poteto', min: 1, max: 1, mode: 'worktree', modelLine: 'bug-fix' }),
    check('bug-fix.failing-repro-lands-before-the-fix', 'step 5: across the workflow (a failing test the parent committed before the spawn counts, and is not the delegate\'s), the first commit adds only the regression test and fails there; the last commit changes the source and passes', src('poteto-mode/playbooks/bug-fix.md', 'so the failing repro lands before the fix in git history'), (view) => {
      // Workflow level: a failing test the parent committed before it spawned the delegate counts, and is not credited to the delegate.
      const { ok, detail } = redFirst(view);
      return when(ok, detail, detail);
    }),
    check('bug-fix.smallest-change', 'only the evidence-justified change ships: the fix commit touches src/cart.js and nothing else', src('poteto-mode/playbooks/bug-fix.md', 'The smallest change the evidence justifies ships, nothing more'), (view) => {
      const last = delegateCommits(view).at(-1);
      const files = last === undefined ? [] : filesChanged(view, last);
      return when(files.length === 1 && files[0] === 'src/cart.js', `fix commit touches ${files.join(', ')}`, `fix commit touches ${files.join(', ') || 'nothing'}`);
    }),
    check('bug-fix.same-repro-fails-before-passes-after', 'step 4: the original repro fails at the base and passes at the delivered commit, confirmed by re-running it, and the step 4 receipt names a delivered commit', src('poteto-mode/playbooks/bug-fix.md', 'Verify on the same surface. The original repro now passes'), (view) => {
      const run = primaryRun(view, 'bug-fix');
      const [before] = stepReceipts(run, 1);
      const [after] = stepReceipts(run, 4);
      const delivered = [...delegateCommits(view), ...view.git.commitsSinceBase, view.git.head];
      const head = delegateCommits(view).at(-1) ?? view.git.head;
      if (before === undefined || after === undefined || delegateCommits(view).length === 0) return fail(`missing the step 1 receipt (${before?.id ?? 'none'}), the step 4 receipt (${after?.id ?? 'none'}), or the delivered commit`);
      // The playbook has the same repro run before and after; the repository's repro is re-run here at both commits, so each receipt's own wording does not matter.
      const rerunBefore = runAtCommit(view, view.base, REPRO);
      const rerunAfter = runAtCommit(view, head, REPRO);
      const delegateInput = String(assignmentOf(delegateOf(view) as never).workspace?.inputCommit);
      // The repro ran on unfixed code: the base, or the commit the delegate was spawned at (the parent may have committed the failing test first).
      const beforeAtBase = before.commit === null || namesCommit(before.commit, [view.base, delegateInput]);
      return when(beforeAtBase && namesCommit(after.commit, delivered) && (after.exitCode === undefined || after.exitCode === 0) && rerunBefore.status !== 0 && rerunAfter.status === 0, `${before.id} at the base, ${after.id} at ${after.commit?.slice(0, 8)}; base exit ${rerunBefore.status} (${rerunBefore.output.trim()}), delivered exit ${rerunAfter.status} (${rerunAfter.output.trim()})`, `${before.id}.commit ${String(before.commit).slice(0, 8)}, ${after.id}.commit ${String(after.commit).slice(0, 8)} (exit ${String(after.exitCode)}) vs delivered ${head.slice(0, 8)}; reruns ${rerunBefore.status}/${rerunAfter.status}`);
    }),
    check('bug-fix.reply-pastes-failing-then-passing-output', 'the reply pastes the failing then the passing repro output verbatim', src('poteto-mode/playbooks/bug-fix.md', '**Reply:** what was broken, root cause, fix'), (view) => {
      const run = primaryRun(view, 'bug-fix');
      const outputs = [1, 4].map((step) => artifactText(run, stepReceipts(run, step)[0]).trim());
      const reply = finalReply(view);
      const positions = outputs.map((output) => (output === '' ? -1 : reply.indexOf(output)));
      return when(!positions.includes(-1) && (positions[0] as number) < (positions[1] as number), `before ${JSON.stringify(outputs[0])} precedes after ${JSON.stringify(outputs[1])}`, `positions ${positions.join(',')} for ${JSON.stringify(outputs)}`);
    }),
    parentWritesOnlyScratch('bug-fix.parent-stays-in-the-lead', 'the parent delegates the fix: it wrote no production code (the failing repro it writes under test/ is step 1 and 5, not the fix)', src('poteto-mode/playbooks/bug-fix.md', 'Delegate investigation and the fix to subagents, stay in the lead'), /^test\//),
    writableWorkerRecords('bug-fix.worker-records', src('poteto-mode/playbooks/bug-fix.md', 'Delegate investigation and the fix to subagents'), ['poteto']),
    settledAndCollected('bug-fix.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    ...todoNegatives('bugfix-coupon', 'bug-fix', { done: [1, 2, 3, 4, 5], receipts: { 1: 'bug-repro-before', 2: 'bug-hypotheses', 3: 'fix-check', 4: 'bug-repro-after', 5: 'bug-order' } }),
    { name: 'the fix landed in one commit with its test', mutate: (sandbox) => squashBranch(sandbox, 'pstack-run/bugfix-coupon/fix'), fails: ['bug-fix.failing-repro-lands-before-the-fix'] },
    { name: 'the repro never failed at the base: it exited 0 and printed a healthy total', mutate: (sandbox) => { patchReceipt(sandbox, 'bugfix-coupon', 'bug-repro-before', { exitCode: 0 }); writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/bugfix-coupon/verification/artifacts/bug-repro-before.txt'), 'total=10\n'); }, fails: ['bug-fix.reproduced-first-on-the-surface'] },
    { name: 'the repro exited 0 but printed the wrong total, as a repro script that reports instead of failing does', mutate: (sandbox) => patchReceipt(sandbox, 'bugfix-coupon', 'bug-repro-before', { exitCode: 0 }), fails: [], passes: ['bug-fix.reproduced-first-on-the-surface'] },
    { name: 'the receipts target the steps as "1" and "4", and the repro was run with different wording', mutate: (sandbox) => { patchReceipt(sandbox, 'bugfix-coupon', 'bug-repro-before', { target: '1', command: ['node', 'repro.js'] }); patchReceipt(sandbox, 'bugfix-coupon', 'bug-repro-after', { target: '4', command: ['node', 'repro.js'] }); }, fails: [], passes: ['bug-fix.reproduced-first-on-the-surface', 'bug-fix.same-repro-fails-before-passes-after'] },
    { name: 'the repro receipt was recorded in a batch after the spawn, and nothing before the spawn ran the command or wrote its output', mutate: (sandbox) => {
        rewriteSession(parentSession(sandbox), 'bug-repro-before.receipt.json', 'later-batch.json');
        rewriteSession(parentSession(sandbox), 'bug-repro-before.txt', 'elsewhere.txt');
      }, fails: ['bug-fix.reproduced-first-on-the-surface'] },
    { name: 'the repro receipt was recorded in a batch after the spawn, but the parent ran the command and wrote its output before the spawn', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'bug-repro-before.receipt.json', 'later-batch.json'), fails: [], passes: ['bug-fix.reproduced-first-on-the-surface'] },
    { name: 'the after receipt names a commit nobody delivered', mutate: (sandbox) => patchReceipt(sandbox, 'bugfix-coupon', 'bug-repro-after', { commit: 'deadbeefdeadbeef' }), fails: ['bug-fix.same-repro-fails-before-passes-after'] },
    { name: 'the parent wrote the failing repro test itself', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'write', { path: `${sandbox}/repo/test/coupon-over-100.test.js`, content: FIX_TEST }), fails: [], passes: ['bug-fix.parent-stays-in-the-lead'] },
    { name: 'the investigator confirmed nothing', mutate: (sandbox) => rewriteHunter(sandbox), fails: ['bug-fix.hypotheses-eliminated-with-runtime-evidence'] },
    { name: 'the reply did not paste the failing output', mutate: (sandbox) => rewriteReply(sandbox, 'total=-5', 'it was negative'), fails: ['bug-fix.reply-pastes-failing-then-passing-output'] },
    { name: 'the parent wrote the fix itself', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'edit', { path: `${sandbox}/repo/src/cart.js`, edits: [] }), fails: ['bug-fix.parent-stays-in-the-lead'] },
    { name: 'the investigator was given a writable worktree', mutate: (sandbox) => patchAssignment(sandbox, 'bugfix-coupon', 'hunter', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: 'abc1234' })), fails: ['bug-fix.investigator-readonly'] },
    { name: 'the fix worker was removed', mutate: (sandbox) => removeWorker(sandbox, 'bugfix-coupon', 'fix'), fails: ['bug-fix.fix-delegated'] },
  ],
};


const rewriteReply = rewriteFinalReply;

function rewriteHunter(sandbox: string): void {
  const dir = join(sandbox, 'repo/.pi/pstack/runs/bugfix-coupon/workers/hunter/session');
  const file = join(dir, readdirSync(dir).find((name) => name.endsWith('.jsonl')) as string);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll('confirmed', 'unclear'));
}

function readCart(repo: string): string {
  return readFileSync(join(repo, 'src/cart.js'), 'utf8');
}

// ---- tdd

const TDD_REPLY = `Failing before: test/coupon-over-100.test.js failed with "a coupon over 100 percent never pays the customer", total was -5.
Passing after: node --test ran green with 4 tests after the one-line bound in src/cart.js.
Nearby validation: the three existing cart tests still pass unchanged.`;

const TEST_RUN = /\b(node --test|npm (run )?test|npx vitest|vitest|pnpm( run)? test|yarn test|pytest|go test|cargo test)\b/;
const isRepoFile = (call: ToolCall, view: RunView) => {
  const path = String(call.args['path'] ?? '');
  return (path.startsWith(view.repo) || !path.startsWith('/')) && !path.includes('/.pi/') && !path.startsWith('.pi/');
};
/** A write or an edit of a test file: the regression test is a new file or a new test added to an existing one. */
const isTestEdit = (call: ToolCall, view: RunView) => (call.name === 'write' || call.name === 'edit') && isRepoFile(call, view) && /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[jt]sx?$/.test(String(call.args['path']));
const isRepoSource = (call: ToolCall, view: RunView) => isRepoFile(call, view) && /(^|\/)(src|lib)\//.test(String(call.args['path']));

export const tddFamily: Family = {
  id: 'tdd',
  title: 'tdd: a failing test first, confirmed red for the intended reason, then the smallest fix, then green (spec 12.3)',
  spec: {
    family: 'tdd',
    runId: 'tdd-coupon',
    history: cartHistory,
    prompt: () => '/tdd a coupon over 100 percent makes total() negative; add a regression test first and then fix it',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const test = join(ctx.repo, 'test/coupon-over-100.test.js');
      const commit = (message: string) => `git -c user.name=tdd -c user.email=t@example.com commit -q -m ${JSON.stringify(message)}`;
      parent
        .readSkill('tdd')
        .bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook bug-fix --title "tdd: coupon over 100" --run-id ${ctx.runId}`)
        .read(join(ctx.repo, 'src/cart.js'))
        .write(test, FIX_TEST)
        .bash('node --test')
        .bash(`git add test/coupon-over-100.test.js && ${commit('test: a coupon over 100 percent pays the customer')}`)
        .edit(join(ctx.repo, 'src/cart.js'), '  return roundCents(amount - (amount * percent) / 100);', '  const bounded = Math.min(100, Math.max(0, percent));\n  return roundCents(amount - (amount * bounded) / 100);')
        .bash('node --test')
        .bash(`git add src/cart.js && ${commit('fix: bound the coupon percent')}`)
        .text(TDD_REPLY);
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('tdd'),
    parentReads('tdd.reads-skill', 'the parent opens the tdd skill', src('tdd/SKILL.md', '# TDD Bug Fix'), ['tdd']),
    check('tdd.test-first-red-then-fix-then-green', 'a regression test is written or added to a test file first, run and seen failing, then the source is edited, then the suite is run and passes', src('tdd/SKILL.md', '**Run the new test before fixing.**'), (view) => {
      const calls = view.parent.toolCalls;
      const wrote = calls.find((call) => isTestEdit(call, view));
      const fixed = calls.find((call) => (call.name === 'edit' || call.name === 'write') && !isTestEdit(call, view) && isRepoSource(call, view) && wrote !== undefined && call.order > wrote.order);
      const runs = calls.filter((call) => call.name === 'bash' && TEST_RUN.test(String(call.args['command'])) && !/git (add|commit)/.test(String(call.args['command'])));
      const red = runs.find((call) => wrote !== undefined && call.order > wrote.order);
      const green = runs.find((call) => fixed !== undefined && call.order > fixed.order);
      const failed = (call: ToolCall | undefined) => call !== undefined && (call.isError || /exited with code [1-9]|\bnot ok\b|\bfailed\b|\bfailing\b|\bFAIL\b|\bfail [1-9]|✖/.test(call.resultText));
      const detail = `test written at ${wrote?.order}, red at ${red?.order}, fix at ${fixed?.order}, green at ${green?.order}`;
      return when(wrote !== undefined && fixed !== undefined && red !== undefined && green !== undefined && wrote.order < red.order && red.order < fixed.order && fixed.order < green.order && failed(red) && !failed(green), detail, `${detail}; red failed ${String(failed(red))}, green failed ${String(failed(green))}`);
    }),
    check('tdd.history-has-the-failing-test-before-the-fix', 'when the work was committed, git history holds the failing test before the fix; the skill has no commit step, so uncommitted work is judged by the transcript order alone', src('tdd/SKILL.md', 'The goal is a focused regression test that fails before the fix and passes after it'), (view) => {
      const commits = [...view.git.commitsSinceBase].reverse();
      if (commits.length === 0) return pass('nothing was committed: the skill has no commit step, and the order of test, red run, fix, and green run is held by the transcript check');
      if (commits.length !== 2) return fail(`${commits.length} commit(s) since the base, want the test and the fix in two`);
      const [first, second] = commits as [string, string];
      const red = runAtCommit(view, first, 'node --test');
      const green = runAtCommit(view, second, 'node --test');
      return when(filesChanged(view, first).every((file) => file.startsWith('test/')) && filesChanged(view, second).every((file) => file.startsWith('src/')) && red.status !== 0 && green.status === 0, 'test commit fails alone, fix commit touches only source and passes', `first ${filesChanged(view, first).join()} exit ${red.status}; second ${filesChanged(view, second).join()} exit ${green.status}`);
    }),
    check('tdd.existing-tests-untouched', 'no existing assertion was weakened: test/cart.test.js has no removed or changed line against the base (new tests may be added to it)', src('tdd/SKILL.md', 'Do not change tests merely to match a wrong implementation'), (view) => {
      const diff = spawnSync('git', ['-C', view.repo, 'diff', view.base, '--', 'test/cart.test.js'], { encoding: 'utf8' }).stdout;
      const removed = diff.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---'));
      return when(removed.length === 0, 'test/cart.test.js only gained lines', `test/cart.test.js lost or changed ${removed.length} line(s): ${removed.slice(0, 2).join(' | ')}`);
    }),
    check('tdd.reply-names-the-evidence', 'the reply names the failing-before test and its failure, and the passing-after run', src('tdd/SKILL.md', 'Name the failing-before test or executable check and the failure it produced'), (view) => {
      const reply = finalReply(view);
      const tests = view.parent.toolCalls.filter((call) => isTestEdit(call, view)).map((call) => basename(String(call.args['path'])));
      return when(/Failing[- ]before/i.test(reply) && /Passing[- ]after/i.test(reply) && tests.some((name) => reply.includes(name)) && /-?\d/.test(reply), 'reply has Failing before and Passing after with the test file', `reply: ${reply.slice(0, 160)}; test files ${tests.join(', ') || 'none'}`);
    }),
  ],
  negatives: [
    { name: 'the test and the fix landed together', mutate: (sandbox) => squashMain(sandbox), fails: ['tdd.history-has-the-failing-test-before-the-fix'] },
    { name: 'the fix was edited before the red run', mutate: (sandbox) => swapOrder(sandbox), fails: ['tdd.test-first-red-then-fix-then-green'] },
    { name: 'an existing test was weakened', mutate: (sandbox) => weakenExisting(sandbox), fails: ['tdd.existing-tests-untouched'] },
    { name: 'the reply lost the failing-before evidence', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Failing before', 'Earlier'), fails: ['tdd.reply-names-the-evidence'] },
    { name: 'the parent never opened the tdd skill', mutate: (sandbox) => rewriteSessionPath(sandbox), fails: ['tdd.reads-skill'] },
    { name: 'the reply names no test file', mutate: (sandbox) => rewriteFinalReply(sandbox, 'test/coupon-over-100.test.js', 'a test'), fails: ['tdd.reply-names-the-evidence'] },
    { name: 'the reply hyphenates the two evidence labels', mutate: (sandbox) => rewriteFinalReply(sandbox, /Failing before|Passing after/g, (label) => label.replace(' ', '-')), fails: [], passes: ['tdd.reply-names-the-evidence'] },
    { name: 'the work was never committed, which the skill does not ask for', mutate: (sandbox) => uncommit(sandbox), fails: [], passes: ['tdd.history-has-the-failing-test-before-the-fix'] },
    { name: 'the suite ran as npm test', mutate: (sandbox) => rewriteSession(parentSession(sandbox), /"command":"node --test"/g, '"command":"npm test"'), fails: [], passes: ['tdd.test-first-red-then-fix-then-green'] },
    { name: 'a new test was added to the existing test file', mutate: (sandbox) => addToExistingTest(sandbox), fails: [], passes: ['tdd.existing-tests-untouched'] },
  ],
};


function swapOrder(sandbox: string): void {
  const file = parentSession(sandbox);
  const text = readFileSync(file, 'utf8');
  writeFileSync(file, text.replaceAll('"command":"node --test"', '"command":"echo skipped"'));
}

function weakenExisting(sandbox: string): void {
  const repo = join(sandbox, 'repo');
  const path = join(repo, 'test/cart.test.js');
  writeFileSync(path, readFileSync(path, 'utf8').replace('assert.equal(total(items), 10)', 'assert.ok(total(items))'));
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=m', '-c', 'user.email=m@x', 'commit', '-q', '-m', 'weaken']);
  refreshGit(sandbox);
}

function uncommit(sandbox: string): void {
  const base = (JSON.parse(readFileSync(join(sandbox, 'meta.json'), 'utf8')) as { base: string }).base;
  execFileSync('git', ['-C', join(sandbox, 'repo'), 'reset', '-q', '--mixed', base]);
  refreshGit(sandbox);
}

function addToExistingTest(sandbox: string): void {
  const repo = join(sandbox, 'repo');
  const path = join(repo, 'test/cart.test.js');
  writeFileSync(path, `${readFileSync(path, 'utf8')}\ntest('a coupon of 100 percent is free', () => assert.equal(total([{ price: 10, qty: 1 }], 100), 0));\n`);
  refreshGit(sandbox);
}

function mergeBranch(sandbox: string, branch: string): void {
  execFileSync('git', ['-C', join(sandbox, 'repo'), 'merge', '-q', '--ff-only', branch]);
  refreshGit(sandbox);
}

function commitOnMain(sandbox: string): void {
  execFileSync('git', ['-C', join(sandbox, 'repo'), '-c', 'user.name=m', '-c', 'user.email=m@x', 'commit', '-q', '--allow-empty', '-m', 'parent edits production']);
  refreshGit(sandbox);
}

function rewriteSessionPath(sandbox: string): void {
  const file = parentSession(sandbox);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll('generated/skills/tdd/SKILL.md', 'generated/skills/zzz/SKILL.md'));
}

export const buildFamilies: Family[] = [featureFamily, bugFixFamily, tddFamily];
