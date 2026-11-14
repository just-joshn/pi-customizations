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
const LICENSE_COMMENT = '// SPDX-License-Identifier: MIT';
const PROPOSED_DIFF = /(?:^|\n)(diff --git [\s\S]*?)(?:\n```|$)/;

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
const CLEAN = `${LICENSE_COMMENT}\n${KEPT_COMMENT}\nexport function clampPercent(percent) {\n  return Math.min(100, Math.max(0, percent));\n}\n`;
const COMMENT_PATCH = `diff --git a/src/coupon.js b/src/coupon.js
--- a/src/coupon.js
+++ b/src/coupon.js
@@ -1,5 +1,4 @@
 ${LICENSE_COMMENT}
-${KEPT_COMMENT}
 export function clampPercent(percent) {
   return Math.min(100, Math.max(0, percent));
 }
`;
const ESCAPED_PATCH = COMMENT_PATCH.replace('   return Math.min(100, Math.max(0, percent));', '-  return Math.min(100, Math.max(0, percent));\n+  return Math.max(0, percent);');

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
const ofRole = (view: RunView, role: string) => allWorkers(view).filter((worker) => assignmentOf(worker).role === role);

function replaceAcceptedProposal(sandbox: string, patch: string): void {
  const session = workerSessionFile(sandbox, RUN, 'sicko-2');
  const encoded = JSON.stringify(COMMENT_PATCH).slice(1, -1);
  if (!readFileSync(session, 'utf8').includes(encoded)) throw new Error('The coherent counterexample did not find the second critic proposal');
  rewriteSession(session, encoded, JSON.stringify(patch).slice(1, -1));
  writeFileSync(join(sandbox, 'repo/.pi/pstack/runs', RUN, 'workers/sicko-2/accepted.patch'), patch);
}

function applyScopeEscape(sandbox: string, commit: boolean): void {
  const repo = join(sandbox, 'repo');
  const cart = join(repo, 'src/cart.js');
  writeFileSync(cart, `${readFileSync(cart, 'utf8')}\nexport const outOfScope = true;\n`);
  const extra = git(repo, 'diff', '--', 'src/cart.js');
  if (!extra.includes('diff --git')) throw new Error('The coherent scope-escape counterexample did not change src/cart.js');
  replaceAcceptedProposal(sandbox, COMMENT_PATCH + extra);
  if (commit) git(repo, 'commit', '--only', '-m', 'incorrectly accepted out-of-scope critic edit', '--', 'src/cart.js');
}

export const gatesFamily: Family = {
  id: 'commit-review-gates',
  title: 'deslop before the commit and read-only no-comments review: reject an application-code proposal, rerun once and apply only accepted comment deletions',
  spec: {
    family: 'commit-review-gates',
    runId: RUN,
    history: cartHistory,
    prompt: () => '/poteto-mode add clampPercent(percent) in src/coupon.js, then get it commit and review ready',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const impl = worktreeOf(parent, 'impl');
      const dir = (id: string) => parent.workerDir(id);
      const spawnSicko = (id: string, brief: string) => parent.spawn(id, { role: 'comment-sicko', model: model('judgment and prose'), workspace: parent.readonly() }, brief);
      parent.beginPlaybook('feature', 'Feature: clampPercent');
      parent.spawn('impl', { role: 'poteto', model: model('feature, refactoring'), workspace: parent.worktree(), skills: ['poteto-mode'] }, 'Write clampPercent(percent) in src/coupon.js. Remove AI slop with the deslop skill before you commit.').wait('impl').collect('impl');
      parent.bash(`git -C ${JSON.stringify(ctx.repo)} merge --ff-only pstack-run/${RUN}/impl`);
      parent.bash(`cd ${shQuote(ctx.repo)} && printf '\\nstaged user note\\n' >> README.md && git add README.md && printf 'unstaged user note\\n' >> README.md`);
      parent.write(join(ctx.repo, 'unrelated.txt'), 'untracked user note\n');
      parent.readSkill('no-comments');
      const scope = (id: string) => `git -C ${JSON.stringify(ctx.repo)} diff ${ctx.base} HEAD -- src/coupon.js > ${JSON.stringify(join(dir(id), 'scope.patch'))}`;
      parent.bash(`mkdir -p ${JSON.stringify(dir('sicko-1'))} && ${scope('sicko-1')}`);
      spawnSicko('sicko-1', `Scope: src/coupon.js. Base SHA: ${ctx.base}. Read ${join(dir('sicko-1'), 'scope.patch')} and nearby code. Return proposed comment deletions as a unified diff; do not edit files.`).wait('sicko-1').collect('sicko-1');
      parent.bash(`mkdir -p ${JSON.stringify(dir('sicko-2'))} && ${scope('sicko-2')}`);
      spawnSicko('sicko-2', `Scope: src/coupon.js. Base SHA: ${ctx.base}. Read ${join(dir('sicko-2'), 'scope.patch')} and nearby code. Your previous report was rejected: it proposed changing application code in src/coupon.js, which is outside comment scope. Return only proposed comment deletions as a unified diff; do not edit files.`).wait('sicko-2').collect('sicko-2');
      const extract = `import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAssignment } from ${JSON.stringify(join(ctx.pkg, 'src/run-files.ts'))};
import { workerFinalText } from ${JSON.stringify(join(ctx.pkg, 'src/workers.ts'))};
const dir = process.argv[1];
const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
const report = workerFinalText(loadAssignment(join(dir, 'assignment.json')), state.sessionFile) ?? '';
const patch = report.match(new RegExp(${JSON.stringify(PROPOSED_DIFF.source)}))?.[1];
if (!patch) throw new Error('The critic returned no unified diff proposal');
writeFileSync(join(dir, 'accepted.patch'), patch.endsWith('\\n') ? patch : patch + '\\n');`;
      parent.bash(`node --input-type=module -e ${shQuote(extract)} ${shQuote(dir('sicko-2'))}`);
      parent.bash(`git -C ${JSON.stringify(ctx.repo)} apply ${JSON.stringify(join(dir('sicko-2'), 'accepted.patch'))}`);
      parent.spawn('review', { role: 'reviewer', model: model('judgment and prose'), workspace: parent.readonly() }, 'Review the comment-free change to src/coupon.js.').wait('review').collect('review');
      parent.text('The coordinator applied 1 comment deletion proposed by the read-only critic. The first report proposed an application-code edit and was rejected without applying it; the critic was rerun once. The second proposal was accepted. No comments were restored, the license header was retained, and no architect sketch was needed. No fixes or constraint encodings were proposed, and there are no open findings. Unrelated staged, unstaged and untracked user work is unchanged. The change is deslopped and reviewed.');
      const sicko = (id: string, proposal: string) => new Worker().read(join(dir(id), 'scope.patch')).read(join(ctx.repo, 'src/coupon.js')).text(`${id}: proposed comment deletion in src/coupon.js\n${proposal}`);
      return scenario(parent, {
        impl: new Worker().write(join(impl, 'src/coupon.js'), SLOPPY).read(ctx.skill('deslop')).write(join(impl, 'src/coupon.js'), CLEAN).bash(`cd ${impl} && node -e "import('./src/coupon.js').then((m)=>{if(m.clampPercent(150)!==100)process.exit(1)})" && git add -A && git -c user.name=w -c user.email=w@example.com commit -q -m "feat: clampPercent"`).text('clampPercent committed after deslop'),
        'sicko-1': sicko('sicko-1', ESCAPED_PATCH),
        'sicko-2': sicko('sicko-2', COMMENT_PATCH),
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
    workersCheck('gates.comment-sicko-is-readonly', 'each Comment Sicko is a read-only critic of the caller\'s scoped diff', src('no-comments/SKILL.md', 'Spawn a `pstack_worker` worker with `role: "comment-sicko"`'), { role: 'comment-sicko', min: 2, max: 2, mode: 'readonly' }),
    check('gates.scope-patch-read-only', 'scope.patch holds the scoped diff and the critic reads it without applying changes', src('no-comments/SKILL.md', 'as `scope.patch` in the worker directory'), (view) => {
      const problems = ofRole(view, 'comment-sicko').flatMap((worker) => {
        const patch = join(worker.dir, 'scope.patch');
        const text = existsSync(patch) ? readFileSync(patch, 'utf8') : '';
        const calls = worker.session?.toolCalls ?? [];
        const read = calls.some((call) => call.name === 'read' && call.args['path'] === patch);
        const wrote = calls.some((call) => ['write', 'edit', 'bash'].includes(call.name));
        return [...(text.includes('src/coupon.js') ? [] : [`${worker.id}: scope.patch is missing or lacks src/coupon.js`]), ...(read && !wrote ? [] : [`${worker.id}: patch not read or a write-class tool was used`]), ...(worker.brief?.includes(view.base) ? [] : [`${worker.id}: brief lacks the base SHA`])];
      });
      return when(problems.length === 0, 'both critics read the scoped patch and base SHA without modifying files', problems.join('; '));
    }),
    check('gates.rejected-report-is-rerun-once', 'a report that proposed application-code edits was rejected and the critic rerun once with the failure named; the rejected change never reached the checkout', src('no-comments/SKILL.md', 'Revert and rerun one rejected report with the failure named'), (view) => {
      const [first, second] = ofRole(view, 'comment-sicko');
      const firstDiff = first?.finalText ?? '';
      const escaped = /^-.*Math\.min/m.test(firstDiff) && /^\+.*Math\.max\(0, percent\);/m.test(firstDiff);
      const named = /rejected/i.test(second?.brief ?? '') && /application code/i.test(second?.brief ?? '');
      const landed = git(view.repo, 'diff', 'HEAD', '--', 'src/coupon.js');
      return when(escaped && named && ofRole(view, 'comment-sicko').length === 2 && !/^[-+].*Math\./m.test(landed), 'the first report proposed editing Math.min, the second brief names that, two Comment Sicko runs, and the checkout diff touches no Math line', `first proposed app code edit ${escaped}; rerun brief names failure ${named}; checkout diff:\n${landed}`);
    }),
    check('gates.only-the-accepted-patch-is-applied', 'the caller\'s checkout holds exactly the accepted comment deletion: one removed comment line and no other change', src('no-comments/SKILL.md', 'only the coordinator applies the accepted patch in the caller\'s checkout with `git apply`'), (view) => {
      const diff = git(view.repo, 'diff', 'HEAD', '--', 'src/coupon.js').split('\n').filter((line) => /^[-+][^-+]/.test(line));
      const second = ofRole(view, 'comment-sicko')[1];
      const proposal = second?.finalText.match(PROPOSED_DIFF)?.[1]?.trimEnd();
      const acceptedPath = second === undefined ? '' : join(second.dir, 'accepted.patch');
      const accepted = existsSync(acceptedPath) ? readFileSync(acceptedPath, 'utf8').trimEnd() : '';
      const linked = proposal !== undefined && proposal === accepted;
      const impl = allWorkers(view).find((worker) => worker.id === 'impl');
      const run = primaryRun(view);
      const beforeCritic = impl === undefined || run === undefined ? undefined : branchCommits(view, run.id, impl.id).at(-1);
      if (beforeCritic === undefined) return fail('the implementation commit before the critic is missing');
      const changed = git(view.repo, 'diff', '--name-only', beforeCritic).split('\n').filter(Boolean);
      const scoped = changed.every((path) => ['src/coupon.js', 'README.md'].includes(path)) && view.git.dirty.every((path) => ['src/coupon.js', 'README.md', 'unrelated.txt'].includes(path));
      const original = git(view.repo, 'show', `${beforeCritic}:src/coupon.js`);
      const commentOnly = readFileSync(join(view.repo, 'src/coupon.js'), 'utf8') === original.replace(`${KEPT_COMMENT}\n`, '');
      return when(linked && scoped && commentOnly && diff.length === 1 && diff[0] === `-${KEPT_COMMENT}`, `the applied patch matches the second critic's proposal; only ${diff[0]} changed outside preserved user work and the license remains`, `proposal linked ${linked}; scope preserved ${scoped}; comment-only ${commentOnly}; changed files: ${changed.join(', ')}; changed lines: ${JSON.stringify(diff)}`);
    }),
    check('gates.unrelated-dirty-state-preserved', 'unrelated staged, unstaged and untracked user changes survive the accepted comment patch', src('no-comments/SKILL.md', 'unrelated and uncommitted caller state untouched'), (view) => {
      const staged = git(view.repo, 'show', ':README.md');
      const working = readFileSync(join(view.repo, 'README.md'), 'utf8');
      const untracked = join(view.repo, 'unrelated.txt');
      const kept = staged === '# cart\n\nTotals a shopping cart.\n\nstaged user note\n' && working === `${staged}unstaged user note\n` && existsSync(untracked) && readFileSync(untracked, 'utf8') === 'untracked user note\n' && git(view.repo, 'ls-files', '--', 'unrelated.txt') === '';
      return when(kept, 'staged README bytes, additional unstaged bytes and untracked file are unchanged', 'unrelated staged/unstaged/untracked state changed');
    }),
    check('gates.report-has-the-counts', 'the reply reports the deletion count, the rerun and that nothing was restored', src('no-comments/SKILL.md', '6. Report the deletion count, restored comments, reruns'), (view) => {
      const reply = finalReply(view);
      return when(/coordinator applied 1 comment deletion/i.test(reply) && /rejected without applying/i.test(reply) && /rerun/i.test(reply) && /no comments were restored/i.test(reply) && /license header was retained/i.test(reply), 'the reply correctly attributes application to the coordinator and reports rejection, rerun, restoration count and protected header', `reply: ${reply.slice(0, 200)}`);
    }),
    settledAndCollected('gates.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    { name: 'the worker never opened deslop', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, RUN, 'impl'), 'deslop/SKILL.md', 'zzz/SKILL.md'), fails: ['gates.deslop-before-the-commit'] },
    { name: 'the parent never opened no-comments', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'no-comments/SKILL.md', 'zzz/SKILL.md'), fails: ['gates.no-comments-before-review'] },
    { name: 'the rejected application edit reached the checkout', mutate: (sandbox) => dirtyRepo(sandbox, 'src/coupon.js', '\nexport const escaped = Math.max(0, 1);\n'), fails: ['gates.only-the-accepted-patch-is-applied'] },
    { name: 'a Comment Sicko received a writable workspace', mutate: (sandbox) => patchAssignment(sandbox, RUN, 'sicko-2', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: 'deadbeef' })), fails: ['gates.comment-sicko-is-readonly'] },
    { name: 'a critic did not read the scoped patch', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, RUN, 'sicko-2'), 'scope.patch', 'unrelated.patch'), fails: ['gates.scope-patch-read-only'] },
    { name: 'the rerun brief did not name the failure', mutate: (sandbox) => writeBrief(sandbox, 'sicko-2', 'Scope: src/coupon.js. Delete comments.'), fails: ['gates.rejected-report-is-rerun-once'] },
    { name: 'the second critic supplies no patch', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, RUN, 'sicko-2'), 'diff --git', 'not-a-patch'), fails: ['gates.only-the-accepted-patch-is-applied'] },
    { name: 'the second critic proposes an out-of-scope patch', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, RUN, 'sicko-2'), 'src/coupon.js', 'README.md'), fails: ['gates.only-the-accepted-patch-is-applied'] },
    { name: 'an out-of-scope proposal matches its applied patch and checkout', mutate: (sandbox) => applyScopeEscape(sandbox, false), fails: ['gates.only-the-accepted-patch-is-applied'], passes: ['gates.unrelated-dirty-state-preserved'] },
    { name: 'a coherently applied out-of-scope proposal was committed', mutate: (sandbox) => applyScopeEscape(sandbox, true), fails: ['gates.only-the-accepted-patch-is-applied'], passes: ['gates.unrelated-dirty-state-preserved'] },
    { name: 'committing an application edit inside the scoped file cannot hide it behind the comment deletion', mutate: (sandbox) => {
      const repo = join(sandbox, 'repo');
      const path = join(repo, 'src/coupon.js');
      const changed = CLEAN.replace('Math.min(100, Math.max(0, percent))', 'Math.max(0, percent)');
      writeFileSync(path, changed);
      git(repo, 'commit', '--only', '-m', 'incorrectly accepted executable critic edit', '--', 'src/coupon.js');
      writeFileSync(path, changed.replace(`${KEPT_COMMENT}\n`, ''));
      replaceAcceptedProposal(sandbox, git(repo, 'diff', `pstack-run/${RUN}/impl`, '--', 'src/coupon.js'));
    }, fails: ['gates.only-the-accepted-patch-is-applied'], passes: ['gates.unrelated-dirty-state-preserved'] },
    { name: 'the second critic proposes deleting a protected license header', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, RUN, 'sicko-2'), ` ${LICENSE_COMMENT}`, `-${LICENSE_COMMENT}`), fails: ['gates.only-the-accepted-patch-is-applied'] },
    { name: 'the unrelated staged user change was lost', mutate: (sandbox) => execFileSync('git', ['-C', join(sandbox, 'repo'), 'reset', '-q', 'HEAD', '--', 'README.md']), fails: ['gates.unrelated-dirty-state-preserved'] },
    { name: 'the unrelated unstaged user change was lost', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/README.md'), '# cart\n\nTotals a shopping cart.\n\nstaged user note\n'), fails: ['gates.unrelated-dirty-state-preserved'] },
    { name: 'the unrelated untracked user change was lost', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/unrelated.txt'), ''), fails: ['gates.unrelated-dirty-state-preserved'] },
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
      return when(step?.state === 'passed' && step.evidence.length > 0 && !opened.includes(-1), `step 7 done with ${step?.evidence.join(', ')}; skills opened at ${opened.join(', ')}`, `step 7 is ${step?.state}; skills opened at ${opened.join(', ')}`);
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
    { name: 'the interrogate step was skipped as not contested', mutate: (sandbox) => setStep(sandbox, FI_RUN, 7, 'skipped', (entry) => ({ ...stripEvidence(entry), skip: 'skip: not contested' })), fails: ['feature-contested.interrogate-step-is-done-not-skipped', 'todo.feature.skips-explained'] },
    { name: 'the reviewers were one model family', mutate: (sandbox) => patchAssignment(sandbox, FI_RUN, 'reviewer-2', (assignment) => (assignment['model'] = (SCRIPTED_ROLES['interrogate reviewers'] as string[])[0])), fails: ['feature-contested.reviewers-from-two-families'] },
    { name: 'a reviewer started from the base, not the delivered commit', mutate: (sandbox) => patchAssignment(sandbox, FI_RUN, 'reviewer-1', (assignment) => ((assignment['workspace'] as { inputCommit: string }).inputCommit = 'deadbeef')), fails: ['feature-contested.adversaries-start-from-the-delivered-commit'] },
    { name: 'a fix was applied while interrogating', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['feature-contested.no-fix-was-applied'] },
    { name: 'the reply reports output the rerun did not show', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Output: NaN.', 'Output: 100.'), fails: ['feature-contested.finding-was-rerun-and-reported'] },
  ],
};

export const gateFamilies: Family[] = [gatesFamily, featureContestedFamily];
