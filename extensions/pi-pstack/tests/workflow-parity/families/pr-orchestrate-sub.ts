// Orchestrate with a sub-coordinator (spec 13.4): the root spawns one coordinator with capabilities.spawn, the coordinator
// spawns the owners and verifiers of its area into its own run, and the root reads one rollup. The tree's depth is read
// from who owns each run and who made each spawn call, not from what a worker says about itself.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Actor, Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { bareOf, COMMIT_PREFIX, editForge, FORGE_CLI, forgeEnv, type ForgeAction, type ForgeHandle, predictCommit, readForge, setupForge } from '../fixtures/forge.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, src, type Src, when } from '../lib/check.ts';
import { finalReply, noToolErrors, playbookReads, promptRoutes } from '../lib/checks.ts';
import type { Ctx } from '../lib/driver.ts';
import { parentSession, rewriteFinalReply } from '../lib/mutate.ts';
import { loadRun, type RunDir, type RunView, type WorkerView } from '../lib/view.ts';
import { PR_BODY, OWNER_FAMILY, type Unit } from './pr-autopilot.ts';
import { forgeResolvedOnce, REPO_FLAGS } from './pr-shared.ts';
import { mergesAreAuthorizedAndVerified, mergesIn, verdictsOf } from './pr-shipping.ts';
import type { Family } from './types.ts';

const OR = (anchor: string): Src => src('poteto-mode/playbooks/orchestrate.md', anchor);

const RUN = 'orchestrate-sub';
const SUB = 'sub-greet';
const SUB_RUN = 'sub-greet-area';
const WATCHER = 'watch-rollup';
const GREET = { 'src/greet.js': 'export const greet = (name) => `hello ${name}`;\n', 'test/greet.test.js': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { greet } from '../src/greet.js';\n\ntest('greet says hello', () => assert.equal(greet('ada'), 'hello ada'));\n" };
const SHOUT = { 'src/shout.js': 'export const shout = (name) => `HELLO ${name.toUpperCase()}`;\n', 'test/shout.test.js': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { shout } from '../src/shout.js';\n\ntest('shout is loud', () => assert.equal(shout('ada'), 'HELLO ADA'));\n" };

interface Store {
  handle?: ForgeHandle;
  units: Unit[];
}
const STORE: Store = { units: [] };

const OWNER_MODEL = 'sim/grok-sim';
const VERIFIER_MODEL = 'sim/claude-sim';
const LEAF_CAPS = { mcp: 'inherit', env: 'inherit', externalWrite: false };
const SUB_CAPS = { ...LEAF_CAPS, spawn: true };

const rootRunDir = (ctx: Ctx): string => join(ctx.repo, '.pi', 'pstack', 'runs', ctx.runId);
const subWorktree = (ctx: Ctx): string => join(rootRunDir(ctx), 'workers', SUB, 'worktree');
const subRunDir = (ctx: Ctx): string => join(subWorktree(ctx), '.pi', 'pstack', 'runs', SUB_RUN);
const leafDir = (ctx: Ctx, id: string): string => join(subRunDir(ctx), 'workers', id);
const leafWs = (ctx: Ctx, id: string): string => join(leafDir(ctx, id), 'worktree');
const ROLLUP = (ctx: Ctx): string => join(rootRunDir(ctx), 'sub-rollup.md');
const LOG = (ctx: Ctx): string => join(ctx.pkg, 'generated/skills/show-me-your-work/scripts/log.sh');
const forgeCli = (ctx: Ctx): string => `FORGE_GIT_DIR=${bareOf(ctx.sandbox)} node ${FORGE_CLI} gh`;

const kickoff = (unit: Unit, extra = ''): string => `You own PR ${unit.pr} (${unit.title}) from build to merge. Branch ${unit.branch} off ${unit.base}. Evidence that proves it done: node --test ${unit.testFile} passes in your worktree and the PR is open. Write only ${Object.keys(unit.files).join(' and ')}. Do not touch any other file, merge before your coordinator steers you, or force-push. Open the PR through the forge CLI, report the code-ready head, and wait for the verified head before you merge.${extra}`;

/** Writes a leaf worker's brief and assignment into the coordinator's own run and returns the spawn call, as Parent.stage does for the root's run. */
function stageLeaf(actor: Actor, ctx: Ctx, id: string, role: string, model: string, inputCommit: string, brief: string, capabilities: Record<string, unknown> = LEAF_CAPS) {
  const dir = leafDir(ctx, id);
  const assignment = { schemaVersion: 1, runId: SUB_RUN, workerId: id, kind: 'pi', role, model, thinkingLevel: null, workspace: { mode: 'worktree', inputCommit }, skills: [], brief: 'brief.md', capabilities };
  actor.write(join(dir, 'brief.md'), brief);
  actor.write(join(dir, 'assignment.json'), `${JSON.stringify(assignment, null, 2)}\n`);
  return { tool: 'pstack_worker', args: { action: 'spawn', runId: SUB_RUN, assignmentPath: join(dir, 'assignment.json') } };
}

const decide = (actor: Actor, ctx: Ctx, cells: string[]): Actor => actor.bash(['bash', LOG(ctx), JSON.stringify(join(subRunDir(ctx), 'decisions.tsv')), ...cells.map((cell) => JSON.stringify(cell))].join(' '));
const wait = (actor: Actor, id: string, count = 1): Actor => actor.wait(id, count);
const collect = (actor: Actor, id: string): Actor => actor.call('pstack_worker', { action: 'collect', runId: SUB_RUN, workerId: id });

/** An owner's script in its own worktree: build, self-proof, push, open the PR, report code-ready, then (after the steer) merge. */
function ownerScript(ctx: Ctx, unit: Unit): Worker {
  const worker = new Worker();
  const ws = leafWs(ctx, unit.id);
  const dir = leafDir(ctx, unit.id);
  const body = join(dir, 'pr-body.md');
  const forge = forgeCli(ctx);
  for (const [path, content] of Object.entries(unit.files)) worker.write(join(ws, path), content);
  worker.bash('printenv PSTACK_DEPTH');
  worker.bash(`cd ${ws} && node --test ${unit.testFile}`);
  worker.bash(`cd ${ws} && git add -A && ${COMMIT_PREFIX} git -c commit.gpgsign=false commit -q -m ${JSON.stringify(unit.title)}`);
  worker.bash(`cd ${ws} && git push -q origin HEAD:refs/heads/${unit.branch}`);
  worker.write(body, PR_BODY(unit.title.split(': ')[1] ?? unit.title, unit.testFile));
  worker.bash(`cd ${ws} && ${forge} pr create --title ${JSON.stringify(unit.title)} --body-file ${body} --base ${unit.base} --head ${unit.branch}`);
  const report = `code-ready: PR ${unit.pr} at head ${unit.sha}. Self-proof ${unit.testFile} passed.\n`;
  worker.write(join(dir, 'report.md'), report);
  worker.text(report);
  worker.bash(`cd ${ws} && git fetch -q origin main && echo "trunk checked"`);
  worker.bash(`cd ${ws} && ${forge} pr merge ${unit.pr} ${REPO_FLAGS} --squash --match-head-commit ${unit.sha}`);
  worker.bash(`cd ${ws} && ${forge} pr view ${unit.pr} ${REPO_FLAGS} --json state,baseRefName`);
  return worker.text(`merged PR ${unit.pr} at ${unit.sha}, read back as merged into main.`);
}

/** The first owner of PR 62 dies before it writes anything: its Pi process is killed, which the host records as a failed worker. */
const dyingOwner = (): Worker => new Worker().bash('echo starting; kill -9 $PPID');

function verifierScript(ctx: Ctx, unit: Unit, id: string): Worker {
  const worker = new Worker();
  const ws = leafWs(ctx, id);
  const forge = forgeCli(ctx);
  worker.bash('printenv PSTACK_DEPTH');
  worker.bash(`cd ${ws} && test "$(git rev-parse HEAD)" = ${unit.sha}`);
  worker.bash(`cd ${ws} && node --test ${unit.testFile}; true`);
  worker.bash(`cd ${ws} && patch=$(git show --format= -p HEAD | git patch-id --stable | cut -d' ' -f1) && if node --test ${unit.testFile} >/dev/null 2>&1; then v=PASS; else v=FAIL; fi && ${forge} pr comment ${unit.pr} ${REPO_FLAGS} --body "PSTACK-VERDICT: $v head=$(git rev-parse HEAD) verifier=${id} patch=$patch"`);
  const report = `Verified PR ${unit.pr} at ${unit.sha}: ran ${unit.testFile} in a clean worktree and posted the verdict on the PR.\n`;
  worker.write(join(leafDir(ctx, id), 'report.md'), report);
  return worker.text(report);
}

const verifierBrief = (unit: Unit): string => `You are the independent verifier for PR ${unit.pr} at head ${unit.sha}. You did not write it. Run the change the way a user would: node --test ${unit.testFile} in your worktree, which is at that head. Post exactly one verdict on the PR through node ${FORGE_CLI} gh pr comment ${unit.pr} ${REPO_FLAGS} --body "PSTACK-VERDICT: <PASS|PASS+NOTES|FAIL> head=<full sha> verifier=<your worker id> patch=<git show --format= -p HEAD | git patch-id --stable>". Green CI is not a verdict.`;

const SUB_KICKOFF = (units: Unit[]): string => `You coordinate one area of the program: PR ${units[0]?.pr} (greet) and PR ${units[1]?.pr} (shout), one owner per PR, each verified by a worker on another model family before its owner merges. Start with PR ${units[0]?.pr} all the way, then PR ${units[1]?.pr}. Run your own workers with pstack_worker in your own run, replace a worker that fails, and judge it by its pushes. Evidence that proves the area done: both PRs merged into main, read back live. You may write only your run and ${'sub-rollup.md'} in the root run. Do not merge anything yourself. When done, write one rollup to the root run's sub-rollup.md and end with it. Never relay raw worker reports.`;

function scenarioOf(ctx: Ctx, store: Store) {
  const [first, second] = store.units as [Unit, Unit];
  const second62b: Unit = { ...second, id: 'owner-62b' };
  const root = new Parent(ctx);
  const pr = REPO_FLAGS;
  root.beginPlaybook('orchestrate', 'Orchestrate the greet and shout area through a sub-coordinator');
  root.write(join(rootRunDir(ctx), 'notes.md'), '# Program notes\n\nGoal: greet and shout land as two PRs, one owner each, each verified on another model family.\n\nOne area, so one sub-coordinator: sub-greet owns PRs 61 and 62.\n');
  root.bash('command -v origin || echo "no origin CLI: staying on gh"');
  root.task('Forge: gh (origin CLI absent, fallback recorded)');
  root.task('Topology: one sub-coordinator for the greet and shout area; it owns one owner and one verifier per PR; I read one rollup');
  root.fire(root.stage(SUB, { role: 'general', model: VERIFIER_MODEL, workspace: root.worktree(first.from), capabilities: SUB_CAPS }, SUB_KICKOFF([first, second])));
  root.spawn(WATCHER, { kind: 'watch', role: 'watcher', model: 'inherit-parent', workspace: root.readonly(), watch: { argv: ['sh', '-c', `until [ -s ${ROLLUP(ctx)} ]; do sleep 0.5; done; echo rollup written`], cwd: ctx.repo } }, '');
  root.wait(WATCHER).collect(WATCHER);
  root.bash(`cat ${ROLLUP(ctx)}`);
  root.bash(`gh pr view 61 ${pr} --json state,baseRefName && gh pr view 62 ${pr} --json state,baseRefName`);
  root.decision('rollup', 'accept the sub-coordinator rollup', 'it names both PRs, the replaced owner and the verifier verdicts, and the live read confirms both merged', 'cat sub-rollup.md; gh pr view 61, 62', 'report to the operator');
  root.text(`Landed against the goal: PR 61 (greet) and PR 62 (shout) are merged, each read back live as merged into main. One sub-coordinator, sub-greet, ran the area: owner-61 built PR 61 and verifier-61 passed it; owner-62a failed before it pushed anything, so sub-greet replaced it with owner-62b, which built PR 62, and verifier-62 passed it. I read only its one rollup. Workers accounted for: sub-greet done, watch-rollup done. Dropped: nothing. Decisions waiting on you: none.`);

  const sub = new Actor();
  const probe = (branch: string) => `git ls-remote --heads origin ${branch} | wc -l`;
  sub.bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook orchestrate --title "Greet and shout area" --run-id ${SUB_RUN}`);
  sub.call('pstack_worker', stageLeaf(sub, ctx, 'c3', 'general', OWNER_MODEL, first.from, 'refused: a fourth level', SUB_CAPS).args);
  sub.together(stageLeaf(sub, ctx, first.id, 'owner', OWNER_MODEL, first.from, kickoff(first)));
  wait(sub, first.id);
  collect(sub, first.id);
  sub.bash('git fetch -q origin');
  sub.together(stageLeaf(sub, ctx, 'verifier-61', 'verifier', VERIFIER_MODEL, first.sha as string, verifierBrief(first)));
  wait(sub, 'verifier-61');
  collect(sub, 'verifier-61');
  sub.call('pstack_worker', { action: 'steer', runId: SUB_RUN, workerId: first.id, message: `PR 61 is verified PASS at head ${first.sha}. Merge it now with --match-head-commit ${first.sha}.` });
  wait(sub, first.id, 2);
  collect(sub, first.id);
  sub.bash(`gh pr view 61 ${pr} --json state,baseRefName`);
  decide(sub, ctx, ['unit-1', 'first unit landed, start the second', 'kickoff, owner, verifier and merge all worked for PR 61', 'gh pr view 61', 'spawn the owner of PR 62']);
  sub.together(stageLeaf(sub, ctx, 'owner-62a', 'owner', OWNER_MODEL, second.from, kickoff({ ...second, id: 'owner-62a' })));
  wait(sub, 'owner-62a');
  sub.call('pstack_worker', { action: 'inspect', runId: SUB_RUN, workerId: 'owner-62a' });
  sub.bash(probe(second.branch));
  decide(sub, ctx, ['unit-2', 'replace owner-62a', 'its host recorded a failed worker and it pushed nothing and opened no PR, so the same kickoff is retried', probe(second.branch), 'spawn owner-62b with the consolidated kickoff']);
  sub.together(stageLeaf(sub, ctx, 'owner-62b', 'owner', OWNER_MODEL, second.from, kickoff(second62b, ' The previous owner for this PR, owner-62a, failed (its Pi process exited) after it pushed nothing and opened no PR, so start from the kickoff and do not look for its work.')));
  wait(sub, 'owner-62b');
  collect(sub, 'owner-62b');
  sub.bash('git fetch -q origin');
  sub.together(stageLeaf(sub, ctx, 'verifier-62', 'verifier', VERIFIER_MODEL, second.sha as string, verifierBrief(second62b)));
  wait(sub, 'verifier-62');
  collect(sub, 'verifier-62');
  sub.call('pstack_worker', { action: 'steer', runId: SUB_RUN, workerId: 'owner-62b', message: `PR 62 is verified PASS at head ${second.sha}. Merge it now with --match-head-commit ${second.sha}.` });
  wait(sub, 'owner-62b', 2);
  collect(sub, 'owner-62b');
  sub.bash(`gh pr view 61 ${pr} --json state,baseRefName && gh pr view 62 ${pr} --json state,baseRefName`);
  const rollup = 'Rollup for the greet and shout area: PR 61 and PR 62 are merged into main, read back live. owner-61 built PR 61, verifier-61 passed it at the head, owner-61 merged. owner-62a failed before it pushed anything and was replaced by owner-62b, which built PR 62; verifier-62 passed it at the head and owner-62b merged. Nothing dropped.';
  sub.write(ROLLUP(ctx), `${rollup}\n`);
  sub.text(rollup);

  const workers: Record<string, Worker> = {
    [first.id]: ownerScript(ctx, first),
    'owner-62a': dyingOwner(),
    'owner-62b': ownerScript(ctx, second62b),
    'verifier-61': verifierScript(ctx, first, 'verifier-61'),
    'verifier-62': verifierScript(ctx, second62b, 'verifier-62'),
  };
  const built = scenario(root, workers);
  built.actors[SUB] = sub.steps;
  return built;
}

// ---- reading the tree a run left behind

interface Tree {
  subWorker: WorkerView | undefined;
  subRun: RunDir | undefined;
  leaves: WorkerView[];
  rootSessionFile: string;
}

function treeOf(view: RunView): Tree {
  const rootRun = view.runs[0];
  const candidates = rootRun?.workers.filter((worker) => (worker.assignment as { capabilities?: { spawn?: boolean } }).capabilities?.spawn === true) ?? [];
  if (candidates.length !== 1) throw new Error(`Expected one subcoordinator, candidates: ${candidates.map((worker) => worker.id).join(', ')}`);
  const subWorker = candidates[0];
  const runsDir = subWorker?.worktree ? join(subWorker.worktree, '.pi', 'pstack', 'runs') : '';
  const runs = existsSync(runsDir) ? readdirSync(runsDir).filter((id) => existsSync(join(runsDir, id, 'run.json'))).map((id) => loadRun(subWorker!.worktree!, id)) : [];
  const owned = runs.filter((run) => run.runJson?.['parentSessionFile'] === subWorker?.state?.['sessionFile']);
  if (owned.length !== 1) throw new Error(`Expected one coordinator-owned run, candidates: ${runs.map((run) => run.id).join(', ')}`);
  const subRun = owned[0];
  return { subWorker, subRun, leaves: (subRun?.workers ?? []).filter((worker) => worker.state !== null), rootSessionFile: view.parent.file };
}

/** The level of each process in the spawn tree, from who owns each run: the root session owns the root run, a worker's session owns the run it spawns into, and that run's workers sit one level below that worker. */
function levelsOf(view: RunView, tree: Tree): { sub: number; leaves: number[] } {
  const rootOwned = view.runs[0]?.runJson?.['parentSessionFile'] === tree.rootSessionFile;
  const sub = rootOwned && tree.subWorker !== undefined ? 2 : 0;
  const subOwnsRun = sub === 2 && typeof tree.subWorker?.state?.['sessionFile'] === 'string' && tree.subRun?.runJson?.['parentSessionFile'] === tree.subWorker.state['sessionFile'];
  return { sub, leaves: tree.leaves.map(() => (subOwnsRun ? 3 : 0)) };
}

const spawnsOf = (session: { toolCalls: { name: string; args: Record<string, unknown>; order: number; resultText: string; isError: boolean }[] } | null | undefined) => (session?.toolCalls ?? []).filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn');
const modelOf = (worker: WorkerView): string => String((worker.assignment as { model?: string }).model);
const idFromPath = (call: { args: Record<string, unknown> }): string => /\/workers\/([^/]+)\/assignment\.json$/.exec(String(call.args['assignmentPath']))?.[1] ?? '';

export const orchestrateSubFamily: Family = {
  id: 'orchestrate-sub',
  title: 'orchestrate with a sub-coordinator: the root spawns one coordinator, the coordinator spawns the owners and verifiers into its own run, one owner per PR, independent verifier families, a failed owner replaced, depth read from real nested spawns (spec 13.4)',
  spec: {
    family: 'orchestrate-sub',
    holdWatchers: /.*/,
    runId: RUN,
    history: cartHistory,
    timeoutMs: 480_000,
    prepare: (ctx) => {
      STORE.handle = setupForge(ctx, { owner: 'acme', name: 'widgets', branches: [], prs: [], reserve: { 'feat-greet-sub': 61, 'feat-shout-sub': 62 } });
      const base = STORE.handle.tip('main');
      const first: Unit = { id: 'owner-61', branch: 'feat-greet-sub', pr: 61, from: base, base: 'main', files: GREET, testFile: 'test/greet.test.js', title: 'feat(greet): add greet' };
      const second: Unit = { id: 'owner-62b', branch: 'feat-shout-sub', pr: 62, from: base, base: 'main', files: SHOUT, testFile: 'test/shout.test.js', title: 'feat(shout): add shout' };
      for (const unit of [first, second]) unit.sha = predictCommit(STORE.handle, { from: 'main', files: unit.files, message: unit.title });
      STORE.units = [first, second];
    },
    env: (ctx, driver) => forgeEnv(ctx, STORE.handle as ForgeHandle, { scripted: driver === 'scripted' }),
    prompt: () => '/poteto-mode orchestrate the program: land PR 61 (greet) and PR 62 (shout) through one sub-coordinator, one owner per PR, and merge each once it is verified. Do not stop to ask me.',
    scenario: (ctx) => scenarioOf(ctx, STORE),
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('orchestrate'),
    forgeResolvedOnce('orchestrate.sub.forge-resolved-once-gh-fallback-recorded', OR('Run it with your own tools'), 'gh'),
    check('orchestrate.sub.the-tree-is-three-levels-deep-from-real-nested-spawns', 'the root spawned only the coordinator (the one worker with capabilities.spawn), the coordinator made every leaf spawn call from its own session into its own run, the leaves are owned by the coordinator\'s session and hold no spawn capability, a spawn of a fourth level was refused and left no claim, and the root got wakes for the coordinator only', OR('Stop at three levels: you, sub-coordinators, and workers'), (view) => {
      const tree = treeOf(view);
      const rootSpawns = spawnsOf(view.parent).map(idFromPath);
      const subSpawns = spawnsOf(tree.subWorker?.session);
      const spawned = subSpawns.filter((call) => !call.isError).map(idFromPath);
      const refused = subSpawns.find((call) => call.isError);
      const levels = levelsOf(view, tree);
      const capable = [...(view.runs[0]?.workers ?? []), ...tree.leaves].filter((worker) => (worker.assignment as { capabilities?: { spawn?: boolean } }).capabilities?.spawn === true).map((worker) => worker.id);
      const c3Claimed = refused !== undefined && existsSync(join(tree.subRun?.dir ?? '', 'workers', idFromPath(refused), 'claim'));
      const wakes = view.parent.messages.filter((message) => message.customType === 'pstack-worker').map((message) => String(message.details?.['workerId']));
      const leafSessions = tree.leaves.every((worker) => worker.session !== null && worker.session.toolCalls.every((call) => call.name !== 'pstack_worker'));
      return when(
        rootSpawns.length === 2 && (view.runs[0]?.workers ?? []).filter((worker) => (worker.assignment as { kind?: string; role?: string }).kind === 'watch' && (worker.assignment as { role?: string }).role === 'watcher').length === 1 && JSON.stringify(rootSpawns.sort()) === JSON.stringify((view.runs[0]?.workers ?? []).map((worker) => worker.id).sort()) && tree.subRun !== undefined && tree.leaves.length === 5 && tree.leaves.every((worker) => spawned.includes(worker.id)) && levels.sub === 2 && levels.leaves.every((level) => level === 3) && JSON.stringify(capable) === JSON.stringify([tree.subWorker?.id]) && refused !== undefined && /spawn: true at depth 3/.test(refused.resultText) && !c3Claimed && wakes.every((id) => (view.runs[0]?.workers ?? []).some((worker) => worker.id === id)) && leafSessions,
        `root spawned ${rootSpawns.join(', ')}; the coordinator (level 2) spawned ${spawned.join(', ')} into run ${tree.subRun?.id}, owned by its session, so the leaves sit at level 3; only ${capable.join(', ')} can spawn; a fourth level was refused (no claim); the root woke for ${[...new Set(wakes)].join(', ')} only`,
        `root spawns ${JSON.stringify(rootSpawns)}; sub run ${tree.subRun?.id}; leaves ${tree.leaves.length}; coordinator spawns ${JSON.stringify(spawned)}; levels ${JSON.stringify(levels)}; capable ${JSON.stringify(capable)}; refused ${refused?.resultText.slice(0, 80)}; c3 claimed ${c3Claimed}; root wakes ${JSON.stringify([...new Set(wakes)])}; leaf sessions without spawn tools ${leafSessions}`,
      );
    }),
    check('orchestrate.sub.each-leaf-ran-at-the-depth-the-spawn-tree-gives-it', 'each leaf\'s own environment agrees with the tree: PSTACK_DEPTH is 3', OR('Stop at three levels: you, sub-coordinators, and workers'), (view) => {
      const tree = treeOf(view);
      const seen = tree.leaves.filter((worker) => worker.state?.['phase'] !== 'failed').map((worker) => ({ id: worker.id, out: worker.session?.toolCalls.find((call) => call.name === 'bash' && /printenv PSTACK_DEPTH/.test(String(call.args['command'])))?.resultText.trim().split('\n') ?? [] }));
      return when(seen.length === 4 && seen.every((entry) => entry.out[0] === '3'), `${seen.map((entry) => entry.id).join(', ')} all run with PSTACK_DEPTH 3`, JSON.stringify(seen));
    }),
    check('orchestrate.sub.one-owner-per-pr-the-only-writer-of-its-branch', 'each PR was opened by exactly one live owner that alone pushed its branch, the failed owner wrote nothing, and each PR\'s forge author is its owner', OR('**One owner per PR.**'), (view) => {
      const { state, actions } = readForge(view);
      const writers = (branch: string) => [...new Set(actions.filter((action) => ['push', 'ref-create', 'force-push'].includes(action.kind) && action['ref'] === `refs/heads/${branch}`).map((action) => action.worker))];
      const tree = treeOf(view);
      const authors = [state.prs['61']?.author, state.prs['62']?.author];
      const candidates = tree.leaves.filter((worker) => (worker.assignment as { role?: string }).role === 'owner' && !authors.includes(worker.id));
      if (candidates.length !== 1) throw new Error(`Expected one replaced owner, candidates: ${candidates.map((worker) => worker.id).join(', ')}`);
      const failed = candidates[0];
      const failedWrites = actions.filter((action) => action.worker === failed?.id && !['read', 'log-view'].includes(action.kind));
      const creates = actions.filter((action) => action.kind === 'create' && action.tool === 'gh');
      return when(failed !== undefined && new Set(authors).size === 2 && authors.every((id) => typeof id === 'string' && tree.leaves.some((worker) => worker.id === id && (worker.assignment as { role?: string }).role === 'owner')) && JSON.stringify(writers('feat-greet-sub')) === JSON.stringify([authors[0]]) && JSON.stringify(writers('feat-shout-sub')) === JSON.stringify([authors[1]]) && creates.length === 2 && failedWrites.length === 0, `PR 61 by ${authors[0]} alone, PR 62 by ${authors[1]} alone, two PRs opened, ${failed?.id} wrote nothing`, `authors ${state.prs['61']?.author}, ${state.prs['62']?.author}; writers ${JSON.stringify(writers('feat-greet-sub'))}, ${JSON.stringify(writers('feat-shout-sub'))}; creates ${creates.length}; failed owner writes ${failedWrites.length}`);
    }),
    check('orchestrate.sub.verifiers-are-on-another-family-and-owners-merge-after-the-verdict', 'each PR has a verifier on a different model family than its owner whose verdict names the head, and each owner merged only after that verdict, pinned to the head, with the coordinator\'s steer naming it', OR('**Each PR gets a verifier that isn\'t its author,** on a different model family'), (view) => {
      const { state, actions } = readForge(view);
      const tree = treeOf(view);
      const verdicts = verdictsOf(state, actions);
      const steers = spawnsOfSteer(tree);
      const problems = ([61, 62] as const).flatMap((pr, index) => {
        const ownerId = state.prs[String(pr)]?.author;
        const verifierId = verdicts.find((entry) => entry.pr === pr)?.verifier;
        const unit = STORE.units[index] as Unit;
        const owner = tree.leaves.find((worker) => worker.id === ownerId);
        const verifier = tree.leaves.find((worker) => worker.id === verifierId);
        const verdict = verdicts.find((entry) => entry.pr === pr);
        const merge = mergesIn(actions).find((entry) => entry.pr === pr);
        return [
          ...(owner === undefined || verifier === undefined || OWNER_FAMILY(modelOf(owner)) === OWNER_FAMILY(modelOf(verifier)) ? [`PR ${pr} verifier family is not independent`] : []),
          ...(verdict === undefined || verdict.head !== unit.sha || verdict.verdict === 'FAIL' || verdict.verifier !== verifierId || actions[verdict.at]?.worker !== verifierId ? [`PR ${pr} has no PASS at its head from its verifier`] : []),
          ...(merge === undefined || actions.indexOf(merge) < (verdict?.at ?? Number.POSITIVE_INFINITY) || merge.worker !== ownerId || merge.container ? [`PR ${pr} merge is not the owner's after the verdict`] : []),
          ...(!steers.some((call) => call.args['workerId'] === ownerId && String(call.args['message']).includes(String(unit.sha))) ? [`${ownerId} was never steered with the verified head`] : []),
        ];
      });
      return when(problems.length === 0, 'two independent verifiers, PASS at each head, each owner merges after its verdict on the coordinator\'s steer', problems.join('; '));
    }),
    mergesAreAuthorizedAndVerified('orchestrate.sub.no-merge-without-the-operators-request-and-a-verdict-at-that-head', OR('A verdict covers one head SHA, so a new push needs a new verdict')),
    check('orchestrate.sub.a-failed-owner-is-judged-by-its-pushes-and-replaced-with-a-consolidated-kickoff', 'the coordinator got the failed wake, inspected the owner, probed the branch for pushes, then spawned the replacement with the original kickoff plus the reason, and the host recorded the owner as failed', OR('**Stop or replace a worker that stalls or loops.**'), (view) => {
      const tree = treeOf(view);
      const session = tree.subWorker?.session;
      const authors = Object.values(readForge(view).state.prs).map((pr) => pr.author);
      const candidates = tree.leaves.filter((worker) => (worker.assignment as { role?: string }).role === 'owner' && !authors.includes(worker.id));
      if (candidates.length !== 1) throw new Error(`Expected one replaced owner, candidates: ${candidates.map((worker) => worker.id).join(', ')}`);
      const failed = candidates[0];
      const replacement = tree.leaves.find((worker) => worker.id === readForge(view).state.prs['62']?.author);
      const wake = session?.messages.find((message) => message.customType === 'pstack-worker' && failed !== undefined && message.details?.['workerId'] === failed.id);
      const inspect = session?.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'inspect' && failed !== undefined && call.args['workerId'] === failed.id);
      const probe = session?.toolCalls.find((call) => call.name === 'bash' && /git ls-remote --heads origin feat-shout-sub/.test(String(call.args['command'])));
      const respawn = spawnsOf(session).find((call) => replacement !== undefined && idFromPath(call) === replacement.id);
      const settles = (failed?.state?.['settles'] as { phase: string }[] | undefined) ?? [];
      return when(
        wake?.details?.['phase'] === 'failed' && settles.some((settle) => settle.phase === 'failed') && failed?.state?.['phase'] === 'failed' && inspect !== undefined && probe !== undefined && respawn !== undefined && wake.order < inspect.order && inspect.order < probe.order && probe.order < respawn.order && failed !== undefined && (replacement?.brief ?? '').includes(`${failed.id}, failed`) && /Evidence that proves it done/.test(replacement?.brief ?? ''),
        `failed wake at ${wake?.order}, inspected at ${inspect?.order}, probed at ${probe?.order}, replaced at ${respawn?.order} with the kickoff and the reason; host phase ${String(failed?.state?.['phase'])}`,
        `wake ${JSON.stringify(wake?.details)}; settles ${JSON.stringify(settles.map((settle) => settle.phase))}; inspect ${inspect?.order}; probe ${probe?.order}; respawn ${respawn?.order}; replacement brief ${(replacement?.brief ?? '').slice(0, 80)}`,
      );
    }),
    check('orchestrate.sub.the-root-read-one-rollup-and-the-live-state', 'the root read the coordinator\'s one rollup and both PRs live, collected no leaf worker and no raw report, and its reply accounts for the coordinator and the replaced owner without asking', OR('It owns that area\'s workers and kickoffs and sends you one rollup, never raw worker reports'), (view) => {
      const tree = treeOf(view);
      const failed = tree.leaves.filter((worker) => worker.state?.['phase'] === 'failed');
      const watchers = (view.runs[0]?.workers ?? []).filter((worker) => (worker.assignment as { role?: string }).role === 'watcher');
      const calls = view.parent.toolCalls;
      const collects = calls.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect').map((call) => String(call.args['workerId']));
      const cat = calls.find((call) => call.name === 'bash' && /cat .*sub-rollup\.md/.test(String(call.args['command'])))?.order ?? -1;
      const live = calls.find((call) => call.name === 'bash' && /^gh pr view 61 .*&& gh pr view 62/.test(String(call.args['command'])))?.order ?? -1;
      const rollup = existsSync(join(view.runs[0]?.dir ?? '', 'sub-rollup.md')) ? readFileSync(join(view.runs[0]?.dir ?? '', 'sub-rollup.md'), 'utf8') : '';
      const reply = finalReply(view);
      return when(watchers.length === 1 && JSON.stringify(collects) === JSON.stringify(watchers.map((worker) => worker.id)) && cat !== -1 && live > cat && /PR 61 and PR 62 are merged/.test(rollup) && failed.length === 1 && reply.includes(failed[0]!.id) && tree.subWorker !== undefined && reply.includes(tree.subWorker.id) && !reply.trim().endsWith('?'), `the watcher woke the root once the rollup existed; rollup read at ${cat}, live state at ${live}; only ${collects.join(', ')} collected; reply names ${tree.subWorker?.id} and the replaced owner`, `collects ${JSON.stringify(collects)}; rollup read ${cat}; live ${live}; rollup ${rollup.slice(0, 60)}; reply ${reply.slice(0, 80)}`);
    }),
    noToolErrors('orchestrate.sub.no-tool-errors', OR('**Ask the user only for a real decision or a blocker,**')),
  ],
  negatives: [
    { name: 'the root spawned a leaf itself', mutate: (sandbox) => appendRootSpawn(sandbox), fails: ['orchestrate.sub.the-tree-is-three-levels-deep-from-real-nested-spawns'] },
    { name: 'a leaf held the spawn capability', mutate: (sandbox) => patchLeaf(sandbox, 'owner-61', (assignment) => ((assignment['capabilities'] as Record<string, unknown>)['spawn'] = true)), fails: ['orchestrate.sub.the-tree-is-three-levels-deep-from-real-nested-spawns'] },
    { name: 'the leaves were owned by the root session, one level too shallow', mutate: (sandbox) => rewriteRunOwner(sandbox, (file) => parentSession(sandbox) || file), fails: ['orchestrate.sub.the-tree-is-three-levels-deep-from-real-nested-spawns'] },
    { name: 'a fourth level was claimed', mutate: (sandbox) => mkdirSync(join(subRunDirOf(sandbox), 'workers', 'c3', 'claim'), { recursive: true }), fails: ['orchestrate.sub.the-tree-is-three-levels-deep-from-real-nested-spawns'] },
    { name: 'a leaf ran one level deeper than the tree', mutate: (sandbox) => rewriteLeafSession(sandbox, 'owner-61', /(printenv PSTACK_DEPTH[\s\S]*?"text":")3\\n/, '$14\\n'), fails: ['orchestrate.sub.each-leaf-ran-at-the-depth-the-spawn-tree-gives-it'] },
    { name: 'a second owner pushed the same branch', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'push', ref: 'refs/heads/feat-shout-sub', worker: 'owner-61', run: SUB_RUN, actor: '', container: false } as ForgeAction)), fails: ['orchestrate.sub.one-owner-per-pr-the-only-writer-of-its-branch'] },
    { name: 'the failed owner had pushed a branch', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'ref-create', ref: 'refs/heads/feat-shout-sub', worker: 'owner-62a', run: SUB_RUN, actor: '', container: false } as ForgeAction)), fails: ['orchestrate.sub.one-owner-per-pr-the-only-writer-of-its-branch'] },
    { name: 'a verifier ran on its owner\'s model family', mutate: (sandbox) => patchLeaf(sandbox, 'verifier-62', (assignment) => (assignment['model'] = OWNER_MODEL)), fails: ['orchestrate.sub.verifiers-are-on-another-family-and-owners-merge-after-the-verdict'] },
    { name: 'an owner merged before the verdict was posted', mutate: (sandbox) => editForge(sandbox, (actions) => { const at = actions.findIndex((action) => action.kind === 'merge' && action.pr === 62); const [merge] = actions.splice(at, 1); actions.unshift(merge as ForgeAction); }), fails: ['orchestrate.sub.verifiers-are-on-another-family-and-owners-merge-after-the-verdict', 'orchestrate.sub.no-merge-without-the-operators-request-and-a-verdict-at-that-head'] },
    { name: 'the failed owner was never inspected or probed', mutate: (sandbox) => rewriteSubSession(sandbox, 'git ls-remote --heads origin feat-shout-sub', 'true'), fails: ['orchestrate.sub.a-failed-owner-is-judged-by-its-pushes-and-replaced-with-a-consolidated-kickoff'] },
    { name: 'the replacement got a bare kickoff', mutate: (sandbox) => writeFileSync(join(subRunDirOf(sandbox), 'workers', 'owner-62b', 'brief.md'), 'Build PR 62.'), fails: ['orchestrate.sub.a-failed-owner-is-judged-by-its-pushes-and-replaced-with-a-consolidated-kickoff'] },
    { name: 'the host never recorded the owner as failed', mutate: (sandbox) => patchLeafState(sandbox, 'owner-62a', (state) => { state['phase'] = 'idle'; state['settles'] = [{ sequence: 1, generation: 1, phase: 'idle', reason: null, at: new Date().toISOString() }]; }), fails: ['orchestrate.sub.a-failed-owner-is-judged-by-its-pushes-and-replaced-with-a-consolidated-kickoff'] },
    { name: 'the root collected a leaf\'s raw report', mutate: (sandbox) => appendRootCall(sandbox, { action: 'collect', runId: RUN, workerId: 'owner-61' }), fails: ['orchestrate.sub.the-root-read-one-rollup-and-the-live-state'] },
    { name: 'the reply asked the user', mutate: (sandbox) => rewriteFinalReply(sandbox, /$/, ' Should I continue?'), fails: ['orchestrate.sub.the-root-read-one-rollup-and-the-live-state'] },
    { name: 'the rollup never reached the root', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', '.pi', 'pstack', 'runs', RUN, 'sub-rollup.md'), ''), fails: ['orchestrate.sub.the-root-read-one-rollup-and-the-live-state'] },
  ],
};

const spawnsOfSteer = (tree: Tree) => (tree.subWorker?.session?.toolCalls ?? []).filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'steer');

// ---- negatives

const subRunDirOf = (sandbox: string): string => join(sandbox, 'repo', '.pi', 'pstack', 'runs', RUN, 'workers', SUB, 'worktree', '.pi', 'pstack', 'runs', SUB_RUN);

function patchLeaf(sandbox: string, id: string, change: (assignment: Record<string, unknown>) => void): void {
  const path = join(subRunDirOf(sandbox), 'workers', id, 'assignment.json');
  const assignment = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  change(assignment);
  writeFileSync(path, JSON.stringify(assignment, null, 2));
}

function patchLeafState(sandbox: string, id: string, change: (state: Record<string, unknown>) => void): void {
  const path = join(subRunDirOf(sandbox), 'workers', id, 'state.json');
  const state = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  change(state);
  writeFileSync(path, JSON.stringify(state, null, 2));
}

function rewriteRunOwner(sandbox: string, owner: (current: string) => string): void {
  const path = join(subRunDirOf(sandbox), 'run.json');
  const run = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  run['parentSessionFile'] = owner(String(run['parentSessionFile']));
  writeFileSync(path, JSON.stringify(run, null, 2));
}

const sessionOf = (dir: string): string => join(dir, 'session', readdirSync(join(dir, 'session')).find((name) => name.endsWith('.jsonl')) as string);

function rewriteLeafSession(sandbox: string, id: string, from: RegExp, to: string): void {
  const file = sessionOf(join(subRunDirOf(sandbox), 'workers', id));
  writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));
}

function rewriteSubSession(sandbox: string, from: string, to: string): void {
  const file = sessionOf(join(sandbox, 'repo', '.pi', 'pstack', 'runs', RUN, 'workers', SUB));
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll(from, to));
}

const appendRootSpawn = (sandbox: string): void => appendRootCall(sandbox, { action: 'spawn', runId: RUN, assignmentPath: '/x/workers/owner-61/assignment.json' });

function appendRootCall(sandbox: string, args: Record<string, unknown>): void {
  const file = parentSession(sandbox);
  const id = `forged-${Math.random().toString(36).slice(2, 8)}`;
  const stamp = new Date().toISOString();
  const lines = [
    { type: 'message', id: `${id}a`, parentId: null, timestamp: stamp, message: { role: 'assistant', content: [{ type: 'toolCall', id, name: 'pstack_worker', arguments: args }], provider: 'sim', model: 'forged', stopReason: 'toolUse', timestamp: Date.now() } },
    { type: 'message', id: `${id}b`, parentId: `${id}a`, timestamp: stamp, message: { role: 'toolResult', toolCallId: id, toolName: 'pstack_worker', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: Date.now() } },
  ];
  writeFileSync(file, `${readFileSync(file, 'utf8')}${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

export const orchestrateSubFamilies: Family[] = [orchestrateSubFamily];
