// The deslop gate before a commit and the no-comments gate before review (poteto-mode "Non-negotiables").
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario, shQuote, Worker } from '../fixtures/dsl.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, fail, src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, branchCommits, collectOrder, finalReply, openedAt, panelCheck, primaryRun, settledAndCollected, skillFile, spawnOrder, todoChecks, workersCheck } from '../lib/checks.ts';
import { SCRIPTED_ROLES } from '../lib/driver.ts';
import { dirtyRepo, parentSession, patchAssignment, rewriteFinalReply, rewriteSession, setStep, stripEvidence, workerSessionFile } from '../lib/mutate.ts';
import type { RunView } from '../lib/view.ts';
import { todoNegatives, worktreeOf, writer } from './shared.ts';
import type { Family } from './types.ts';

const RUN = 'commit-review-gates';
const model = (line: string) => String(SCRIPTED_ROLES[line]);
const DESLOP = src('poteto-mode/SKILL.md', 'Before commit → the `deslop` skill');
const NOCOMMENTS = src('poteto-mode/SKILL.md', 'Before review → the **no-comments** skill');
const KEPT_COMMENT = '// percent is clamped to 0..100';

const SLOPPY = `// Clamp the percent value between zero and one hundred
// Check if the percent is a number
export function clampPercent(percent) {
  try {
    // clamp it
    return Math.min(100, Math.max(0, /** @type {any} */ (percent)));
  } catch (error) {
    return 0;
  }
}
`;
const CLEAN = `${KEPT_COMMENT}\nexport function clampPercent(percent) {\n  return Math.min(100, Math.max(0, percent));\n}\n`;
const ESCAPED = CLEAN.replace(`${KEPT_COMMENT}\n`, '').replace('Math.min(100, Math.max(0, percent))', 'Math.max(0, percent)');
const WITHOUT_COMMENT = CLEAN.replace(`${KEPT_COMMENT}\n`, '');

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
const ofRole = (view: RunView, role: string) => allWorkers(view).filter((worker) => assignmentOf(worker).role === role);

export const gatesFamily: Family = {
  id: 'commit-review-gates',
  title: 'deslop before the commit and no-comments before review: a rejected Comment Sicko report is reverted and rerun once, only the accepted patch is applied (poteto-mode triggers)',
  spec: {
    family: 'commit-review-gates',
    runId: RUN,
    history: cartHistory,
    prompt: () => '/poteto-mode add clampPercent(percent) in src/coupon.js, then get it commit and review ready',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const impl = worktreeOf(parent, 'impl');
      const dir = (id: string) => parent.workerDir(id);
      const spawnSicko = (id: string, brief: string) => parent.spawn(id, { role: 'comment-sicko', model: model('judgment and prose'), workspace: parent.worktree() }, brief);
      parent.beginPlaybook('feature', 'Feature: clampPercent');
      parent.spawn('impl', { role: 'poteto', model: model('feature, refactoring'), workspace: parent.worktree(), skills: ['poteto-mode'] }, 'Write clampPercent(percent) in src/coupon.js. Remove AI slop with the deslop skill before you commit.').wait('impl').collect('impl');
      parent.bash(`git -C ${JSON.stringify(ctx.repo)} merge --ff-only pstack-run/${RUN}/impl`);
      parent.readSkill('no-comments');
      const scope = (id: string) => `git -C ${JSON.stringify(ctx.repo)} diff ${ctx.base} HEAD > ${JSON.stringify(join(dir(id), 'scope.patch'))}`;
      parent.bash(`mkdir -p ${JSON.stringify(dir('sicko-1'))} && ${scope('sicko-1')}`);
      spawnSicko('sicko-1', `Scope: src/coupon.js. First run \`git apply --index ${join(dir('sicko-1'), 'scope.patch')}\` in your worktree. Delete comments that only restate code.`).wait('sicko-1').collect('sicko-1');
      parent.bash(`git -C ${worktreeOf(parent, 'sicko-1')} diff`);
      parent.bash(`mkdir -p ${JSON.stringify(dir('sicko-2'))} && ${scope('sicko-2')}`);
      spawnSicko('sicko-2', `Scope: src/coupon.js. First run \`git apply --index ${join(dir('sicko-2'), 'scope.patch')}\` in your worktree. Delete comments that only restate code. Your previous report was rejected: it edited application code in src/coupon.js, which is outside comment scope. Change comments only.`).wait('sicko-2').collect('sicko-2');
      parent.bash(`git -C ${worktreeOf(parent, 'sicko-2')} diff > ${JSON.stringify(join(dir('sicko-2'), 'accepted.patch'))} && git -C ${JSON.stringify(ctx.repo)} apply ${JSON.stringify(join(dir('sicko-2'), 'accepted.patch'))}`);
      parent.spawn('review', { role: 'reviewer', model: model('judgment and prose'), workspace: parent.readonly() }, 'Review the comment-free change to src/coupon.js.').wait('review').collect('review');
      parent.text('Comment Sicko deleted 1 comment after one rejected report was reverted and rerun, no comments were restored, and no architect sketch was needed. The change is deslopped and reviewed.');
      const apply = (id: string) => `cd ${worktreeOf(parent, id)} && git apply --index ${join(dir(id), 'scope.patch')}`;
      const sicko = (id: string, final: string) => new Worker().bash(apply(id)).write(join(worktreeOf(parent, id), 'src/coupon.js'), final).text(`${id}: edited src/coupon.js`);
      return scenario(parent, {
        impl: new Worker().write(join(impl, 'src/coupon.js'), SLOPPY).read(ctx.skill('deslop')).write(join(impl, 'src/coupon.js'), CLEAN).bash(`cd ${impl} && node -e "import('./src/coupon.js').then((m)=>{if(m.clampPercent(150)!==100)process.exit(1)})" && git add -A && git -c user.name=w -c user.email=w@example.com commit -q -m "feat: clampPercent"`).text('clampPercent committed after deslop'),
        'sicko-1': sicko('sicko-1', ESCAPED),
        'sicko-2': sicko('sicko-2', WITHOUT_COMMENT),
        review: new Worker().read(join(ctx.repo, 'src/coupon.js')).text('No issues.'),
      });
    },
  },
  checks: [
    check('gates.deslop-before-the-commit', 'the committing worker opened the deslop skill and removed the slop before its first commit, and the committed file has none of it', DESLOP, (view) => {
      const implementations = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'poteto' && /src\/coupon\.js/.test(worker.brief ?? ''));
      const [impl] = implementations;
      if (implementations.length !== 1 || impl === undefined) return fail(`expected one coupon implementation worker, got ${implementations.length}`);
      const calls = impl?.session?.toolCalls ?? [];
      const read = calls.find((call) => call.name === 'read' && String(call.args['path']).endsWith('deslop/SKILL.md'));
      const commit = calls.find((call) => call.name === 'bash' && /git .*commit/.test(String(call.args['command'])));
      const committed = git(view.repo, 'show', `pstack-run/${view.runs[0]?.id}/${impl.id}:src/coupon.js`);
      const slop = [/Clamp the percent value/, /Check if the percent is a number/, /as any|@type \{any\}/, /try \{/, /catch \(/].filter((pattern) => pattern.test(committed)).map((pattern) => String(pattern));
      return when(read !== undefined && commit !== undefined && read.order < commit.order && slop.length === 0, `deslop read at ${read?.order}, commit at ${commit?.order}, committed file has no slop`, `read ${read?.order}, commit ${commit?.order}, slop left: ${slop.join(', ') || 'none'}`);
    }),
    check('gates.no-comments-before-review', 'the parent opened no-comments and had its report accepted before the reviewer was spawned', NOCOMMENTS, (view) => {
      const opened = openedAt(view.parent, skillFile('no-comments'));
      const reviewSpawn = spawnOrder(view, 'review');
      const lastSicko = Math.max(collectOrder(view, 'sicko-2'));
      return when(opened !== -1 && opened < reviewSpawn && lastSicko !== -1 && lastSicko < reviewSpawn, `no-comments opened at ${opened}, last Comment Sicko collected at ${lastSicko}, reviewer spawned at ${reviewSpawn}`, `opened ${opened}, sicko collected ${lastSicko}, reviewer ${reviewSpawn}`);
    }),
    workersCheck('gates.comment-sicko-in-its-own-worktree', 'each Comment Sicko is role comment-sicko in a worktree started at the scope\'s base commit', src('no-comments/SKILL.md', 'Spawn a `pstack_worker` worker with `role: "comment-sicko"`'), { role: 'comment-sicko', min: 2, max: 2, mode: 'worktree' }),
    check('gates.scope-patch-applied-first', 'scope.patch was written into the worker directory before the spawn, holds the scoped diff, and the brief has the worker apply it with git apply --index', src('no-comments/SKILL.md', 'as `scope.patch` in the worker directory'), (view) => {
      const problems = ofRole(view, 'comment-sicko').flatMap((worker) => {
        const patch = join(worker.dir, 'scope.patch');
        const text = existsSync(patch) ? readFileSync(patch, 'utf8') : '';
        return [...(text.includes('src/coupon.js') ? [] : [`${worker.id}: scope.patch is missing or lacks src/coupon.js`]), ...(new RegExp(`git apply --index ${patch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(worker.brief ?? '') ? [] : [`${worker.id}: brief does not tell it to apply scope.patch`]), ...(assignmentOf(worker).workspace?.inputCommit === view.base ? [] : [`${worker.id}: inputCommit is not the base`])];
      });
      return when(problems.length === 0, 'both workers have a scope.patch and a brief that applies it, from the base commit', problems.join('; '));
    }),
    check('gates.rejected-report-is-rerun-once', 'a report that edited application code was rejected and the worker rerun once with the failure named; the rejected change never reached the checkout', src('no-comments/SKILL.md', 'Revert and rerun one rejected report with the failure named'), (view) => {
      const [first, second] = ofRole(view, 'comment-sicko');
      const firstDiff = first?.worktree === null || first === undefined ? '' : git(first.worktree, 'diff');
      const escaped = /^-.*Math\.min/m.test(firstDiff) && /^\+.*Math\.max\(0, percent\);/m.test(firstDiff);
      const named = /rejected/i.test(second?.brief ?? '') && /application code/i.test(second?.brief ?? '');
      const landed = git(view.repo, 'diff', 'HEAD', '--', 'src/coupon.js');
      return when(escaped && named && ofRole(view, 'comment-sicko').length === 2 && !/^[-+].*Math\./m.test(landed), 'the first report edited Math.min, the second brief names that, two Comment Sicko runs, and the checkout diff touches no Math line', `first edited app code ${escaped}; rerun brief names failure ${named}; checkout diff:\n${landed}`);
    }),
    check('gates.only-the-accepted-patch-is-applied', 'the caller\'s checkout holds exactly the accepted comment deletion: one removed comment line and no other change', src('no-comments/SKILL.md', 'then apply the accepted patch in the caller\'s checkout with `git apply`'), (view) => {
      const diff = git(view.repo, 'diff', 'HEAD', '--', 'src/coupon.js').split('\n').filter((line) => /^[-+][^-+]/.test(line));
      return when(diff.length === 1 && diff[0] === `-${KEPT_COMMENT}` && !view.git.dirty.some((path) => path !== 'src/coupon.js'), `only ${diff[0]} changed`, `changed lines: ${JSON.stringify(diff)}; dirty ${view.git.dirty.join(',')}`);
    }),
    check('gates.report-has-the-counts', 'the reply reports the deletion count, the rerun and that nothing was restored', src('no-comments/SKILL.md', '6. Report the deletion count, restored comments, reruns'), (view) => {
      const reply = finalReply(view);
      return when(/1 comment/.test(reply) && /rerun/i.test(reply) && /restored/i.test(reply), 'deletion count, rerun and restored are in the reply', `reply: ${reply.slice(0, 160)}`);
    }),
    settledAndCollected('gates.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    { name: 'the worker never opened deslop', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, RUN, 'impl'), 'deslop/SKILL.md', 'zzz/SKILL.md'), fails: ['gates.deslop-before-the-commit'] },
    { name: 'the parent never opened no-comments', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'no-comments/SKILL.md', 'zzz/SKILL.md'), fails: ['gates.no-comments-before-review'] },
    { name: 'the rejected application edit reached the checkout', mutate: (sandbox) => dirtyRepo(sandbox, 'src/coupon.js', '\nexport const escaped = Math.max(0, 1);\n'), fails: ['gates.only-the-accepted-patch-is-applied'] },
    { name: 'a Comment Sicko started from the wrong commit', mutate: (sandbox) => patchAssignment(sandbox, RUN, 'sicko-2', (assignment) => ((assignment['workspace'] as { inputCommit: string }).inputCommit = 'deadbeef')), fails: ['gates.scope-patch-applied-first'] },
    { name: 'the rerun brief did not name the failure', mutate: (sandbox) => writeBrief(sandbox, 'sicko-2', 'Scope: src/coupon.js. Delete comments.'), fails: ['gates.rejected-report-is-rerun-once'] },
    { name: 'the report omits the counts', mutate: (sandbox) => rewriteFinalReply(sandbox, '1 comment', 'some comments'), fails: ['gates.report-has-the-counts'] },
  ],
};

function writeBrief(sandbox: string, workerId: string, text: string): void {
  writeFileSync(join(sandbox, 'repo/.pi/pstack/runs', RUN, 'workers', workerId, 'brief.md'), text);
}

// ---- Feature step 7: interrogate when the design is contested

const FI_RUN = 'feature-contested';
const NAN_REPRO = `node --input-type=module -e "import('./src/coupon.js').then((m)=>console.log(String(m.clampPercent(NaN))))"`;
const FI_INTENT = 'clampPercent(percent) returns a number from 0 to 100 for any input, so a coupon can never apply more than the whole cart.';
const COUPON_JS = 'export function clampPercent(percent) {\n  return Math.min(100, Math.max(0, percent));\n}\n';
const COUPON_TEST = "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { clampPercent } from '../src/coupon.js';\n\ntest('caps at 100', () => assert.equal(clampPercent(150), 100));\ntest('floors at 0', () => assert.equal(clampPercent(-5), 0));\n";
const FI_BRIEF = (head: string) => `Scope: the committed change at ${head}.\nIntent: ${FI_INTENT}\n\nBreak this change. Prove each finding with a run against the real code, such as a failing test, a repro script, or command output that shows the wrong behavior. Keep repros in your own worktree. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Leave out anything you did not run. No findings is a valid result.`;
const FI_REPORT = `Built clampPercent in src/coupon.js on a COUPON_BOUNDS table shape. The design was contested (clamp in the function or reject out of range input), so interrogate ran before shipping.
Intent
${FI_INTENT}
Findings
- clampPercent(NaN) returns NaN. Command: ${NAN_REPRO}. Output: NaN. The intent requires a number from 0 to 100. Found by reviewer-1.
Dropped
- reviewer-1: 0 dropped.
- reviewer-2: 0 dropped, no findings.
Open decisions: whether NaN should clamp to 0 or be rejected. Not fixed here, interrogate reports and does not apply fixes.`;

export const featureContestedFamily: Family = {
  id: 'feature-contested',
  title: 'Feature step 7: a contested design is interrogated before shipping, by two families, from the delivered commit, with no fix applied (feature.md step 7)',
  spec: {
    family: 'feature-contested',
    runId: FI_RUN,
    history: cartHistory,
    prompt: () => '/poteto-mode add clampPercent to src/coupon.js. Two designs are on the table, clamp or reject, and I am not sure which is right.',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      parent.beginPlaybook('feature', 'Feature: clampPercent (contested)').bash('sleep 0.5');
      parent.skip('feature', 1, 'the subsystem is one new file, so how has nothing to explain');
      parent.skip('feature', 2, 'the two candidate shapes are already named in the request, so no design sketch is needed');
      for (const item of ['Blocking first steps. none.', 'Independent workstreams. n/a: one file.', 'Shared mutable state. n/a: none.', 'Smallest safe decomposition. One worker, one unit.']) parent.task(item);
      parent.proof({ id: 'fc-checkpoint', target: 'step-3', command: `grep -c -E '^- \\[ \\] (Blocking|Independent|Shared|Smallest)' ${join(parent.runDir, 'TODO.md')} | grep -qx 4`, kind: 'review' }).done('feature', 3, 'fc-checkpoint');
      parent.spawn('impl', { role: 'poteto', model: model('feature, refactoring'), workspace: parent.worktree(), skills: ['poteto-mode'] }, 'Build clampPercent in src/coupon.js.\nFile paths: src/coupon.js, test/coupon.test.js.\nData shape: a COUPON_BOUNDS table of min and max.\nSuccess criteria: node --test passes.');
      workers['impl'] = writer(parent, 'impl', { units: [{ files: { 'src/coupon.js': COUPON_JS, 'test/coupon.test.js': COUPON_TEST }, commit: 'feat: clampPercent' }], test: 'node --test', report: 'clampPercent committed, tests green.' });
      parent.wait('impl').collect('impl').done('feature', 4, 'impl-check');
      const tree = worktreeOf(parent, 'impl');
      parent.proof({ id: 'fc-surface', target: 'step-5', command: `node --input-type=module -e "import('./src/coupon.js').then((m)=>process.stdout.write(String(m.clampPercent(150))))" | grep -qx 100`, cwd: tree, gitDir: tree }).done('feature', 5, 'fc-surface');
      parent.proof({ id: 'fc-units', target: 'step-6', command: `test $(git rev-list --count ${ctx.base}..HEAD) -ge 1`, cwd: tree, gitDir: tree }).done('feature', 6, 'fc-units');
      parent.readSkill('interrogate').readSkill('in-your-own-words').readSkill('arena');
      const head = `$(git -C ${JSON.stringify(tree)} rev-parse HEAD)`;
      const ids = ['reviewer-1', 'reviewer-2'];
      for (const [index, id] of ids.entries()) {
        const dir = parent.workerDir(id);
        const fields = { role: 'reviewer', model: String((SCRIPTED_ROLES['interrogate reviewers'] as string[])[index]), workspace: { mode: 'worktree', inputCommit: '__HEAD__' } };
        parent.bash([`mkdir -p ${JSON.stringify(dir)}`, `head=${head}`, `printf '%s\\n' ${shQuote(FI_BRIEF('__HEAD__'))} | sed "s/__HEAD__/$head/" > ${JSON.stringify(join(dir, 'brief.md'))}`, `printf '%s\\n' ${shQuote(JSON.stringify({ schemaVersion: 1, runId: ctx.runId, workerId: id, kind: 'pi', role: 'reviewer', brief: 'brief.md', model: fields.model, thinkingLevel: null, skills: [], workspace: fields.workspace }, null, 2))} | sed "s/__HEAD__/$head/" > ${JSON.stringify(join(dir, 'assignment.json'))}`].join('\n'));
      }
      parent.fire(...ids.map((id) => ({ tool: 'pstack_worker', args: { action: 'spawn', runId: ctx.runId, assignmentPath: join(parent.workerDir(id), 'assignment.json') } })));
      for (const id of ids) parent.wait(id);
      parent.collect(...ids).bash(`cd ${tree} && ${NAN_REPRO}`);
      parent.proof({ id: 'fc-interrogate', target: 'step-7', command: `${NAN_REPRO} | grep -qx NaN`, cwd: tree, kind: 'review', gitDir: tree }).done('feature', 7, 'fc-interrogate');
      parent.skip('feature', 8, 'this repository has no remote, so no PR is opened here');
      parent.text(FI_REPORT);
      workers['reviewer-1'] = writer(parent, 'reviewer-1', { units: [{ files: { 'repro.sh': `${NAN_REPRO}\n` }, commit: 'repro for NaN' }], test: NAN_REPRO, testKind: 'command', report: `Finding: clampPercent(NaN) returns NaN.\nCommand: ${NAN_REPRO}\nOutput: NaN\nRequired: a number from 0 to 100.` });
      workers['reviewer-2'] = writer(parent, 'reviewer-2', { units: [{ files: { 'notes.md': 'no findings\n' }, commit: 'notes' }], test: 'test -s notes.md', testKind: 'command', report: 'No findings.' });
      return scenario(parent, workers);
    },
  },
  checks: [
    ...todoChecks({ playbook: 'feature', mandatory: [4, 7], skipReason: { 8: /PR|remote/i } }),
    check('feature-contested.interrogate-step-is-done-not-skipped', 'step 7 ends done with a receipt, after the interrogate skill and its two companion skills were opened', src('poteto-mode/playbooks/feature.md', 'If the design is contested, `interrogate` before shipping.'), (view) => {
      const step = primaryRun(view, 'feature')?.steps.find((entry) => entry.n === 7);
      const opened = ['interrogate', 'in-your-own-words', 'arena'].map((name) => openedAt(view.parent, skillFile(name)));
      return when(step?.state === 'done' && step.evidence.length > 0 && !opened.includes(-1), `step 7 done with ${step?.evidence.join(', ')}; skills opened at ${opened.join(', ')}`, `step 7 is ${step?.state}; skills opened at ${opened.join(', ')}`);
    }),
    panelCheck('feature-contested.reviewers-from-two-families', 'the adversaries are role reviewer, each in its own worktree, on the "interrogate reviewers" line, from at least two families', src('interrogate/SKILL.md', 'Read the `interrogate reviewers` line in place of `arena runners`'), { role: 'reviewer', line: 'interrogate reviewers', mode: 'worktree' }),
    check('feature-contested.adversaries-start-from-the-delivered-commit', 'the reviewers were spawned after the implementation was collected, and each starts at the implementation head', src('interrogate/SKILL.md', 'Copy the scope\'s uncommitted changes into each worktree'), (view) => {
      const implementations = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'poteto' && /src\/coupon\.js/.test(worker.brief ?? ''));
      const [impl] = implementations;
      const run = view.runs.find((entry) => impl !== undefined && entry.workers.includes(impl));
      if (implementations.length !== 1 || impl === undefined || run === undefined) return fail(`expected one coupon implementation worker, got ${implementations.length}`);
      const head = branchCommits(view, run.id, impl.id).at(-1);
      const collected = collectOrder(view, impl.id);
      const problems = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'reviewer').flatMap((worker) => [...(assignmentOf(worker).workspace?.inputCommit === head ? [] : [`${worker.id} starts at ${assignmentOf(worker).workspace?.inputCommit}, not ${head}`]), ...(spawnOrder(view, worker.id) > collected ? [] : [`${worker.id} spawned before impl was collected`])]);
      return when(head !== undefined && problems.length === 0, `both reviewers start at ${head?.slice(0, 10)} after the implementation`, problems.join('; ') || 'no implementation head');
    }),
    check('feature-contested.finding-was-rerun-and-reported', 'the finding in the reply was rerun by the parent with the reported output, and it is left as an open decision', src('interrogate/SKILL.md', 'Verify each finding per arena Phase F by rerunning its command'), (view) => {
      const rerun = view.parent.toolCalls.find((call) => call.name === 'bash' && String(call.args['command']).includes(NAN_REPRO));
      const reply = finalReply(view);
      return when(rerun?.resultText.includes('NaN') === true && reply.includes('Output: NaN') && /Open decisions?/i.test(reply), 'the parent reran the command and saw NaN; the reply lists it', `rerun ${rerun?.resultText.slice(0, 40)}; reply has output ${reply.includes('Output: NaN')}`);
    }),
    check('feature-contested.no-fix-was-applied', 'interrogate reported without fixing: the implementation branch holds only its own commit and the main checkout is untouched', src('interrogate/SKILL.md', 'Report the findings. Do not apply fixes.'), (view) => {
      const implementations = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'poteto' && /src\/coupon\.js/.test(worker.brief ?? ''));
      const [impl] = implementations;
      const run = view.runs.find((entry) => impl !== undefined && entry.workers.includes(impl));
      if (implementations.length !== 1 || impl === undefined || run === undefined) return fail(`expected one coupon implementation worker, got ${implementations.length}`);
      const commits = branchCommits(view, run.id, impl.id);
      return when(commits.length === 1 && view.git.dirty.length === 0 && view.git.commitsSinceBase.length === 0, '1 commit on the branch, main clean', `${commits.length} commits on the impl branch; dirty ${view.git.dirty.join(',')}`);
    }),
    settledAndCollected('feature-contested.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    ...todoNegatives(FI_RUN, 'feature', { done: [3, 4, 5, 6, 7], receipts: { 3: 'fc-checkpoint', 4: 'impl-check', 5: 'fc-surface', 6: 'fc-units', 7: 'fc-interrogate' } }),
    { name: 'the interrogate step was skipped as not contested', mutate: (sandbox) => setStep(sandbox, FI_RUN, 7, '~', (line) => `${stripEvidence(line)} (skip: not contested)`), fails: ['feature-contested.interrogate-step-is-done-not-skipped', 'todo.feature.skips-explained'] },
    { name: 'the reviewers were one model family', mutate: (sandbox) => patchAssignment(sandbox, FI_RUN, 'reviewer-2', (assignment) => (assignment['model'] = (SCRIPTED_ROLES['interrogate reviewers'] as string[])[0])), fails: ['feature-contested.reviewers-from-two-families'] },
    { name: 'a reviewer started from the base, not the delivered commit', mutate: (sandbox) => patchAssignment(sandbox, FI_RUN, 'reviewer-1', (assignment) => ((assignment['workspace'] as { inputCommit: string }).inputCommit = 'deadbeef')), fails: ['feature-contested.adversaries-start-from-the-delivered-commit'] },
    { name: 'a fix was applied while interrogating', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['feature-contested.no-fix-was-applied'] },
    { name: 'the reply reports output the rerun did not show', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Output: NaN.', 'Output: 100.'), fails: ['feature-contested.finding-was-rerun-and-reported'] },
  ],
};

export const gateFamilies: Family[] = [gatesFamily, featureContestedFamily];
