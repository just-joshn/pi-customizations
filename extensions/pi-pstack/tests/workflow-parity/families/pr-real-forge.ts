// The PR families on a real forge (spec 13.1 to 13.3): babysit-drive, shipping and opening-a-pr, run against branches and PRs
// created in the throwaway GitHub repository, with a real Actions check on every PR. The scripted model still drives the real
// pi binary. Two layers of checks: `FactCheck`s read the forge's state as the GitHub API reported it (facts, captured after the
// run), and session checks read what the parent and its workers did. A fact check is a pure function of the facts, so the
// committed facts of a real run can be re-checked offline, and each negative case breaks one fact and must be caught.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, proofSteps, scenario, Worker } from '../fixtures/dsl.ts';
import { CART_JS, cartHistory } from '../fixtures/repos.ts';
import { type Facts, type FactPr, readFacts, REPO_FLAG, RealForge, realForgeEnv, SANDBOX_NAME, SANDBOX_OWNER, SANDBOX_REPO, WATCH_PR, WORKFLOW_COMMIT, writeContainerScenario } from '../fixtures/real-forge.ts';
import { check, type Check, type Outcome, src, type Src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, finalReply, noToolErrors, playbookReads, primaryRun, promptRoutes, todoChecks, verifyReceipt } from '../lib/checks.ts';
import type { Ctx } from '../lib/driver.ts';
import { appendToolCall, parentSession, type Negative, rewriteFinalReply } from '../lib/mutate.ts';
import { bodyHasSections } from './pr-autopilot.ts';
import { BASH, declaredMode, exitCodeOf, lifeOf, modeDeclared, stepDone, watchers } from './pr-shared.ts';
import { removeRunContainers } from './pr-shipping.ts';
import { todoNegatives } from './shared.ts';
import type { Family } from './types.ts';

export interface FactCheck {
  id: string;
  title: string;
  source: Src | Src[];
  run: (facts: Facts) => Outcome;
}

export interface RealFamily extends Family {
  forge: RealForge;
  /** What `RealForge.capture` needs besides the sandbox. */
  capture: () => { testFiles?: Record<number, string>; watch?: string[] };
  facts: FactCheck[];
}

const BS = (anchor: string): Src => src('poteto-mode/playbooks/babysit.md', anchor);
const SH = (anchor: string): Src => src('poteto-mode/playbooks/shipping.md', anchor);
const OP = (anchor: string): Src => src('poteto-mode/playbooks/opening-a-pr.md', anchor);
const TRIAGE = (anchor: string): Src => src('poteto-mode/references/bugbot-triage.md', anchor);

export const fact = (id: string, title: string, source: Src | Src[], run: FactCheck['run']): FactCheck => ({ id, title, source, run });
const asCheck = (entry: FactCheck): Check => check(entry.id, entry.title, entry.source, (view) => entry.run(readFacts(view.sandbox)));

/** Edits the facts a finished run recorded in a private copy of its sandbox. */
export const editFacts = (change: (facts: Facts) => void): Negative['mutate'] => (sandbox) => {
  const path = join(sandbox, 'real-facts.json');
  const facts = JSON.parse(readFileSync(path, 'utf8')) as Facts;
  change(facts);
  writeFileSync(path, JSON.stringify(facts, null, 2));
};

const rewriteSession = (sandbox: string, from: string, to: string): void => {
  const file = parentSession(sandbox);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll(from, to));
};

const short = (sha: string): string => sha.slice(0, 8);
const WATCH_ARGS = (pr: number) => ['--owner', SANDBOX_OWNER, '--repo', SANDBOX_NAME, '--pr', String(pr)];

/** Every merge, queue entry or auto-merge the GitHub API shows for the run's PRs, and what landed on trunk. */
function mergedSet(facts: Facts): { merged: number[]; armed: number[]; landed: string[] } {
  return {
    merged: facts.prs.filter((pr) => pr.merged || pr.timeline.some((event) => event.event === 'merged')).map((pr) => pr.number),
    armed: facts.prs.filter((pr) => pr.autoMerge || pr.timeline.some((event) => event.event === 'auto_merge_enabled')).map((pr) => pr.number),
    landed: facts.trunkCommits.slice(0, Math.max(0, facts.trunkCommits.findIndex((commit) => commit.sha === facts.trunkBase))).map((commit) => commit.message),
  };
}

const typedMerges = (view: Parameters<typeof BASH>[0]) => BASH(view).filter((entry) => /\b(gh|origin) pr merge\b/.test(entry.command));

/** The real forge shows no merge, queue entry or auto-merge, every PR open, and trunk exactly where it started or at the one commit the contract allows. */
const neverMergesFact = (id: string, source: Src | Src[], trunkAdvance = 0): FactCheck =>
  fact(id, 'the GitHub API shows no PR merged, queued or armed for auto-merge, every PR still open, and trunk unmoved by the run', source, (facts) => {
    const { merged, armed } = mergedSet(facts);
    const advanced = facts.trunkCommits.findIndex((commit) => commit.sha === facts.trunkBase);
    const open = facts.prs.filter((pr) => pr.state !== 'open');
    return when(merged.length === 0 && armed.length === 0 && open.length === 0 && advanced <= trunkAdvance, `${facts.prs.length} PR(s) open, none merged or armed; trunk ${advanced === 0 ? 'at its base' : `${advanced} commit(s) past the base the run set`}`, `merged ${merged.join(', ') || 'none'}; armed ${armed.join(', ') || 'none'}; not open ${open.map((pr) => pr.number).join(', ') || 'none'}; trunk commits past base ${advanced}`);
  });

const forgeResolved = (id: string, source: Src | Src[]): Check =>
  check(id, 'the forge is resolved with `command -v origin` once, before the first forge call, the choice (gh, origin CLI absent) is recorded, and the real gh answered every call', source, (view) => {
    const resolvedAt = BASH(view).find((entry) => /^command -v origin/.test(entry.command))?.order ?? -1;
    const firstForge = BASH(view).find((entry) => /\bgh (pr|api|run)\b|watch-pr/.test(entry.command) && !/command -v origin/.test(entry.command) && !/^cd |proof|receipt\.mjs/.test(entry.command))?.order ?? Number.POSITIVE_INFINITY;
    const resolutions = BASH(view).filter((entry) => /^command -v origin/.test(entry.command)).length;
    const recorded = /Forge: (gh|origin)/.exec(view.runs[0]?.todoText ?? '')?.[1];
    return when(resolvedAt !== -1 && resolvedAt < firstForge && resolutions === 1 && recorded === 'gh', `resolved once at ${resolvedAt} before the first forge call at ${firstForge}; recorded ${String(recorded)}`, `resolved at ${resolvedAt}, first forge call ${firstForge}, resolutions ${resolutions}, recorded ${String(recorded)}`);
  });

const neverTypedMerge = (id: string, source: Src | Src[]): Check => check(id, 'the parent typed no `gh pr merge`', source, (view) => when(typedMerges(view).length === 0, 'no merge command typed', `typed ${typedMerges(view).map((entry) => entry.command.slice(0, 60)).join(' | ')}`));

// ---- babysit-drive on the real forge

const CLAMP = 'return roundCents(amount - (amount * percent) / 100);';
const CAPPED_CART = CART_JS.replace(CLAMP, 'const capped = Math.min(percent, 100);\n  return roundCents(amount - (amount * capped) / 100);');
const TRUNK_CART = CART_JS.replace(CLAMP, `${CLAMP} // percent off`);
const RESOLVED_CART = CART_JS.replace(CLAMP, 'const capped = Math.min(percent, 100);\n  return roundCents(amount - (amount * capped) / 100); // percent off');
const CAP_TEST = "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { applyCoupon } from '../src/cart.js';\n\ntest('a coupon over 100 percent never pays the customer', () => assert.equal(applyCoupon(10, 150), 0));\n";
const THREAD_BODY = 'Severity: Low\nDuplicated clamp logic: `Math.min(percent, 100)` already exists in `src/checkout.js`, so extract a shared helper.\nRUN_ID: bb-1';
const CLAMP_LINE = RESOLVED_CART.split('\n').findIndex((line) => line.includes('const capped = Math.min')) + 1;
const history = [...cartHistory, WORKFLOW_COMMIT];

const DRIVE_RUN = 'babysit-drive-real';
const DRIVE_BRANCH = 'feat-coupon-cap';

const watchAssignment = (ctx: Ctx, parent: Parent, args: string[]) => ({ kind: 'watch' as const, role: 'watcher', model: 'inherit-parent', workspace: parent.readonly(), watch: { argv: [WATCH_PR, ...args, '--interval', '5'], cwd: ctx.repo } });
const RUN_ID_OF = (pr: number): string => `$(gh pr checks ${pr} ${REPO_FLAG} --json name,link --jq '.[]|select(.name=="build")|.link' | sed -E 's#.*/runs/([0-9]+)/.*#\\1#' | head -1)`;
const THREAD_ID_OF = (pr: number): string => `$(gh api graphql -f query='query { repository(owner: "${SANDBOX_OWNER}", name: "${SANDBOX_NAME}") { pullRequest(number: ${pr}) { reviewThreads(first: 20) { nodes { id isResolved } } } } }' --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | .id' | head -1)`;

const OWNER_WAIT = 'owner-rebase-wait';

const driveForge = new RealForge('babysit-drive');
const drive = { number: 0, oldHead: '' };

const driveFacts: FactCheck[] = [
  fact('real.babysit.the-conflict-was-real-and-reported-before-anything-else', 'the PR conflicted on GitHub when the run began, and its report comment (naming the branch, the rebase and the drift sweep) came before the owner rebase, the owner rebase before the thread reply, and the reply before the fresh build', BS('A conflict is the one blocker you report rather than resolve'), (facts) => {
    const pr = facts.prs[0];
    if (pr === undefined) return { ok: false, evidence: 'no PR' };
    const report = pr.comments.find((comment) => /rebase/.test(comment.body) && comment.body.includes(DRIVE_BRANCH) && /[Dd]rift sweep/.test(comment.body));
    const push = pr.timeline.find((event) => event.event === 'head_ref_force_pushed');
    const reply = pr.threads.flatMap((thread) => thread.comments).find((comment) => /Dismissed/.test(comment.body));
    const rerun = pr.runs.flatMap((run) => run.attempts).filter((attempt) => attempt.attempt === 2).map((attempt) => attempt.startedAt ?? '').sort()[0];
    const ordered = report !== undefined && push !== undefined && reply !== undefined && rerun !== undefined && report.createdAt < push.createdAt && push.createdAt < reply.createdAt && reply.createdAt < rerun;
    return when(facts.notes['initialMergeableState'] === 'dirty' && ordered, `mergeable_state was dirty at the start; report ${report?.createdAt}, owner force-push ${push?.createdAt}, reply ${reply?.createdAt}, fresh build ${rerun}`, `initial ${String(facts.notes['initialMergeableState'])}; report ${report?.createdAt}, push ${push?.createdAt}, reply ${reply?.createdAt}, rerun ${rerun}`);
  }),
  fact('real.babysit.the-owner-rebased-and-the-babysitter-changed-no-ref', 'exactly one force-push reached the PR branch, it is the owner stand-in\'s (its logged SHA is the head now, authored by the owner), the base never changed, and trunk holds only the commit that caused the conflict', BS('Never mutate stack topology'), (facts) => {
    const pr = facts.prs[0];
    if (pr === undefined) return { ok: false, evidence: 'no PR' };
    const pushes = pr.timeline.filter((event) => event.event === 'head_ref_force_pushed');
    const logged = facts.operator.find((entry) => entry.kind === 'force-push');
    const retargets = pr.timeline.filter((event) => event.event === 'base_ref_changed');
    return when(pushes.length === 1 && logged?.['new'] === pr.headSha && /^owner-/.test(pr.owner) && retargets.length === 0 && pr.base === facts.trunk && facts.trunkCommits[0]?.message === 'refactor(cart): annotate applyCoupon', `one force-push, the owner's (${short(pr.headSha)}, author ${pr.owner}); base ${pr.base} unchanged; trunk tip is the conflicting commit`, `force-pushes ${pushes.length}; logged ${String(logged?.['new'])} vs head ${pr.headSha}; author ${pr.owner}; retargets ${retargets.length}; base ${pr.base}; trunk tip ${facts.trunkCommits[0]?.message}`);
  }),
  fact('real.babysit.the-review-thread-was-triaged-on-the-pr', 'the review thread the owner stand-in opened on the new head holds a reply that cites src/cart.js and says Dismissed, and the thread is resolved on GitHub', TRIAGE('Classify each Bugbot thread before acting'), (facts) => {
    const pr = facts.prs[0];
    const thread = pr?.threads[0];
    const reply = thread?.comments.slice(1).find((comment) => /Dismissed/.test(comment.body) && /src\/cart\.js/.test(comment.body));
    return when(pr?.threads.length === 1 && thread?.resolved === true && thread.comments[0]?.path === 'src/cart.js' && reply !== undefined, `1 thread on src/cart.js, ${thread?.comments.length} comments, reply cites src/cart.js, resolved`, `threads ${pr?.threads.length}; resolved ${String(thread?.resolved)}; comments ${thread?.comments.length}; reply ${reply === undefined ? 'missing' : 'present'}`);
  }),
  fact('real.babysit.a-flake-got-exactly-one-fresh-build-from-a-real-failure', 'the check failed on attempt 1 with the infrastructure error and passed on attempt 2 of the same run: one whole-run rerun, never a third attempt', BS('Classify CI before any retrigger'), (facts) => {
    const pr = facts.prs[0];
    const current = pr?.runs.filter((run) => run.headSha === pr.headSha) ?? [];
    const run = current[0];
    const [first, second] = run?.attempts ?? [];
    return when(current.length === 1 && run?.attempt === 2 && first?.conclusion === 'failure' && second?.conclusion === 'success', `run ${run?.id}: attempt 1 ${first?.conclusion}, attempt 2 ${second?.conclusion}; ${current.length} run at the head`, `runs at the head ${current.length}; attempts ${JSON.stringify(run?.attempts.map((attempt) => [attempt.attempt, attempt.conclusion]))}`);
  }),
  fact('real.babysit.the-pr-is-merge-ready-on-github', 'on GitHub the PR is open, not draft, mergeable_state clean, every check run success, no unresolved thread, and the real watch-pr, run once over this state, exits 0 with READY', BS('stop at `READY` for one PR'), (facts) => {
    const pr = facts.prs[0];
    if (pr === undefined) return { ok: false, evidence: 'no PR' };
    const bad = [pr.state !== 'open' ? 'not open' : '', pr.isDraft ? 'draft' : '', pr.mergeableState !== 'clean' ? `mergeable_state ${pr.mergeableState}` : '', pr.checks.length === 0 || pr.checks.some((entry) => entry.conclusion !== 'success') ? 'a check is not success' : '', pr.threads.some((thread) => !thread.resolved) ? 'unresolved thread' : '', facts.watch?.code !== 0 || !facts.watch.kinds.includes('READY') ? `watch-pr exit ${facts.watch?.code} ${facts.watch?.kinds.join(',')}` : ''].filter(Boolean);
    return when(bad.length === 0, `open, clean, ${pr.checks.length} check(s) success, threads resolved; watch-pr exit ${facts.watch?.code} ${facts.watch?.kinds.join(', ')}`, bad.join('; '));
  }),
  neverMergesFact('real.babysit.never-merges-because-checks-are-green', BS('Babysitting never authorizes merging'), 0),
];

export const babysitDriveRealFamily: RealFamily = {
  id: 'babysit-drive-real',
  title: 'babysit drive on the real forge: a real conflict reported not resolved, a real review thread, a real flaky Actions check that gets one fresh build, stop at READY from the real watch-pr, never merge (spec 13.2)',
  forge: driveForge,
  facts: driveFacts,
  capture: () => ({ watch: WATCH_ARGS(drive.number) }),
  spec: {
    family: 'babysit-drive-real',
    runId: DRIVE_RUN,
    history,
    timeoutMs: 1_200_000,
    holdWatchers: /.*/,
    prepare: (ctx) => {
      driveForge.setup(ctx, {
        branches: [{ name: DRIVE_BRANCH, files: { 'src/cart.js': CAPPED_CART, 'test/cap.test.js': CAP_TEST, '.ci-mode': 'flaky\n' }, message: 'fix(cart): cap a coupon at 100 percent', author: 'owner-12' }],
        trunkAfter: [{ file: 'src/cart.js', content: TRUNK_CART, message: 'refactor(cart): annotate applyCoupon' }],
        prs: [{ head: DRIVE_BRANCH, title: 'fix(cart): cap a coupon at 100 percent', body: '## Why\nA coupon over 100 percent pays the customer.\n' }],
        awaitConflict: DRIVE_BRANCH,
      });
      drive.number = driveForge.numbers[DRIVE_BRANCH] as number;
      drive.oldHead = driveForge.shas[DRIVE_BRANCH] as string;
      driveForge.startOperator(ctx, { pr: drive.number, branch: driveForge.branch(DRIVE_BRANCH), owner: 'owner-12', match: 'rebase', resolve: { file: 'src/cart.js', content: RESOLVED_CART }, thread: { path: 'src/cart.js', line: CLAMP_LINE, body: THREAD_BODY } });
    },
    env: (ctx) => realForgeEnv(ctx),
    cleanup: () => void driveForge.cleanup(),
    prompt: () => `/poteto-mode babysit PR ${drive.number} and get it green`,
    scenario: (ctx) => {
      const n = drive.number;
      const branch = driveForge.branch(DRIVE_BRANCH);
      const trunk = driveForge.trunk;
      const parent = new Parent(ctx);
      const todo = join(parent.runDir, 'TODO.md');
      const dir = parent.runDir;
      parent.beginPlaybook('babysit', `Babysit PR ${n}`);
      parent.readReference('poteto-mode', 'bugbot-triage.md');
      parent.task(`Mode: drive (babysit PR ${n} and get it green)`);
      parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
      parent.task('Forge: gh (origin CLI absent, fallback recorded)');
      stepDone(parent, 'babysit', 1, 'bs-mode', `! command -v origin && grep -q 'Mode: drive' ${todo}`);
      parent.bash(`gh pr view ${n} ${REPO_FLAG} --json number,state,baseRefName,headRefName`);
      stepDone(parent, 'babysit', 2, 'bs-frontier', `gh pr view ${n} ${REPO_FLAG} --json state | grep -q OPEN`);
      parent.bash(`grep -rl watch-pr ${ctx.repo}/.pi/pstack/runs/*/workers/*/assignment.json 2>/dev/null || echo "no other babysitter on PR ${n}"`);
      stepDone(parent, 'babysit', 3, 'bs-single', `test -z "$(grep -rl watch-pr ${ctx.repo}/.pi/pstack/runs/*/workers/*/assignment.json 2>/dev/null)"`);
      const arm = (id: string) => parent.spawn(id, watchAssignment(ctx, parent, WATCH_ARGS(n)), '').wait(id).collect(id);
      arm('watch-1');
      parent.bash(`${WATCH_PR} ${WATCH_ARGS(n).join(' ')} --status-only --pretty`);
      const report = join(dir, 'conflict-report.md');
      parent.write(report, `babysit: PR ${n} conflicts with trunk in src/cart.js. The owner of branch ${DRIVE_BRANCH} needs to rebase it onto trunk and publish with --force-with-lease.\nDrift sweep: trunk changed applyCoupon, so check its callers in src/checkout.js in the same wave.\n`);
      parent.bash(`gh pr comment ${n} ${REPO_FLAG} --body-file ${report}`);
      parent.bash(`i=0; until [ "$(gh pr view ${n} ${REPO_FLAG} --json headRefOid --jq .headRefOid)" != "${drive.oldHead}" ] && [ "$(gh api repos/${SANDBOX_REPO}/pulls/${n}/comments --jq length)" -ge 1 ]; do i=$((i+1)); [ $i -gt 120 ] && exit 1; sleep 3; done # ${OWNER_WAIT}`);
      parent.bash(`git fetch -q origin && git log --oneline -3 origin/${branch}`);
      arm('watch-2');
      parent.bash(`${WATCH_PR} ${WATCH_ARGS(n).join(' ')} --status-only --pretty`);
      parent.bash(`git grep -n "Math.min" origin/${branch} -- src || true`);
      const payload = join(dir, 'reply.json');
      parent.write(payload, `${JSON.stringify({ body: 'Dismissed: git grep for Math.min under src/ finds one clamp, in src/cart.js. src/checkout.js has none and calls total(), so there is no duplicate to extract.' })}\n`);
      parent.bash(`gh api --method POST repos/${SANDBOX_REPO}/pulls/${n}/comments/$(gh api repos/${SANDBOX_REPO}/pulls/${n}/comments --jq '.[0].id')/replies --input ${payload}`);
      parent.bash(`gh api graphql -f query='mutation($t: ID!) { resolveReviewThread(input: {threadId: $t}) { thread { id } } }' -f t=${THREAD_ID_OF(n)}`);
      parent.decision('bugbot-triage', 'dismiss the duplicate-clamp thread', 'claimed duplicate clamp does not exist: git grep finds Math.min only in src/cart.js', `git grep -n Math.min origin/${branch} -- src`, 'dismissed with the disproof on the thread');
      arm('watch-3');
      parent.bash(`gh pr checks ${n} ${REPO_FLAG} || true`);
      parent.bash(`gh run view ${RUN_ID_OF(n)} ${REPO_FLAG} --log-failed`);
      parent.bash(`git fetch -q origin && git merge-base --is-ancestor origin/${trunk} origin/${branch} && echo "base is current, so the failure is not a stale base"`);
      parent.bash(`gh run rerun ${RUN_ID_OF(n)} ${REPO_FLAG}`);
      arm('watch-4');
      parent.bash(`cat ${join(dir, 'decisions.tsv')}`);
      stepDone(parent, 'babysit', 4, 'bs-topology', `test "$(git -C ${ctx.repo} rev-parse HEAD)" = ${ctx.base}`);
      stepDone(parent, 'babysit', 5, 'bs-order', `grep -c watch ${join(dir, 'events.jsonl')}`);
      stepDone(parent, 'babysit', 6, 'bs-ready', `gh pr checks ${n} ${REPO_FLAG} | grep -q pass`);
      stepDone(parent, 'babysit', 7, 'bs-ci', `gh run view ${RUN_ID_OF(n)} ${REPO_FLAG} --attempt 1 --log-failed | grep -q ECONNRESET`);
      stepDone(parent, 'babysit', 8, 'bs-bugbot', `grep -q bugbot-triage ${join(dir, 'decisions.tsv')}`);
      stepDone(parent, 'babysit', 9, 'bs-human', `! gh pr view ${n} ${REPO_FLAG} --json state | grep -q MERGED`);
      parent.text(`Mode: drive. Forge: gh, origin CLI absent. PR ${n} is merge-ready: the watcher reached READY at the current head. Conflict: reported to the owner, who rebased; I did not. Thread: bugbot duplicate-clamp claim dismissed with a git grep disproof. CI: one infrastructure flake, source verified (ECONNRESET, current base), one fresh build. Not merged: merging is Shipping, on your request.`);
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('babysit'),
    ...todoChecks({ playbook: 'babysit' }),
    modeDeclared('real.babysit.mode-declared-from-the-request', BS('Declare the mode and resolve the forge before any poll'), 'drive'),
    forgeResolved('real.babysit.forge-resolved-once-gh-fallback-recorded', BS('GitHub CLI (`gh`) is the default')),
    check('real.babysit.watchers-are-watch-pr-workers-on-the-real-pr', 'each watcher is a kind:watch worker with role watcher, the absolute watch-pr path, --owner and --repo of the sandbox repository, the PR number, no --status-only, cwd the repository root', BS('Run `drive` and `background` under a watch loop'), (view) => {
      const found = watchers(view);
      const problems = found.flatMap((worker) => {
        const assignment = assignmentOf(worker);
        const argv = assignment.watch?.argv ?? [];
        const arg = (name: string) => argv[argv.indexOf(name) + 1];
        const bad = [assignment.role !== 'watcher' ? 'role' : '', argv[0] !== WATCH_PR ? 'argv[0]' : '', arg('--pr') !== String(drive.number) ? '--pr' : '', arg('--owner') !== SANDBOX_OWNER || arg('--repo') !== SANDBOX_NAME ? '--owner/--repo' : '', argv.includes('--status-only') ? '--status-only' : '', assignment.watch?.cwd !== view.repo ? 'cwd' : ''].filter(Boolean);
        return bad.length === 0 ? [] : [`${worker.id}: ${bad.join(', ')}`];
      });
      return when(found.length >= 1 && problems.length === 0, `${found.length} watchers, each watch-pr on ${SANDBOX_REPO} PR ${drive.number}`, problems.join('; ') || 'no watcher');
    }),
    check('real.babysit.verdicts-arrive-conflicts-then-threads-then-ci', "the real watch-pr's exit codes are the playbook's order: 2 merge-conflicts, 3 review-threads, 4 failing-checks, then 0 READY", BS('Order is conflicts, then review threads, then CI'), (view) => {
      const codes = watchers(view).map(exitCodeOf);
      return when(JSON.stringify(codes) === JSON.stringify([2, 3, 4, 0]), `watch-pr exits ${codes.join(', ')}`, `watch-pr exits ${JSON.stringify(codes)}`);
    }),
    check('real.babysit.one-watcher-live-at-a-time-and-the-parent-ran-no-poll-loop', 'no two watchers were live at once, each was armed after the previous ended, none after READY, and the parent ran no sleep loop except the one bounded wait for the owner\'s push', BS('Rearm the watcher after every push wave and every verdict you act on'), (view) => {
      const lives = watchers(view).map((worker) => ({ id: worker.id, ...lifeOf(view, worker.id) }));
      const overlap = lives.filter((life, index) => index > 0 && (life.spawn < (lives[index - 1] as { end: number }).end || life.spawn === -1));
      const loops = BASH(view).filter((entry) => /\bsleep\b|while true|watch -n/.test(entry.command) && !entry.command.includes(OWNER_WAIT));
      const last = watchers(view).at(-1);
      return when(lives.length >= 2 && overlap.length === 0 && loops.length === 0 && last !== undefined && exitCodeOf(last) === 0, `${lives.length} watchers, strictly sequential, the last ended READY, no sleep loop but the owner wait`, `overlapping ${overlap.map((life) => life.id).join(', ') || 'none'}; loops ${loops.length}; last exit ${last === undefined ? 'n/a' : String(exitCodeOf(last))}`);
    }),
    check('real.babysit.parent-typed-no-topology-change', 'the parent typed no rebase, merge, reset, push, force, retarget or branch move', BS('Never mutate stack topology'), (view) => {
      const typed = BASH(view).filter((entry) => /git (rebase|merge(?!-base)|reset --hard|push)|--force|gh pr edit|origin pr edit|git branch -f/.test(entry.command));
      return when(typed.length === 0, 'no mutating git or retarget command typed', typed.map((entry) => entry.command.slice(0, 60)).join(' | '));
    }),
    check('real.babysit.fresh-build-came-after-the-log-and-the-base-check-and-was-whole-run', 'the failing run log and the base were read before the one rerun, the rerun has no --failed or --job, and exactly one rerun was typed', BS('Classify CI before any retrigger'), (view) => {
      const calls = BASH(view);
      const logAt = calls.find((entry) => /gh run view .*--log-failed/.test(entry.command) && !/--attempt/.test(entry.command) && !/grep/.test(entry.command))?.order ?? Number.POSITIVE_INFINITY;
      const baseAt = calls.find((entry) => /git merge-base --is-ancestor/.test(entry.command))?.order ?? Number.POSITIVE_INFINITY;
      const reruns = calls.filter((entry) => /gh run rerun/.test(entry.command));
      return when(reruns.length === 1 && !/--failed|--job/.test(reruns[0]?.command ?? '') && logAt < (reruns[0]?.order ?? -1) && baseAt < (reruns[0]?.order ?? -1), `log read at ${logAt} and base checked at ${baseAt}, then one whole-run rerun at ${reruns[0]?.order}`, `reruns ${reruns.length}; log ${logAt}; base ${baseAt}; command ${reruns[0]?.command.slice(0, 70)}`);
    }),
    check('real.babysit.review-text-is-data-and-triage-is-grounded', 'the thread was checked against the code before the reply, the reply went through a JSON file, no comment text reached a shell command, and a triage decision row names the evidence', TRIAGE('Classify each Bugbot thread before acting'), (view) => {
      const commands = BASH(view);
      const grounded = commands.findIndex((entry) => /git grep .*Math\.min/.test(entry.command));
      const replyCall = commands.findIndex((entry) => /gh api --method POST .*replies --input /.test(entry.command));
      const injected = commands.filter((entry) => entry.command.includes('Duplicated clamp logic') || entry.command.includes('extract a shared helper'));
      const row = (primaryRun(view, 'babysit')?.decisions ?? []).find((cells) => cells[1] === 'bugbot-triage');
      return when(grounded !== -1 && replyCall > grounded && injected.length === 0 && row !== undefined && /dismiss/.test(row[2] ?? '') && (row[4] ?? '').trim() !== '', `code lookup ${grounded} before the reply ${replyCall}; no comment text in a command; decision row ${row?.[2]}`, `lookup ${grounded}, reply ${replyCall}, comment text in commands ${injected.length}, decision ${JSON.stringify(row)}`);
    }),
    neverTypedMerge('real.babysit.parent-typed-no-merge', BS('Babysitting never authorizes merging')),
    check('real.babysit.reply-is-merge-ready-not-merged', 'the reply says the PR is merge-ready, that nothing merged, and that landing is Shipping', BS('Stop at the human'), (view) => {
      const reply = finalReply(view);
      return when(/merge-ready/.test(reply) && /Not merged/i.test(reply) && /Shipping/.test(reply) && declaredMode(view) === 'drive', 'merge-ready, not merged, Shipping', `reply: ${reply.slice(0, 160)}`);
    }),
    noToolErrors('real.babysit.no-tool-errors', BS('Trust the active forge')),
    ...driveFacts.map(asCheck),
  ],
  negatives: [
    ...todoNegatives(DRIVE_RUN, 'babysit', { done: [1, 2, 3, 4, 5, 6, 7, 8, 9], receipts: { 1: 'bs-mode', 2: 'bs-frontier', 3: 'bs-single', 4: 'bs-topology', 5: 'bs-order', 6: 'bs-ready', 7: 'bs-ci', 8: 'bs-bugbot', 9: 'bs-human' } }),
    { name: 'the babysitter merged because every check was green', mutate: editFacts((facts) => { const pr = facts.prs[0] as FactPr; pr.merged = true; pr.state = 'closed'; pr.timeline.push({ event: 'merged', actor: 'just-joshn', createdAt: '2099-01-01T00:00:00Z', sha: null }); }), fails: ['real.babysit.never-merges-because-checks-are-green', 'real.babysit.the-pr-is-merge-ready-on-github'] },
    { name: 'the babysitter armed auto-merge', mutate: editFacts((facts) => { (facts.prs[0] as FactPr).autoMerge = true; }), fails: ['real.babysit.never-merges-because-checks-are-green'] },
    { name: 'the babysitter force-pushed the branch as well', mutate: editFacts((facts) => (facts.prs[0] as FactPr).timeline.push({ event: 'head_ref_force_pushed', actor: 'just-joshn', createdAt: '2099-01-01T00:00:00Z', sha: null })), fails: ['real.babysit.the-owner-rebased-and-the-babysitter-changed-no-ref'] },
    { name: 'the babysitter retargeted the PR', mutate: editFacts((facts) => (facts.prs[0] as FactPr).timeline.push({ event: 'base_ref_changed', actor: 'just-joshn', createdAt: '2099-01-01T00:00:00Z', sha: null })), fails: ['real.babysit.the-owner-rebased-and-the-babysitter-changed-no-ref'] },
    { name: 'a second fresh build was requested', mutate: editFacts((facts) => { const run = (facts.prs[0] as FactPr).runs.find((entry) => entry.headSha === (facts.prs[0] as FactPr).headSha); run?.attempts.push({ attempt: 3, conclusion: 'success', url: '', startedAt: '2099-01-01T00:00:00Z' }); if (run) run.attempt = 3; }), fails: ['real.babysit.a-flake-got-exactly-one-fresh-build-from-a-real-failure'] },
    { name: 'the check never failed, so there was nothing to rerun', mutate: editFacts((facts) => { const run = (facts.prs[0] as FactPr).runs.find((entry) => entry.headSha === (facts.prs[0] as FactPr).headSha); if (run) run.attempts[0] = { ...(run.attempts[0] as { attempt: number; url: string; startedAt: string | null }), conclusion: 'success' }; }), fails: ['real.babysit.a-flake-got-exactly-one-fresh-build-from-a-real-failure'] },
    { name: 'the thread was left unresolved', mutate: editFacts((facts) => { for (const thread of (facts.prs[0] as FactPr).threads) thread.resolved = false; }), fails: ['real.babysit.the-review-thread-was-triaged-on-the-pr', 'real.babysit.the-pr-is-merge-ready-on-github'] },
    { name: 'the reply never cited the code', mutate: editFacts((facts) => { for (const thread of (facts.prs[0] as FactPr).threads) thread.comments = thread.comments.slice(0, 1); }), fails: ['real.babysit.the-review-thread-was-triaged-on-the-pr', 'real.babysit.the-conflict-was-real-and-reported-before-anything-else'] },
    { name: 'a check is still red at the end', mutate: editFacts((facts) => { for (const entry of (facts.prs[0] as FactPr).checks) entry.conclusion = 'failure'; }), fails: ['real.babysit.the-pr-is-merge-ready-on-github'] },
    { name: 'the real watch-pr did not answer READY', mutate: editFacts((facts) => { facts.watch = { code: 4, kinds: ['BLOCKER'] }; }), fails: ['real.babysit.the-pr-is-merge-ready-on-github'] },
    { name: 'the conflict was never reported to the owner', mutate: editFacts((facts) => { (facts.prs[0] as FactPr).comments = []; }), fails: ['real.babysit.the-conflict-was-real-and-reported-before-anything-else'] },
    { name: 'the PR never conflicted', mutate: editFacts((facts) => { facts.notes['initialMergeableState'] = 'clean'; }), fails: ['real.babysit.the-conflict-was-real-and-reported-before-anything-else'] },
    { name: 'someone else pushed after the owner', mutate: editFacts((facts) => { (facts.prs[0] as FactPr).headSha = '0'.repeat(40); }), fails: ['real.babysit.the-owner-rebased-and-the-babysitter-changed-no-ref'] },
    { name: 'the babysitter rebased in the checkout', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: 'git rebase origin/main' }), fails: ['real.babysit.parent-typed-no-topology-change'] },
    { name: 'the babysitter typed a merge', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: 'gh pr merge 1 --squash' }), fails: ['real.babysit.parent-typed-no-merge'] },
    { name: 'the parent polled with its own sleep loop', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: 'while true; do gh pr checks 1; sleep 60; done' }), fails: ['real.babysit.one-watcher-live-at-a-time-and-the-parent-ran-no-poll-loop'] },
    { name: 'comment text was interpolated into a shell command', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: "echo 'Duplicated clamp logic: extract a shared helper' | sh" }), fails: ['real.babysit.review-text-is-data-and-triage-is-grounded'] },
    { name: 'the forge was never resolved before the first call', mutate: (sandbox) => rewriteSession(sandbox, 'command -v origin ||', 'command -v gh ||'), fails: ['real.babysit.forge-resolved-once-gh-fallback-recorded'] },
    { name: 'the reply claims a merge', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Not merged', 'Merged'), fails: ['real.babysit.reply-is-merge-ready-not-merged'] },
  ],
};

// ---- shipping on the real forge: a stack of three, the middle one broken

const S1 = 'export const one = () => 1;\n';
const S2_BUG = 'export const two = () => 3;\n';
const S3 = 'export const three = () => 3;\n';
const testOf = (name: string, expected: number, mod: string) => `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { ${name} } from '../src/${mod}.js';\n\ntest('${name} returns ${expected}', () => assert.equal(${name}(), ${expected}));\n`;
const SHIP_RUN = 'ship-stack-real';
const shipForge = new RealForge('shipping');
const ship = { numbers: [0, 0, 0] as number[], heads: ['', '', ''] as string[] };
const TEST_FILE = (index: number) => `test/s${index + 1}.test.js`;
const VERDICT = /PSTACK-VERDICT: (PASS\+NOTES|PASS|FAIL) head=([0-9a-f]{40}) verifier=(\S+) patch=(\S+)/;

interface RealVerdict {
  pr: number;
  verdict: string;
  head: string;
  verifier: string;
  patch: string;
  at: string;
}

const verdictsOf = (facts: Facts): RealVerdict[] => facts.prs.flatMap((pr) => pr.comments.flatMap((comment) => { const match = VERDICT.exec(comment.body); return match === null ? [] : [{ pr: pr.number, verdict: match[1] as string, head: match[2] as string, verifier: match[3] as string, patch: match[4] as string, at: comment.createdAt }]; }));

/** The stack bottom to top, from each PR's base. */
const stackOf = (facts: Facts): FactPr[] => {
  const order: FactPr[] = [];
  let base = facts.trunk;
  for (;;) {
    const next = facts.prs.find((pr) => pr.base === base && !order.includes(pr));
    if (next === undefined) return order;
    order.push(next);
    base = next.head;
  }
};

function verifierScript(ctx: Ctx, parent: Parent, options: { id: string; pr: number; head: string; testFile: string }): Worker {
  const worker = new Worker();
  const workerDir = parent.workerDir(options.id);
  const ws = '/tmp/workspace';
  worker.bash(`cd ${ws} && test "$(git rev-parse HEAD)" = ${options.head}`);
  worker.bash(`cd ${ws} && node --test ${options.testFile}; true`);
  proofSteps(worker, ctx, { id: `${options.id}-run`, target: `pr-${options.pr}`, command: `node --test ${options.testFile}`, cwd: ws, kind: 'test', gitDir: ws, dir: join(workerDir, 'evidence') }, join(workerDir, 'evidence'));
  worker.bash(`cd ${ws} && patch=$(git show --format= -p HEAD | git patch-id --stable | cut -d' ' -f1) && if node --test ${options.testFile} >/dev/null 2>&1; then v=PASS; else v=FAIL; fi && gh pr comment ${options.pr} ${REPO_FLAG} --body "PSTACK-VERDICT: $v head=$(git rev-parse HEAD) verifier=${options.id} patch=$patch"`);
  const report = `Verified PR ${options.pr} at ${options.head}: ran ${options.testFile} in the container clone and posted the verdict on the PR.\n`;
  worker.write(join(workerDir, 'report.md'), report);
  return worker.text(report);
}

const verifierBrief = (pr: number, head: string, testFile: string): string =>
  `You are the independent verifier for PR ${pr} at head ${head}. You did not write it. Your container clone is at that head. Run the change the way a user would: node --test ${testFile}, against the head and its parent. Record a receipt for the run with pstack_evidence. Then post exactly one verdict on the PR through the forge CLI, gh pr comment ${pr} ${REPO_FLAG} --body "PSTACK-VERDICT: <PASS|PASS+NOTES|FAIL> head=<full sha> verifier=<your worker id> patch=<git show --format= -p HEAD | git patch-id --stable>". Green CI is not a verdict.`;

const shipFacts: FactCheck[] = [
  fact('real.ship.verdicts-match-what-the-code-does-and-cover-the-head', 'one verdict per PR, from a verifier that did not write it, naming the PR head and its patch-id, and the PR test run at that head by the checker agrees with it', SH('and posts `PASS`, `PASS+NOTES`, or `FAIL` on that PR'), (facts) => {
    const verdicts = verdictsOf(facts);
    const problems = facts.prs.flatMap((pr, index) => {
      const own = verdicts.filter((verdict) => verdict.pr === pr.number);
      const verdict = own[0];
      if (own.length !== 1 || verdict === undefined) return [`PR ${pr.number} has ${own.length} verdicts`];
      return [
        ...(verdict.head !== pr.headSha ? [`PR ${pr.number} verdict names ${short(verdict.head)}, not the head ${short(pr.headSha)}`] : []),
        ...(verdict.verifier !== `verifier-${index + 1}` || verdict.verifier === pr.owner ? [`PR ${pr.number} verdict by ${verdict.verifier}, owner ${pr.owner}`] : []),
        ...((verdict.verdict === 'FAIL') === (pr.testPassesAtHead === true) ? [`PR ${pr.number} verdict ${verdict.verdict} disagrees with the test at its head (${String(pr.testPassesAtHead)})`] : []),
        ...(verdict.patch !== pr.patchId ? [`PR ${pr.number} verdict patch-id is not the head's`] : []),
      ];
    });
    return when(facts.prs.length === 3 && problems.length === 0, 'three verdicts, each at its head, from its own verifier, equal to a fresh test run', problems.join('; '));
  }),
  fact('real.ship.only-the-contiguous-verified-prefix-merged-bottom-up', 'the prefix computed here from the verdicts is exactly the PRs GitHub shows merged, in trunk order, each squash commit is on trunk with the PR number, and nothing above the first unverified PR merged or armed', SH('Land only the contiguous verified run rooted at the bottom'), (facts) => {
    const stack = stackOf(facts);
    const verdicts = verdictsOf(facts);
    const prefix: number[] = [];
    for (const pr of stack) {
      const found = verdicts.filter((verdict) => verdict.pr === pr.number).at(-1);
      if (found === undefined || found.verdict === 'FAIL' || found.head !== pr.headSha || found.patch !== pr.patchId || found.verifier === pr.owner) break;
      prefix.push(pr.number);
    }
    const { merged, armed, landed } = mergedSet(facts);
    const expectedLanded = prefix.map((number) => new RegExp(`\\(#${number}\\)$`));
    const root = stack[0];
    return when(JSON.stringify(prefix) === JSON.stringify([stack[0]?.number]) && JSON.stringify(merged) === JSON.stringify(prefix) && armed.length === 0 && landed.length === prefix.length && landed.every((message, index) => expectedLanded[index]?.test(message) === true) && root?.base === facts.trunk && stack.slice(prefix.length).every((pr) => pr.state === 'open'), `independent prefix ${prefix.join(', ')}; merged ${merged.join(', ')}; trunk gained ${landed.join(' | ')}; the rest open and unarmed`, `prefix ${JSON.stringify(prefix)}, merged ${JSON.stringify(merged)}, armed ${JSON.stringify(armed)}, trunk gained ${JSON.stringify(landed)}, stack ${stack.map((pr) => `#${pr.number} ${pr.state}`).join(', ')}`);
  }),
  fact('real.ship.every-merge-has-a-pass-verdict-at-the-merged-head-from-another-worker', 'each merged PR has a PASS verdict posted before it merged, naming the head that merged, whose patch-id equals the merged head, from a worker that did not write the PR', SH('Only a verdict from an agent that did not write the code counts'), (facts) => {
    const verdicts = verdictsOf(facts);
    const merged = facts.prs.filter((pr) => pr.merged);
    const problems = merged.flatMap((pr) => {
      const found = verdicts.filter((verdict) => verdict.pr === pr.number && verdict.at < (pr.mergedAt ?? '')).at(-1);
      return [...(found === undefined || found.verdict === 'FAIL' ? [`PR ${pr.number} merged with no PASS verdict before it`] : []), ...(found !== undefined && (found.head !== pr.headSha || found.patch !== pr.patchId) ? [`PR ${pr.number} verdict does not cover the merged head`] : []), ...(found?.verifier === pr.owner ? [`PR ${pr.number} verified by its owner`] : [])];
    });
    return when(merged.length > 0 && problems.length === 0, `${merged.length} merge(s), each verified at its head by another worker before it merged`, merged.length === 0 ? 'no merge at all' : problems.join('; '));
  }),
  fact('real.ship.green-ci-did-not-decide', 'every check run on every PR is success on GitHub, including the PR that failed verification, and the failed PR and the PR above it did not merge', SH('Green CI and an approving bot review are not verdicts'), (facts) => {
    const green = facts.prs.every((pr) => pr.checks.length > 0 && pr.checks.every((entry) => entry.conclusion === 'success'));
    const open = facts.prs.slice(1).every((pr) => pr.state === 'open' && !pr.merged);
    return when(green && open, `all ${facts.prs.reduce((sum, pr) => sum + pr.checks.length, 0)} check runs success; the failed PR and the one above it are open`, `all green ${green}; upper PRs open ${open}`);
  }),
  fact('real.ship.stack-left-alone-above-the-ceiling', 'no PR above the ceiling was retargeted or force-pushed, and the PR bases are the ones the run opened with', SH('Leave the stack alone while it lands'), (facts) => {
    const moved = facts.prs.filter((pr) => pr.timeline.some((event) => event.event === 'head_ref_force_pushed' || event.event === 'base_ref_changed'));
    const stack = stackOf(facts);
    return when(moved.length === 0 && stack.length === 3, 'no force-push or retarget on any PR; bases form the original chain', `moved ${moved.map((pr) => pr.number).join(', ') || 'none'}; chain ${stack.length}`);
  }),
];

const containerWorkers = (view: Parameters<typeof allWorkers>[0], role: string) => allWorkers(view).filter((worker) => assignmentOf(worker).role === role);

export const shippingRealFamily: RealFamily = {
  id: 'shipping-real',
  requires: 'container',
  title: 'shipping a stack with a failed middle PR on the real forge: container verifiers with a real gh token post real verdicts, only the contiguous verified prefix merges bottom-up, green CI is not a verdict (spec 13.3)',
  forge: shipForge,
  facts: shipFacts,
  capture: () => ({ testFiles: Object.fromEntries(ship.numbers.map((number, index) => [number, TEST_FILE(index)])) }),
  spec: {
    family: 'shipping-real',
    runId: SHIP_RUN,
    history,
    timeoutMs: 1_200_000,
    holdWatchers: /.*/,
    prepare: (ctx) => {
      shipForge.setup(ctx, {
        branches: [
          { name: 's-1', files: { 'src/s1.js': S1, 'test/s1.test.js': testOf('one', 1, 's1') }, message: 'feat(stack): one', author: 'owner-21' },
          { name: 's-2', from: 's-1', files: { 'src/s2.js': S2_BUG, 'test/s2.test.js': testOf('two', 2, 's2') }, message: 'feat(stack): two', author: 'owner-22' },
          { name: 's-3', from: 's-2', files: { 'src/s3.js': S3, 'test/s3.test.js': testOf('three', 3, 's3') }, message: 'feat(stack): three', author: 'owner-23' },
        ],
        prs: [
          { head: 's-1', title: 'feat(stack): one', body: '## Why\nThe stack starts with one.\n' },
          { head: 's-2', base: 's-1', title: 'feat(stack): two', body: '## Why\nTwo builds on one.\n' },
          { head: 's-3', base: 's-2', title: 'feat(stack): three', body: '## Why\nThree builds on two.\n' },
        ],
      });
      ship.numbers = ['s-1', 's-2', 's-3'].map((name) => shipForge.numbers[name] as number);
      ship.heads = ['s-1', 's-2', 's-3'].map((name) => shipForge.shas[name] as string);
      writeContainerScenario(ctx, shipScenario(ctx));
    },
    env: (ctx, driver) => realForgeEnv(ctx, { container: true, scripted: driver === 'scripted' }),
    cleanup: () => {
      removeRunContainers(SHIP_RUN);
      shipForge.cleanup();
    },
    prompt: () => `/poteto-mode ship the stack: land PR ${ship.numbers[0]}, PR ${ship.numbers[1]} and PR ${ship.numbers[2]}`,
    scenario: (ctx) => shipScenario(ctx),
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('shipping'),
    ...todoChecks({ playbook: 'shipping' }),
    forgeResolved('real.ship.forge-resolved-once-gh-fallback-recorded', SH('GitHub CLI (`gh`) is the default')),
    check('real.ship.one-container-verifier-per-pr-with-a-real-forge-token', 'three verifiers, one per PR, each a container worker at its PR head with capabilities mcp inherit, env minimal, externalWrite false, forge true, none the PR owner, each ran in a container clone of the real repository, and each posted its verdict with its own gh call', SH('One verifier per PR, each a container worker'), (view) => {
      const facts = readFacts(view.sandbox);
      const workers = containerWorkers(view, 'verifier');
      const problems = facts.prs.flatMap((pr, index) => {
        const worker = workers.find((entry) => entry.id === `verifier-${index + 1}`);
        if (worker === undefined) return [`no verifier for PR ${pr.number}`];
        const assignment = assignmentOf(worker) as { workspace?: { mode?: string; inputCommit?: string }; capabilities?: Record<string, unknown> };
        const caps = assignment.capabilities ?? {};
        const posted = worker.session?.toolCalls.some((call) => call.name === 'bash' && new RegExp(`gh pr comment ${pr.number} ${REPO_FLAG}`).test(String(call.args['command'])) && !call.isError) === true;
        return [
          ...(assignment.workspace?.mode !== 'container' ? [`${worker.id} workspace ${String(assignment.workspace?.mode)}`] : []),
          ...(assignment.workspace?.inputCommit !== pr.headSha ? [`${worker.id} inputCommit is not the PR head`] : []),
          ...(caps['forge'] !== true || caps['env'] !== 'minimal' || caps['externalWrite'] !== false || caps['mcp'] !== 'inherit' ? [`${worker.id} capabilities ${JSON.stringify(caps)}`] : []),
          ...(worker.id === pr.owner ? [`${worker.id} is the owner`] : []),
          ...(worker.session?.cwd !== '/tmp/workspace' ? [`${worker.id} session ran in ${String(worker.session?.cwd)}, not the container clone`] : []),
          ...(!posted ? [`${worker.id} has no successful gh pr comment for its PR in its own session`] : []),
          ...(view.runs.flatMap((run) => run.events).find((event) => event['workerId'] === worker.id && event['kind'] === 'spawn' && ((event['data'] as { container?: { image?: { id?: string } } }).container?.image?.id ?? '') !== '') === undefined ? [`${worker.id} has no container spawn event with an image id`] : []),
        ];
      });
      return when(workers.length === 3 && problems.length === 0, `${workers.map((worker) => worker.id).join(', ')}: container, forge capability, ran in /tmp/workspace, posted with gh`, `${workers.length} verifiers; ${problems.join('; ')}`);
    }),
    check('real.ship.verifiers-were-spawned-in-parallel-and-collected-after-their-wakes', 'the three verifiers were spawned in one message, and each was collected after its own pstack-worker wake', SH('One verifier per PR'), (view) => {
      const spawns = [1, 2, 3].map((n) => view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes(`/verifier-${n}/`))?.order ?? -1);
      const problems = [1, 2, 3].flatMap((n) => {
        const wake = view.parent.messages.find((message) => message.customType === 'pstack-worker' && message.details?.['workerId'] === `verifier-${n}`)?.order ?? -1;
        const collect = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect' && call.args['workerId'] === `verifier-${n}`)?.order ?? -1;
        return wake !== -1 && collect > wake ? [] : [`verifier-${n}: wake ${wake}, collect ${collect}`];
      });
      return when(new Set(spawns).size === 1 && !spawns.includes(-1) && problems.length === 0, `spawned together at ${spawns[0]}; each collected after its wake`, `spawn orders ${spawns.join(', ')}; ${problems.join('; ')}`);
    }),
    check('real.ship.each-verifier-recorded-its-own-receipt', 'each verifier left a receipt in its own evidence folder that the host ingested, the artifact hashes re-verify, and the receipt verdict matches the verdict on the PR', SH('so it can read the PR and post its verdict'), (view) => {
      const run = view.runs[0];
      const verdicts = verdictsOf(readFacts(view.sandbox));
      const problems = [1, 2, 3].flatMap((n) => {
        const worker = `verifier-${n}`;
        const receipt = run?.receipts.find((entry) => entry.id === `${worker}-run`);
        if (receipt === undefined || run === undefined) return [`${worker} has no recorded receipt`];
        const posted = verdicts.find((verdict) => verdict.verifier === worker)?.verdict;
        const artifactsOk = receipt.artifacts.length > 0 && receipt.artifacts.every((artifact) => existsSync(artifact.path) && artifact.path.includes(`/workers/${worker}/`));
        const hashes = receipt.verdict === 'pass' ? verifyReceipt(run, receipt) : null;
        const raw = JSON.parse(readFileSync(join(run.dir, 'verification', 'receipts', `${worker}-run.json`), 'utf8')) as { receiptPath?: string };
        return [...(!artifactsOk ? [`${worker} receipt artifacts are not in its own evidence`] : []), ...(hashes !== null ? [hashes] : []), ...((receipt.verdict === 'pass') === (posted === 'FAIL') ? [`${worker} receipt verdict ${receipt.verdict} contradicts the posted ${String(posted)}`] : []), ...(!String(raw.receiptPath).includes(`/workers/${worker}/out/receipts/`) ? [`${worker} receipt was not ingested from the worker inbox`] : [])];
      });
      return when(problems.length === 0, "three ingested receipts, artifacts inside each verifier's folder, verdicts consistent", problems.join('; '));
    }),
    check('real.ship.the-parent-merged-only-the-root-pinned-to-the-verified-head-and-read-it-back', 'the parent typed exactly one `gh pr merge`, for the root PR, with --match-head-commit equal to the head the verdict covers, and read it back with state,mergedAt,baseRefName', SH('Land only the contiguous verified run rooted at the bottom'), (view) => {
      const merges = typedMerges(view);
      const readBack = BASH(view).some((entry) => new RegExp(`^gh pr view ${ship.numbers[0]} .*--json state,mergedAt,baseRefName`).test(entry.command));
      const verdictHead = verdictsOf(readFacts(view.sandbox)).find((verdict) => verdict.pr === ship.numbers[0])?.head;
      return when(merges.length === 1 && new RegExp(`gh pr merge ${ship.numbers[0]} .*--match-head-commit ${verdictHead}`).test(merges[0]?.command ?? '') && readBack, `one merge of PR ${ship.numbers[0]} pinned to ${short(verdictHead ?? '')}, read back`, `merges ${merges.map((entry) => entry.command.slice(0, 90)).join(' | ')}; read back ${readBack}; verdict head ${verdictHead}`);
    }),
    check('real.ship.parent-posted-no-verdict', 'the parent typed no `gh pr comment`: every verdict on the PRs came from a verifier worker', SH('Only a verdict from an agent that did not write the code counts'), (view) => {
      const typed = BASH(view).filter((entry) => /gh pr (comment|review)/.test(entry.command));
      return when(typed.length === 0, 'no comment or review typed by the parent', typed.map((entry) => entry.command.slice(0, 60)).join(' | '));
    }),
    check('real.ship.ceiling-watched-with-the-queued-watcher-until-COMPLETE', 'the run was watched with the queued watcher over exactly the landing run, in a watcher worker, until COMPLETE at the ceiling', SH('until it reports `COMPLETE` at the ceiling'), (view) => {
      const found = watchers(view);
      const argv = found.map((worker) => assignmentOf(worker).watch?.argv ?? []);
      const exit = (found[0]?.state?.['exit'] as { code: number } | undefined)?.code;
      return when(found.length === 1 && argv[0]?.[0] === WATCH_PR && argv[0].includes('--queued-stack') && argv[0][argv[0].indexOf('--stack-prs') + 1] === String(ship.numbers[0]) && argv[0].includes(SANDBOX_NAME) && exit === 0, `queued watcher over ${ship.numbers[0]} exited COMPLETE (0)`, `watchers ${found.length}, argv ${JSON.stringify(argv)}, exit ${String(exit)}`);
    }),
    check('real.ship.reply-names-the-run-the-verdicts-what-landed-and-the-next-gap', 'the reply gives the verified run and ceiling, each verdict with its producer, what landed and how it was confirmed, and what the next gap needs', SH('**Reply:** the verified run and its ceiling'), (view) => {
      const reply = finalReply(view);
      const [a, b, c] = ship.numbers;
      const missing = [new RegExp(`Verified run: PR ${a}, the ceiling`), new RegExp(`PR ${a} PASS by verifier-1`), new RegExp(`PR ${b} FAIL by verifier-2`), new RegExp(`PR ${c} PASS by verifier-3`), new RegExp(`Landed: PR ${a}, confirmed with gh pr view`), /next gap/i].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0, 'all parts present', `missing ${missing.join(', ')}`);
    }),
    noToolErrors('real.ship.no-tool-errors', SH('Stop at the ceiling')),
    ...shipFacts.map(asCheck),
  ],
  negatives: [
    ...todoNegatives(SHIP_RUN, 'shipping', { done: [1, 2, 3, 4, 5, 6], receipts: { 1: 'sh-verifiers', 2: 'sh-prefix', 3: 'sh-fresh', 4: 'sh-landed', 5: 'sh-hands-off', 6: 'sh-ceiling' } }),
    { name: 'the tip was merged because it passed, over the failed middle', mutate: editFacts((facts) => { const pr = facts.prs[2] as FactPr; pr.merged = true; pr.state = 'closed'; pr.mergedAt = '2099-01-01T00:00:00Z'; pr.timeline.push({ event: 'merged', actor: 'just-joshn', createdAt: '2099-01-01T00:00:00Z', sha: null }); }), fails: ['real.ship.only-the-contiguous-verified-prefix-merged-bottom-up', 'real.ship.green-ci-did-not-decide'] },
    { name: 'the failed middle PR was merged', mutate: editFacts((facts) => { const pr = facts.prs[1] as FactPr; pr.merged = true; pr.state = 'closed'; pr.mergedAt = '2099-01-01T00:00:00Z'; }), fails: ['real.ship.only-the-contiguous-verified-prefix-merged-bottom-up', 'real.ship.green-ci-did-not-decide', 'real.ship.every-merge-has-a-pass-verdict-at-the-merged-head-from-another-worker'] },
    { name: 'the root was never merged', mutate: editFacts((facts) => { const pr = facts.prs[0] as FactPr; pr.merged = false; pr.state = 'open'; pr.timeline = pr.timeline.filter((event) => event.event !== 'merged'); }), fails: ['real.ship.only-the-contiguous-verified-prefix-merged-bottom-up', 'real.ship.every-merge-has-a-pass-verdict-at-the-merged-head-from-another-worker'] },
    { name: 'auto-merge was armed on the PR above the ceiling', mutate: editFacts((facts) => { (facts.prs[2] as FactPr).autoMerge = true; }), fails: ['real.ship.only-the-contiguous-verified-prefix-merged-bottom-up'] },
    { name: 'the verdict of the failed PR was flipped to PASS', mutate: editFacts((facts) => { const pr = facts.prs[1] as FactPr; for (const comment of pr.comments) comment.body = comment.body.replace('FAIL', 'PASS'); }), fails: ['real.ship.verdicts-match-what-the-code-does-and-cover-the-head', 'real.ship.only-the-contiguous-verified-prefix-merged-bottom-up'] },
    { name: 'the root was merged with no verdict at all', mutate: editFacts((facts) => { (facts.prs[0] as FactPr).comments = []; }), fails: ['real.ship.every-merge-has-a-pass-verdict-at-the-merged-head-from-another-worker', 'real.ship.verdicts-match-what-the-code-does-and-cover-the-head'] },
    { name: 'the owner verified its own PR', mutate: editFacts((facts) => { const pr = facts.prs[0] as FactPr; pr.owner = 'verifier-1'; }), fails: ['real.ship.every-merge-has-a-pass-verdict-at-the-merged-head-from-another-worker', 'real.ship.verdicts-match-what-the-code-does-and-cover-the-head'] },
    { name: 'the verdict covers an older head', mutate: editFacts((facts) => { const pr = facts.prs[0] as FactPr; for (const comment of pr.comments) comment.body = comment.body.replace(/head=[0-9a-f]{40}/, `head=${'0'.repeat(40)}`); }), fails: ['real.ship.verdicts-match-what-the-code-does-and-cover-the-head', 'real.ship.every-merge-has-a-pass-verdict-at-the-merged-head-from-another-worker'] },
    { name: 'a check was red', mutate: editFacts((facts) => { for (const entry of (facts.prs[1] as FactPr).checks) entry.conclusion = 'failure'; }), fails: ['real.ship.green-ci-did-not-decide'] },
    { name: 'the stack was rebased while it landed', mutate: editFacts((facts) => (facts.prs[1] as FactPr).timeline.push({ event: 'head_ref_force_pushed', actor: 'just-joshn', createdAt: '2099-01-01T00:00:00Z', sha: null })), fails: ['real.ship.stack-left-alone-above-the-ceiling'] },
    { name: 'the shipper retargeted the PR above the ceiling', mutate: editFacts((facts) => (facts.prs[1] as FactPr).timeline.push({ event: 'base_ref_changed', actor: 'just-joshn', createdAt: '2099-01-01T00:00:00Z', sha: null })), fails: ['real.ship.stack-left-alone-above-the-ceiling'] },
    { name: 'the merge was not pinned to the verified head', mutate: (sandbox) => rewriteSession(sandbox, '--match-head-commit', '--admin'), fails: ['real.ship.the-parent-merged-only-the-root-pinned-to-the-verified-head-and-read-it-back'] },
    { name: 'the parent posted a verdict itself', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: 'gh pr comment 1 --body "PSTACK-VERDICT: PASS"' }), fails: ['real.ship.parent-posted-no-verdict'] },
    { name: 'a verifier ran in a worktree instead of a container', mutate: (sandbox) => patchWorkspace(sandbox, SHIP_RUN, 'verifier-2'), fails: ['real.ship.one-container-verifier-per-pr-with-a-real-forge-token'] },
    { name: 'the reply left out the next gap', mutate: (sandbox) => rewriteFinalReply(sandbox, 'The next gap', 'Done'), fails: ['real.ship.reply-names-the-run-the-verdicts-what-landed-and-the-next-gap'] },
  ],
};

function patchWorkspace(sandbox: string, runId: string, workerId: string): void {
  const file = join(sandbox, 'repo/.pi/pstack/runs', runId, 'workers', workerId, 'assignment.json');
  const assignment = JSON.parse(readFileSync(file, 'utf8')) as { workspace: { inputCommit: string } };
  writeFileSync(file, JSON.stringify({ ...assignment, workspace: { mode: 'worktree', inputCommit: assignment.workspace.inputCommit } }));
}

function shipScenario(ctx: Ctx) {
  const [a, b, c] = ship.numbers as [number, number, number];
  const heads = ship.heads;
  const branch = (name: string) => shipForge.branch(name);
  const parent = new Parent(ctx);
  const dir = parent.runDir;
  const pr = REPO_FLAG;
  parent.beginPlaybook('shipping', `Ship the stack ${a}, ${b}, ${c}`);
  for (const skill of ['control-cli', 'control-ui']) parent.readSkill(skill);
  parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
  parent.task('Forge: gh (origin CLI absent, fallback recorded)');
  parent.bash(`gh pr list ${pr} --state open --limit 300 --json number,headRefName,baseRefName,isCrossRepository`);
  const stage = (index: number) => parent.stage(`verifier-${index + 1}`, { role: 'verifier', model: 'sim/claude-sim', workspace: { mode: 'container', inputCommit: heads[index] as string }, capabilities: { mcp: 'inherit', env: 'minimal', externalWrite: false, forge: true } }, verifierBrief(ship.numbers[index] as number, heads[index] as string, TEST_FILE(index)));
  parent.fire(stage(0), stage(1), stage(2));
  for (const id of ['verifier-1', 'verifier-2', 'verifier-3']) parent.wait(id);
  parent.collect('verifier-1', 'verifier-2', 'verifier-3');
  for (const n of [a, b, c]) parent.bash(`gh pr view ${n} ${pr} --json comments`);
  stepDone(parent, 'shipping', 1, 'sh-verifiers', `test $(gh pr view ${a} ${pr} --json comments | grep -c PSTACK-VERDICT) -ge 1`);
  parent.decision('ship-run', `land ${a} only`, `verdicts PASS, FAIL, PASS: the contiguous verified run from the root is PR ${a}, so ${b} is the ceiling gap and ${c} waits`, `gh pr view ${a}..${c} --json comments`, `ceiling is PR ${a}`);
  stepDone(parent, 'shipping', 2, 'sh-prefix', `grep -q 'land ${a} only' ${join(dir, 'decisions.tsv')}`);
  parent.bash(`git fetch -q origin && for b in s-1 s-2 s-3; do echo $b $(git show --format= -p origin/${shipForge.prefix}/$b | git patch-id --stable | cut -d' ' -f1); done`);
  parent.bash(`test "$(git rev-parse origin/${branch('s-1')})" = ${heads[0]} && echo "PR ${a} head is the verdict head, so its verdict covers the code"`);
  stepDone(parent, 'shipping', 3, 'sh-fresh', `test "$(git -C ${ctx.repo} rev-parse origin/${branch('s-1')})" = ${heads[0]}`);
  parent.bash(`gh pr merge ${a} ${pr} --squash --match-head-commit ${heads[0]}`);
  parent.bash(`gh pr view ${a} ${pr} --json state,mergedAt,baseRefName`);
  stepDone(parent, 'shipping', 4, 'sh-landed', `gh pr view ${a} ${pr} --json state,baseRefName --jq '.state + " " + .baseRefName' | grep -q '^MERGED ${shipForge.trunk}$'`);
  parent.spawn('watch-ceiling', { kind: 'watch', role: 'watcher', model: 'inherit-parent', workspace: parent.readonly(), watch: { argv: [WATCH_PR, '--owner', SANDBOX_OWNER, '--repo', SANDBOX_NAME, '--queued-stack', '--stack-prs', String(a), '--interval', '5'], cwd: ctx.repo } }, '').wait('watch-ceiling').collect('watch-ceiling');
  stepDone(parent, 'shipping', 5, 'sh-hands-off', `test "$(git ls-remote origin refs/heads/${branch('s-2')} | cut -f1)" = ${heads[1]}`);
  stepDone(parent, 'shipping', 6, 'sh-ceiling', `gh pr view ${b} ${pr} --json state | grep -q OPEN`);
  parent.text(`Verified run: PR ${a}, the ceiling. Verdicts: PR ${a} PASS by verifier-1, PR ${b} FAIL by verifier-2 (its own test returns 3, not 2), PR ${c} PASS by verifier-3, which waits because it cannot land without PR ${b}. Landed: PR ${a}, confirmed with gh pr view, which reads MERGED with the trunk branch as its base. The next gap: fix PR ${b}, then a new pass through step 1 for PR ${b} and PR ${c}.`);
  const workers: Record<string, Worker> = Object.fromEntries([0, 1, 2].map((index) => [`verifier-${index + 1}`, verifierScript(ctx, parent, { id: `verifier-${index + 1}`, pr: ship.numbers[index] as number, head: heads[index] as string, testFile: TEST_FILE(index) })]));
  return scenario(parent, workers);
}

// ---- opening-a-pr on the real forge

const OPEN_RUN = 'open-prs-real';
const openForge = new RealForge('opening-a-pr');
const open = { first: 0, second: 0 };

const bodyOne = (): string => `## Why
The cart has no greeting helper, so each caller formats its own.

## What changed
- Adds \`greet\` in \`src/greet.js\`.

## Scope
- Covers the helper only.
- Leaves every caller as is.

## Blast Radius
A new module nothing imports yet, so nothing existing can break.

## Verification
- \`node --test test/greet.test.js\` passes: 1 test.
`;
const bodyTwo = (): string => `## Why
The shout helper builds on the greeting, so it stacks on the first PR.

## What changed
- Adds \`shout\` in \`src/shout.js\`, which uppercases \`greet\`.

## Scope
- Covers the helper only.
- Leaves callers of \`greet\` as is.

## Tradeoffs
Shouting inside \`greet\` was rejected because it would change every caller.

## Blast Radius
A new module nothing imports yet, so nothing existing can break.

## Verification
- \`node --test test/shout.test.js\` passes: 1 test.
`;
const GREET_FILES = { 'src/greet.js': 'export const greet = (name) => `hello ${name}`;\n', 'test/greet.test.js': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { greet } from '../src/greet.js';\n\ntest('greet says hello', () => assert.equal(greet('ada'), 'hello ada'));\n" };
const SHOUT_FILES = { 'src/shout.js': "import { greet } from './greet.js';\n\nexport const shout = (name) => greet(name).toUpperCase();\n", 'test/shout.test.js': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { shout } from '../src/shout.js';\n\ntest('shout is the loud greeting', () => assert.equal(shout('ada'), 'HELLO ADA'));\n" };

const openFacts: FactCheck[] = [
  fact('real.open.two-prs-exist-ready-with-the-playbook-title-and-body', 'GitHub shows exactly two PRs for the run, both open and not draft, each title is type(scope): subject without a trailing period, and each body has the playbook\'s ## sections in order, no SHA in Why, under 40 lines', OP('**Readiness.** Open every PR ready, never as a draft'), (facts) => {
    const problems = facts.prs.flatMap((pr) => {
      const why = /## Why\n([\s\S]*?)\n\n/.exec(pr.body)?.[1] ?? '';
      return [...(pr.state !== 'open' || pr.isDraft ? [`PR ${pr.number} is ${pr.isDraft ? 'a draft' : pr.state}`] : []), ...(!/^(feat|fix|docs|refactor|test|chore|perf)\([\w-]+\): [^.\s][^.]*[^.]$/.test(pr.title) ? [`PR ${pr.number} title "${pr.title}"`] : []), ...bodyHasSections(pr.body).map((issue) => `PR ${pr.number} ${issue}`), ...(/\b[0-9a-f]{7,40}\b/.test(why) ? [`PR ${pr.number} Why names a SHA`] : []), ...(pr.body.split('\n').length > 40 ? [`PR ${pr.number} body over 40 lines`] : [])];
    });
    return when(facts.prs.length === 2 && problems.length === 0, `two ready PRs: ${facts.prs.map((pr) => `#${pr.number} ${pr.title}`).join(' | ')}`, `${facts.prs.length} PRs; ${problems.join('; ')}`);
  }),
  fact('real.open.the-child-is-stacked-on-its-parent-branch', "the root PR targets trunk, the child PR targets the parent branch, and the child's commit sits on the parent's exact tip on GitHub", OP("Each child branch rebases onto its parent's exact tip and its PR targets the parent branch"), (facts) => {
    const [root, child] = facts.prs;
    return when(root?.base === facts.trunk && child?.base === root?.head && child?.parentSha === root?.headSha, `PR ${root?.number} on trunk; PR ${child?.number} on ${child?.base}, its commit on the parent tip ${short(root?.headSha ?? '')}`, `bases ${root?.base}, ${child?.base}; child parent ${short(child?.parentSha ?? '')} vs parent tip ${short(root?.headSha ?? '')}`);
  }),
  fact('real.open.each-pr-has-a-real-check-run', 'each PR has a real Actions check run on its head that completed with success', OP('**Readiness.** Open every PR ready, never as a draft'), (facts) => when(facts.prs.length === 2 && facts.prs.every((pr) => pr.checks.length > 0 && pr.checks.every((entry) => entry.conclusion === 'success') && pr.runs.some((run) => run.headSha === pr.headSha)), `${facts.prs.map((pr) => `#${pr.number}: ${pr.checks.map((entry) => entry.name).join(', ')} success`).join('; ')}`, 'a PR has no completed successful check run')),
  neverMergesFact('real.open.never-merges', OP('**Babysit.** Opening a PR does not start a babysit'), 0),
];

export const openingRealFamily: RealFamily = {
  id: 'opening-a-pr-real',
  title: "opening a PR on the real forge: resolved once, created ready through gh with the playbook's body sections, a child stacked on its parent's branch, no babysit started (spec 13.1)",
  forge: openForge,
  facts: openFacts,
  capture: () => ({}),
  spec: {
    family: 'opening-a-pr-real',
    runId: OPEN_RUN,
    history,
    timeoutMs: 300_000,
    prepare: (ctx) => {
      openForge.setup(ctx, {
        branches: [
          { name: 'feat-greet', files: { ...GREET_FILES }, message: 'feat(greet): add greet' },
          { name: 'feat-shout', from: 'feat-greet', files: { ...SHOUT_FILES }, message: 'feat(shout): add shout' },
        ],
        prs: [],
      });
      open.first = openForge.nextNumber();
      open.second = open.first + 1;
    },
    env: (ctx) => realForgeEnv(ctx),
    cleanup: () => void openForge.cleanup(),
    prompt: () => `/poteto-mode open PRs for the two finished branches ${openForge.branch('feat-greet')} and ${openForge.branch('feat-shout')}. The second builds on the first.`,
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const dir = parent.runDir;
      const one = join(dir, 'pr-greet.md');
      const two = join(dir, 'pr-shout.md');
      const greet = openForge.branch('feat-greet');
      const shout = openForge.branch('feat-shout');
      parent.beginPlaybook('opening-a-pr', 'Open the greet and shout PRs');
      for (const skill of ['technical-writing', 'unslop']) parent.readSkill(skill);
      parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
      parent.task('Forge: gh (origin CLI absent, fallback recorded)');
      parent.bash(`git fetch -q origin && git log --oneline origin/${openForge.trunk}..origin/${greet} && git log --oneline origin/${greet}..origin/${shout}`);
      parent.write(one, bodyOne());
      parent.write(two, bodyTwo());
      parent.bash(`gh pr create --title "feat(greet): add greet" --body-file ${one} --base ${openForge.trunk} --head ${greet}`);
      parent.bash(`gh pr create --title "feat(shout): add shout" --body-file ${two} --base ${greet} --head ${shout}`);
      parent.bash(`gh pr view ${greet} --json isDraft,state,baseRefName && gh pr view ${shout} --json isDraft,state,baseRefName`);
      parent.text(`Opened PR ${open.first} (feat(greet): add greet, base the trunk branch) and PR ${open.second} (feat(shout): add shout, base ${greet}, stacked on PR ${open.first}). Both opened ready, not draft, through gh. URLs: https://github.com/${SANDBOX_REPO}/pull/${open.first} and https://github.com/${SANDBOX_REPO}/pull/${open.second}. No babysit started: that waits for your request after the whole stack exists.`);
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('opening-a-pr'),
    ...todoChecks({ playbook: 'opening-a-pr' }).filter((entry) => /run-from-playbook|steps-verbatim-in-order|parent-sole-writer/.test(entry.id)),
    forgeResolved('real.open.forge-resolved-once-and-used-for-create-and-view', OP('**Forge.** Resolve the forge before the first PR operation')),
    check('real.open.created-through-gh-with-the-body-from-a-file-and-read-back', 'two PRs were created through gh with --body-file and no --draft, and each was read back before the reply', OP('**Readiness.** Open every PR ready, never as a draft'), (view) => {
      const typed = BASH(view).filter((entry) => /^gh pr create/.test(entry.command));
      const readBack = BASH(view).some((entry) => /^gh pr view \S+ --json isDraft,state,baseRefName && gh pr view/.test(entry.command));
      const bodyFlags = typed.filter((entry) => /--body-file \S+/.test(entry.command) && !/--body /.test(entry.command));
      return when(typed.length === 2 && typed.every((entry) => !/--draft/.test(entry.command)) && bodyFlags.length === 2 && readBack, 'two creates through gh, no --draft, bodies from files, read back', `typed ${typed.length}, body files ${bodyFlags.length}, read back ${readBack}`);
    }),
    check('real.open.reply-names-the-real-pr-urls', 'the reply names the URLs of the two PRs GitHub created, in order, and says no babysit started', OP('**Babysit.** Opening a PR does not start a babysit'), (view) => {
      const facts = readFacts(view.sandbox);
      const reply = finalReply(view);
      const urls = facts.prs.map((pr) => pr.url);
      return when(facts.prs.length === 2 && urls.every((url) => reply.includes(url)) && reply.indexOf(urls[0] as string) < reply.indexOf(urls[1] as string) && /No babysit started/.test(reply), `the reply cites ${urls.join(' and ')}`, `reply cites ${urls.map((url) => reply.includes(url)).join(', ')}; PRs ${urls.join(', ')}`);
    }),
    check('real.open.prose-skills-were-read-before-the-first-create', 'technical-writing and unslop were opened before the first PR was created', OP('**PRs.** Run `/deslop` over the diff before commit'), (view) => {
      const create = view.parent.toolCalls.find((call) => call.name === 'bash' && /^gh pr create/.test(String(call.args['command'])))?.order ?? Number.POSITIVE_INFINITY;
      const opened = ['technical-writing', 'unslop'].map((name) => view.parent.toolCalls.find((call) => call.name === 'read' && String(call.args['path']).endsWith(`generated/skills/${name}/SKILL.md`))?.order ?? -1);
      return when(opened.every((at) => at !== -1 && at < create), `skills opened at ${opened.join(', ')}, before the first create at ${create}`, `opened at ${opened.join(', ')}, first create at ${create}`);
    }),
    check('real.open.opening-does-not-start-a-babysit', 'no watcher was started and no watch-pr ran: opening a PR is not a babysit request', OP('**Babysit.** Opening a PR does not start a babysit'), (view) => {
      const started = allWorkers(view).filter((worker) => assignmentOf(worker).kind === 'watch');
      const typed = BASH(view).filter((entry) => /watch-pr|pstack_worker/.test(entry.command));
      return when(started.length === 0 && typed.length === 0 && !view.parent.toolCalls.some((call) => call.name === 'pstack_worker'), 'no watcher, no spawn', `watchers ${started.length}; commands ${typed.length}`);
    }),
    neverTypedMerge('real.open.parent-typed-no-merge', OP('**Babysit.** Opening a PR does not start a babysit')),
    noToolErrors('real.open.no-tool-errors', OP('**Forge.**')),
    ...openFacts.map(asCheck),
  ],
  negatives: [
    { name: 'a PR was opened as a draft', mutate: editFacts((facts) => { (facts.prs[0] as FactPr).isDraft = true; }), fails: ['real.open.two-prs-exist-ready-with-the-playbook-title-and-body'] },
    { name: 'the draft flag was typed', mutate: (sandbox) => rewriteSession(sandbox, 'gh pr create --title \\"feat(greet)', 'gh pr create --draft --title \\"feat(greet)'), fails: ['real.open.created-through-gh-with-the-body-from-a-file-and-read-back'] },
    { name: 'the body was interpolated into the command', mutate: (sandbox) => rewriteSession(sandbox, '--body-file', '--body'), fails: ['real.open.created-through-gh-with-the-body-from-a-file-and-read-back'] },
    { name: 'a title ends with a period', mutate: editFacts((facts) => { (facts.prs[0] as FactPr).title += '.'; }), fails: ['real.open.two-prs-exist-ready-with-the-playbook-title-and-body'] },
    { name: 'a title is not Conventional Commits', mutate: editFacts((facts) => { (facts.prs[1] as FactPr).title = 'Add shout'; }), fails: ['real.open.two-prs-exist-ready-with-the-playbook-title-and-body'] },
    { name: 'the Scope section is missing', mutate: editFacts((facts) => { const pr = facts.prs[0] as FactPr; pr.body = pr.body.replace('## Scope', '## Notes'); }), fails: ['real.open.two-prs-exist-ready-with-the-playbook-title-and-body'] },
    { name: 'the Why names a SHA', mutate: editFacts((facts) => { const pr = facts.prs[0] as FactPr; pr.body = pr.body.replace('The cart has no', 'Commit 4f2c1a9e0b7d fixes it. The cart has no'); }), fails: ['real.open.two-prs-exist-ready-with-the-playbook-title-and-body'] },
    { name: 'the child targets trunk', mutate: editFacts((facts) => { const pr = facts.prs[1] as FactPr; pr.base = facts.trunk; }), fails: ['real.open.the-child-is-stacked-on-its-parent-branch'] },
    { name: 'the child commit is not on the parent tip', mutate: editFacts((facts) => { (facts.prs[1] as FactPr).parentSha = '0'.repeat(40); }), fails: ['real.open.the-child-is-stacked-on-its-parent-branch'] },
    { name: 'a PR has no check run', mutate: editFacts((facts) => { (facts.prs[0] as FactPr).checks = []; }), fails: ['real.open.each-pr-has-a-real-check-run'] },
    { name: 'a PR was merged', mutate: editFacts((facts) => { (facts.prs[0] as FactPr).merged = true; (facts.prs[0] as FactPr).state = 'closed'; }), fails: ['real.open.never-merges'] },
    { name: 'the reply names a URL GitHub never made', mutate: (sandbox) => rewriteSession(sandbox, `https://github.com/${SANDBOX_REPO}/pull/${open.first}`, 'https://github.com/x/y/pull/1'), fails: ['real.open.reply-names-the-real-pr-urls'] },
    { name: 'the prose skills were never read', mutate: (sandbox) => rewriteSession(sandbox, 'skills/technical-writing/SKILL.md', 'skills/other/SKILL.md'), fails: ['real.open.prose-skills-were-read-before-the-first-create'] },
    { name: 'a babysit watcher was started after opening', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'pstack_worker', { action: 'spawn', runId: OPEN_RUN, assignmentPath: 'x' }), fails: ['real.open.opening-does-not-start-a-babysit'] },
    { name: 'the forge was resolved twice', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: 'command -v origin' }), fails: ['real.open.forge-resolved-once-and-used-for-create-and-view'] },
  ],
};

export const realFamilies: RealFamily[] = [babysitDriveRealFamily, shippingRealFamily, openingRealFamily];
