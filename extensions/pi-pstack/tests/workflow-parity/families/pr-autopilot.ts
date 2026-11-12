// Autopilot families (spec 13.4): one container owner per PR, a root that verifies at the head before an owner may merge,
// autopilot-stack that never merges, and an operator hold that reaches every owner in one message.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, proofSteps, scenario, Worker } from '../fixtures/dsl.ts';
import { bareOf, COMMIT_PREFIX, editForge, FORGE_CLI, forgeEnv, type ForgeAction, type ForgeHandle, predictCommit, predictCommits, readForge, revParse, setupForge, writeContainerScenario } from '../fixtures/forge.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, src, type Src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, finalReply, noToolErrors, openedAt, playbookFile, playbookReads, promptRoutes, todoChecks } from '../lib/checks.ts';
import type { Ctx } from '../lib/driver.ts';
import { dropWakes, parentSession, patchAssignment, rewriteFinalReply } from '../lib/mutate.ts';
import type { RunView, WorkerView } from '../lib/view.ts';
import { forgeResolvedOnce, REPO_FLAGS, stepDone } from './pr-shared.ts';
import { mergesAreAuthorizedAndVerified, mergesIn, removeRunContainers, stageVerifier, verdictsOf, verifierScript } from './pr-shipping.ts';
import { todoNegatives } from './shared.ts';
import type { Family } from './types.ts';

const AF = (anchor: string): Src => src('poteto-mode/playbooks/autopilot-full.md', anchor);
const AS = (anchor: string): Src => src('poteto-mode/playbooks/autopilot-stack.md', anchor);

export const PR_BODY = (what: string, verified: string): string => `## Why\n${what} is needed by the queue, so each PR lands on its own.\n\n## What changed\n- Adds ${what}.\n\n## Scope\n- Covers ${what} only.\n- Leaves every caller as is.\n\n## Blast Radius\nA new module nothing imports yet, so nothing existing can break.\n\n## Verification\n- ${verified}: passes in the container clone.\n`;

export interface Unit {
  /** Worker id of its owner. */
  id: string;
  branch: string;
  pr: number;
  /** The branch or commit the owner's clone starts from. */
  from: string;
  base: string;
  files: Record<string, string>;
  testFile: string;
  title: string;
  sha?: string;
}

const GREET = { 'src/greet.js': 'export const greet = (name) => `hello ${name}`;\n', 'test/greet.test.js': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { greet } from '../src/greet.js';\n\ntest('greet says hello', () => assert.equal(greet('ada'), 'hello ada'));\n" };
const SHOUT = { 'src/shout.js': 'export const shout = (name) => `HELLO ${name.toUpperCase()}`;\n', 'test/shout.test.js': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { shout } from '../src/shout.js';\n\ntest('shout is loud', () => assert.equal(shout('ada'), 'HELLO ADA'));\n" };
const SHOUT_STACKED = { 'src/shout.js': "import { greet } from './greet.js';\n\nexport const shout = (name) => greet(name).toUpperCase();\n", 'test/shout.test.js': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { shout } from '../src/shout.js';\n\ntest('shout is the loud greeting', () => assert.equal(shout('ada'), 'HELLO ADA'));\n" };

const unitA = (pr: number, branch: string): Unit => ({ id: 'owner-a', branch, pr, from: 'main', base: 'main', files: GREET, testFile: 'test/greet.test.js', title: 'feat(greet): add greet' });
const unitB = (pr: number, branch: string, from: string, base: string, files: Record<string, string>): Unit => ({ id: 'owner-b', branch, pr, from, base, files, testFile: 'test/shout.test.js', title: 'feat(shout): add shout' });

const WS = '/tmp/workspace';
const LOG = (ctx: Ctx) => join(ctx.pkg, 'generated/skills/show-me-your-work/scripts/log.sh');

/** An owner's script in its container: build, self-proof, push, open the PR, report code-ready, then (after a go) merge or stand down. */
export function ownerScript(ctx: Ctx, parent: Parent, unit: Unit, after: 'merge' | 'stand-down' | 'none'): Worker {
  const worker = new Worker();
  const dir = parent.workerDir(unit.id);
  const body = join(dir, 'pr-body.md');
  const forge = `node ${FORGE_CLI} gh`;
  for (const [path, content] of Object.entries(unit.files)) worker.write(join(WS, path), content);
  proofSteps(worker, ctx, { id: `${unit.id}-selfproof`, target: `pr-${unit.pr}`, command: `node --test ${unit.testFile}`, cwd: WS, kind: 'test', dir: join(dir, 'evidence') }, join(dir, 'evidence'));
  worker.bash(`cd ${WS} && git add -A && ${COMMIT_PREFIX} git -c commit.gpgsign=false commit -q -m ${JSON.stringify(unit.title)}`);
  worker.bash(`cd ${WS} && git push -q origin HEAD:refs/heads/${unit.branch}`);
  worker.write(body, PR_BODY(unit.title.split(': ')[1] ?? unit.title, unit.testFile));
  worker.bash(`cd ${WS} && ${forge} pr create --title ${JSON.stringify(unit.title)} --body-file ${body} --base ${unit.base} --head ${unit.branch}`);
  worker.bash(`bash ${LOG(ctx)} ${dir}/decisions.tsv build "open the PR early" "CI and bots run alongside" "${unit.branch} pushed" "PR ${unit.pr} open"`);
  const head = unit.sha as string;
  const report = `code-ready: PR ${unit.pr} at head ${head}. Self-proof ${unit.testFile} passed. Slop-strip and no-comments passes done.\n`;
  worker.write(join(dir, 'report.md'), report);
  worker.bash(`printf 'depth=%s\\n' "$PSTACK_DEPTH" >> ${join(dir, 'report.md')}`);
  worker.text(report);
  if (after === 'merge') {
    worker.bash(`cd ${WS} && git fetch -q origin main && (git merge-base --is-ancestor origin/main HEAD && echo "trunk unchanged" || echo "trunk moved: only unrelated files changed, so no rebase")`);
    worker.bash(`cd ${WS} && ${forge} pr merge ${unit.pr} ${REPO_FLAGS} --squash --match-head-commit ${head}`);
    worker.bash(`cd ${WS} && ${forge} pr view ${unit.pr} ${REPO_FLAGS} --json state,baseRefName`);
    worker.text(`merged PR ${unit.pr} at ${head}, read back as merged into main.`);
  }
  if (after === 'stand-down') worker.text(`Standing down. PR ${unit.pr} is open at head ${head}, with no write in flight and nothing to push. I keep my brief until you release me.`);
  return worker;
}

const stageOwner = (parent: Parent, unit: Unit): { tool: string; args: Record<string, unknown> } =>
  parent.stage(unit.id, { role: 'owner', model: 'sim/grok-sim', workspace: { mode: 'container', inputCommit: unit.from }, capabilities: { mcp: 'inherit', env: 'minimal', externalWrite: false, forge: true } }, ownerBrief(unit));

const ownerBrief = (unit: Unit): string => `You own PR ${unit.pr} (${unit.title}) from build to merge. Branch ${unit.branch} off ${unit.base}. Build it, run ${unit.testFile}, push the branch, open the PR per playbooks/opening-a-pr.md with node ${FORGE_CLI} gh, report the code-ready head, and wait. Merge only after the root steers you with a verdict at that head. Force-push only your own branch.`;

// ---- the shared run: forge, units, prediction

interface Store {
  handle?: ForgeHandle;
  units: Unit[];
}

function prepare(ctx: Ctx, store: Store, scenarioOf: (ctx: Ctx) => unknown, units: (handle: ForgeHandle) => Unit[], reserve: Record<string, number>): void {
  store.handle = setupForge(ctx, { owner: 'acme', name: 'widgets', branches: [], prs: [], reserve });
  store.units = units(store.handle);
  writeContainerScenario(ctx, scenarioOf(ctx));
}

const specOf = (id: string, runId: string, store: Store, scenarioOf: (ctx: Ctx) => ReturnType<typeof scenario>, units: (handle: ForgeHandle) => Unit[], reserve: Record<string, number>, prompt: string, followUps: string[] = []): Family['spec'] => ({
  family: id,
  runId,
  history: cartHistory,
  timeoutMs: 480_000,
  prepare: (ctx) => prepare(ctx, store, scenarioOf, units, reserve),
  env: (ctx, driver) => forgeEnv(ctx, store.handle as ForgeHandle, { container: true, scripted: driver === 'scripted' }),
  cleanup: () => removeRunContainers(runId),
  prompt: () => prompt,
  ...(followUps.length === 0 ? {} : { followUps: () => followUps }),
  scenario: scenarioOf,
});

const independentUnits = () => (handle: ForgeHandle): Unit[] => {
  const base = handle.tip('main');
  const a = unitA(31, 'feat-greet');
  const b = unitB(32, 'feat-shout', base, 'main', SHOUT);
  a.from = base;
  for (const unit of [a, b]) unit.sha = predictCommit(handle, { from: 'main', files: unit.files, message: unit.title });
  return [a, b];
};

const stackedUnits = (handle: ForgeHandle): Unit[] => {
  const base = handle.tip('main');
  const a = unitA(41, 'feat-greet-stack');
  a.from = base;
  const b = unitB(42, 'feat-shout-stack', 'pending', 'feat-greet-stack', SHOUT_STACKED);
  const shas = predictCommits(handle, { from: 'main', steps: [a, b].map((unit) => ({ files: unit.files, message: unit.title })) });
  a.sha = shas[0] as string;
  b.sha = shas[1] as string;
  b.from = a.sha;
  return [a, b];
};

// ---- shared checks

const OWNER_FAMILY = (model: string): string => model.slice(model.indexOf('/') + 1).split(/[-.]/)[0] as string;

const ownerWorkers = (view: RunView): WorkerView[] => allWorkers(view).filter((worker) => assignmentOf(worker).role === 'owner');

function onePerPrOwners(id: string, source: Src | Src[], units: (view: RunView) => Unit[], options: { from: 'trunk' | 'stack' }): Check {
  return check(id, 'one container owner per PR, each with the forge capability, a distinct id, workspace at its own start commit, and the PR it opened carries that owner as its author', source, (view) => {
    const { state, actions } = readForge(view);
    const owners = ownerWorkers(view);
    const wanted = units(view);
    const problems = wanted.flatMap((unit) => {
      const worker = owners.find((entry) => entry.id === unit.id);
      const pr = state.prs[String(unit.pr)];
      if (worker === undefined) return [`no owner ${unit.id}`];
      const assignment = assignmentOf(worker) as { workspace?: { mode?: string; inputCommit?: string }; capabilities?: Record<string, unknown> };
      const caps = assignment.capabilities ?? {};
      const create = actions.find((action) => action.kind === 'create' && action.pr === unit.pr);
      return [
        ...(assignment.workspace?.mode !== 'container' ? [`${unit.id} workspace ${String(assignment.workspace?.mode)}`] : []),
        ...(assignment.workspace?.inputCommit !== unit.from ? [`${unit.id} starts at ${String(assignment.workspace?.inputCommit).slice(0, 8)}, not ${unit.from.slice(0, 8)} (${options.from})`] : []),
        ...(caps['forge'] !== true || caps['env'] !== 'minimal' || caps['externalWrite'] !== false ? [`${unit.id} capabilities ${JSON.stringify(caps)}`] : []),
        ...(pr?.author !== unit.id || create?.worker !== unit.id || create?.container !== true ? [`PR ${unit.pr} was not opened by ${unit.id} from its container`] : []),
        ...(worker.session?.cwd !== WS ? [`${unit.id} ran in ${String(worker.session?.cwd)}`] : []),
      ];
    });
    const sharedPr = new Set(actions.filter((action) => action.kind === 'create' && action.tool === 'gh').map((action) => action.pr)).size;
    return when(owners.length === wanted.length && sharedPr === wanted.length && problems.length === 0, `${owners.map((worker) => worker.id).join(', ')}: one container owner per PR, forge capability, own PR`, `${owners.length} owners for ${wanted.length} PRs; ${problems.join('; ')}`);
  });
}

type Check = ReturnType<typeof check>;

/** Each owner pushed only its own branch, never forced, and left a decision trail and a self-proof receipt. */
function ownerHygiene(id: string, source: Src | Src[], units: (view: RunView) => Unit[]): Check {
  return check(id, 'each owner pushed its own branch as a plain push (no force), wrote a decision trail in its worker directory, and recorded its self-proof receipt', source, (view) => {
    const { actions } = readForge(view);
    const run = view.runs[0];
    const problems = units(view).flatMap((unit) => {
      const pushes = actions.filter((action) => ['push', 'ref-create', 'force-push'].includes(action.kind) && action.worker === unit.id);
      const foreign = pushes.filter((action) => action['ref'] !== `refs/heads/${unit.branch}`);
      const forced = pushes.filter((action) => action.kind === 'force-push');
      const trail = readFileSync(join(run?.dir ?? '', 'workers', unit.id, 'out', 'decisions.tsv'), { encoding: 'utf8', flag: 'r' });
      const receipt = run?.receipts.find((entry) => entry.id === `${unit.id}-selfproof`);
      return [...(pushes.length === 0 ? [`${unit.id} pushed nothing`] : []), ...(foreign.length > 0 ? [`${unit.id} pushed ${foreign.map((action) => String(action['ref'])).join(', ')}`] : []), ...(forced.length > 0 ? [`${unit.id} force-pushed`] : []), ...(!/open the PR early/.test(trail) ? [`${unit.id} left no decision trail`] : []), ...(receipt === undefined || receipt.verdict !== 'pass' ? [`${unit.id} has no passing self-proof receipt`] : [])];
    });
    return when(problems.length === 0, 'own branch only, no force-push, trail and self-proof recorded', problems.join('; '));
  });
}

/** Each PR's body carries the opening-a-pr sections in order. */
export const BODY_SECTIONS = ['Why', 'What changed', 'Scope', 'Blast Radius', 'Verification'];

export function bodyHasSections(body: string): string[] {
  const found = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1] as string);
  const order = found.filter((heading) => BODY_SECTIONS.includes(heading) || heading === 'Tradeoffs');
  const wanted = ['Why', 'What changed', 'Scope', 'Tradeoffs', 'Blast Radius', 'Verification'];
  const positions = order.map((heading) => wanted.indexOf(heading));
  return [...BODY_SECTIONS.filter((heading) => !found.includes(heading)).map((heading) => `lacks ## ${heading}`), ...(positions.some((position, index) => index > 0 && position < (positions[index - 1] as number)) ? ['sections out of order'] : [])];
}

function verifiersIndependent(id: string, source: Src | Src[], units: (view: RunView) => Unit[]): Check {
  return check(id, 'each PR has a container verifier on a different model family than its owner, started only after the owner reported code-ready, at exactly the code-ready head, and its verdict was posted by it', source, (view) => {
    const { state, actions } = readForge(view);
    const verdicts = verdictsOf(state, actions);
    const problems = units(view).flatMap((unit) => {
      const verifier = allWorkers(view).find((worker) => worker.id === `verifier-${unit.pr}`);
      const owner = ownerWorkers(view).find((worker) => worker.id === unit.id);
      const verdict = verdicts.find((entry) => entry.pr === unit.pr);
      if (verifier === undefined || owner === undefined) return [`PR ${unit.pr} lacks a verifier or an owner`];
      const spawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes(`/${verifier.id}/`))?.order ?? -1;
      const ownerWake = view.parent.messages.find((message) => message.customType === 'pstack-worker' && message.details?.['workerId'] === owner.id)?.order ?? Number.POSITIVE_INFINITY;
      const assignment = assignmentOf(verifier) as { workspace?: { mode?: string; inputCommit?: string }; capabilities?: Record<string, unknown> };
      return [
        ...(OWNER_FAMILY(String(assignmentOf(verifier).model)) === OWNER_FAMILY(String(assignmentOf(owner).model)) ? [`${verifier.id} runs on the owner's model family`] : []),
        ...(spawn < ownerWake ? [`${verifier.id} was spawned (${spawn}) before ${owner.id} reported (${ownerWake})`] : []),
        ...(assignment.workspace?.mode !== 'container' || assignment.workspace.inputCommit !== unit.sha || assignment.capabilities?.['forge'] !== true ? [`${verifier.id} is not a forge container worker at ${unit.sha?.slice(0, 8)}`] : []),
        ...(verdict === undefined || verdict.head !== unit.sha || verdict.verifier !== verifier.id || actions[verdict.at]?.worker !== verifier.id ? [`PR ${unit.pr} verdict ${JSON.stringify(verdict)}`] : []),
      ];
    });
    return when(problems.length === 0, 'verifiers independent, after code-ready, at the head, own verdicts', problems.join('; '));
  });
}

const rootAudited = (id: string, source: Src | Src[]): Check =>
  check(id, 'the root audited the receipts through pstack_evidence after the verifiers were collected and before any owner was told to merge', source, (view) => {
    const audit = view.parent.toolCalls.find((call) => call.name === 'pstack_evidence' && ['list', 'verify'].includes(String(call.args['action'])) && !call.isError)?.order ?? -1;
    const lastCollect = Math.max(...[31, 32, 41, 42].map((pr) => view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect' && call.args['workerId'] === `verifier-${pr}`)?.order ?? -1));
    const steer = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'steer')?.order ?? Number.POSITIVE_INFINITY;
    return when(audit > lastCollect && audit < steer, `receipts audited at ${audit}, after the last verifier collect (${lastCollect}) and before the first go (${steer})`, `audit ${audit}, last collect ${lastCollect}, first steer ${steer}`);
  });

const hourlyWatch = (id: string, source: Src | Src[], options: { aborted: boolean }): Check =>
  check(id, `the root armed an hourly watch loop (watcher, sleep 3600, absolute cwd)${options.aborted ? ' and stopped it once no delegated work was left' : ''}`, source, (view) => {
    const watcher = allWorkers(view).find((worker) => assignmentOf(worker).kind === 'watch');
    const argv = assignmentOf(watcher as never).watch?.argv ?? [];
    const ownerSpawn = Math.min(...ownerWorkers(view).map((worker) => view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes(`/${worker.id}/`))?.order ?? Number.POSITIVE_INFINITY));
    const watchSpawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes('/watch-hourly/'))?.order ?? -1;
    const abort = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'abort' && call.args['workerId'] === 'watch-hourly' && !call.isError)?.order ?? -1;
    const lastMerge = Math.max(...view.parent.toolCalls.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect').map((call) => call.order));
    return when(watcher !== undefined && assignmentOf(watcher).role === 'watcher' && argv[0] === 'sleep' && argv[1] === '3600' && assignmentOf(watcher).watch?.cwd === view.repo && watchSpawn > ownerSpawn && (!options.aborted || abort > lastMerge), `sleep 3600 at ${view.repo}, armed at ${watchSpawn} after the owners (${ownerSpawn})${options.aborted ? `, aborted at ${abort}` : ''}`, `watcher ${JSON.stringify(argv)}, armed ${watchSpawn}, owners ${ownerSpawn}, abort ${abort}, last collect ${lastMerge}`);
  });

// ---- autopilot-full

const FULL_RUN = 'autopilot-full-queue';
const FULL_STORE: Store = { units: [] };
const PROMPT_FULL = '/poteto-mode autopilot this queue, full autopilot, go: PR 31 adds greet, PR 32 adds shout. Merge each once it is verified.';

function rootBegin(parent: Parent, playbook: string, title: string): { pr: string } {
  parent.beginPlaybook(playbook, title);
  if (playbook === 'autopilot-stack') parent.readPlaybook('autopilot-full');
  if (playbook === 'autopilot-full') for (const skill of ['deslop', 'show-me-your-work', 'swarm', 'control-ui', 'control-cli', 'ketchup']) parent.readSkill(skill);
  parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
  parent.task('Forge: gh (origin CLI absent, fallback recorded)');
  return { pr: REPO_FLAGS };
}

function fullScenario(ctx: Ctx, store: Store, mode: 'merge' | 'hold') {
  const parent = new Parent(ctx);
  const [a, b] = store.units as [Unit, Unit];
  const dir = parent.runDir;
  const { pr } = rootBegin(parent, 'autopilot-full', 'Autopilot the greet and shout queue');
  parent.task('Grant: autopilot queue is PR 31 and PR 32; operator-held items: none; the go is the operator\'s prompt');
  stepDone(parent, 'autopilot-full', 1, 'af-gates', `grep -q 'Grant: autopilot queue' ${join(dir, 'TODO.md')}`);
  parent.fire(stageOwner(parent, a), stageOwner(parent, b));
  parent.spawn('watch-hourly', { kind: 'watch', role: 'watcher', model: 'inherit-parent', workspace: parent.readonly(), watch: { argv: ['sleep', '3600'], cwd: ctx.repo } }, '');
  parent.wait('owner-a').wait('owner-b').collect('owner-a', 'owner-b');
  stepDone(parent, 'autopilot-full', 2, 'af-owners', `test $(gh pr list ${pr} --state open --json number | grep -o number | wc -l) -eq 2`);
  parent.bash(`gh pr view 31 ${pr} --json headRefOid,baseRefName,state && gh pr view 32 ${pr} --json headRefOid,baseRefName,state`);
  stepDone(parent, 'autopilot-full', 3, 'af-parallel', `gh pr view 32 ${pr} --json baseRefName | grep -q main`);
  if (mode === 'hold') {
    parent.text('Both owners reported code-ready: PR 31 and PR 32 are open off main. Verification starts next.');
    parent.together(...[a, b].map((unit) => ({ tool: 'pstack_worker', args: { action: 'steer', runId: ctx.runId, workerId: unit.id, message: `HOLD from the operator: zero writes now. Do not push, comment, rebase or merge. Report where you stand, and keep your brief until the operator releases you.` } })));
    parent.wait('owner-a', 2).wait('owner-b', 2).collect('owner-a', 'owner-b');
    for (const n of [4, 5, 6]) parent.skip('autopilot-full', n, 'the operator held the queue before verification, so nothing is verified or merged');
    stepDone(parent, 'autopilot-full', 7, 'af-hold', `grep -q 'Standing down' ${join(dir, 'workers/owner-a/report.md')} || true`);
    parent.text(`Held at the operator's word. Both owners got the zero-writes order in one message and report standing down: PR 31 at ${a.sha}, PR 32 at ${b.sha}, no write in flight. Nothing merged. Each keeps its brief until you release it.`);
  } else {
    parent.bash('git fetch -q origin');
    parent.fire(...[a, b].map((unit) => stageVerifier(parent, `verifier-${unit.pr}`, unit.pr, unit.sha as string, unit.testFile)));
    parent.wait('verifier-31').wait('verifier-32').collect('verifier-31', 'verifier-32');
    stepDone(parent, 'autopilot-full', 4, 'af-swarm', `test $(gh pr view 31 ${pr} --json comments | grep -c PSTACK-VERDICT) -ge 1`);
    parent.call('pstack_evidence', { action: 'list', runId: ctx.runId });
    parent.decision('verdict', 'PR 31 and PR 32 verified at their code-ready heads', 'two independent verifiers re-ran each PR test in a container clone and posted PASS', 'gh pr view 31, 32 --json comments', 'owners may merge');
    parent.together(...[a, b].map((unit) => ({ tool: 'pstack_worker', args: { action: 'steer', runId: ctx.runId, workerId: unit.id, message: `PR ${unit.pr} is verified PASS at head ${unit.sha}. Merge it now with --match-head-commit ${unit.sha}.` } })));
    parent.wait('owner-a', 2).wait('owner-b', 2).collect('owner-a', 'owner-b');
    parent.bash(`gh pr view 31 ${pr} --json state,baseRefName && gh pr view 32 ${pr} --json state,baseRefName`);
    stepDone(parent, 'autopilot-full', 5, 'af-merge', `gh pr view 31 ${pr} --json state | grep -q MERGED`);
    parent.call('pstack_worker', { action: 'abort', runId: ctx.runId, workerId: 'watch-hourly' });
    stepDone(parent, 'autopilot-full', 6, 'af-root-layer', `gh pr view 32 ${pr} --json state | grep -q MERGED`);
    parent.skip('autopilot-full', 7, 'the operator issued no stop');
    parent.text(`Caught up: PR 31 (greet) and PR 32 (shout) are merged. Each was verified PASS by its own independent verifier at the code-ready head before its owner merged, and each merge was read back as merged into main. No countersign was needed because no gate was loosened. Open operator gates: none. Parked follow-ups: none. Trails are in each owner's worker directory.`);
  }
  const workers: Record<string, Worker> = {
    'owner-a': ownerScript(ctx, parent, a, mode === 'merge' ? 'merge' : 'stand-down'),
    'owner-b': ownerScript(ctx, parent, b, mode === 'merge' ? 'merge' : 'stand-down'),
  };
  if (mode === 'merge') for (const unit of [a, b]) workers[`verifier-${unit.pr}`] = verifierScript(ctx, parent, { id: `verifier-${unit.pr}`, pr: unit.pr, head: unit.sha as string, testFile: unit.testFile });
  return scenario(parent, workers);
}

const unitsOf = (store: Store) => (): Unit[] => store.units;

const fullChecks = (prefix: string, store: Store): Check[] => [
  promptRoutes('poteto-mode'),
  ...playbookReads('autopilot-full'),
  forgeResolvedOnce(`${prefix}.forge-resolved-once-gh-fallback-recorded`, AF('GitHub CLI (`gh`) is the default'), 'gh'),
  onePerPrOwners(`${prefix}.one-container-owner-per-pr-off-trunk`, AF('Spawn one owner per PR'), unitsOf(store), { from: 'trunk' }),
  ownerHygiene(`${prefix}.owners-push-their-own-branch-and-keep-a-trail`, AF('Assume the container dies'), unitsOf(store)),
  check(`${prefix}.prs-open-ready-with-the-required-body-sections`, 'each PR was opened ready (not draft) through the resolved forge with the opening-a-pr body sections in order', src('poteto-mode/playbooks/opening-a-pr.md', 'Use `##` headings'), (view) => {
    const { state, actions } = readForge(view);
    const problems = Object.values(state.prs).flatMap((pr) => {
      const create = actions.find((action) => action.kind === 'create' && action.pr === pr.number);
      return [...bodyHasSections(pr.body).map((issue) => `PR ${pr.number} ${issue}`), ...(create?.['draft'] === true ? [`PR ${pr.number} opened as a draft`] : []), ...(create?.tool !== 'gh' ? [`PR ${pr.number} not opened through gh`] : [])];
    });
    return when(Object.keys(state.prs).length > 0 && problems.length === 0, `${Object.keys(state.prs).length} PRs, ready, sections in order`, problems.join('; '));
  }),
  hourlyWatch(`${prefix}.hourly-watch-loop-armed-on-the-go`, AF('arm an hourly watch loop to audit until no delegated work is left'), { aborted: prefix !== 'autopilot.hold' }),
  noToolErrors(`${prefix}.no-tool-errors`, AF('Run the root layer')),
];

export const autopilotFullFamily: Family = {
  id: 'autopilot-full',
  requires: 'container',
  title: 'autopilot-full: one container owner per PR off trunk, independent verifiers at the code-ready head, an owner merges only what the root verified, an hourly watch loop (spec 13.4)',
  spec: specOf('autopilot-full', FULL_RUN, FULL_STORE, (ctx) => fullScenario(ctx, FULL_STORE, 'merge'), independentUnits(), { 'feat-greet': 31, 'feat-shout': 32 }, PROMPT_FULL),
  checks: [
    ...fullChecks('autopilot.full', FULL_STORE),
    ...todoChecks({ playbook: 'autopilot-full', skipReason: { 7: /stop/ } }),
    verifiersIndependent('autopilot.full.independent-verifier-per-pr-on-another-family-at-the-head', AF('Swarm-verify once'), unitsOf(FULL_STORE)),
    rootAudited('autopilot.full.root-audits-receipts-before-any-go', AF('The verdict is not clean without the live lane, or before you audit the merge-ready report\'s receipts')),
    mergesAreAuthorizedAndVerified('autopilot.full.no-merge-without-a-verdict-at-that-head', AF('The owner merges only what you verified')),
    check('autopilot.full.the-owner-merges-its-own-pr-after-the-root-says-go', 'each merge was made by its PR\'s own owner from its container, after the root steered that owner, pinned to the verified head, and both PRs landed in main', AF('The owner merges only what you verified'), (view) => {
      const { state, actions } = readForge(view);
      const merges = mergesIn(actions);
      const steers = view.parent.toolCalls.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'steer');
      const problems = merges.flatMap((merge) => {
        const author = state.prs[String(merge.pr)]?.author;
        return [...(merge.worker !== author || merge.container !== true ? [`PR ${merge.pr} merged by ${merge.worker}, not its owner ${String(author)}`] : []), ...(!steers.some((call) => call.args['workerId'] === author && String(call.args['message']).includes(String(merge['head']))) ? [`PR ${merge.pr} owner was never steered with the verified head`] : [])];
      });
      return when(merges.length === 2 && problems.length === 0 && Object.values(state.prs).every((pr) => pr.state === 'MERGED'), 'two merges, each by its owner after a go that names the verified head', `${merges.length} merges; ${problems.join('; ')}`);
    }),
    check('autopilot.full.reply-catches-the-operator-up', 'the reply covers each PR\'s state and verdict, what merged, countersigns, open operator gates and parked follow-ups', AF('**Reply:** catch the operator up'), (view) => {
      const reply = finalReply(view);
      const missing = [/PR 31.*PR 32.*merged/, /verified PASS/, /countersign/, /Open operator gates/, /Parked follow-ups/].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0 && openedAt(view.parent, 'generated/skills/ketchup/SKILL.md') !== -1, 'ketchup read, every part present', `missing ${missing.join(', ')}`);
    }),
  ],
  negatives: [
    ...todoNegatives(FULL_RUN, 'autopilot-full', { done: [1, 2, 3, 4, 5, 6], receipts: { 1: 'af-gates', 2: 'af-owners', 3: 'af-parallel', 4: 'af-swarm', 5: 'af-merge', 6: 'af-root-layer' } }),
    { name: 'an owner merged with no verdict posted for its PR', mutate: (sandbox) => editForge(sandbox, (actions) => actions.splice(0, actions.length, ...actions.filter((action) => !(action.kind === 'comment' && action.pr === 31)))), fails: ['autopilot.full.no-merge-without-a-verdict-at-that-head', 'autopilot.full.independent-verifier-per-pr-on-another-family-at-the-head'] },
    { name: 'an owner verified its own PR', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'comment' && action.pr === 32) action.worker = 'owner-b'; })), fails: ['autopilot.full.no-merge-without-a-verdict-at-that-head', 'autopilot.full.independent-verifier-per-pr-on-another-family-at-the-head'] },
    { name: 'a merge was not pinned to the verified head', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'merge') action['requested'] = null; })), fails: ['autopilot.full.no-merge-without-a-verdict-at-that-head'] },
    { name: 'the root merged instead of the owner', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'merge' && action.pr === 31) { action.worker = ''; action.container = false; } })), fails: ['autopilot.full.the-owner-merges-its-own-pr-after-the-root-says-go'] },
    { name: 'a verifier ran on the owner\'s model family', mutate: (sandbox) => patchAssignment(sandbox, FULL_RUN, 'verifier-31', (assignment) => (assignment['model'] = 'sim/grok-sim')), fails: ['autopilot.full.independent-verifier-per-pr-on-another-family-at-the-head'] },
    { name: 'an owner ran in a worktree', mutate: (sandbox) => patchAssignment(sandbox, FULL_RUN, 'owner-a', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: (assignment['workspace'] as { inputCommit: string }).inputCommit })), fails: ['autopilot.full.one-container-owner-per-pr-off-trunk'] },
    { name: 'an owner had no forge capability', mutate: (sandbox) => patchAssignment(sandbox, FULL_RUN, 'owner-b', (assignment) => ((assignment['capabilities'] as Record<string, unknown>)['forge'] = false)), fails: ['autopilot.full.one-container-owner-per-pr-off-trunk'] },
    { name: 'an owner force-pushed', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'force-push', ref: 'refs/heads/feat-greet', worker: 'owner-a', run: FULL_RUN, actor: '', container: true } as ForgeAction)), fails: ['autopilot.full.owners-push-their-own-branch-and-keep-a-trail'] },
    { name: 'an owner pushed a branch that is not its own', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'push', ref: 'refs/heads/feat-shout', worker: 'owner-a', run: FULL_RUN, actor: '', container: true } as ForgeAction)), fails: ['autopilot.full.owners-push-their-own-branch-and-keep-a-trail'] },
    { name: 'a PR was opened as a draft', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'create' && action.pr === 31) action['draft'] = true; })), fails: ['autopilot.full.prs-open-ready-with-the-required-body-sections'] },
    { name: 'a PR body lost its Scope section', mutate: (sandbox) => editForge(sandbox, (_actions, state) => { const pr = state.prs['32']; if (pr) pr.body = pr.body.replace('## Scope', '## Notes'); }), fails: ['autopilot.full.prs-open-ready-with-the-required-body-sections'] },
    { name: 'the hourly watch loop was never armed', mutate: (sandbox) => patchAssignment(sandbox, FULL_RUN, 'watch-hourly', (assignment) => (assignment['watch'] = { argv: ['sleep', '5'], cwd: '/tmp' })), fails: ['autopilot.full.hourly-watch-loop-armed-on-the-go'] },
    { name: 'the root audited nothing before the go', mutate: (sandbox) => rewriteSession(sandbox, '"name":"pstack_evidence","arguments":{"action":"list"', '"name":"pstack_evidence","arguments":{"action":"record"'), fails: ['autopilot.full.root-audits-receipts-before-any-go'] },
    { name: 'the reply left out the open gates', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Open operator gates', 'Gates'), fails: ['autopilot.full.reply-catches-the-operator-up'] },
  ],
};

// ---- autopilot-hold

const HOLD_RUN = 'autopilot-hold-queue';
const HOLD_STORE: Store = { units: [] };

export const autopilotHoldFamily: Family = {
  id: 'autopilot-hold',
  requires: 'container',
  title: 'autopilot-full operator hold: a zero-writes order reaches every owner in one message, each owner reports standing down and writes nothing more, nothing merges (spec 13.4)',
  spec: specOf('autopilot-hold', HOLD_RUN, HOLD_STORE, (ctx) => fullScenario(ctx, HOLD_STORE, 'hold'), independentUnits(), { 'feat-greet': 31, 'feat-shout': 32 }, PROMPT_FULL, ['/poteto-mode hold everything: stop all writes now, do not merge anything']),
  checks: [
    ...fullChecks('autopilot.hold', HOLD_STORE),
    ...todoChecks({ playbook: 'autopilot-full', skipReason: { 4: /held|hold/, 5: /held|hold/, 6: /held|hold/, 7: /./ } }),
    check('autopilot.hold.the-hold-reached-every-owner-in-one-message', 'the hold turn steered every owner in the run from one assistant message, with a zero-writes order', AF('A hold reaches every owner as a zero-writes order'), (view) => {
      const turns = view.parent.messages.filter((message) => message.role === 'user');
      const holdTurn = turns[1]?.order ?? Number.POSITIVE_INFINITY;
      const steers = view.parent.toolCalls.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'steer' && call.order > holdTurn);
      const owners = ownerWorkers(view).map((worker) => worker.id).sort();
      const targets = steers.map((call) => String(call.args['workerId'])).sort();
      return when(/hold/i.test(turns[1]?.text ?? '') && JSON.stringify(targets) === JSON.stringify(owners) && new Set(steers.map((call) => call.order)).size === 1 && steers.every((call) => /zero writes/i.test(String(call.args['message']))), `owners ${owners.join(', ')} all steered at message ${steers[0]?.order} with a zero-writes order`, `owners ${owners.join(', ')}; steered ${targets.join(', ')} at messages ${steers.map((call) => call.order).join(', ')}`);
    }),
    check('autopilot.hold.each-owner-reports-where-it-stands-and-wrote-nothing-more', 'after the hold each owner ran no tool, reported standing down at its head, and kept its brief', AF('Each reports where it stands and keeps its brief until the operator releases it'), (view) => {
      const problems = ownerWorkers(view).flatMap((worker) => {
        const messages = worker.session?.messages ?? [];
        const steer = messages.findIndex((message) => message.role === 'user' && /HOLD from the operator/.test(message.text));
        const after = messages.slice(steer + 1);
        const calls = (worker.session?.toolCalls ?? []).filter((call) => call.order > (messages[steer]?.order ?? Number.POSITIVE_INFINITY));
        const reply = [...after].reverse().find((message) => message.role === 'assistant' && message.text.trim() !== '')?.text ?? '';
        return [...(steer === -1 ? [`${worker.id} never received the hold`] : []), ...(calls.length > 0 ? [`${worker.id} ran ${calls.map((call) => call.name).join(', ')} after the hold`] : []), ...(!/Standing down/.test(reply) || !/head [0-9a-f]{40}/.test(reply) || !/keep my brief/.test(reply) ? [`${worker.id} reply: ${reply.slice(0, 80)}`] : [])];
      });
      return when(ownerWorkers(view).length === 2 && problems.length === 0, 'both owners stood down at their heads with no further tool call', problems.join('; '));
    }),
    check('autopilot.hold.nothing-merged-and-the-forge-saw-no-write-after-the-owners-reported', 'no merge, queue entry or verdict exists, and the only forge writes are the owners\' own pushes and PR creation', AF('Stand down at once on the operator\'s stop'), (view) => {
      const { actions, state } = readForge(view);
      const kinds = [...new Set(actions.filter((action) => !['read', 'log-view'].includes(action.kind)).map((action) => `${action.kind}:${action.worker}`))].sort();
      return when(Object.values(state.prs).every((pr) => pr.state === 'OPEN') && kinds.every((kind) => /^(create|push|ref-create):owner-[ab]$/.test(kind)), `writes: ${kinds.join(', ')}; every PR open`, `writes ${kinds.join(', ')}; states ${Object.values(state.prs).map((pr) => pr.state).join(', ')}`);
    }),
  ],
  negatives: [
    { name: 'the hold reached only one owner', mutate: (sandbox) => rewriteSession(sandbox, '"workerId":"owner-b","message":"HOLD', '"workerId":"owner-a","message":"HOLD'), fails: ['autopilot.hold.the-hold-reached-every-owner-in-one-message'] },
    { name: 'the hold was not a zero-writes order', mutate: (sandbox) => rewriteSession(sandbox, 'zero writes now', 'slow down'), fails: ['autopilot.hold.the-hold-reached-every-owner-in-one-message'] },
    { name: 'an owner kept writing after the hold', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'push', ref: 'refs/heads/feat-greet', worker: 'owner-a', run: HOLD_RUN, actor: '', container: true } as ForgeAction, { kind: 'merge', tool: 'gh', pr: 31, worker: 'owner-a', run: HOLD_RUN, actor: '', container: true })), fails: ['autopilot.hold.nothing-merged-and-the-forge-saw-no-write-after-the-owners-reported'] },
    { name: 'an owner ran a tool after the hold', mutate: (sandbox) => appendOwnerCall(sandbox, HOLD_RUN, 'owner-b'), fails: ['autopilot.hold.each-owner-reports-where-it-stands-and-wrote-nothing-more'] },
    { name: 'an owner never answered the hold', mutate: (sandbox) => rewriteOwnerSession(sandbox, HOLD_RUN, 'owner-a', 'Standing down', 'Working on it'), fails: ['autopilot.hold.each-owner-reports-where-it-stands-and-wrote-nothing-more'] },
    { name: 'the root verified and merged after the hold', mutate: (sandbox) => editForge(sandbox, (actions, state) => { actions.push({ kind: 'merge', tool: 'gh', pr: 31, worker: '', run: '', actor: '', container: false }); (state.prs['31'] as { state: string }).state = 'MERGED'; }), fails: ['autopilot.hold.nothing-merged-and-the-forge-saw-no-write-after-the-owners-reported'] },
    { name: 'the second user turn was never a hold', mutate: (sandbox) => rewriteSession(sandbox, 'hold everything', 'keep going'), fails: ['autopilot.hold.the-hold-reached-every-owner-in-one-message'] },
    { name: 'one owner was never spawned', mutate: (sandbox) => patchAssignment(sandbox, HOLD_RUN, 'owner-b', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: (assignment['workspace'] as { inputCommit: string }).inputCommit })), fails: ['autopilot.hold.one-container-owner-per-pr-off-trunk'] },
  ],
};

// ---- autopilot-stack

const STACK_RUN = 'autopilot-stack-queue';
const STACK_STORE: Store = { units: [] };

function stackScenario(ctx: Ctx, store: Store) {
  const parent = new Parent(ctx);
  const [a, b] = store.units as [Unit, Unit];
  const { pr } = rootBegin(parent, 'autopilot-stack', 'Autopilot-stack greet and shout');
  parent.task('Grant: autopilot-stack queue is PR 41 and PR 42; do not merge; PR 42 builds on PR 41');
  parent.spawn('owner-a', { role: 'owner', model: 'sim/grok-sim', workspace: { mode: 'container', inputCommit: a.from }, capabilities: { mcp: 'inherit', env: 'minimal', externalWrite: false, forge: true } }, ownerBrief(a));
  parent.wait('owner-a').collect('owner-a');
  parent.bash('git fetch -q origin');
  parent.fire(stageOwner(parent, b));
  parent.wait('owner-b').collect('owner-b');
  parent.bash('git fetch -q origin');
  parent.fire(...[a, b].map((unit) => stageVerifier(parent, `verifier-${unit.pr}`, unit.pr, unit.sha as string, unit.testFile)));
  parent.wait('verifier-41').wait('verifier-42').collect('verifier-41', 'verifier-42');
  parent.call('pstack_evidence', { action: 'list', runId: ctx.runId });
  parent.bash(`gh pr view 41 ${pr} --json baseRefName,headRefName,state && gh pr view 42 ${pr} --json baseRefName,headRefName,state`);
  stepDone(parent, 'autopilot-stack', 1, 'as-verified', `test $(gh pr view 41 ${pr} --json comments | grep -c PSTACK-VERDICT) -ge 1 && test $(gh pr view 42 ${pr} --json comments | grep -c PSTACK-VERDICT) -ge 1`);
  stepDone(parent, 'autopilot-stack', 2, 'as-stack', `gh pr view 42 ${pr} --json baseRefName | grep -q feat-greet-stack`);
  parent.text(`Handoff: PR 41 (greet) PASS by verifier-41 at ${a.sha}. PR 42 (shout, stacked on PR 41's branch because it imports greet) PASS by verifier-42 at ${b.sha}. Nothing merged. Nobody pushes until you give the go. Land them with Shipping when you are ready.`);
  const workers: Record<string, Worker> = { 'owner-a': ownerScript(ctx, parent, a, 'none'), 'owner-b': ownerScript(ctx, parent, b, 'none') };
  for (const unit of [a, b]) workers[`verifier-${unit.pr}`] = verifierScript(ctx, parent, { id: `verifier-${unit.pr}`, pr: unit.pr, head: unit.sha as string, testFile: unit.testFile });
  return scenario(parent, workers);
}

export const autopilotStackFamily: Family = {
  id: 'autopilot-stack',
  requires: 'container',
  title: 'autopilot-stack: autopilot-full without the merge: a PR stacks only on the PR it builds on, every PR is verified at its head, nothing merges, nobody pushes after the handoff (spec 13.4)',
  spec: specOf('autopilot-stack', STACK_RUN, STACK_STORE, (ctx) => stackScenario(ctx, STACK_STORE), stackedUnits, { 'feat-greet-stack': 41, 'feat-shout-stack': 42 }, '/poteto-mode autopilot-stack: build PR 41 (greet) and PR 42 (shout, which builds on greet), verify them, and do not merge, I will land them'),
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('autopilot-stack'),
    ...todoChecks({ playbook: 'autopilot-stack' }),
    check('reads.autopilot-stack.runs-the-autopilot-full-playbook', 'the stack playbook says to run Autopilot-full, so the parent opened autopilot-full.md too', AS('Run the Autopilot-full playbook, but do not merge'), (view) => when(openedAt(view.parent, playbookFile('autopilot-full')) !== -1, 'autopilot-full.md opened', 'autopilot-full.md was never opened')),
    forgeResolvedOnce('autopilot.stack.forge-resolved-once-gh-fallback-recorded', AF('GitHub CLI (`gh`) is the default'), 'gh'),
    onePerPrOwners('autopilot.stack.one-container-owner-per-pr', AF('Spawn one owner per PR'), unitsOf(STACK_STORE), { from: 'stack' }),
    ownerHygiene('autopilot.stack.owners-push-their-own-branch-and-keep-a-trail', AF('Assume the container dies'), unitsOf(STACK_STORE)),
    check('autopilot.stack.stacks-only-the-pr-that-builds-on-another', 'PR 42 is based on PR 41\'s branch and its commit sits on PR 41\'s head, PR 41 is based on trunk, and neither base changed after opening', AS('Stack a PR only when it builds on another PR'), (view) => {
      const { state, actions } = readForge(view);
      const bare = bareOf(view.sandbox);
      const [a, b] = STACK_UNITS(view) as [Unit, Unit];
      const parent = spawnSyncGit(bare, `rev-parse ${b.sha}^`);
      const imports = spawnSyncGit(bare, `show ${b.sha}:src/shout.js`);
      return when(state.prs['41']?.base === 'main' && state.prs['42']?.base === 'feat-greet-stack' && parent === a.sha && /from '\.\/greet\.js'/.test(imports) && !actions.some((action) => action.kind === 'edit-base'), 'PR 41 on main; PR 42 on feat-greet-stack, its commit on PR 41\'s head, and it imports greet', `bases ${state.prs['41']?.base}, ${state.prs['42']?.base}; parent of 42 ${parent.slice(0, 8)} vs ${a.sha?.slice(0, 8)}; imports greet ${/greet/.test(imports)}`);
    }),
    verifiersIndependent('autopilot.stack.independent-verifier-per-pr-at-the-head', AS('In place of step 5, stop at verified'), unitsOf(STACK_STORE)),
    rootAudited('autopilot.stack.root-audits-receipts', AS('In place of step 5, stop at verified')),
    check('autopilot.stack.nothing-merges-and-nobody-pushes-after-the-handoff', 'no merge, queue entry or auto-merge exists, and every owner push and PR creation precedes the first verdict', AS('In place of step 5, stop at verified'), (view) => {
      const { actions, state } = readForge(view);
      const firstVerdict = actions.findIndex((action) => action.kind === 'comment' && /PSTACK-VERDICT/.test(String(action['body'])));
      const late = actions.filter((action, index) => index > firstVerdict && ['push', 'force-push', 'create', 'merge', 'merge-queued', 'auto-merge', 'edit-base'].includes(action.kind));
      return when(firstVerdict !== -1 && late.length === 0 && mergesIn(actions).length === 0 && Object.values(state.prs).every((pr) => pr.state === 'OPEN' && pr.autoMerge !== true && pr.queued !== true), 'no merge; no push, creation or retarget after the first verdict', `late writes ${late.map((action) => action.kind).join(', ') || 'none'}; merges ${mergesIn(actions).length}`);
    }),
    check('autopilot.stack.reply-lists-each-pr-with-its-verdict', 'the reply lists each PR with its verdict in place of what merged, says nothing merged, and says nobody pushes without the go', AS('**Reply:** list each PR with its verdict'), (view) => {
      const reply = finalReply(view);
      const missing = [/PR 41 .*PASS by verifier-41/, /PR 42 .*PASS by verifier-42/, /Nothing merged/, /Nobody pushes until you give the go/].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0, 'every part present', `missing ${missing.join(', ')}`);
    }),
    noToolErrors('autopilot.stack.no-tool-errors', AS('In place of step 5')),
  ],
  negatives: [
    ...todoNegatives(STACK_RUN, 'autopilot-stack', { done: [1, 2], receipts: { 1: 'as-verified', 2: 'as-stack' } }),
    { name: 'a PR was merged under autopilot-stack', mutate: (sandbox) => editForge(sandbox, (actions, state) => { actions.push({ kind: 'merge', tool: 'gh', pr: 41, worker: 'owner-a', run: STACK_RUN, actor: '', container: true }); (state.prs['41'] as { state: string }).state = 'MERGED'; }), fails: ['autopilot.stack.nothing-merges-and-nobody-pushes-after-the-handoff'] },
    { name: 'auto-merge was armed', mutate: (sandbox) => editForge(sandbox, (_actions, state) => { (state.prs['42'] as { autoMerge?: boolean }).autoMerge = true; }), fails: ['autopilot.stack.nothing-merges-and-nobody-pushes-after-the-handoff'] },
    { name: 'an owner pushed after the handoff', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'push', ref: 'refs/heads/feat-shout-stack', worker: 'owner-b', run: STACK_RUN, actor: '', container: true } as ForgeAction)), fails: ['autopilot.stack.nothing-merges-and-nobody-pushes-after-the-handoff'] },
    { name: 'the dependent PR was based on trunk', mutate: (sandbox) => editForge(sandbox, (_actions, state) => { (state.prs['42'] as { base: string }).base = 'main'; }), fails: ['autopilot.stack.stacks-only-the-pr-that-builds-on-another'] },
    { name: 'the stack was retargeted', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'edit-base', tool: 'gh', pr: 42, worker: '', run: '', actor: '', container: false })), fails: ['autopilot.stack.stacks-only-the-pr-that-builds-on-another'] },
    { name: 'a PR was handed over with no verdict', mutate: (sandbox) => editForge(sandbox, (actions) => actions.splice(0, actions.length, ...actions.filter((action) => !(action.kind === 'comment' && action.pr === 42)))), fails: ['autopilot.stack.independent-verifier-per-pr-at-the-head'] },
    { name: 'the autopilot-full playbook was never read', mutate: (sandbox) => rewriteSession(sandbox, 'playbooks/autopilot-full.md', 'playbooks/other.md'), fails: ['reads.autopilot-stack.runs-the-autopilot-full-playbook'] },
    { name: 'the reply says the stack was merged', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Nothing merged', 'All merged'), fails: ['autopilot.stack.reply-lists-each-pr-with-its-verdict'] },
    { name: 'the parent collected with no wake from its workers', mutate: (sandbox) => dropWakes(sandbox), fails: ['autopilot.stack.independent-verifier-per-pr-at-the-head'] },
  ],
};

const STACK_UNITS = (view: RunView): Unit[] => {
  const a = unitA(41, 'feat-greet-stack');
  const bare = bareOf(view.sandbox);
  a.sha = revParse(bare, 'refs/heads/feat-greet-stack');
  const b = unitB(42, 'feat-shout-stack', a.sha, 'feat-greet-stack', SHOUT_STACKED);
  b.sha = revParse(bare, 'refs/heads/feat-shout-stack');
  return [a, b];
};

function spawnSyncGit(bare: string, command: string): string {
  return String(spawnSync('git', ['--git-dir', bare, ...command.split(' ')], { encoding: 'utf8' }).stdout).trim();
}

// ---- helpers for negatives

function rewriteSession(sandbox: string, from: string, to: string): void {
  const file = parentSession(sandbox);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll(from, to));
}

const ownerSessionFile = (sandbox: string, runId: string, workerId: string): string => {
  const dir = join(sandbox, 'repo/.pi/pstack/runs', runId, 'workers', workerId, 'out', 'session');
  return join(dir, readdirSync(dir).find((name) => name.endsWith('.jsonl')) as string);
};

function rewriteOwnerSession(sandbox: string, runId: string, workerId: string, from: string, to: string): void {
  const file = ownerSessionFile(sandbox, runId, workerId);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll(from, to));
}

function appendOwnerCall(sandbox: string, runId: string, workerId: string): void {
  const file = ownerSessionFile(sandbox, runId, workerId);
  const id = `forged-${Math.random().toString(36).slice(2, 8)}`;
  const stamp = new Date().toISOString();
  const lines = [
    { type: 'message', id: `${id}a`, parentId: null, timestamp: stamp, message: { role: 'assistant', content: [{ type: 'toolCall', id, name: 'bash', arguments: { command: 'git push origin HEAD' } }], provider: 'sim', model: 'forged', stopReason: 'toolUse', timestamp: Date.now() } },
    { type: 'message', id: `${id}b`, parentId: `${id}a`, timestamp: stamp, message: { role: 'toolResult', toolCallId: id, toolName: 'bash', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: Date.now() } },
  ];
  appendFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

export { stageOwner, ownerBrief, OWNER_FAMILY, ownerWorkers, rootBegin };

export const autopilotFamilies: Family[] = [autopilotFullFamily, autopilotHoldFamily, autopilotStackFamily];
