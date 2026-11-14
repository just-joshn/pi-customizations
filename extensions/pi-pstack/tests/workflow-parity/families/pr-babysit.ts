// Babysit families (spec 13.2): each request-to-mode row, GitHub against Origin, the conflict-threads-CI order, one fresh
// build for a verified flake, WAITING with merge-queue, one watcher at a time, and no merge because checks are green.
// Every run drives the real pi binary against the fake forge in fixtures/forge.ts.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario } from '../fixtures/dsl.ts';
import { type ChaosStep, editForge, type ForgeAction, type ForgeHandle, type ForgeState, forgeEnv, readForge, setupForge, WATCH_PR, watchVerdict } from '../fixtures/forge.ts';
import { CART_JS, cartHistory } from '../fixtures/repos.ts';
import { check, checkAbsence, src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, callsInTurn, finalReply, noToolErrors, playbookReads, primaryRun, promptRoutes, todoChecks } from '../lib/checks.ts';
import type { Ctx } from '../lib/driver.ts';
import { appendToolCall, parentSession, patchAssignment, rewriteFinalReply } from '../lib/mutate.ts';
import { babysitRestartFamilies } from './pr-babysit-restart.ts';
import { BASH, declaredMode, exitCodeOf, forgeResolvedOnce, lifeOf, modeDeclared, neverMerges, neverMutatesTopology, REPO_FLAGS, REPO_SLUG, replyMentions, sourceLookup, stepDone, watchers } from './pr-shared.ts';
import { todoNegatives } from './shared.ts';
import type { Family } from './types.ts';

const BS = (anchor: string) => src('poteto-mode/playbooks/babysit.md', anchor);
const billingThread = (state: ForgeState) => state.prs['13']?.threads.find((thread) => thread.comments.some((comment) => /negative\s+couponPercent/i.test(comment.body)));
const ownerRebasePending = (state: ForgeState, actions: ForgeAction[]): boolean => state.prs['12']?.mergeable === 'CONFLICTING' && !actions.some((action) => ['reply', 'resolve', 'rerun'].includes(action.kind));
const TRIAGE = (anchor: string) => src('poteto-mode/references/bugbot-triage.md', anchor);

const CLAMP = 'return roundCents(amount - (amount * percent) / 100);';
const CAPPED_CART = CART_JS.replace(CLAMP, 'const capped = Math.min(percent, 100);\n  return roundCents(amount - (amount * capped) / 100);');
const TRUNK_CART = CART_JS.replace(CLAMP, `${CLAMP} // percent off`);
const RESOLVED_CART = CART_JS.replace(CLAMP, 'const capped = Math.min(percent, 100);\n  return roundCents(amount - (amount * capped) / 100); // percent off');
const CAP_TEST = "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { applyCoupon } from '../src/cart.js';\n\ntest('a coupon over 100 percent never pays the customer', () => assert.equal(applyCoupon(10, 150), 0));\n";

const watchAssignment = (ctx: Ctx, parent: Parent, args: string[]) => ({ kind: 'watch' as const, role: 'watcher', model: 'inherit-parent', workspace: parent.readonly(), watch: { argv: [WATCH_PR, ...args, '--interval', '0.3'], cwd: ctx.repo } });
const observedWatcher = (view: Parameters<typeof watchers>[0], pr: string) => {
  const candidates = view.runs.flatMap((run) => run.workers.map((worker) => ({ ...worker, runId: run.id }))).filter((worker) => {
    const argv = assignmentOf(worker).watch?.argv ?? [];
    return (worker.state?.['kind'] ?? worker.assignment['kind']) === 'watch' && (pr === '51,52' ? argv[argv.indexOf('--stack-prs') + 1] === pr : argv[argv.indexOf('--pr') + 1] === pr);
  });
  const worker = candidates[0];
  if (candidates.length !== 1 || worker === undefined) throw new Error(`expected one watcher for ${pr}; candidates: ${candidates.map((entry) => `${entry.runId}/${entry.id}`).join(', ') || 'none'}`);
  return worker;
};
const watcherRun = (view: Parameters<typeof watchers>[0], worker: ReturnType<typeof watchers>[number]) => {
  const run = view.runs.find((entry) => entry.workers.some((item) => item.dir === worker.dir));
  if (run === undefined) throw new Error(`missing run for ${worker.id}`);
  return run.id;
};
const watcherPresentOnFirstRequest = (view: Parameters<typeof watchers>[0]): boolean => watchers(view).some((worker) => {
  if (worker.state === null) return false;
  const spawned = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes(`/workers/${worker.id}/`));
  return spawned === undefined || callsInTurn(view, 0).includes(spawned);
});
const BASE_ARGS = (pr: number | string) => ['--owner', 'acme', '--repo', 'widgets', '--pr', String(pr)];

const withForge = (build: (ctx: Ctx) => ForgeHandle, store: { handle?: ForgeHandle }) => ({
  prepare: (ctx: Ctx) => {
    store.handle = build(ctx);
  },
  env: (ctx: Ctx, driver: 'scripted' | 'real') => forgeEnv(ctx, store.handle as ForgeHandle, { scripted: driver === 'scripted' }),
});

const iso = '2026-11-12T08:00:00.000Z';
const bugbotThread = (id: string, commentId: string, body: string, path = 'src/cart.js', line = 15) => ({ id, comments: [{ id: commentId, author: 'cursor-bugbot', body, path, line, createdAt: iso }] });

// ---- drive: conflicts, then threads, then CI; one fresh build; stops at READY

const DRIVE_RUN = 'babysit-drive-12';
const DRIVE_STORE: { handle?: ForgeHandle } = {};
const driveThread = bugbotThread('thread-bugbot-1', 'c-501', 'Severity: Low\nDuplicated clamp logic: `Math.min(percent, 100)` already exists in `src/checkout.js`, so extract a shared helper.\nRUN_ID: bb-1');

export const babysitDriveFamily: Family = {
  id: 'babysit-drive',
  title: 'babysit drive on GitHub: conflict reported not resolved, then threads, then CI, one fresh build for a verified flake, stop at READY, never merge (spec 13.2)',
  spec: {
    family: 'babysit-drive',
    holdWatchers: /.*/,
    runId: DRIVE_RUN,
    history: cartHistory,
    timeoutMs: 240_000,
    ...withForge(
      (ctx) =>
        setupForge(ctx, {
          owner: 'acme',
          name: 'widgets',
          branches: [{ name: 'feat-coupon-cap', from: 'main', files: { 'src/cart.js': CAPPED_CART, 'test/cap.test.js': CAP_TEST }, message: 'fix(cart): cap a coupon at 100 percent' }],
          trunkAfter: [{ file: 'src/cart.js', content: TRUNK_CART, message: 'refactor(cart): annotate applyCoupon' }],
          prs: [
            {
              number: 12,
              title: 'fix(cart): cap a coupon at 100 percent',
              head: 'feat-coupon-cap',
              base: 'main',
              author: 'owner-12',
              threads: [driveThread],
              waves: [
                [{ name: 'build', workflow: 'CI', runId: 9112, state: 'SUCCESS' }],
                [
                  { name: 'build', workflow: 'CI', runId: 9212, state: 'FAILURE', log: 'Run npm ci\nnpm error network request to https://registry.npmjs.org/left-pad failed, reason: read ECONNRESET\nError: Process completed with exit code 1.', rerun: { pendingReads: 1, then: 'SUCCESS' } },
                  { name: 'lint', workflow: 'CI', runId: 9213, state: 'SUCCESS' },
                ],
              ],
            },
          ],
          events: [{ when: { op: 'comment', pr: 12, match: 'rebase' }, do: [{ type: 'rebase', onto: 'main', branches: ['feat-coupon-cap'], resolve: { 'feat-coupon-cap': { file: 'src/cart.js', content: RESOLVED_CART } } } as ChaosStep] }],
        }),
      DRIVE_STORE,
    ),
    prompt: () => '/poteto-mode babysit PR 12 and get it green',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const todo = join(parent.runDir, 'TODO.md');
      const dir = parent.runDir;
      const pr = REPO_FLAGS;
      parent.beginPlaybook('babysit', 'Babysit PR 12');
      parent.readReference('poteto-mode', 'bugbot-triage.md');
      parent.task('Mode: drive (babysit PR 12 and get it green)');
      parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
      parent.task('Forge: gh (origin CLI absent, fallback recorded)');
      stepDone(parent, 'babysit', 1, 'bs-mode', `! command -v origin && grep -q 'Mode: drive' ${todo}`);
      parent.bash(`gh pr view 12 ${pr} --json number,state,baseRefName,headRefName`);
      stepDone(parent, 'babysit', 2, 'bs-frontier', `gh pr view 12 ${pr} --json state | grep -q OPEN`);
      parent.bash(`grep -rl watch-pr ${ctx.repo}/.pi/pstack/runs/*/workers/*/assignment.json 2>/dev/null || echo "no other babysitter on PR 12"`);
      stepDone(parent, 'babysit', 3, 'bs-single', `test -z "$(grep -rl watch-pr ${ctx.repo}/.pi/pstack/runs/*/workers/*/assignment.json 2>/dev/null)"`);
      const arm = (id: string) => parent.spawn(id, watchAssignment(ctx, parent, BASE_ARGS(12)), '').wait(id).collect(id);
      arm('watch-1');
      parent.bash(`${WATCH_PR} ${BASE_ARGS(12).join(' ')} --status-only --pretty`);
      const report = join(dir, 'conflict-report.md');
      parent.write(report, 'babysit: PR 12 conflicts with main in src/cart.js. The owner of branch feat-coupon-cap needs to rebase it onto main and publish with --force-with-lease.\nDrift sweep: main changed applyCoupon, so check its callers in src/checkout.js in the same wave.\n');
      parent.bash(`gh pr comment 12 ${pr} --body-file ${report}`);
      parent.bash(`git fetch -q origin && git log --oneline -3 origin/feat-coupon-cap`);
      arm('watch-2');
      parent.bash(`${WATCH_PR} ${BASE_ARGS(12).join(' ')} --status-only --pretty`);
      parent.bash(`git grep -n "Math.min" origin/feat-coupon-cap -- src || true`);
      const payload = join(dir, 'reply-c-501.json');
      parent.write(payload, `${JSON.stringify({ body: 'Dismissed: git grep for Math.min under src/ finds one clamp, in src/cart.js. src/checkout.js has none and calls total(), so there is no duplicate to extract.' })}\n`);
      parent.bash(`gh api --method POST repos/${REPO_SLUG}/pulls/12/comments/c-501/replies --input ${payload}`);
      parent.bash(`gh api graphql -f query='mutation($t: ID!) { resolveReviewThread(input: {threadId: $t}) { thread { id } } }' -f t=thread-bugbot-1`);
      parent.decision('bugbot-triage', 'dismiss thread-bugbot-1', 'claimed duplicate clamp does not exist: git grep finds Math.min only in src/cart.js', 'git grep -n Math.min origin/feat-coupon-cap -- src', 'dismissed with the disproof on the thread');
      arm('watch-3');
      parent.bash(`gh pr checks 12 ${pr} || true`);
      parent.bash(`gh run view 9212 ${pr} --log-failed`);
      parent.bash('git merge-base --is-ancestor origin/main origin/feat-coupon-cap && echo "base is current, so the failure is not a stale base"');
      parent.bash(`gh run rerun 9212 ${pr}`);
      arm('watch-4');
      parent.bash(`cat ${join(dir, 'decisions.tsv')}`);
      stepDone(parent, 'babysit', 4, 'bs-topology', `test "$(git -C ${ctx.repo} rev-parse HEAD)" = ${ctx.base}`);
      stepDone(parent, 'babysit', 5, 'bs-order', `grep -c watch ${join(dir, 'events.jsonl')}`);
      stepDone(parent, 'babysit', 6, 'bs-ready', `gh pr checks 12 ${pr} | grep -q pass`);
      stepDone(parent, 'babysit', 7, 'bs-ci', `gh run view 9212 ${pr} --log-failed | grep -q ECONNRESET`);
      stepDone(parent, 'babysit', 8, 'bs-bugbot', `grep -q bugbot-triage ${join(dir, 'decisions.tsv')}`);
      stepDone(parent, 'babysit', 9, 'bs-human', `! gh pr view 12 ${pr} --json state | grep -q MERGED`);
      parent.text('Mode: drive. Forge: gh, origin CLI absent. PR 12 is merge-ready: the watcher reached READY at the current head. Conflict: reported to the owner, who rebased; I did not. Thread: bugbot duplicate-clamp claim dismissed with a git grep disproof. CI: one infrastructure flake, source verified (ECONNRESET, current base), one fresh build. Not merged: merging is Shipping, on your request.');
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('babysit'),
    ...todoChecks({ playbook: 'babysit' }),
    modeDeclared('babysit.mode-declared-from-the-request', BS('Declare the mode and resolve the forge before any poll'), 'drive'),
    forgeResolvedOnce('babysit.forge-resolved-once-gh-fallback-recorded', BS('GitHub CLI (`gh`) is the default'), 'gh'),
    check('babysit.one-babysitter-checked-before-start', 'before the first watcher is armed the parent looked for another watcher on the stack', BS('One babysitter per stack'), (view) => {
      const looked = BASH(view).find((entry) => /grep .*watch-pr .*assignment\.json/.test(entry.command))?.order ?? -1;
      const first = Math.min(...watchers(view).map((worker) => view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes(`/workers/${worker.id}/`))?.order ?? Number.POSITIVE_INFINITY));
      return when(looked !== -1 && looked < first, `looked for a competing babysitter at ${looked}, before the first watcher spawn at ${first}`, `search at ${looked}, first spawn at ${first}`);
    }),
    check('babysit.watchers-are-watch-pr-workers', 'each watcher is a kind:watch worker with role watcher, the absolute watch-pr path as argv[0], the PR in its args, no --status-only, and the absolute repository root as cwd', BS('Run `drive` and `background` under a watch loop'), (view) => {
      const found = watchers(view);
      const problems = found.flatMap((worker) => {
        const assignment = assignmentOf(worker);
        const argv = assignment.watch?.argv ?? [];
        const bad = [assignment.role !== 'watcher' ? 'role' : '', argv[0] !== WATCH_PR ? 'argv[0]' : '', !argv.includes('--pr') || argv[argv.indexOf('--pr') + 1] !== '12' ? '--pr 12' : '', argv.includes('--status-only') ? '--status-only' : '', assignment.watch?.cwd !== view.repo ? 'cwd' : ''].filter(Boolean);
        return bad.length === 0 ? [] : [`${worker.id}: ${bad.join(', ')}`];
      });
      return when(found.length >= 1 && problems.length === 0, `${found.length} watchers, each watch-pr --pr 12 at ${view.repo}`, problems.join('; ') || 'no watcher');
    }),
    check('babysit.verdicts-arrive-conflicts-then-threads-then-ci', "the watchers' exit codes are watch-pr's verdict classes in the playbook's order: 2 merge-conflicts, 3 review-threads, 4 failing-checks, then 0 READY", BS('Order is conflicts, then review threads, then CI'), (view) => {
      const codes = watchers(view).map(exitCodeOf);
      return when(JSON.stringify(codes) === JSON.stringify([2, 3, 4, 0]), `watch-pr exits ${codes.join(', ')}`, `watch-pr exits ${JSON.stringify(codes)}`);
    }),
    check('babysit.one-watcher-live-at-a-time-rearmed-after-each-verdict', 'by the host timeline no two watchers were live at once, each was armed after the previous one ended, none after READY, and the parent ran no second sleep loop', BS('Rearm the watcher after every push wave and every verdict you act on'), (view) => {
      const lives = watchers(view).map((worker) => ({ id: worker.id, ...lifeOf(view, worker.id) }));
      const overlap = lives.filter((life, index) => index > 0 && (life.spawn < (lives[index - 1] as { end: number }).end || life.spawn === -1));
      const loops = BASH(view).filter((entry) => /\bsleep\b|while true|watch -n/.test(entry.command));
      const last = watchers(view).at(-1);
      return when(lives.length >= 2 && overlap.length === 0 && loops.length === 0 && last !== undefined && exitCodeOf(last) === 0, `${lives.length} watchers, strictly sequential in events.jsonl, the last ended READY, no sleep loop`, `overlapping: ${overlap.map((life) => life.id).join(', ') || 'none'}; sleep loops ${loops.length}; last exit ${last === undefined ? 'n/a' : String(exitCodeOf(last))}`);
    }),
    check('babysit.conflict-is-reported-before-anything-else', 'the conflict is reported to the owner with the branch, requested rebase and drift sweep, before any thread or CI action', BS('A conflict is the one blocker you report rather than resolve'), (view) => {
      const { actions } = readForge(view);
      const report = actions.findIndex((action) => action.kind === 'comment' && action.pr === 12 && /rebase/.test(String(action['body'])) && /feat-coupon-cap/.test(String(action['body'])) && /[Dd]rift sweep/.test(String(action['body'])));
      const later = actions.findIndex((action) => ['reply', 'resolve', 'rerun'].includes(action.kind));
      const rebase = actions.findIndex((action) => action.kind === 'force-push');
      const message = view.parent.messages.find((entry) => entry.role === 'assistant' && /conflict/i.test(entry.text) && /feat-coupon-cap|PR\s*#?12/i.test(entry.text) && /rebase/i.test(entry.text) && /drift sweep/i.test(entry.text));
      const laterCall = BASH(view).find((entry) => /run rerun|replies|resolveReviewThread/.test(entry.command));
      const commentReported = report !== -1 && (later === -1 || report < later);
      const directlyReported = message !== undefined && (later === -1 || (laterCall !== undefined && message.order < laterCall.order));
      return when(commentReported || directlyReported, `owner notified by comment at action ${report} or assistant message ${message?.order}; later work ${later}`, `report ${report}, assistant report ${message?.order}, later work ${later} at tool ${laterCall?.order}; rebase ${rebase}`);
    }),
    neverMutatesTopology('babysit.never-mutates-stack-topology', BS('Never mutate stack topology')),
    check('babysit.threads-before-ci', 'the thread reply and resolve happen before the CI rerun', BS('Order is conflicts, then review threads, then CI'), (view) => {
      const { state, actions } = readForge(view);
      if (ownerRebasePending(state, actions)) return { inconclusive: 'the owner has not cleared the conflict; neither thread handling nor CI was reached' };
      const reply = actions.findIndex((action) => action.kind === 'reply');
      const resolve = actions.findIndex((action) => action.kind === 'resolve');
      const rerun = actions.findIndex((action) => action.kind === 'rerun');
      return when(reply !== -1 && resolve > reply && rerun > resolve, `reply ${reply}, resolve ${resolve}, rerun ${rerun}`, `reply ${reply}, resolve ${resolve}, rerun ${rerun}`);
    }),
    check('babysit.flake-verified-in-source-then-exactly-one-fresh-build', 'the failing run log and the base were read before one whole-run rerun, with no job retry and no second rerun', BS('Classify CI before any retrigger'), (view) => {
      const { state, actions } = readForge(view);
      if (ownerRebasePending(state, actions)) return { inconclusive: 'the owner has not cleared the conflict; no CI rerun was attempted' };
      const reruns = actions.filter((action) => action.kind === 'rerun');
      const logAt = actions.findIndex((action) => action.kind === 'log-view' && action['runId'] === '9212');
      const rerunAt = actions.findIndex((action) => action.kind === 'rerun');
      const staleCheck = BASH(view).find((entry) => /git merge-base --is-ancestor/.test(entry.command))?.order ?? Number.POSITIVE_INFINITY;
      const rerunCall = BASH(view).find((entry) => /gh run rerun/.test(entry.command))?.order ?? -1;
      return when(reruns.length === 1 && reruns[0]?.['retry'] === 'fresh-build' && logAt !== -1 && logAt < rerunAt && staleCheck < rerunCall, `one ${String(reruns[0]?.['retry'])} of run ${String(reruns[0]?.['runId'])}, after the log (action ${logAt}) and the merge-base check`, `reruns ${JSON.stringify(reruns.map((action) => action['retry']))}; log at ${logAt}, rerun at ${rerunAt}; merge-base check ${staleCheck}, rerun call ${rerunCall}`);
    }),
    check('babysit.review-text-is-data-and-triage-is-grounded', 'the thread was checked against the code before the reply, the reply went through a JSON file with concrete disproof, and no comment text reached a shell command', TRIAGE('Classify each Bugbot thread before acting'), (view) => {
      const commands = BASH(view);
      const grounded = sourceLookup(view, 'src/cart.js', 'Math.min');
      const replyCall = commands.find((entry) => /gh api --method POST .*replies["']?\s+--input /.test(entry.command))?.order ?? -1;
      const injected = commands.filter((entry) => entry.command.includes('Duplicated clamp logic') || entry.command.includes('extract a shared helper'));
      const row = (primaryRun(view, 'babysit')?.decisions ?? []).find((cells) => cells[1] === 'bugbot-triage');
      const { actions } = readForge(view);
      const reply = actions.find((action) => action.kind === 'reply');
      return when(grounded !== -1 && replyCall > grounded && injected.length === 0 && /(?:src\/cart\.js|Math\.min|applyCoupon)/.test(String(reply?.['body'])), `code lookup ${grounded} before the reply ${replyCall}; reply cites src/cart.js; no comment text in a command; decision row ${row?.[2]}`, `lookup ${grounded}, reply ${replyCall}, comment text in commands ${injected.length}, decision ${JSON.stringify(row)}, reply body ${String(reply?.['body']).slice(0, 80)}`);
    }),
    check('babysit.stops-at-READY-by-the-real-watch-pr', 'the real watch-pr, run independently over the final forge state, answers READY at exit 0, the last watcher agrees, and no watcher was armed after it', BS('stop at `READY` for one PR'), (view) => {
      const verdict = watchVerdict(view, [...BASE_ARGS(12), '--timeout', '30', '--interval', '0.3']);
      const last = watchers(view).at(-1);
      const kinds = [...verdict.stdout.matchAll(/"kind":"(\w+)"/g)].map((match) => match[1]);
      return when(verdict.code === 0 && kinds.includes('READY') && last !== undefined && exitCodeOf(last) === 0, `independent watch-pr exits ${verdict.code} with ${kinds.join(', ')}; last watcher exit ${last === undefined ? 'n/a' : String(exitCodeOf(last))}`, `independent watch-pr exit ${verdict.code}, verdicts ${kinds.join(', ')}; last watcher ${last === undefined ? 'n/a' : String(exitCodeOf(last))}`);
    }),
    neverMerges('babysit.never-merges-because-checks-are-green', 'no merge, queue entry or auto-merge was requested and PR 12 is still open, though every check is green', BS('Babysitting never authorizes merging')),
    check('babysit.reply-is-merge-ready-not-merged', 'the reply says the PR is merge-ready, that nothing merged, and that landing is Shipping', BS('Stop at the human'), (view) => {
      const reply = finalReply(view);
      return when(/merge-ready/.test(reply) && /Not merged/i.test(reply) && /Shipping/.test(reply) && declaredMode(view) === 'drive', 'merge-ready, not merged, Shipping', `reply: ${reply.slice(0, 160)}`);
    }),
    noToolErrors('babysit.no-tool-errors', BS('Trust the active forge')),
  ],
  negatives: [
    ...todoNegatives(DRIVE_RUN, 'babysit', { done: [1, 2, 3, 4, 5, 6, 7, 8, 9], receipts: { 1: 'bs-mode', 2: 'bs-frontier', 3: 'bs-single', 4: 'bs-topology', 5: 'bs-order', 6: 'bs-ready', 7: 'bs-ci', 8: 'bs-bugbot', 9: 'bs-human' } }),
    { name: 'the babysitter merged because every check was green', mutate: (sandbox) => editForge(sandbox, (actions, state) => { actions.push({ kind: 'merge', tool: 'gh', pr: 12, worker: '', run: '', actor: '', container: false }); (state.prs['12'] as { state: string }).state = 'MERGED'; }), fails: ['babysit.never-merges-because-checks-are-green'] },
    { name: 'the babysitter queued the PR for auto-merge', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'auto-merge', tool: 'gh', pr: 12, worker: '', run: '', actor: '', container: false })), fails: ['babysit.never-merges-because-checks-are-green'] },
    { name: 'the babysitter force-pushed the branch itself', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'force-push', ref: 'refs/heads/feat-coupon-cap', worker: '', run: '', actor: '', container: false } as ForgeAction)), fails: ['babysit.never-mutates-stack-topology'] },
    { name: 'the babysitter retargeted the PR', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'edit-base', tool: 'gh', pr: 12, worker: '', run: '', actor: '', container: false })), fails: ['babysit.never-mutates-stack-topology'] },
    { name: 'the babysitter rebased in the checkout', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: 'git rebase origin/main' }), fails: ['babysit.never-mutates-stack-topology'] },
    { name: 'a second fresh build was requested', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'rerun', tool: 'gh', pr: 12, runId: '9212', retry: 'fresh-build', worker: '', run: '', actor: '', container: false })), fails: ['babysit.flake-verified-in-source-then-exactly-one-fresh-build'] },
    { name: 'the flake was retried as a single job', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'rerun') action['retry'] = 'job-retry'; })), fails: ['babysit.flake-verified-in-source-then-exactly-one-fresh-build'] },
    { name: 'the build was retried without reading the log', mutate: (sandbox) => editForge(sandbox, (actions) => actions.splice(0, actions.length, ...actions.filter((action) => action.kind !== 'log-view'))), fails: ['babysit.flake-verified-in-source-then-exactly-one-fresh-build'] },
    { name: 'CI was handled before the review thread', mutate: (sandbox) => editForge(sandbox, (actions) => { const at = actions.findIndex((action) => action.kind === 'rerun'); const [rerun] = actions.splice(at, 1); actions.unshift(rerun as ForgeAction); }), fails: ['babysit.threads-before-ci', 'babysit.conflict-is-reported-before-anything-else'] },
    { name: 'the conflict was never reported to the owner', mutate: (sandbox) => editForge(sandbox, (actions) => actions.splice(0, actions.length, ...actions.filter((action) => action.kind !== 'comment'))), fails: ['babysit.conflict-is-reported-before-anything-else'] },
    { name: 'the watchers ended in the wrong order', mutate: (sandbox, view) => watchers(view).slice(0, 2).forEach((worker, index) => patchWatcherExit(sandbox, watcherRun(view, worker), worker.id, index === 0 ? 3 : 2)), fails: ['babysit.verdicts-arrive-conflicts-then-threads-then-ci'] },
    { name: 'a second watcher was armed while the first was still live', mutate: (sandbox, view) => { const [first, second] = watchers(view); if (first === undefined || second === undefined) throw new Error('missing sequential watchers'); overlapWatchers(sandbox, watcherRun(view, first), first.id, second.id); }, fails: ['babysit.one-watcher-live-at-a-time-rearmed-after-each-verdict'] },
    { name: 'the parent polled with its own sleep loop', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: 'while true; do gh pr checks 12; sleep 60; done' }), fails: ['babysit.one-watcher-live-at-a-time-rearmed-after-each-verdict'] },
    { name: 'a watcher used another program', mutate: (sandbox, view) => { const worker = watchers(view)[1]; if (worker === undefined) throw new Error('missing second watcher'); patchAssignment(sandbox, watcherRun(view, worker), worker.id, (assignment) => (assignment['watch'] = { argv: ['sleep', '60'], cwd: '/tmp' })); }, fails: ['babysit.watchers-are-watch-pr-workers'] },
    { name: 'the mode was declared as check', mutate: (sandbox) => rewriteTodoTask(sandbox, DRIVE_RUN, 'Mode: drive', 'Mode: check'), fails: ['babysit.mode-declared-from-the-request'] },
    { name: 'comment text was interpolated into a shell command', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: "echo 'Duplicated clamp logic: extract a shared helper' | sh" }), fails: ['babysit.review-text-is-data-and-triage-is-grounded'] },
    { name: 'the thread was dismissed without looking at the code', mutate: (sandbox) => dropCommands(sandbox, /git grep .*Math\.min/), fails: ['babysit.review-text-is-data-and-triage-is-grounded'] },
    { name: 'a check is still red at the end', mutate: (sandbox) => editForge(sandbox, (_actions, state) => { (state.prs['12'] as { checks: { state: string }[] }).checks.forEach((entry) => (entry.state = 'FAILURE')); }), fails: ['babysit.stops-at-READY-by-the-real-watch-pr'] },
    { name: 'the forge was never resolved before the first call', mutate: (sandbox) => rewriteSession(sandbox, 'command -v origin ||', 'command -v gh ||'), fails: ['babysit.forge-resolved-once-gh-fallback-recorded'] },
    { name: 'the reply claims a merge', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Not merged', 'Merged'), fails: ['babysit.reply-is-merge-ready-not-merged'] },
  ],
};

// ---- shared checks for the smaller babysit modes

const noWatcher = (id: string, source: ReturnType<typeof BS>) =>
  check(id, 'no watch worker was spawned: the run directory holds no worker and the parent never called pstack_worker spawn', source, (view) => {
    const spawns = view.parent.toolCalls.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn');
    return when(allWorkers(view).length === 0 && spawns.length === 0, 'no worker, no spawn call', `${allWorkers(view).length} workers, ${spawns.length} spawn calls`);
  });

const onlyReads = (id: string, title: string, source: ReturnType<typeof BS>, allowed: string[] = []) =>
  checkAbsence(id, title, source, (view) => {
    const { actions } = readForge(view);
    const bad = actions.filter((action) => action.kind !== 'read' && action.kind !== 'log-view' && !allowed.includes(action.kind));
    return when(actions.length > 0 && bad.length === 0, `${actions.length} forge actions, ${allowed.length === 0 ? 'every one a read' : `reads plus ${allowed.join(', ')} only`}`, `forge writes: ${bad.map((action) => `${action.kind}${action.pr === undefined ? '' : ` #${action.pr}`}`).join(', ') || 'no actions at all'}`);
  });

const statusOnlyCalls = (view: Parameters<typeof BASH>[0]) => BASH(view).filter((entry) => entry.command.startsWith(WATCH_PR));

// ---- check: one status pass, no watcher (also the docs-only routing)

interface StatusOnly {
  id: string;
  runId: string;
  prompt: string;
  why: string;
}

const CHECK_STORE: { handle?: ForgeHandle } = {};
const README_TEXT = '# cart\n\nTotals a shopping cart.\n\nCoupons take a percent off the subtotal, and a coupon over 100 percent is capped at the subtotal. That sentence is intentionally longer than the lint limit so the docs lint complains about it.\n';

function statusOnlyFamily(options: StatusOnly): Family {
  const store: { handle?: ForgeHandle } = options.id === 'babysit-check' ? CHECK_STORE : {};
  return {
    id: options.id,
    title: `babysit check mode (${options.why}): one status pass with watch-pr --status-only, no watcher, no forge write (spec 13.2)`,
    spec: {
      family: options.id,
      runId: options.runId,
      history: cartHistory,
      timeoutMs: 120_000,
      ...withForge(
        (ctx) =>
          setupForge(ctx, {
            owner: 'acme',
            name: 'widgets',
            branches: [{ name: 'docs-readme', from: 'main', files: { 'README.md': README_TEXT }, message: 'docs: describe the coupon cap' }],
            prs: [{ number: 14, title: 'docs: describe the coupon cap', head: 'docs-readme', base: 'main', author: 'owner-14', threads: [bugbotThread('thread-docs-1', 'c-601', 'Severity: Low\nThe README sentence is long.\nRUN_ID: bb-14', 'README.md', 3)], waves: [[{ name: 'build', workflow: 'CI', runId: 9114, state: 'SUCCESS' }, { name: 'docs-lint', workflow: 'CI', runId: 9115, state: 'FAILURE', log: 'README.md:4 MD013 line too long' }]] }],
          }),
        store,
      ),
      prompt: () => options.prompt,
      scenario: (ctx) => {
        const parent = new Parent(ctx);
        const todo = join(parent.runDir, 'TODO.md');
        const mode = 'check';
        const skip = 'check is one status pass and a report, so it fixes, retries and watches nothing';
        parent.beginPlaybook('babysit', 'Babysit PR 14 (check)');
        parent.task(`Mode: ${mode} (${options.why})`);
        parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
        parent.task('Forge: gh (origin CLI absent, fallback recorded)');
        stepDone(parent, 'babysit', 1, 'bc-mode', `! command -v origin && grep -q 'Mode: ${mode}' ${todo}`);
        for (const n of [2, 3, 4, 5]) parent.skip('babysit', n, skip);
        parent.bash(`${WATCH_PR} ${BASE_ARGS(14).join(' ')} --status-only --pretty`);
        stepDone(parent, 'babysit', 6, 'bc-status', `${WATCH_PR} ${BASE_ARGS(14).join(' ')} --status-only | grep -q STATUS`);
        for (const n of [7, 8]) parent.skip('babysit', n, skip);
        stepDone(parent, 'babysit', 9, 'bc-human', `! gh pr view 14 ${REPO_FLAGS} --json state | grep -q MERGED`);
        parent.text('Mode: check, one status pass and no watcher. PR 14: the docs-lint check is failing, build passes, one bugbot thread is open, no conflict. Nothing was changed and nothing merged. Say "drive" to babysit it.');
        return scenario(parent);
      },
    },
    checks: [
      promptRoutes('poteto-mode'),
      ...playbookReads('babysit'),
      ...todoChecks({ playbook: 'babysit', skipReason: { 2: /status/, 3: /status/, 4: /status/, 5: /status/, 7: /status/, 8: /status/ } }),
      modeDeclared('babysit.check.mode-declared-from-the-request', BS('Declare the mode and resolve the forge before any poll'), 'check'),
      forgeResolvedOnce('babysit.check.forge-resolved-once-gh-fallback-recorded', BS('GitHub CLI (`gh`) is the default'), 'gh'),
      noWatcher('babysit.check.starts-no-watcher', BS('`check` is one status pass and a report')),
      check('babysit.check.one-status-only-pass-by-watch-pr', 'the status came from one direct watch-pr run with --status-only, never the polling form', BS('In `check` mode pass `--status-only`'), (view) => {
        const calls = statusOnlyCalls(view);
        return when(calls.length === 1 && calls.every((entry) => entry.command.includes('--status-only')), 'one watch-pr --status-only run', `${calls.length} direct watch-pr runs: ${calls.map((entry) => entry.command.slice(-40)).join(' | ')}`);
      }),
      onlyReads('babysit.check.touches-nothing', 'the forge saw reads only: no comment, reply, rerun, ref update or merge', BS('`check` is one status pass and a report'), []),
      neverMerges('babysit.check.never-merges', 'nothing merged, queued or auto-merged', BS('Babysitting never authorizes merging')),
      replyMentions('babysit.check.reply-reports-the-status', 'the reply reports the failing check, the open thread and that nothing changed or merged', BS('`check` is one status pass and a report'), [{ name: 'the failing docs-lint check', pattern: /docs-lint.*failing/i }, { name: 'the open thread', pattern: /thread/i }, { name: 'nothing changed or merged', pattern: /Nothing was changed and nothing merged/ }]),
      noToolErrors('babysit.check.no-tool-errors', BS('Trust the active forge')),
    ],
    negatives: [
      ...todoNegatives(options.runId, 'babysit', { done: [1, 6, 9], receipts: { 1: 'bc-mode', 6: 'bc-status', 9: 'bc-human' } }),
      { name: 'a watcher was started for a check', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'pstack_worker', { action: 'spawn', runId: options.runId, assignmentPath: `${sandbox}/repo/.pi/pstack/runs/${options.runId}/workers/watch-1/assignment.json` }), fails: ['babysit.check.starts-no-watcher'] },
      { name: 'a worker directory exists for a check', mutate: (sandbox) => patchWatcherDir(sandbox, options.runId), fails: ['babysit.check.starts-no-watcher'] },
      { name: 'the status pass polled until a verdict', mutate: (sandbox) => rewriteSession(sandbox, '--status-only --pretty', '--pretty'), fails: ['babysit.check.one-status-only-pass-by-watch-pr'] },
      { name: 'a second status pass ran', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: `${WATCH_PR} --pr 14 --status-only` }), fails: ['babysit.check.one-status-only-pass-by-watch-pr'] },
      { name: 'the check replied on a thread', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'reply', tool: 'gh', pr: 14, worker: '', run: '', actor: '', container: false })), fails: ['babysit.check.touches-nothing'] },
      { name: 'the check re-ran a build', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'rerun', tool: 'gh', pr: 14, runId: '9115', retry: 'fresh-build', worker: '', run: '', actor: '', container: false })), fails: ['babysit.check.touches-nothing'] },
      { name: 'the check merged the PR', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'merge', tool: 'gh', pr: 14, worker: '', run: '', actor: '', container: false })), fails: ['babysit.check.never-merges'] },
      { name: 'the mode was declared as drive', mutate: (sandbox) => rewriteTodoTask(sandbox, options.runId, 'Mode: check', 'Mode: drive'), fails: ['babysit.check.mode-declared-from-the-request'] },
      { name: 'the reply hid the failing check', mutate: (sandbox) => rewriteFinalReply(sandbox, 'the docs-lint check is failing', 'everything looks fine'), fails: ['babysit.check.reply-reports-the-status'] },
    ],
  };
}

function patchWatcherDir(sandbox: string, runId: string): void {
  const dir = join(sandbox, 'repo/.pi/pstack/runs', runId, 'workers/watch-1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'assignment.json'), JSON.stringify({ schemaVersion: 1, runId, workerId: 'watch-1', kind: 'watch', role: 'watcher', model: 'inherit-parent', thinkingLevel: null, workspace: { mode: 'readonly', path: join(sandbox, 'repo') }, skills: [], watch: { argv: [WATCH_PR], cwd: join(sandbox, 'repo') } }));
}

export const babysitCheckFamily = statusOnlyFamily({ id: 'babysit-check', runId: 'babysit-check-14', prompt: '/poteto-mode check on PR 14, is it green?', why: 'request: check on X' });
export const babysitDocsOnlyFamily = statusOnlyFamily({ id: 'babysit-docs-only', runId: 'babysit-docs-14', prompt: '/poteto-mode babysit PR 14, it only changes the README', why: 'docs-only PR gets check, not drive' });

// ---- threads-only: answer review comments, touch nothing else

const THREADS_RUN = 'babysit-threads-13';
const THREADS_STORE: { handle?: ForgeHandle } = {};
const CHECKOUT_COMMENTED = "import { total } from './cart.js';\nimport { formatMoney } from './money.js';\n\n// checkout applies the coupon through total()\nexport function checkout(items, couponPercent = 0) {\n  const amount = total(items, couponPercent);\n  return { amount, label: formatMoney(amount) };\n}\n";
const THREAD_A = bugbotThread('thread-a', 'c-701', 'Severity: Medium\ncheckout() drops couponPercent, so a coupon is never applied at checkout.\nRUN_ID: bb-13', 'src/checkout.js', 5);
const THREAD_B = bugbotThread('thread-b', 'c-702', 'Severity: High\nA negative couponPercent raises the billed amount: validate it before charging.\nRUN_ID: bb-13', 'src/cart.js', 12);

export const babysitThreadsOnlyFamily: Family = {
  id: 'babysit-threads-only',
  title: 'babysit threads-only: a disproved comment is dismissed with the evidence, a billing finding is asked about, and nothing else is touched (spec 13.2)',
  spec: {
    family: 'babysit-threads-only',
    runId: THREADS_RUN,
    history: cartHistory,
    timeoutMs: 120_000,
    ...withForge(
      (ctx) =>
        setupForge(ctx, {
          owner: 'acme',
          name: 'widgets',
          branches: [{ name: 'feat-checkout-note', from: 'main', files: { 'src/checkout.js': CHECKOUT_COMMENTED }, message: 'docs(checkout): note the coupon path' }],
          prs: [{ number: 13, title: 'docs(checkout): note the coupon path', head: 'feat-checkout-note', base: 'main', author: 'owner-13', threads: [THREAD_A, THREAD_B], waves: [[{ name: 'build', workflow: 'CI', runId: 9113, state: 'FAILURE', log: 'flaky', rerun: { pendingReads: 1, then: 'SUCCESS' } }]] }],
        }),
      THREADS_STORE,
    ),
    prompt: () => '/poteto-mode address the bugbot comments on PR 13',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const dir = parent.runDir;
      const skip = 'threads-only answers review comments and touches nothing else';
      parent.beginPlaybook('babysit', 'Babysit PR 13 (threads-only)');
      parent.readReference('poteto-mode', 'bugbot-triage.md');
      parent.task('Mode: threads-only (address the bugbot comments on PR 13)');
      parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
      parent.task('Forge: gh (origin CLI absent, fallback recorded)');
      stepDone(parent, 'babysit', 1, 'bt-mode', `! command -v origin && grep -q 'Mode: threads-only' ${join(dir, 'TODO.md')}`);
      for (const n of [2, 3]) parent.skip('babysit', n, skip);
      stepDone(parent, 'babysit', 4, 'bt-topology', `test "$(git -C ${ctx.repo} rev-parse HEAD)" = ${ctx.base}`);
      parent.skip('babysit', 5, skip);
      parent.skip('babysit', 6, skip);
      parent.skip('babysit', 7, skip);
      parent.bash(`gh api graphql -f query='query ReviewThreads($owner: String!, $repo: String!, $pr: Int!, $after: String) { repository(owner: $owner, name: $repo) { pullRequest(number: $pr) { reviewThreads(first: 100, after: $after) { nodes { id isResolved comments(first: 10) { nodes { body path line author { login } } } } } } } }' -f owner=acme -f repo=widgets -F pr=13`);
      parent.bash(`git fetch -q origin && git grep -n "total(items, couponPercent)" origin/feat-checkout-note -- src/checkout.js`);
      const payload = join(dir, 'reply-c-701.json');
      parent.write(payload, `${JSON.stringify({ body: 'Dismissed: src/checkout.js line 7 calls total(items, couponPercent), so the coupon is applied. git grep on the PR head shows the call.' })}\n`);
      parent.bash(`gh api --method POST repos/${REPO_SLUG}/pulls/13/comments/c-701/replies --input ${payload}`);
      parent.bash(`gh api graphql -f query='mutation($t: ID!) { resolveReviewThread(input: {threadId: $t}) { thread { id } } }' -f t=thread-a`);
      parent.decision('bugbot-triage', 'dismiss thread-a', 'src/checkout.js passes couponPercent to total(), disproving the claim', 'git grep -n "total(items, couponPercent)" origin/feat-checkout-note', 'dismissed with the disproof on the thread');
      parent.decision('bugbot-triage', 'ask thread-b', 'a billing finding is ask-by-default in the rubric, and the code does not clamp a negative percent', 'src/cart.js applyCoupon', 'left open, asked the user');
      stepDone(parent, 'babysit', 8, 'bt-bugbot', `grep -c bugbot-triage ${join(dir, 'decisions.tsv')}`);
      stepDone(parent, 'babysit', 9, 'bt-human', `! gh pr view 13 ${REPO_FLAGS} --json state | grep -q MERGED`);
      parent.text('Mode: threads-only. thread-a (checkout drops couponPercent) is dismissed: src/checkout.js passes it to total(), with the git grep on the thread. thread-b is a billing finding, a negative couponPercent raises the amount, and the rubric says ask. Question: should I fix thread-b in PR 13 or open a follow-up PR? I changed nothing else and merged nothing.');
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('babysit'),
    ...todoChecks({ playbook: 'babysit', skipReason: { 2: /threads|single PR|no stack/i, 3: /threads|single babysitter|no stack/i, 5: /threads|no CI/i, 6: /threads|no CI/i, 7: /threads|no CI/i } }),
    modeDeclared('babysit.threads.mode-declared-from-the-request', BS('Declare the mode and resolve the forge before any poll'), 'threads-only'),
    forgeResolvedOnce('babysit.threads.forge-resolved-once-gh-fallback-recorded', BS('GitHub CLI (`gh`) is the default'), 'gh'),
    noWatcher('babysit.threads.starts-no-watcher', BS('`threads-only` answers review comments and touches nothing else')),
    check('babysit.threads.touches-only-threads', 'the forge saw only review-thread replies and resolutions of disproved findings: no CI action, no comment, no ref update, no merge', BS('`threads-only` answers review comments and touches nothing else'), (view) => {
      const { state, actions } = readForge(view);
      const writes = actions.filter((action) => !['read', 'log-view'].includes(action.kind));
      const kinds = writes.map((action) => action.kind).sort();
      const ask = billingThread(state);
      return when(writes.every((action) => action.kind === 'reply' || (action.kind === 'resolve' && action['thread'] !== ask?.id)),  `writes: ${kinds.join(', ')}`, `writes: ${writes.map((action) => `${action.kind}${action.pr === undefined ? '' : ` #${action.pr}`}`).join(', ') || 'none'}`);
    }),
    check('babysit.threads.dismissal-grounded-and-the-ask-left-open', 'the disproved thread got a reply that cites the code and was resolved after a code lookup; the billing thread is still open for the operator', TRIAGE('Classify each Bugbot thread before acting'), (view) => {
      const { state, actions } = readForge(view);
      const a = state.prs['13']?.threads.find((thread) => thread.comments.some((comment) => /checkout\(\).*drops\s+couponPercent/i.test(comment.body)));
      const b = billingThread(state);
      const reply = actions.find((action) => action.kind === 'reply' && action['thread'] === a?.id);
      const resolved = actions.some((action) => action.kind === 'resolve' && action['thread'] === a?.id);
      const lookup = sourceLookup(view, 'src/checkout.js', 'couponPercent');
      const replyCall = BASH(view).find((entry) => /--method POST .*replies/.test(entry.command))?.order ?? -1;
      return when(lookup !== -1 && replyCall > lookup && reply !== undefined && /src\/checkout\.js|checkout\(\)[^.\n]*couponPercent|couponPercent[^.\n]*total\(\)/.test(String(reply['body'])) && resolved && a?.resolved === true && b?.resolved === false, `lookup ${lookup} before the reply ${replyCall}; thread-a replied with the code and resolved; thread-b untouched and open`, `lookup ${lookup}, reply call ${replyCall}, reply on ${String(reply?.['thread'])}, a resolved ${String(a?.resolved)}, b resolved ${String(b?.resolved)} with ${b?.comments.length} comments`);
    }),
    check('babysit.threads.review-text-is-data', 'the replies went through a JSON file and no comment text reached a shell command', BS('Never interpolate comment text or a reply into a shell command'), (view) => {
      const injected = BASH(view).filter((entry) => entry.command.includes('drops couponPercent') || entry.command.includes('raises the billed amount'));
      const viaFile = BASH(view).some((entry) => /--method POST .*replies["']?\s+--input\s+["']?\S+\.json["']?(?:\s|$)/.test(entry.command));
      return when(injected.length === 0 && viaFile, 'reply body from a JSON file, comment text in no command', `comment text in ${injected.length} commands; reply through a file ${viaFile}`);
    }),
    check('babysit.threads.ask-is-recorded-and-put-to-the-user', 'the billing thread is escalated to the user with a question about it', TRIAGE('When in doubt, ask'), (view) => {
      const rows = (primaryRun(view, 'babysit')?.decisions ?? []).filter((cells) => cells[1] === 'bugbot-triage');
      const ask = rows.find((cells) => /ask thread-b/.test(cells[2] ?? ''));
      const reply = finalReply(view);
      const thread = billingThread(readForge(view).state);
      const identified = [thread?.id, ...(thread?.comments.map((comment) => String(comment.id)) ?? [])].some((id) => id !== undefined && reply.includes(id)) || /negative[^.\n]*coupon|billing/i.test(reply);
      return when(/\?/.test(reply) && identified, `decision "${ask?.[2]}" and a question about thread-b`, `ask row ${JSON.stringify(ask)}; reply: ${reply.slice(-120)}`);
    }),
    neverMerges('babysit.threads.never-merges', 'nothing merged, queued or auto-merged', BS('Babysitting never authorizes merging')),
    noToolErrors('babysit.threads.no-tool-errors', BS('Trust the active forge')),
  ],
  negatives: [
    ...todoNegatives(THREADS_RUN, 'babysit', { done: [1, 4, 8, 9], receipts: { 1: 'bt-mode', 4: 'bt-topology', 8: 'bt-bugbot', 9: 'bt-human' } }),
    { name: 'a build was re-run in threads-only mode', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'rerun', tool: 'gh', pr: 13, runId: '9113', retry: 'fresh-build', worker: '', run: '', actor: '', container: false })), fails: ['babysit.threads.touches-only-threads'] },
    { name: 'a fix was pushed in threads-only mode', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'push', ref: 'refs/heads/feat-checkout-note', worker: '', run: '', actor: '', container: false } as ForgeAction)), fails: ['babysit.threads.touches-only-threads'] },
    { name: 'the billing thread was dismissed too', mutate: (sandbox) => editForge(sandbox, (actions, state) => { actions.push({ kind: 'resolve', tool: 'gh', pr: 13, thread: 'thread-b', worker: '', run: '', actor: '', container: false }); const thread = state.prs['13']?.threads.find((entry) => entry.id === 'thread-b'); if (thread) thread.resolved = true; }), fails: ['babysit.threads.dismissal-grounded-and-the-ask-left-open', 'babysit.threads.touches-only-threads'] },
    { name: 'the dismissal never looked at the code', mutate: (sandbox) => dropCommands(sandbox, /git grep .*couponPercent/), fails: ['babysit.threads.dismissal-grounded-and-the-ask-left-open'] },
    { name: 'the reply text went through the shell', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: "echo 'checkout() drops couponPercent' > /tmp/x" }), fails: ['babysit.threads.review-text-is-data'] },
    { name: 'a watcher was started', mutate: (sandbox) => patchWatcherDir(sandbox, THREADS_RUN), fails: ['babysit.threads.starts-no-watcher'] },
    { name: 'the billing finding was not asked about', mutate: (sandbox) => rewriteFinalReply(sandbox, /Question:[^\n]*\?/, 'No question was asked.'), fails: ['babysit.threads.ask-is-recorded-and-put-to-the-user'] },
    { name: 'the mode was declared as drive', mutate: (sandbox) => rewriteTodoTask(sandbox, THREADS_RUN, 'Mode: threads-only', 'Mode: drive'), fails: ['babysit.threads.mode-declared-from-the-request'] },
    { name: 'the PR was merged', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'merge', tool: 'gh', pr: 13, worker: '', run: '', actor: '', container: false })), fails: ['babysit.threads.never-merges'] },
  ],
};

// ---- queued stack: WAITING with reason merge-queue, report merge-ready, stop the watcher

const QUEUED_RUN = 'babysit-queued-51';
const QUEUED_STORE: { handle?: ForgeHandle } = {};
const QUEUED_ARGS = [...['--owner', 'acme', '--repo', 'widgets'], '--queued-stack', '--stack-prs', '51,52'];

export const babysitQueuedFamily: Family = {
  id: 'babysit-queued',
  title: 'babysit a queued stack: a blocker-free frontier is a non-terminal WAITING with reason merge-queue, reported merge-ready, watcher stopped, nothing merged (spec 13.2)',
  spec: {
    family: 'babysit-queued',
    runId: QUEUED_RUN,
    history: cartHistory,
    timeoutMs: 120_000,
    ...withForge(
      (ctx) =>
        setupForge(ctx, {
          owner: 'acme',
          name: 'widgets',
          queue: true,
          branches: [
            { name: 'q-1', from: 'main', files: { 'src/q1.js': 'export const q1 = 1;\n' }, message: 'feat: q1' },
            { name: 'q-2', from: 'q-1', files: { 'src/q2.js': 'export const q2 = 2;\n' }, message: 'feat: q2' },
          ],
          prs: [
            { number: 51, title: 'feat: q1', head: 'q-1', base: 'main', author: 'owner-51' },
            { number: 52, title: 'feat: q2', head: 'q-2', base: 'q-1', author: 'owner-52' },
          ],
        }),
      QUEUED_STORE,
    ),
    prompt: () => '/poteto-mode babysit the queued stack PR 51 and PR 52 until it is merge-ready',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const dir = parent.runDir;
      const out = join(dir, 'watch-queued.out');
      parent.beginPlaybook('babysit', 'Babysit queued stack 51, 52');
      parent.task('Mode: drive (babysit the queued stack PR 51 and PR 52)');
      parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
      parent.task('Forge: gh (origin CLI absent, fallback recorded)');
      stepDone(parent, 'babysit', 1, 'bq-mode', `! command -v origin && grep -q 'Mode: drive' ${join(dir, 'TODO.md')}`);
      parent.bash(`gh pr list ${REPO_FLAGS} --state open --limit 300 --json number,headRefName,baseRefName,isCrossRepository`);
      parent.task('Frozen queue, bottom to top: 51,52');
      stepDone(parent, 'babysit', 2, 'bq-frontier', `gh pr view 51 ${REPO_FLAGS} --json state | grep -q OPEN`);
      stepDone(parent, 'babysit', 3, 'bq-single', `test -z "$(grep -rl watch-pr ${ctx.repo}/.pi/pstack/runs/*/workers/*/assignment.json 2>/dev/null)"`);
      stepDone(parent, 'babysit', 4, 'bq-topology', `test "$(git -C ${ctx.repo} rev-parse HEAD)" = ${ctx.base}`);
      stepDone(parent, 'babysit', 5, 'bq-order', `gh pr view 52 ${REPO_FLAGS} --json mergeable | grep -q MERGEABLE`);
      parent.spawn('watch-queue', watchAssignment(ctx, parent, QUEUED_ARGS), '');
      parent.bash(`for i in $(seq 1 40); do S=$(tmux -L "$PSTACK_TMUX_SOCKET" list-sessions -F '#{session_name}' | grep watch-queue); tmux -L "$PSTACK_TMUX_SOCKET" capture-pane -p -J -S - -t "$S" > ${out} 2>/dev/null; grep -q merge-queue ${out} && break; sleep 0.25; done; cat ${out}`);
      parent.call('pstack_worker', { action: 'inspect', runId: ctx.runId, workerId: 'watch-queue' });
      parent.call('pstack_worker', { action: 'abort', runId: ctx.runId, workerId: 'watch-queue' });
      stepDone(parent, 'babysit', 6, 'bq-ready', `grep -q merge-queue ${out}`);
      stepDone(parent, 'babysit', 7, 'bq-ci', `gh pr checks 51 ${REPO_FLAGS} | grep -q pass`);
      parent.skip('babysit', 8, 'no bugbot threads on either PR');
      stepDone(parent, 'babysit', 9, 'bq-human', `! gh pr view 51 ${REPO_FLAGS} --json state | grep -q MERGED`);
      parent.text('Mode: drive on the queued stack 51, 52. The queued watcher reported WAITING with reason merge-queue: PR 51 is a blocker-free frontier, so I report it merge-ready and stopped the watcher. Not merged: that is Shipping, on your request.');
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('babysit'),
    ...todoChecks({ playbook: 'babysit', skipReason: { 8: /bugbot/ } }),
    modeDeclared('babysit.queued.mode-declared-from-the-request', BS('Declare the mode and resolve the forge before any poll'), 'drive'),
    forgeResolvedOnce('babysit.queued.forge-resolved-once-gh-fallback-recorded', BS('GitHub CLI (`gh`) is the default'), 'gh'),
    check('babysit.queued.queue-frozen-bottom-to-top-once', 'the stack was captured once from the forge, bottom to top, and the queued watcher got that exact list', BS('capture the PR list bottom-to-top once'), (view) => {
      const { state } = readForge(view);
      const prs = Object.values(state.prs);
      const order: number[] = [];
      let base = state.repo.trunk;
      for (;;) {
        const next = prs.find((pr) => (pr.baseAtStart ?? pr.base) === base && !order.includes(pr.number));
        if (next === undefined) break;
        order.push(next.number);
        base = next.head;
      }
      const argv = watchers(view).map((worker) => assignmentOf(worker).watch?.argv ?? []);
      const lists = argv.map((args) => args[args.indexOf('--stack-prs') + 1]);
      const captures = BASH(view).filter((entry) => /^gh pr list/.test(entry.command)).length;
      return when(captures === 1 && argv.length === 1 && argv[0]?.includes('--queued-stack') === true && lists[0] === order.join(','), `one capture; the forge's stack bottom-to-top is ${order.join(',')}; the watcher got ${lists[0]}`, `captures ${captures}; watchers ${argv.length}; forge order ${order.join(',')}; passed ${String(lists[0])}`);
    }),
    check('babysit.queued.frontier-is-WAITING-merge-queue-never-READY', 'the real watch-pr in queued mode, run over the final forge state, emits a non-terminal WAITING with reason merge-queue and never READY; the parent saw it in the live watcher output', BS('A blocker-free frontier is a non-terminal `WAITING` with reason `merge-queue`'), (view) => {
      const verdict = watchVerdict(view, [...QUEUED_ARGS, '--interval', '0.3'], { until: 'WAITING' });
      const lines = verdict.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { kind: string; terminal?: boolean; reason?: { kind: string } });
      const waiting = lines.find((line) => line.kind === 'WAITING');
      const worker = observedWatcher(view, '51,52');
      const capture = BASH(view).find((entry) => /capture-pane/.test(entry.command) && (entry.command.includes(worker.id) || entry.command.includes(String(worker.state?.['tmuxSession'] ?? '\u0000'))));
      const output = /capture-pane[^;\n]*?\s>\s*(\/\S+)/.exec(capture?.command ?? '')?.[1];
      const inspect = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'inspect' && call.args['workerId'] === worker.id && call.args['runId'] === worker.runId && !call.isError);
      const seen = output === undefined ? inspect?.resultText ?? '' : readFileSyncSafe(output);
      return when(waiting?.terminal === false && waiting.reason?.kind === 'merge-queue' && !lines.some((line) => line.kind === 'READY') && /merge-queue/.test(seen), `WAITING reason ${waiting?.reason?.kind} non-terminal; no READY; verdicts ${lines.map((line) => line.kind).join(', ')}; the live output was captured`, `verdicts ${lines.map((line) => `${line.kind}${line.reason ? `:${line.reason.kind}` : ''}`).join(', ')}; captured output has merge-queue ${/merge-queue/.test(seen)}`);
    }),
    check('babysit.queued.watcher-stopped-after-the-report', 'the watcher was aborted after the parent read WAITING merge-queue, and no watcher is left running', BS('Report that frontier merge-ready and stop the watcher'), (view) => {
      const worker = observedWatcher(view, '51,52');
      const abort = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'abort' && call.args['workerId'] === worker.id && call.args['runId'] === worker.runId && !call.isError);
      const capture = view.parent.toolCalls.find((call) => (call.name === 'bash' && /capture-pane/.test(String(call.args['command'])) && String(call.args['command']).includes(worker.id)) || (call.name === 'pstack_worker' && call.args['action'] === 'inspect' && call.args['workerId'] === worker.id && call.args['runId'] === worker.runId && !call.isError && /merge-queue/.test(call.resultText)));
      const settles = (worker?.state?.['settles'] as { phase: string }[] | undefined) ?? [];
      return when(abort !== undefined && capture !== undefined && abort.order > capture.order && settles.some((settle) => settle.phase === 'aborted') && exitCodeOf(worker as never) !== 0, `captured output at ${capture?.order}, aborted at ${abort?.order}; phase ${String(worker?.state?.['phase'])}`, `abort ${abort?.order}, capture ${capture?.order}, settles ${JSON.stringify(settles.map((settle) => settle.phase))}`);
    }),
    check('babysit.queued.watcher-verdict-is-readable-through-pstack-worker', 'the non-terminal WAITING merge-queue verdict the watcher printed is readable through the pstack_worker surface the parent already has (inspect), not only from the tmux pane', BS('A blocker-free frontier is a non-terminal `WAITING` with reason `merge-queue`'), (view) => {
      const worker = observedWatcher(view, '51,52');
      const inspect = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'inspect' && call.args['workerId'] === worker.id && call.args['runId'] === worker.runId);
      const abort = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'abort' && call.args['workerId'] === worker.id && call.args['runId'] === worker.runId);
      return when(inspect !== undefined && !inspect.isError && /"kind":"WAITING"[^\n]*merge-queue|merge-queue[^\n]*"kind":"WAITING"/.test(inspect.resultText) && (abort === undefined || inspect.order < abort.order), 'inspect, before the abort, carries the WAITING merge-queue verdict', `inspect returned: ${inspect?.resultText.slice(0, 200)}`);
    }),
    neverMerges('babysit.queued.never-merges-or-arms-auto-merge', 'nothing merged, queued by the babysitter, or auto-merged', BS('Babysitting never authorizes merging')),
    replyMentions('babysit.queued.reply-is-merge-ready-and-points-to-shipping', 'the reply reports the frontier merge-ready with the merge-queue reason, says the watcher stopped, and leaves landing to Shipping', BS('Report that frontier merge-ready and stop the watcher'), [{ name: 'merge-queue reason', pattern: /merge-queue/ }, { name: 'merge-ready', pattern: /merge-ready/ }, { name: 'stopped', pattern: /stopped the watcher/ }, { name: 'Shipping', pattern: /Shipping/ }], [{ name: 'READY', pattern: /\bREADY\b/ }]),
    noToolErrors('babysit.queued.no-tool-errors', BS('Trust the active forge')),
  ],
  negatives: [
    ...todoNegatives(QUEUED_RUN, 'babysit', { done: [1, 2, 3, 4, 5, 6, 7, 9], receipts: { 1: 'bq-mode', 2: 'bq-frontier', 3: 'bq-single', 4: 'bq-topology', 5: 'bq-order', 6: 'bq-ready', 7: 'bq-ci', 9: 'bq-human' } }),
    { name: 'the watcher got the queue top-to-bottom', mutate: (sandbox, view) => patchAssignment(sandbox, observedWatcher(view, '51,52').runId, observedWatcher(view, '51,52').id, (assignment) => ((assignment['watch'] as { argv: string[] }).argv = (assignment['watch'] as { argv: string[] }).argv.map((arg) => (arg === '51,52' ? '52,51' : arg)))), fails: ['babysit.queued.queue-frozen-bottom-to-top-once'] },
    { name: 'the watcher was not in queued mode', mutate: (sandbox, view) => patchAssignment(sandbox, observedWatcher(view, '51,52').runId, observedWatcher(view, '51,52').id, (assignment) => ((assignment['watch'] as { argv: string[] }).argv = (assignment['watch'] as { argv: string[] }).argv.filter((arg) => arg !== '--queued-stack'))), fails: ['babysit.queued.queue-frozen-bottom-to-top-once'] },
    { name: 'the frontier was merging into the queue', mutate: (sandbox) => editForge(sandbox, (actions, state) => { actions.push({ kind: 'merge-queued', tool: 'gh', pr: 51, worker: '', run: '', actor: '', container: false }); (state.prs['51'] as { queued?: boolean }).queued = true; }), fails: ['babysit.queued.never-merges-or-arms-auto-merge'] },
    { name: 'a check is failing, so the frontier is not merge-ready', mutate: (sandbox) => editForge(sandbox, (_actions, state) => { (state.prs['51'] as { checks: { name: string; runId: number; state: string }[] }).checks = [{ name: 'build', runId: 9051, state: 'FAILURE' }]; }), fails: ['babysit.queued.frontier-is-WAITING-merge-queue-never-READY'] },
    { name: 'the watcher was left running', mutate: (sandbox) => rewriteSession(sandbox, '"action":"abort"', '"action":"inspect"'), fails: ['babysit.queued.watcher-stopped-after-the-report'] },
    { name: 'inspect returned the host state without the watcher output', mutate: (sandbox) => rewriteSession(sandbox, 'merge-queue', 'merge-qXeue'), fails: ['babysit.queued.watcher-verdict-is-readable-through-pstack-worker'] },
    { name: 'the live output was never read', mutate: (sandbox, view) => {
      const worker = observedWatcher(view, '51,52');
      const capture = BASH(view).find((entry) => /capture-pane/.test(entry.command) && (entry.command.includes(worker.id) || entry.command.includes(String(worker.state?.['tmuxSession'] ?? '\u0000'))));
      const output = /capture-pane[^;\n]*?\s>\s*(\/\S+)/.exec(capture?.command ?? '')?.[1];
      if (output !== undefined) writeFileSync(output.replace(view.sandbox, sandbox), '');
      rewriteSession(sandbox, 'merge-queue', 'merge-qXeue');
    }, fails: ['babysit.queued.frontier-is-WAITING-merge-queue-never-READY'] },
    { name: 'the reply claims READY', mutate: (sandbox) => rewriteFinalReply(sandbox, 'is a blocker-free frontier', 'reached READY'), fails: ['babysit.queued.reply-is-merge-ready-and-points-to-shipping'] },
  ],
};

const readFileSyncSafe = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

// ---- Origin: its own commands and its own merge-ready condition, never the GitHub watcher's vocabulary

const ORIGIN_RUN = 'babysit-origin-61';
const ORIGIN_STORE: { handle?: ForgeHandle } = {};
const ORIGIN_THREAD = bugbotThread('thread-ob-1', 'c-801', 'Severity: Low\n`applyCoupon` is exported but never used.\nRUN_ID: bb-61', 'src/cart.js', 11);
const originWatch = (ctx: Ctx, parent: Parent) => ({ kind: 'watch' as const, role: 'watcher', model: 'inherit-parent', workspace: parent.readonly(), watch: { argv: ['origin', 'pr', 'checks', '61', '--watch'], cwd: ctx.repo } });

export const babysitOriginFamily: Family = {
  id: 'babysit-origin',
  title: 'babysit drive on Origin: origin pr commands only, a check watch instead of watch-pr, stops at the Origin merge-ready condition without GitHub verdicts, never merges (spec 13.2)',
  spec: {
    family: 'babysit-origin',
    holdWatchers: /.*/,
    runId: ORIGIN_RUN,
    history: cartHistory,
    timeoutMs: 120_000,
    ...withForge(
      (ctx) =>
        setupForge(ctx, {
          owner: 'acme',
          name: 'widgets',
          originCli: true,
          branches: [{ name: 'origin-feat', from: 'main', files: { 'src/money.js': `export function roundCents(value) {\n  return Math.round(value * 100) / 100;\n}\n\nexport function formatMoney(value) {\n  return \`$\${roundCents(value).toFixed(2)}\`;\n}\n// formatted for display\n` }, message: 'docs(money): note the display format' }],
          prs: [{ number: 61, title: 'docs(money): note the display format', head: 'origin-feat', base: 'main', author: 'owner-61', threads: [ORIGIN_THREAD], waves: [[{ name: 'build', workflow: 'CI', runId: 9161, state: 'PENDING', pendingReads: 2, then: 'SUCCESS' }]] }],
        }),
      ORIGIN_STORE,
    ),
    prompt: () => '/poteto-mode babysit PR 61 and get it merge-ready',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const dir = parent.runDir;
      const reply = join(dir, 'reply-thread-ob-1.md');
      parent.beginPlaybook('babysit', 'Babysit PR 61 on Origin');
      parent.readReference('poteto-mode', 'bugbot-triage.md');
      parent.task('Mode: drive (babysit PR 61 and get it merge-ready)');
      parent.bash('command -v origin && origin pr view 61');
      parent.task('Forge: origin (command -v origin succeeded and Origin resolves the repository)');
      stepDone(parent, 'babysit', 1, 'bo-mode', `command -v origin && grep -q 'Mode: drive' ${join(dir, 'TODO.md')}`);
      parent.bash('origin pr view 61 --checks --comments');
      stepDone(parent, 'babysit', 2, 'bo-frontier', 'origin pr view 61 | grep -q OPEN');
      parent.bash(`grep -rl "pr checks 61" ${ctx.repo}/.pi/pstack/runs/*/workers/*/assignment.json 2>/dev/null || echo "no other babysitter on PR 61"`);
      stepDone(parent, 'babysit', 3, 'bo-single', `test -z "$(grep -rl 'pr checks 61' ${ctx.repo}/.pi/pstack/runs/*/workers/*/assignment.json 2>/dev/null)"`);
      stepDone(parent, 'babysit', 4, 'bo-topology', `test "$(git -C ${ctx.repo} rev-parse HEAD)" = ${ctx.base}`);
      parent.bash('origin pr thread list 61');
      parent.bash('git grep -n "applyCoupon" main -- src');
      parent.write(reply, 'Dismissed: git grep finds applyCoupon called by total() in src/cart.js, so it is used.\n');
      parent.bash(`origin pr thread reply thread-ob-1 61 --body-file ${reply}`);
      parent.bash('origin pr thread resolve thread-ob-1 61');
      parent.decision('bugbot-triage', 'dismiss thread-ob-1', 'applyCoupon is called by total() in src/cart.js', 'git grep -n applyCoupon main -- src', 'dismissed with the disproof on the thread');
      stepDone(parent, 'babysit', 5, 'bo-order', `origin pr thread list 61 | grep -q '\\[\\]'`);
      parent.spawn('watch-origin', originWatch(ctx, parent), '').wait('watch-origin').collect('watch-origin');
      parent.bash('origin pr view 61 --checks --comments');
      parent.bash('origin pr thread list 61');
      stepDone(parent, 'babysit', 6, 'bo-ready', `origin pr view 61 | grep -q '"mergeable":true'`);
      parent.skip('babysit', 7, 'no check failed, so there is nothing to classify or retry');
      stepDone(parent, 'babysit', 8, 'bo-bugbot', `grep -q bugbot-triage ${join(dir, 'decisions.tsv')}`);
      stepDone(parent, 'babysit', 9, 'bo-human', `! origin pr view 61 | grep -q MERGED`);
      parent.text('Mode: drive on Origin. PR 61 is merge-ready by the Origin condition: checks are green, origin pr view reports it mergeable with no blockers, and origin pr thread list is empty. The bugbot claim that applyCoupon is unused was dismissed with a git grep disproof. I used no GitHub watcher. Not merged: that is Shipping, on your request.');
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('babysit'),
    ...todoChecks({ playbook: 'babysit', skipReason: { 7: /failed|classify/ } }),
    modeDeclared('babysit.origin.mode-declared-from-the-request', BS('Declare the mode and resolve the forge before any poll'), 'drive'),
    forgeResolvedOnce('babysit.origin.origin-chosen-once-and-used-alone', BS('If `command -v origin` succeeds and Origin can resolve the repository'), 'origin'),
    check('babysit.origin.no-github-watcher-no-github-verdicts', 'watch-pr is never run, the watcher is an origin check watch, and the reply claims none of READY, WAITING, ADVANCE or COMPLETE', BS('Origin does not wait for `READY`, `WAITING`, `ADVANCE`, or `COMPLETE`'), (view) => {
      const typed = BASH(view).filter((entry) => /watch-pr/.test(entry.command));
      const argv = watchers(view).map((worker) => assignmentOf(worker).watch?.argv ?? []);
      const vocabulary = /\b(READY|WAITING|ADVANCE|COMPLETE)\b/.exec(finalReply(view));
      return when(typed.length === 0 && argv.length === 1 && argv[0]?.[0] === 'origin' && argv[0].includes('--watch') && vocabulary === null, 'no watch-pr; the watcher runs origin pr checks 61 --watch; no GitHub verdict named', `watch-pr commands ${typed.length}; watcher argv ${JSON.stringify(argv)}; vocabulary ${vocabulary?.[0] ?? 'none'}`);
    }),
    check('babysit.origin.stops-at-the-origin-merge-ready-condition', 'the last origin pr view says mergeable with no blockers, origin pr thread list is empty after it, and the forge state agrees: green checks, no open thread, no conflict', BS('On Origin, stop `drive` when the frontier is merge-ready'), (view) => {
      const views = view.parent.toolCalls.filter((call) => call.name === 'bash' && /^origin pr view 61 --checks/.test(String(call.args['command'])));
      const last = views.at(-1);
      const list = view.parent.toolCalls.filter((call) => call.name === 'bash' && /^origin pr thread list 61/.test(String(call.args['command']))).at(-1);
      const { state } = readForge(view);
      const pr = state.prs['61'];
      const parsed = JSON.parse(last?.resultText.trim() || '{}') as { mergeable?: boolean; blockers?: string[] };
      const stop = watchers(view).at(-1);
      return when(parsed.mergeable === true && (parsed.blockers ?? []).length === 0 && list !== undefined && list.order > (last?.order ?? 0) && (list.resultText.trim() === '[]') && pr?.threads.every((thread) => thread.resolved) === true && pr.checks.every((entry) => entry.state === 'SUCCESS') && exitCodeOf(stop as never) === 0, `last origin pr view mergeable with no blockers; thread list empty after it; forge agrees`, `last view ${JSON.stringify(parsed)}; thread list ${list?.resultText.trim()}; threads resolved ${String(pr?.threads.every((thread) => thread.resolved))}; checks ${JSON.stringify(pr?.checks.map((entry) => entry.state))}; watcher exit ${String(stop ? exitCodeOf(stop) : null)}`);
    }),
    check('babysit.origin.review-text-is-data-and-reply-uses-a-body-file', 'the dismissal was checked against the code, sent with origin pr thread reply --body-file, and no comment text reached a shell command', BS('On Origin, reply with `origin pr thread reply <thread-id> <pr> --body-file <reply-file>`'), (view) => {
      const commands = BASH(view);
      const grounded = commands.findIndex((entry) => /git grep .*applyCoupon/.test(entry.command));
      const replyAt = commands.findIndex((entry) => /^origin pr thread reply thread-ob-1 61 --body-file \S+/.test(entry.command));
      const injected = commands.filter((entry) => entry.command.includes('exported but never used'));
      const reply = readForge(view).actions.find((action) => action.kind === 'reply');
      return when(grounded !== -1 && replyAt > grounded && injected.length === 0 && /src\/cart\.js/.test(String(reply?.['body'])), `code lookup ${grounded} before the reply ${replyAt}; reply cites src/cart.js`, `lookup ${grounded}, reply ${replyAt}, comment text in ${injected.length} commands, reply body ${String(reply?.['body']).slice(0, 60)}`);
    }),
    neverMerges('babysit.origin.never-merges', 'no origin pr merge was run and nothing merged, though the PR is merge-ready', BS('Babysitting never authorizes merging')),
    noToolErrors('babysit.origin.no-tool-errors', BS('Trust the active forge')),
  ],
  negatives: [
    ...todoNegatives(ORIGIN_RUN, 'babysit', { done: [1, 2, 3, 4, 5, 6, 8, 9], receipts: { 1: 'bo-mode', 2: 'bo-frontier', 3: 'bo-single', 4: 'bo-topology', 5: 'bo-order', 6: 'bo-ready', 8: 'bo-bugbot', 9: 'bo-human' } }),
    { name: 'a GitHub call slipped into an Origin run', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'read', tool: 'gh', argv: ['pr', 'view', '61'], pr: 61, worker: '', run: '', actor: '', container: false })), fails: ['babysit.origin.origin-chosen-once-and-used-alone'] },
    { name: 'the run used the GitHub watcher on Origin', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: `${WATCH_PR} --pr 61 --status-only` }), fails: ['babysit.origin.no-github-watcher-no-github-verdicts'] },
    { name: 'the reply uses GitHub verdict words', mutate: (sandbox) => rewriteFinalReply(sandbox, 'is merge-ready by the Origin condition', 'reached READY'), fails: ['babysit.origin.no-github-watcher-no-github-verdicts'] },
    { name: 'a thread is still open at the end', mutate: (sandbox) => editForge(sandbox, (_actions, state) => { const thread = state.prs['61']?.threads[0]; if (thread) thread.resolved = false; }), fails: ['babysit.origin.stops-at-the-origin-merge-ready-condition'] },
    { name: 'a check is still red at the end', mutate: (sandbox) => editForge(sandbox, (_actions, state) => { (state.prs['61'] as { checks: { state: string }[] }).checks.forEach((entry) => (entry.state = 'FAILURE')); }), fails: ['babysit.origin.stops-at-the-origin-merge-ready-condition'] },
    { name: 'the thread was dismissed without a code lookup', mutate: (sandbox) => dropCommands(sandbox, /git grep .*applyCoupon/), fails: ['babysit.origin.review-text-is-data-and-reply-uses-a-body-file'] },
    { name: 'the reply went through the shell', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: "origin pr thread reply thread-ob-1 61 --body '`applyCoupon` is exported but never used.'" }), fails: ['babysit.origin.review-text-is-data-and-reply-uses-a-body-file'] },
    { name: 'origin pr merge ran because the checks were green', mutate: (sandbox) => editForge(sandbox, (actions, state) => { actions.push({ kind: 'merge', tool: 'origin', pr: 61, worker: '', run: '', actor: '', container: false }); (state.prs['61'] as { state: string }).state = 'MERGED'; }), fails: ['babysit.origin.never-merges'] },
  ],
};

// ---- background: triage while a plan keeps executing

const BG_RUN = 'babysit-background-15';
const BG_STORE: { handle?: ForgeHandle } = {};

export const babysitBackgroundFamily: Family = {
  id: 'babysit-background',
  title: 'babysit background: the watcher is armed and the plan keeps executing, the parent is woken by the verdict and stops at READY without merging (spec 13.2)',
  spec: {
    family: 'babysit-background',
    holdWatchers: /.*/,
    runId: BG_RUN,
    history: cartHistory,
    timeoutMs: 120_000,
    ...withForge(
      (ctx) =>
        setupForge(ctx, {
          owner: 'acme',
          name: 'widgets',
          branches: [{ name: 'feat-bg', from: 'main', files: { 'src/bg.js': 'export const bg = true;\n' }, message: 'feat: bg' }],
          prs: [{ number: 15, title: 'feat: bg', head: 'feat-bg', base: 'main', author: 'owner-15', waves: [[{ name: 'build', workflow: 'CI', runId: 9115, state: 'PENDING', pendingReads: 1, then: 'SUCCESS' }]] }],
        }),
      BG_STORE,
    ),
    prompt: () => '/poteto-mode the plan is still executing in the background, so babysit PR 15 while it runs',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const dir = parent.runDir;
      parent.beginPlaybook('babysit', 'Babysit PR 15 in the background');
      parent.task('Mode: background (a plan is still executing, babysit PR 15)');
      parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
      parent.task('Forge: gh (origin CLI absent, fallback recorded)');
      stepDone(parent, 'babysit', 1, 'bg-mode', `! command -v origin && grep -q 'Mode: background' ${join(dir, 'TODO.md')}`);
      stepDone(parent, 'babysit', 2, 'bg-frontier', `gh pr view 15 ${REPO_FLAGS} --json state | grep -q OPEN`);
      stepDone(parent, 'babysit', 3, 'bg-single', `test -z "$(grep -rl watch-pr ${ctx.repo}/.pi/pstack/runs/*/workers/*/assignment.json 2>/dev/null)"`);
      stepDone(parent, 'babysit', 4, 'bg-topology', `test "$(git -C ${ctx.repo} rev-parse HEAD)" = ${ctx.base}`);
      stepDone(parent, 'babysit', 5, 'bg-order', `gh pr view 15 ${REPO_FLAGS} --json mergeable | grep -q MERGEABLE`);
      parent.spawn('watch-bg', watchAssignment(ctx, parent, BASE_ARGS(15)), '');
      parent.write(join(dir, 'plan-progress.md'), 'plan unit 1 done while the watcher runs\n');
      parent.write(join(dir, 'plan-progress.md'), 'plan unit 1 done while the watcher runs\nplan unit 2 done while the watcher runs\n');
      parent.wait('watch-bg').collect('watch-bg');
      stepDone(parent, 'babysit', 6, 'bg-ready', `gh pr checks 15 ${REPO_FLAGS} | grep -q pass`);
      parent.skip('babysit', 7, 'no check failed, so there is nothing to classify or retry');
      parent.skip('babysit', 8, 'no bugbot threads on PR 15');
      stepDone(parent, 'babysit', 9, 'bg-human', `! gh pr view 15 ${REPO_FLAGS} --json state | grep -q MERGED`);
      parent.text('Mode: background. The watcher ran while the plan kept executing, two plan units finished meanwhile. It reached READY: PR 15 is merge-ready. Not merged: that is Shipping, on your request.');
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('babysit'),
    ...todoChecks({ playbook: 'babysit', skipReason: { 7: /failed|classify/, 8: /bugbot/ } }),
    modeDeclared('babysit.background.mode-declared-from-the-request', BS('Declare the mode and resolve the forge before any poll'), 'background'),
    forgeResolvedOnce('babysit.background.forge-resolved-once-gh-fallback-recorded', BS('GitHub CLI (`gh`) is the default'), 'gh'),
    check('babysit.background.plan-work-continues-while-the-watcher-runs', 'the parent did other work between arming the watcher and its wake, and was woken by the watcher exit', BS('`background` triages without blocking'), (view) => {
      const selected = observedWatcher(view, '15');
      const spawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && call.args['runId'] === selected.runId && String(call.args['assignmentPath']).includes(`/workers/${selected.id}/`))?.order ?? -1;
      const wake = view.parent.messages.find((message) => message.customType === 'pstack-worker' && message.details?.['workerId'] === selected.id && message.details?.['runId'] === selected.runId && message.details?.['phase'] === 'exited')?.order ?? -1;
      const between = view.parent.toolCalls.filter((call) => call.order > spawn && call.order < wake && call.name === 'write');
      const worker = selected;
      return when(spawn !== -1 && wake > spawn && between.length >= 2 && worker !== undefined && exitCodeOf(worker) === 0, `${between.length} plan writes between the spawn at ${spawn} and the wake at ${wake}; the watcher exited READY (0)`, `spawn ${spawn}, wake ${wake}, plan writes between ${between.length}; exit ${worker ? String(exitCodeOf(worker)) : 'n/a'}`);
    }),
    check('babysit.background.one-watch-pr-watcher-stopped-at-READY', 'exactly one watch-pr watcher ran, it ended at READY, and the real watch-pr agrees over the final state', BS('stop at `READY` for one PR'), (view) => {
      const verdict = watchVerdict(view, [...BASE_ARGS(15), '--timeout', '20', '--interval', '0.3']);
      return when(watchers(view).length === 1 && assignmentOf(watchers(view)[0] as never).watch?.argv?.[0] === WATCH_PR && verdict.code === 0 && /"kind":"READY"/.test(verdict.stdout), 'one watch-pr watcher; independent watch-pr exits 0 with READY', `${watchers(view).length} watchers; independent exit ${verdict.code}`);
    }),
    neverMerges('babysit.background.never-merges', 'nothing merged, queued or auto-merged', BS('Babysitting never authorizes merging')),
    replyMentions('babysit.background.reply-is-merge-ready-not-merged', 'the reply says background, merge-ready, and not merged', BS('Stop at the human'), [{ name: 'background', pattern: /Mode: background/ }, { name: 'merge-ready', pattern: /merge-ready/ }, { name: 'not merged', pattern: /Not merged/ }]),
    noToolErrors('babysit.background.no-tool-errors', BS('Trust the active forge')),
  ],
  negatives: [
    ...todoNegatives(BG_RUN, 'babysit', { done: [1, 2, 3, 4, 5, 6, 9], receipts: { 1: 'bg-mode', 2: 'bg-frontier', 3: 'bg-single', 4: 'bg-topology', 5: 'bg-order', 6: 'bg-ready', 9: 'bg-human' } }),
    { name: 'the parent blocked on the watcher and did no plan work', mutate: dropWrites, fails: ['babysit.background.plan-work-continues-while-the-watcher-runs'] },
    { name: 'a second watcher was armed', mutate: (sandbox, view) => { const worker = observedWatcher(view, '15'); duplicateWorker(sandbox, worker.runId, worker.id, `${worker.id}-duplicate`); }, fails: ['babysit.background.one-watch-pr-watcher-stopped-at-READY'] },
    { name: 'a check is red at the end', mutate: (sandbox) => editForge(sandbox, (_actions, state) => { (state.prs['15'] as { checks: { state: string }[] }).checks.forEach((entry) => (entry.state = 'FAILURE')); }), fails: ['babysit.background.one-watch-pr-watcher-stopped-at-READY'] },
    { name: 'the PR was merged', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'merge', tool: 'gh', pr: 15, worker: '', run: '', actor: '', container: false })), fails: ['babysit.background.never-merges'] },
    { name: 'the mode was declared as drive', mutate: (sandbox) => rewriteTodoTask(sandbox, BG_RUN, 'Mode: background', 'Mode: drive'), fails: ['babysit.background.mode-declared-from-the-request'] },
  ],
};

function dropWrites(sandbox: string): void {
  const file = parentSession(sandbox);
  const lines = readFileSync(file, 'utf8').split('\n').map((line) => {
    if (line === '') return line;
    const entry = JSON.parse(line) as { message?: { content?: { type: string; name?: string }[] } };
    for (const part of entry.message?.content ?? []) if (part.type === 'toolCall' && part.name === 'write') part.name = 'read';
    return JSON.stringify(entry);
  });
  writeFileSync(file, lines.join('\n'));
}

function duplicateWorker(sandbox: string, runId: string, from: string, to: string): void {
  const base = join(sandbox, 'repo/.pi/pstack/runs', runId, 'workers');
  mkdirSync(join(base, to), { recursive: true });
  const assignment = JSON.parse(readFileSync(join(base, from, 'assignment.json'), 'utf8')) as Record<string, unknown>;
  assignment['workerId'] = to;
  writeFileSync(join(base, to, 'assignment.json'), JSON.stringify(assignment));
}

// ---- one watcher only: a repeated babysit request finds the live watcher and arms no second one

const DUP_RUN = 'babysit-dup-16';
const DUP_STORE: { handle?: ForgeHandle } = {};

export const babysitSingleWatcherFamily: Family = {
  id: 'babysit-single-watcher',
  title: 'babysit one watcher per stack: a second babysit request while the first watcher is live finds it and arms no duplicate (spec 13.2)',
  spec: {
    family: 'babysit-single-watcher',
    runId: DUP_RUN,
    history: cartHistory,
    timeoutMs: 120_000,
    ...withForge(
      (ctx) =>
        setupForge(ctx, {
          owner: 'acme',
          name: 'widgets',
          branches: [{ name: 'feat-dup', from: 'main', files: { 'src/dup.js': 'export const dup = true;\n' }, message: 'feat: dup' }],
          prs: [{ number: 16, title: 'feat: dup', head: 'feat-dup', base: 'main', author: 'owner-16', waves: [[{ name: 'build', workflow: 'CI', runId: 9116, state: 'PENDING', pendingReads: ctx.driver === 'real' ? 2 : 400, then: 'SUCCESS' }]] }],
        }),
      DUP_STORE,
    ),
    prompt: () => '/poteto-mode babysit PR 16 and get it green',
    followUps: () => ['/poteto-mode babysit PR 16 and get it green'],
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const dir = parent.runDir;
      const pr = REPO_FLAGS;
      const find = `grep -rl watch-pr ${ctx.repo}/.pi/pstack/runs/*/workers/*/assignment.json 2>/dev/null || echo "no other babysitter on PR 16"`;
      parent.beginPlaybook('babysit', 'Babysit PR 16');
      parent.task('Mode: drive (babysit PR 16 and get it green)');
      parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
      parent.task('Forge: gh (origin CLI absent, fallback recorded)');
      stepDone(parent, 'babysit', 1, 'bd-mode', `! command -v origin && grep -q 'Mode: drive' ${join(dir, 'TODO.md')}`);
      stepDone(parent, 'babysit', 2, 'bd-frontier', `gh pr view 16 ${pr} --json state | grep -q OPEN`);
      parent.bash(find);
      parent.spawn('watch-1', watchAssignment(ctx, parent, BASE_ARGS(16)), '');
      parent.text('Armed the watcher for PR 16. I will act on its verdict.');
      // the repeated request: the one babysitter is already on this stack
      parent.bash(find);
      parent.call('pstack_worker', { action: 'inspect', runId: ctx.runId, workerId: 'watch-1' });
      parent.decision('one-babysitter', 'reuse watch-1 for PR 16', 'a live watch-pr watcher already covers PR 16, so a second would double the polling and the verdict handling', 'grep of assignments and pstack_worker inspect watch-1', 'no second watcher armed');
      stepDone(parent, 'babysit', 3, 'bd-single', `test $(grep -l '"--pr"' ${ctx.repo}/.pi/pstack/runs/*/workers/*/assignment.json | wc -l) -eq 1`);
      for (const n of [4, 5, 6, 7, 8, 9]) parent.skip('babysit', n, 'the one live watcher is still polling, so there is nothing to act on until its verdict wakes me');
      parent.text('Mode: drive. watch-1 is already live on PR 16, so one watcher serves both requests and I armed no second one. I act on its verdict when it wakes me.');
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('babysit'),
    ...todoChecks({ playbook: 'babysit', skipReason: { 4: /watcher/, 5: /watcher/, 6: /watcher/, 7: /watcher/, 8: /watcher/, 9: /watcher/ } }),
    modeDeclared('babysit.single.mode-declared-from-the-request', BS('Declare the mode and resolve the forge before any poll'), 'drive'),
    forgeResolvedOnce('babysit.single.forge-resolved-once-gh-fallback-recorded', BS('GitHub CLI (`gh`) is the default'), 'gh'),
    check('babysit.single.the-second-request-armed-no-second-watcher', 'two babysit requests arrived, the second found the existing watcher live through the assignments and an inspect, and made no pstack_worker spawn', BS('One babysitter per stack'), (view) => {
      if (!watcherPresentOnFirstRequest(view)) return { inconclusive: 'the first request armed or adopted no watcher, so reuse on a second request was not exercised' };
      const turns = view.parent.messages.filter((message) => message.role === 'user').length;
      const second = callsInTurn(view, 1);
      const spawns = second.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn');
      const worker = observedWatcher(view, '16');
      const inspect = second.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'inspect' && !call.isError && call.args['workerId'] === worker.id && call.args['runId'] === worker.runId);
      return when(turns === 2 && spawns.length === 0 && /running/.test(inspect?.resultText ?? ''), `the repeat request inspected the known watcher ${worker.id} as running, and spawned nothing`, `user turns ${turns}; second-turn spawns ${spawns.length}; inspect said "${inspect?.resultText.slice(0, 60)}"`);
    }),
    check('babysit.single.only-one-watcher-ever-polled-the-pr', 'one watcher worker exists, it was still polling when the second request arrived, and the forge log shows exactly one watcher identity reading PR 16, so no duplicate ran', BS('Never add a second sleep loop'), (view) => {
      if (!watcherPresentOnFirstRequest(view)) return { inconclusive: 'the first request armed or adopted no watcher, so duplicate polling was not exercised' };
      const { actions } = readForge(view);
      const readers = [...new Set(actions.filter((action) => action.kind === 'read' && action.pr === 16 && action.worker !== '').map((action) => action.worker))];
      const worker = observedWatcher(view, '16');
      const life = lifeOf({ ...view, runs: view.runs.filter((run) => run.id === worker.runId) }, worker.id);
      const live = callsInTurn(view, 1).find((call) => call.name === 'pstack_worker' && call.args['action'] === 'inspect' && call.args['workerId'] === worker.id && call.args['runId'] === worker.runId)?.resultText ?? '';
      return when(watchers(view).length === 1 && JSON.stringify(readers) === JSON.stringify([worker.id]) && life.spawn !== -1 && worker !== undefined && exitCodeOf(worker) === null && /running/.test(live), `one watcher, live at the second request, one polling identity (${readers.join(', ')})`, `watchers ${watchers(view).length}; polling identities ${JSON.stringify(readers)}; inspect "${live.slice(0, 50)}"`);
    }),
    neverMerges('babysit.single.never-merges', 'nothing merged, queued or auto-merged', BS('Babysitting never authorizes merging')),
    noToolErrors('babysit.single.no-tool-errors', BS('Trust the active forge')),
  ],
  negatives: [
    ...todoNegatives(DUP_RUN, 'babysit', { done: [1, 2, 3], receipts: { 1: 'bd-mode', 2: 'bd-frontier', 3: 'bd-single' } }),
    { name: 'the second request armed a second watcher', mutate: (sandbox, view) => { const worker = observedWatcher(view, '16'); duplicateWorker(sandbox, worker.runId, worker.id, 'duplicate-watcher'); editForge(sandbox, (actions) => actions.push({ kind: 'read', tool: 'gh', pr: 16, worker: 'duplicate-watcher', run: worker.runId, actor: '', container: false })); }, fails: ['babysit.single.only-one-watcher-ever-polled-the-pr'] },
    { name: 'a second spawn call came with the repeated request', mutate: (sandbox) => rewriteSession(sandbox, '"action":"inspect"', '"action":"spawn"'), fails: ['babysit.single.the-second-request-armed-no-second-watcher'] },
    { name: 'the repeated request never inspected the live watcher', mutate: (sandbox) => rewriteSession(sandbox, '"action":"inspect"', '"action":"not-inspect"'), fails: ['babysit.single.the-second-request-armed-no-second-watcher'] },
    { name: 'the PR was merged', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'merge', tool: 'gh', pr: 16, worker: '', run: '', actor: '', container: false })), fails: ['babysit.single.never-merges'] },
    { name: 'the mode was declared as check', mutate: (sandbox) => rewriteTodoTask(sandbox, DUP_RUN, 'Mode: drive', 'Mode: check'), fails: ['babysit.single.mode-declared-from-the-request'] },
  ],
};

// ---- an identical second failure is not a flake

const TWICE_RUN = 'babysit-twice-17';
const TWICE_STORE: { handle?: ForgeHandle } = {};
const TWICE_LOG = 'Run npm ci\nnpm error code E403\nnpm error 403 Forbidden - GET https://registry.npmjs.org/@acme%2fprivate - the token expired\nError: Process completed with exit code 1.';

export const babysitFlakeTwiceFamily: Family = {
  id: 'babysit-flake-twice',
  title: 'babysit CI: a flake gets one fresh build, an identical second failure is reclassified from the logs, never retried again, and reported to the owner (spec 13.2)',
  spec: {
    family: 'babysit-flake-twice',
    holdWatchers: /.*/,
    runId: TWICE_RUN,
    history: cartHistory,
    timeoutMs: 120_000,
    ...withForge(
      (ctx) =>
        setupForge(ctx, {
          owner: 'acme',
          name: 'widgets',
          branches: [{ name: 'feat-twice', from: 'main', files: { 'src/twice.js': 'export const twice = 2;\n' }, message: 'feat: twice' }],
          prs: [{ number: 17, title: 'feat: twice', head: 'feat-twice', base: 'main', author: 'owner-17', waves: [[{ name: 'build', workflow: 'CI', runId: 9217, state: 'FAILURE', log: TWICE_LOG, rerun: { pendingReads: 1, then: 'FAILURE' } }]] }],
        }),
      TWICE_STORE,
    ),
    prompt: () => '/poteto-mode babysit PR 17 and get it green',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const dir = parent.runDir;
      const pr = REPO_FLAGS;
      const report = join(dir, 'ci-report.md');
      parent.beginPlaybook('babysit', 'Babysit PR 17');
      parent.task('Mode: drive (babysit PR 17 and get it green)');
      parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
      parent.task('Forge: gh (origin CLI absent, fallback recorded)');
      stepDone(parent, 'babysit', 1, 'bw-mode', `! command -v origin && grep -q 'Mode: drive' ${join(dir, 'TODO.md')}`);
      stepDone(parent, 'babysit', 2, 'bw-frontier', `gh pr view 17 ${pr} --json state | grep -q OPEN`);
      stepDone(parent, 'babysit', 3, 'bw-single', `test -z "$(grep -rl watch-pr ${ctx.repo}/.pi/pstack/runs/*/workers/*/assignment.json 2>/dev/null)"`);
      stepDone(parent, 'babysit', 4, 'bw-topology', `test "$(git -C ${ctx.repo} rev-parse HEAD)" = ${ctx.base}`);
      parent.skip('babysit', 5, 'no conflict and no review thread, so CI is the only blocker');
      const arm = (id: string) => parent.spawn(id, watchAssignment(ctx, parent, BASE_ARGS(17)), '').wait(id).collect(id);
      arm('watch-1');
      parent.bash(`gh run view 9217 ${pr} --log-failed`);
      parent.bash('git fetch -q origin && git merge-base --is-ancestor origin/main origin/feat-twice && echo "base is current, so not a stale base"');
      parent.bash(`gh run rerun 9217 ${pr}`);
      arm('watch-2');
      parent.bash(`gh run view 9217 ${pr} --log`);
      parent.decision('ci-classification', 'not a flake: the identical failure reproduced', 'the fresh build failed the same way, an expired registry token, so retrying again would burn builds', 'gh run view 9217 --log', 'no further retry, reported to the owner');
      parent.write(report, 'babysit: CI on PR 17 fails the same way after one fresh build: npm ci gets 403 Forbidden from the private registry because the token expired. This is not a flake and not a code change. The owner needs to renew the registry credential, then push or rerun.\n');
      parent.bash(`gh pr comment 17 ${pr} --body-file ${report}`);
      stepDone(parent, 'babysit', 6, 'bw-stop', `grep -c 'not a flake' ${report}`);
      stepDone(parent, 'babysit', 7, 'bw-ci', `grep -q 'ci-classification' ${join(dir, 'decisions.tsv')}`);
      parent.skip('babysit', 8, 'no bugbot threads on PR 17');
      stepDone(parent, 'babysit', 9, 'bw-human', `! gh pr view 17 ${pr} --json state | grep -q MERGED`);
      parent.text('Mode: drive. PR 17 is not merge-ready. The build failed, I verified it was infrastructure from the log, and gave it exactly one fresh build. It failed identically, so it was never a flake: the private registry token expired. I read the full log, did not retry again, and reported it to the owner. Not merged: that is Shipping, on your request.');
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('babysit'),
    ...todoChecks({ playbook: 'babysit', skipReason: { 5: /conflict/, 8: /bugbot/ } }),
    modeDeclared('babysit.twice.mode-declared-from-the-request', BS('Declare the mode and resolve the forge before any poll'), 'drive'),
    forgeResolvedOnce('babysit.twice.forge-resolved-once-gh-fallback-recorded', BS('GitHub CLI (`gh`) is the default'), 'gh'),
    check('babysit.twice.exactly-one-fresh-build-then-no-more', 'watchers ended on failing checks (exit 4), exactly one whole-run rerun was requested after the run log was read, and none after the second failure', BS('One retry only.'), (view) => {
      const { actions } = readForge(view);
      const reruns = actions.filter((action) => action.kind === 'rerun');
      const rerunAt = actions.findIndex((action) => action.kind === 'rerun');
      const logBefore = actions.slice(0, rerunAt).some((action) => action.kind === 'log-view');
      const codes = watchers(view).map(exitCodeOf);
      return when(reruns.length === 1 && reruns[0]?.['retry'] === 'fresh-build' && logBefore && codes.length > 0 && codes.every((code) => code === 4), `one fresh build after the log was read; watchers ended ${codes.join(', ')}`, `reruns ${JSON.stringify(reruns.map((action) => action['retry']))}; log read before ${logBefore}; exits ${JSON.stringify(codes)}`);
    }),
    check('babysit.twice.the-identical-second-failure-is-reclassified-from-the-logs', 'after the second failure the parent read the logs and reclassified the identical failure instead of retrying', BS('An identical second failure means it was never flake, so reclassify and read the child logs instead of retrying blind'), (view) => {
      const { actions } = readForge(view);
      const rerunCall = BASH(view).findIndex((entry) => /gh run rerun/.test(entry.command));
      const second = BASH(view).findIndex((entry, index) => index > rerunCall && /\bgh run view 9217\b/.test(entry.command) && /(?:^|\s)--log(?:-failed)?(?:\s|$)/.test(entry.command));
      const row = (primaryRun(view, 'babysit')?.decisions ?? []).find((cells) => cells[1] === 'ci-classification');
      const comment = actions.find((action) => action.kind === 'comment' && action.pr === 17);
      const classification = [row?.join(' ') ?? '', String(comment?.['body'] ?? ''), ...view.parent.messages.filter((message) => message.role === 'assistant').map((message) => message.text)].join('\n');
      return when(second > rerunCall && rerunCall !== -1 && /not (?:a )?flake|never (?:a )?flake|identical (?:second )?failure/i.test(classification) && /403|token/i.test(classification), `full log read at ${second} after the rerun at ${rerunCall}; decision "${row?.[2]}"; the owner was told the cause`, `full log ${second}, rerun ${rerunCall}, decision ${JSON.stringify(row)}, comment ${String(comment?.['body']).slice(0, 60)}`);
    }),
    neverMutatesTopology('babysit.twice.never-mutates-stack-topology', BS('Never mutate stack topology')),
    neverMerges('babysit.twice.never-merges', 'nothing merged, queued or auto-merged', BS('Babysitting never authorizes merging')),
    replyMentions('babysit.twice.reply-says-not-merge-ready-and-why', 'the reply says the PR is not merge-ready, that one fresh build failed identically, and what was reported', BS('Classify CI before any retrigger'), [{ name: 'not merge-ready', pattern: /not merge-ready|not green|still blocked/i }, { name: 'identical failure', pattern: /failed identically|same (?:403|failure)|identical second failure/i }, { name: 'credential cause reported', pattern: /token[^.\n]*expired|expired[^.\n]*token/i }]),
    noToolErrors('babysit.twice.no-tool-errors', BS('Trust the active forge')),
  ],
  negatives: [
    ...todoNegatives(TWICE_RUN, 'babysit', { done: [1, 2, 3, 4, 6, 7, 9], receipts: { 1: 'bw-mode', 2: 'bw-frontier', 3: 'bw-single', 4: 'bw-topology', 6: 'bw-stop', 7: 'bw-ci', 9: 'bw-human' } }),
    { name: 'a second fresh build was requested after the identical failure', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'rerun', tool: 'gh', pr: 17, runId: '9217', retry: 'fresh-build', worker: '', run: '', actor: '', container: false })), fails: ['babysit.twice.exactly-one-fresh-build-then-no-more'] },
    { name: 'the second failure was retried as a job', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'rerun', tool: 'gh', pr: 17, runId: '9217', retry: 'job-retry', worker: '', run: '', actor: '', container: false })), fails: ['babysit.twice.exactly-one-fresh-build-then-no-more'] },
    { name: 'the build was retried without reading the log', mutate: (sandbox) => editForge(sandbox, (actions) => actions.splice(0, actions.length, ...actions.filter((action) => action.kind !== 'log-view'))), fails: ['babysit.twice.exactly-one-fresh-build-then-no-more'] },
    { name: 'the second failure was never read from the logs', mutate: (sandbox) => rewriteSession(sandbox, 'gh run view 9217 --repo acme/widgets --log"', 'true"'), fails: ['babysit.twice.the-identical-second-failure-is-reclassified-from-the-logs'] },
    { name: 'the identical failure was never reclassified', mutate: (sandbox) => {
      editForge(sandbox, (actions) => actions.splice(0, actions.length, ...actions.filter((action) => action.kind !== 'comment')));
      const log = join(sandbox, 'repo/.pi/pstack/runs', TWICE_RUN, 'decisions.tsv');
      writeFileSync(log, readFileSync(log, 'utf8').split('\n').filter((line) => !line.includes('ci-classification')).join('\n'));
      rewriteSession(sandbox, 'flake', 'mystery');
    }, fails: ['babysit.twice.the-identical-second-failure-is-reclassified-from-the-logs'] },
    { name: 'the babysitter pushed an empty commit to retrigger', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'push', ref: 'refs/heads/feat-twice', worker: '', run: '', actor: '', container: false } as ForgeAction)), fails: ['babysit.twice.never-mutates-stack-topology'] },
    { name: 'the reply claims it is merge-ready', mutate: (sandbox) => rewriteFinalReply(sandbox, 'PR 17 is not merge-ready', 'PR 17 is merge-ready'), fails: ['babysit.twice.reply-says-not-merge-ready-and-why'] },
  ],
};

// ---- helpers for negatives

function rewriteSession(sandbox: string, from: string, to: string): void {
  const file = parentSession(sandbox);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll(from, to));
}

function rewriteTodoTask(sandbox: string, runId: string, from: string, to: string): void {
  const file = join(sandbox, 'repo/.pi/pstack/runs', runId, 'TODO.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));
}

function patchWatcherExit(sandbox: string, runId: string, workerId: string, code: number): void {
  const file = join(sandbox, 'repo/.pi/pstack/runs', runId, 'workers', workerId, 'state.json');
  const state = JSON.parse(readFileSync(file, 'utf8')) as { exit: { code: number } };
  state.exit.code = code;
  writeFileSync(file, JSON.stringify(state));
}

/** Rewrites events.jsonl so the later worker was spawned before the earlier one ended. */
function overlapWatchers(sandbox: string, runId: string, first: string, second: string): void {
  const file = join(sandbox, 'repo/.pi/pstack/runs', runId, 'events.jsonl');
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const spawn = lines.findIndex((entry) => entry['workerId'] === second && entry['kind'] === 'spawn');
  const [moved] = lines.splice(spawn, 1);
  lines.splice(lines.findIndex((entry) => entry['workerId'] === first && entry['kind'] === 'launch') + 1, 0, moved as Record<string, unknown>);
  writeFileSync(file, `${lines.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
}

/** Replaces parent bash commands that match a pattern with `true`, as if the parent never ran them. */
function dropCommands(sandbox: string, pattern: RegExp): void {
  const file = parentSession(sandbox);
  const lines = readFileSync(file, 'utf8').split('\n').map((line) => {
    if (line === '') return line;
    const entry = JSON.parse(line) as { message?: { content?: { type: string; name?: string; arguments?: { command?: string } }[] } };
    for (const part of entry.message?.content ?? []) if (part.type === 'toolCall' && part.name === 'bash' && pattern.test(part.arguments?.command ?? '')) part.arguments = { command: 'true' };
    return JSON.stringify(entry);
  });
  writeFileSync(file, lines.join('\n'));
}

export const babysitFamilies: Family[] = [babysitDriveFamily, babysitCheckFamily, babysitDocsOnlyFamily, babysitThreadsOnlyFamily, babysitQueuedFamily, babysitOriginFamily, babysitBackgroundFamily, babysitSingleWatcherFamily, babysitFlakeTwiceFamily, ...babysitRestartFamilies];
