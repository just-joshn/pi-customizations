// The deslop gate before a commit and the no-comments gate before review (poteto-mode "Non-negotiables").
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, collectOrder, finalReply, openedAt, settledAndCollected, skillFile, spawnOrder, workersCheck } from '../lib/checks.ts';
import { SCRIPTED_ROLES } from '../lib/driver.ts';
import { dirtyRepo, parentSession, patchAssignment, rewriteFinalReply, rewriteSession, workerSessionFile } from '../lib/mutate.ts';
import type { RunView } from '../lib/view.ts';
import { worktreeOf } from './shared.ts';
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
      const impl = allWorkers(view).find((worker) => worker.id === 'impl');
      const calls = impl?.session?.toolCalls ?? [];
      const read = calls.find((call) => call.name === 'read' && String(call.args['path']).endsWith('deslop/SKILL.md'));
      const commit = calls.find((call) => call.name === 'bash' && /git .*commit/.test(String(call.args['command'])));
      const committed = git(view.repo, 'show', `pstack-run/${RUN}/impl:src/coupon.js`);
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
