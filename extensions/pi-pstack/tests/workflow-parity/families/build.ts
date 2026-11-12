// Families: feature, bug-fix, tdd (spec 12.3). Refactoring, perf-issue, hillclimb and prototype live in build-measured.ts.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { cartHistory, lineOf } from '../fixtures/repos.ts';
import { check, fail, src, when } from '../lib/check.ts';
import {
  allWorkers,
  assignmentOf,
  branchCommits,
  everyCommitGreen,
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
import { appendToolCall, dirtyRepo, parentSession, patchAssignment, patchGit, patchReceipt, refreshGit, removeWorker, rewriteFinalReply, setStep, squashBranch, squashMain, stripEvidence } from '../lib/mutate.ts';
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
    workersCheck('feature.grounded-with-how', 'step 1: how ran over the subsystem, a readonly explainer on the repository root', src('poteto-mode/playbooks/feature.md', '`how` over the affected subsystem'), { role: 'general', min: 1, mode: 'readonly', rootPath: true, modelLine: 'how explainer', id: /explainer/ }),
    check('feature.architect-step-honest', 'step 2 is either done with the architect skill opened, or skipped with a reason', src('poteto-mode/playbooks/feature.md', '`architect` for parallel design exploration'), (view) => {
      const step = primaryRun(view, 'feature')?.steps.find((entry) => entry.n === 2);
      if (step === undefined) return fail('no step 2');
      if (step.state === 'skipped') return when((step.skip ?? '').trim() !== '', `skipped: ${step.skip}`, 'skipped with no reason');
      return when(step.state === 'done' && openedAt(view.parent, skillFile('architect')) !== -1, 'done and the architect skill was opened', `state ${step.state}, architect opened: ${openedAt(view.parent, skillFile('architect')) !== -1}`);
    }),
    check('feature.throughput-checkpoint-four-items', 'step 3: the throughput checkpoint is four todo items, none dropped', src('poteto-mode/playbooks/feature.md', 'Write the throughput checkpoint as four todo items'), (view) => {
      const items = taskItems(primaryRun(view, 'feature')).map((item) => item.text);
      const missing = ['Blocking first steps', 'Independent workstreams', 'Shared mutable state', 'Smallest safe decomposition'].filter((name) => !items.some((item) => item.startsWith(name)));
      const empty = items.filter((item) => /^(Blocking|Independent|Shared|Smallest)/.test(item) && item.replace(/^[^.]*\.\s*/, '').trim() === '');
      return when(missing.length === 0 && empty.length === 0, 'all four dimensions kept, each with content or n/a: <reason>', `missing ${missing.join(', ') || 'none'}; empty ${empty.join(', ') || 'none'}`);
    }),
    workersCheck('feature.delegated-to-one-writer', 'step 4: code-writing is delegated to a fresh poteto worker in its own worktree at the base commit, on the "feature, refactoring" model line', src('poteto-mode/playbooks/feature.md', 'Delegate code-writing to a subagent using your configured feature model'), { role: 'poteto', min: 1, max: 1, mode: 'worktree', modelLine: 'feature, refactoring' }),
    check('feature.brief-names-scope', 'the delegate brief carries file paths, the named data shape, and success criteria', src('poteto-mode/playbooks/feature.md', 'with a specific scope (file paths, named data shape'), (view) => {
      const worker = allWorkers(view).find((entry) => assignmentOf(entry).role === 'poteto');
      const brief = worker?.brief ?? '';
      const missing = [{ name: 'file paths', pattern: /src\/\w+\.js/ }, { name: 'data shape', pattern: /data shape/i }, { name: 'success criteria', pattern: /success criteria/i }].filter(({ pattern }) => !pattern.test(brief)).map(({ name }) => name);
      return when(missing.length === 0 && assignmentOf(worker as never).workspace?.inputCommit === view.base, 'the brief names paths, the data shape, success criteria, and the base commit is the input', `brief lacks ${missing.join(', ')}`);
    }),
    parentWritesOnlyScratch('feature.parent-stays-in-the-lead', 'the parent wrote no production code and the main checkout is clean: it plans, reviews, verifies', src('poteto-mode/playbooks/feature.md', 'Delegate implementation. Stay in the lead.')),
    everyCommitGreen('feature.small-ordered-verified-commits', src('poteto-mode/playbooks/feature.md', 'building, verifying, and committing each small unit before the next'), (view) => primaryRun(view, 'feature')?.id ?? '', 'impl', { min: 2 }),
    check('feature.surface-receipt-is-the-delivered-commit', 'the surface receipt records the commit the worker delivered', src('poteto-mode/playbooks/feature.md', 'Verify on the matching surface'), (view) => {
      const run = primaryRun(view, 'feature');
      const head = branchCommits(view, run?.id ?? '', 'impl').at(-1);
      const receipt = run?.receipts.find((entry) => entry.id === 'feat-surface');
      return when(head !== undefined && receipt?.commit === head, `receipt commit ${head?.slice(0, 10)} is the worker head`, `receipt commit ${String(receipt?.commit)} is not worker head ${String(head)}`);
    }),
    writableWorkerRecords('feature.worker-records', src('poteto-mode/playbooks/feature.md', 'Commit liberally'), ['poteto']),
    settledAndCollected('feature.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
    check('feature.reply-has-the-contract', 'the reply carries what was built, the throughput checkpoint, and open decisions', src('poteto-mode/playbooks/feature.md', '**Reply:** what you built'), (view) => {
      const reply = finalReply(view);
      const missing = [{ name: 'checkpoint', pattern: /Throughput checkpoint/i }, { name: 'open decisions', pattern: /Open decisions?/i }, { name: 'built', pattern: /Built/i }].filter(({ pattern }) => !pattern.test(reply)).map(({ name }) => name);
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
    { name: 'the delegate brief has no success criteria', mutate: (sandbox) => rewriteBrief(sandbox, 'feature-export', 'impl', /Success criteria/g, 'Hope'), fails: ['feature.brief-names-scope'] },
    { name: 'the delegate left no commit', mutate: (sandbox) => patchGit(sandbox, (git) => (git['branchCommits'] = {})), fails: ['feature.small-ordered-verified-commits'] },
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

const REPRO = `node --input-type=module -e "import('./src/cart.js').then((m)=>{const t=m.total([{price:10,qty:1}],150);console.log('total='+t);process.exit(t<0?1:0)})"`;

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
total=-5
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
      parent.proof({ id: 'bug-repro-before', target: 'step-1', command: REPRO, kind: 'command', commit: ctx.base, verdict: 'pass', reason: 'defect reproduced: total=-5' });
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
    check('bug-fix.reproduced-first-on-the-surface', 'step 1: the parent reproduced the defect itself, before any worker fixed it; the receipt records a failing exit status', src('poteto-mode/playbooks/bug-fix.md', 'Reproduce it yourself on the matching surface'), (view) => {
      const run = primaryRun(view, 'bug-fix');
      const before = run?.receipts.find((entry) => entry.id === 'bug-repro-before');
      const fixSpawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes('/fix/'));
      const ran = view.parent.toolCalls.find((call) => call.name === 'bash' && String(call.args['command']).includes('bug-repro-before'));
      const output = before?.artifacts[0] === undefined ? '' : safe(before.artifacts[0].path);
      return when(before !== undefined && before.exitCode !== 0 && /total=-\d/.test(output) && ran !== undefined && fixSpawn !== undefined && ran.order < fixSpawn.order, `repro ran at ${ran?.order} before the fix spawn at ${fixSpawn?.order}, exit ${String(before?.exitCode)}, output ${output.trim()}`, `receipt ${JSON.stringify(before?.exitCode)} output ${output.trim()} ran ${ran?.order} fix spawn ${fixSpawn?.order}`);
    }),
    check('bug-fix.hypotheses-eliminated-with-runtime-evidence', 'step 2: an investigator ruled hypotheses out and confirmed the survivor, each with a command it ran', src('poteto-mode/playbooks/bug-fix.md', 'Binary-search the cause'), (view) => {
      const hunter = allWorkers(view).find((worker) => assignmentOf(worker).role === 'investigator');
      const text = hunter?.finalText ?? '';
      const ranCommands = (hunter?.session?.toolCalls ?? []).filter((call) => call.name === 'bash_readonly').length;
      return when(/ruled out/i.test(text) && /confirmed/i.test(text) && (text.match(/^H\d/gm) ?? []).length >= 2 && ranCommands >= 2, `${(text.match(/^H\d/gm) ?? []).length} hypotheses, ${ranCommands} commands run`, `report ${text.slice(0, 80)}; commands ${ranCommands}`);
    }),
    workersCheck('bug-fix.investigator-readonly', 'the investigator is readonly on the repository root', src('poteto-mode/playbooks/bug-fix.md', 'Delegate investigation and the fix to subagents'), { role: 'investigator', min: 1, mode: 'readonly', rootPath: true, mcpInherit: true }),
    workersCheck('bug-fix.fix-delegated', 'step 3: the fix is delegated to a poteto worker in its own worktree on the "bug-fix" model line', src('poteto-mode/playbooks/bug-fix.md', 'Delegate implementation to a subagent using your configured bug-fix model'), { role: 'poteto', min: 1, max: 1, mode: 'worktree', modelLine: 'bug-fix' }),
    check('bug-fix.failing-repro-lands-before-the-fix', 'step 5: the first commit adds only the regression test and fails there; the last commit changes the source and passes', src('poteto-mode/playbooks/bug-fix.md', 'so the failing repro lands before the fix in git history'), (view) => {
      const commits = branchCommits(view, primaryRun(view, 'bug-fix')?.id ?? '', 'fix');
      if (commits.length < 2) return fail(`${commits.length} commits on the fix branch, want the test and the fix apart`);
      const first = commits[0] as string;
      const last = commits.at(-1) as string;
      const firstFiles = filesChanged(view, first);
      const lastFiles = filesChanged(view, last);
      const red = runAtCommit(view, first, 'node --test');
      const green = runAtCommit(view, last, 'node --test');
      return when(firstFiles.every((file) => file.startsWith('test/')) && lastFiles.includes('src/cart.js') && red.status !== 0 && green.status === 0, `commit 1 (${firstFiles.join(',')}) fails, last (${lastFiles.join(',')}) passes`, `first touches ${firstFiles.join(',')} exit ${red.status}; last touches ${lastFiles.join(',')} exit ${green.status}`);
    }),
    check('bug-fix.smallest-change', 'only the evidence-justified change ships: the fix commit touches src/cart.js and nothing else', src('poteto-mode/playbooks/bug-fix.md', 'The smallest change the evidence justifies ships, nothing more'), (view) => {
      const last = branchCommits(view, primaryRun(view, 'bug-fix')?.id ?? '', 'fix').at(-1);
      const files = last === undefined ? [] : filesChanged(view, last);
      return when(files.length === 1 && files[0] === 'src/cart.js', `fix commit touches ${files.join(', ')}`, `fix commit touches ${files.join(', ') || 'nothing'}`);
    }),
    check('bug-fix.same-repro-fails-before-passes-after', 'step 4: the same repro command fails at the base and passes at the delivered commit, and re-running it confirms both', src('poteto-mode/playbooks/bug-fix.md', 'Verify on the same surface. The original repro now passes'), (view) => {
      const run = primaryRun(view, 'bug-fix');
      const before = run?.receipts.find((entry) => entry.id === 'bug-repro-before');
      const after = run?.receipts.find((entry) => entry.id === 'bug-repro-after');
      const head = branchCommits(view, run?.id ?? '', 'fix').at(-1);
      if (before === undefined || after === undefined || head === undefined) return fail('missing a repro receipt or the delivered commit');
      const same = JSON.stringify(before.command) === JSON.stringify(after.command);
      const rerunBefore = runAtCommit(view, view.base, REPRO);
      const rerunAfter = runAtCommit(view, head, REPRO);
      return when(same && before.commit === view.base && after.commit === head && after.exitCode === 0 && rerunBefore.status !== 0 && rerunAfter.status === 0, `same command; base exit ${rerunBefore.status} (${rerunBefore.output.trim()}), delivered exit ${rerunAfter.status} (${rerunAfter.output.trim()})`, `same command ${same}; before.commit ${String(before.commit).slice(0, 8)}, after.commit ${String(after.commit).slice(0, 8)} vs head ${head.slice(0, 8)}; reruns ${rerunBefore.status}/${rerunAfter.status}`);
    }),
    check('bug-fix.reply-pastes-failing-then-passing-output', 'the reply pastes the failing then the passing repro output verbatim', src('poteto-mode/playbooks/bug-fix.md', '**Reply:** what was broken, root cause, fix'), (view) => {
      const run = primaryRun(view, 'bug-fix');
      const outputs = ['bug-repro-before', 'bug-repro-after'].map((id) => {
        const receipt = run?.receipts.find((entry) => entry.id === id);
        return receipt?.artifacts[0] === undefined ? '' : safe(receipt.artifacts[0].path).trim();
      });
      const reply = finalReply(view);
      const positions = outputs.map((output) => (output === '' ? -1 : reply.indexOf(output)));
      return when(!positions.includes(-1) && (positions[0] as number) < (positions[1] as number), `before ${JSON.stringify(outputs[0])} precedes after ${JSON.stringify(outputs[1])}`, `positions ${positions.join(',')} for ${JSON.stringify(outputs)}`);
    }),
    parentWritesOnlyScratch('bug-fix.parent-stays-in-the-lead', 'the parent delegates the fix: it wrote no production code', src('poteto-mode/playbooks/bug-fix.md', 'Delegate investigation and the fix to subagents, stay in the lead')),
    writableWorkerRecords('bug-fix.worker-records', src('poteto-mode/playbooks/bug-fix.md', 'Delegate investigation and the fix to subagents'), ['poteto']),
    settledAndCollected('bug-fix.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    ...todoNegatives('bugfix-coupon', 'bug-fix', { done: [1, 2, 3, 4, 5], receipts: { 1: 'bug-repro-before', 2: 'bug-hypotheses', 3: 'fix-check', 4: 'bug-repro-after', 5: 'bug-order' } }),
    { name: 'the fix landed in one commit with its test', mutate: (sandbox) => squashBranch(sandbox, 'pstack-run/bugfix-coupon/fix'), fails: ['bug-fix.failing-repro-lands-before-the-fix'] },
    { name: 'the repro never failed at the base', mutate: (sandbox) => patchReceipt(sandbox, 'bugfix-coupon', 'bug-repro-before', { exitCode: 0 }), fails: ['bug-fix.reproduced-first-on-the-surface'] },
    { name: 'the after receipt used a different command', mutate: (sandbox) => patchReceipt(sandbox, 'bugfix-coupon', 'bug-repro-after', { command: ['sh', '-c', 'node --test'] }), fails: ['bug-fix.same-repro-fails-before-passes-after'] },
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

function safe(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

// ---- tdd

const TDD_REPLY = `Failing before: test/coupon-over-100.test.js failed with "a coupon over 100 percent never pays the customer", total was -5.
Passing after: node --test ran green with 4 tests after the one-line bound in src/cart.js.
Nearby validation: the three existing cart tests still pass unchanged.`;

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
    check('tdd.test-first-red-then-fix-then-green', 'the regression test is written first, run and seen failing, then the source is edited, then the suite is run and passes', src('tdd/SKILL.md', '**Run the new test before fixing.**'), (view) => {
      const calls = view.parent.toolCalls;
      const writeTest = calls.find((call) => call.name === 'write' && String(call.args['path']).includes('/test/'));
      const editSource = calls.find((call) => call.name === 'edit' && String(call.args['path']).includes('/src/'));
      const runs = calls.filter((call) => call.name === 'bash' && /node --test/.test(String(call.args['command'])) && !/git add/.test(String(call.args['command'])));
      const red = runs.find((call) => writeTest !== undefined && call.order > writeTest.order);
      const green = runs.find((call) => editSource !== undefined && call.order > editSource.order);
      return when(writeTest !== undefined && editSource !== undefined && red !== undefined && green !== undefined && writeTest.order < (red.order) && red.order < editSource.order && editSource.order < green.order && red.isError && !green.isError && /fail/i.test(red.resultText), `test written at ${writeTest?.order}, red at ${red?.order}, fix at ${editSource?.order}, green at ${green?.order}`, `write ${writeTest?.order}, red ${red?.order} err=${red?.isError}, edit ${editSource?.order}, green ${green?.order} err=${green?.isError}`);
    }),
    check('tdd.history-has-the-failing-test-before-the-fix', 'git history holds the failing test commit before the fix commit, each touching only its own files', src('tdd/SKILL.md', 'The goal is a focused regression test that fails before the fix and passes after it'), (view) => {
      const commits = [...view.git.commitsSinceBase].reverse();
      if (commits.length !== 2) return fail(`${commits.length} commits since the base, want the test and the fix`);
      const [first, second] = commits as [string, string];
      const red = runAtCommit(view, first, 'node --test');
      const green = runAtCommit(view, second, 'node --test');
      return when(filesChanged(view, first).every((file) => file.startsWith('test/')) && filesChanged(view, second).join() === 'src/cart.js' && red.status !== 0 && green.status === 0, 'test commit fails alone, fix commit touches only src/cart.js and passes', `first ${filesChanged(view, first).join()} exit ${red.status}; second ${filesChanged(view, second).join()} exit ${green.status}`);
    }),
    check('tdd.existing-tests-untouched', 'no existing assertion was weakened: test/cart.test.js is identical at HEAD', src('tdd/SKILL.md', 'Do not change tests merely to match a wrong implementation'), (view) => {
      const changed = view.git.commitsSinceBase.flatMap((sha) => filesChanged(view, sha)).filter((file) => file === 'test/cart.test.js');
      return when(changed.length === 0, 'test/cart.test.js untouched', 'test/cart.test.js was edited');
    }),
    check('tdd.reply-names-the-evidence', 'the reply names the failing-before test and its failure, and the passing-after run', src('tdd/SKILL.md', 'Name the failing-before test or executable check and the failure it produced'), (view) => {
      const reply = finalReply(view);
      return when(/Failing before/i.test(reply) && /Passing after/i.test(reply) && /test\/coupon-over-100\.test\.js/.test(reply) && /-?\d/.test(reply), 'reply has Failing before and Passing after with the test file', `reply: ${reply.slice(0, 120)}`);
    }),
  ],
  negatives: [
    { name: 'the test and the fix landed together', mutate: (sandbox) => squashMain(sandbox), fails: ['tdd.history-has-the-failing-test-before-the-fix'] },
    { name: 'the fix was edited before the red run', mutate: (sandbox) => swapOrder(sandbox), fails: ['tdd.test-first-red-then-fix-then-green'] },
    { name: 'an existing test was weakened', mutate: (sandbox) => weakenExisting(sandbox), fails: ['tdd.existing-tests-untouched'] },
    { name: 'the reply lost the failing-before evidence', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Failing before', 'Earlier'), fails: ['tdd.reply-names-the-evidence'] },
    { name: 'the parent never opened the tdd skill', mutate: (sandbox) => rewriteSessionPath(sandbox), fails: ['tdd.reads-skill'] },
  ],
};


function swapOrder(sandbox: string): void {
  const file = parentSession(sandbox);
  const text = readFileSync(file, 'utf8');
  writeFileSync(file, text.replaceAll('"command":"node --test"', '"command":"echo skipped"'));
}

function weakenExisting(sandbox: string): void {
  const repo = join(sandbox, 'repo');
  writeFileSync(join(repo, 'test/cart.test.js'), `${readFileSync(join(repo, 'test/cart.test.js'), 'utf8')}// weakened\n`);
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=m', '-c', 'user.email=m@x', 'commit', '-q', '-m', 'weaken']);
  refreshGit(sandbox);
}

function rewriteSessionPath(sandbox: string): void {
  const file = parentSession(sandbox);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll('generated/skills/tdd/SKILL.md', 'generated/skills/zzz/SKILL.md'));
}

export const buildFamilies: Family[] = [featureFamily, bugFixFamily, tddFamily];
