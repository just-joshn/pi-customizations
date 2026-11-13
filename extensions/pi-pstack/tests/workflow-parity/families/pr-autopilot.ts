// Autopilot families (spec 13.4): one container owner per PR, a root that verifies at the head before an owner may merge,
// autopilot-stack that never merges, and an operator hold that reaches every owner in one message.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, proofSteps, scenario, Worker } from '../fixtures/dsl.ts';
import { bareOf, COMMIT_PREFIX, editForge, FORGE_CLI, type ForgeAction, type ForgeHandle, forgeEnv, predictCommit, predictCommits, readForge, revParse, setupForge, writeContainerScenario } from '../fixtures/forge.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, type Src, src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, finalReply, noToolErrors, openedAt, playbookFile, playbookReads, promptRoutes, skillRequest, todoChecks } from '../lib/checks.ts';
import type { Ctx } from '../lib/driver.ts';
import { dropWakes, parentSession, patchAssignment, rewriteFinalReply } from '../lib/mutate.ts';
import type { RunView, WorkerView } from '../lib/view.ts';
import { forgeResolvedOnce, REPO_FLAGS, stepDone } from './pr-shared.ts';
import { mergesAreAuthorizedAndVerified, mergeRequested, mergesIn, removeRunContainers, stageVerifier, verdictsOf, verifierScript } from './pr-shipping.ts';
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

export function responsibleWorker(view: RunView, role: string, pr: number, lane?: string): WorkerView | undefined {
  const { state, actions } = readForge(view);
  const candidates = allWorkers(view).filter((worker) => {
    if (assignmentOf(worker).role !== role) return false;
    const identity = String(worker.assignment['workerId'] ?? worker.id);
    const responsible = role === 'owner' ? state.prs[String(pr)]?.author === identity : actions.some((action) => action.pr === pr && action.worker === identity && action.kind === 'comment');
    return responsible && (lane === undefined || new RegExp(`\\b${lane}\\b`, 'i').test(worker.brief ?? ''));
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function observedUnits(view: RunView, units: Unit[]): Unit[] {
  const { state } = readForge(view);
  return units.map((unit) => {
    const pr = state.prs[String(unit.pr)];
    return { ...unit, id: responsibleWorker(view, 'owner', unit.pr)?.id ?? '', sha: pr?.mergedHead ?? revParse(bareOf(view.sandbox), `refs/heads/${pr?.head}`) };
  });
}

const verificationWorkers = (view: RunView, head: string | undefined): WorkerView[] => allWorkers(view).filter((worker) => assignmentOf(worker).role === 'verifier' && assignmentOf(worker).workspace?.inputCommit === head);
const mergeGo = (view: RunView, owner: string) => view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'steer' && call.args['workerId'] === owner && /\bmerge\b/i.test(String(call.args['message'])) && !/\b(?:do not|don't|not to) merge\b/i.test(String(call.args['message'])));
const laneClean = (view: RunView, worker: WorkerView, head: string): boolean => {
  const report = `${worker.report ?? ''}\n${worker.finalText ?? ''}`;
  if (/VERDICT\s+(?:FAIL|blocked)/i.test(report)) return false;
  if (new RegExp(`VERDICT\\s+(?:clean|PASS(?:\\+NOTES)?)[\\s\\S]*${head}`, 'i').test(report)) return true;
  const { state, actions } = readForge(view);
  const posted = verdictsOf(state, actions, view).filter((verdict) => verdict.verifier === worker.id && verdict.head === head).at(-1);
  return posted !== undefined && posted.author === worker.id && posted.verdict !== 'FAIL';
};

function onePerPrOwners(id: string, source: Src | Src[], units: (view: RunView) => Unit[], options: { from: 'trunk' | 'stack' }): Check {
  return check(id, 'one container owner per PR, each with the forge capability, a distinct id, workspace at its own start commit, and the PR it opened carries that owner as its author', source, (view) => {
    const { state, actions } = readForge(view);
    const owners = ownerWorkers(view);
    const wanted = observedUnits(view, units(view));
    const problems = wanted.flatMap((unit) => {
      const worker = responsibleWorker(view, 'owner', unit.pr);
      const pr = state.prs[String(unit.pr)];
      if (worker === undefined) return [`no owner ${unit.id}`];
      const assignment = assignmentOf(worker) as { workspace?: { mode?: string; inputCommit?: string }; capabilities?: Record<string, unknown> };
      const caps = assignment.capabilities ?? {};
      const run = view.runs.find((entry) => entry.workers.includes(worker));
      const create = actions.find((action) => action.kind === 'create' && action.pr === unit.pr);
      return [
        ...(assignment.workspace?.mode !== 'container' ? [`${unit.id} workspace ${String(assignment.workspace?.mode)}`] : []),
        ...(assignment.workspace?.inputCommit !== unit.from ? [`${unit.id} starts at ${String(assignment.workspace?.inputCommit).slice(0, 8)}, not ${unit.from.slice(0, 8)} (${options.from})`] : []),
        ...(caps['forge'] !== true || caps['env'] !== 'minimal' || caps['externalWrite'] !== false ? [`${unit.id} capabilities ${JSON.stringify(caps)}`] : []),
        ...(pr?.author !== unit.id || create?.worker !== unit.id || create?.run !== run?.id || create?.container !== true ? [`PR ${unit.pr} was not opened by ${unit.id} from its container`] : []),
        ...(worker.session?.cwd !== WS ? [`${unit.id} ran in ${String(worker.session?.cwd)}`] : []),
      ];
    });
    const sharedPr = new Set(actions.filter((action) => action.kind === 'create' && action.tool === 'gh').map((action) => action.pr)).size;
    return when(owners.length === wanted.length && new Set(wanted.map((unit) => unit.id)).size === wanted.length && sharedPr === wanted.length && problems.length === 0, `${owners.map((worker) => worker.id).join(', ')}: one container owner per PR, forge capability, own PR`, `${owners.length} owners for ${wanted.length} PRs; ${problems.join('; ')}`);
  });
}

type Check = ReturnType<typeof check>;

/** Each owner pushed only its own branch, never forced, and left a decision trail and a self-proof receipt. */
function ownerHygiene(id: string, source: Src | Src[], units: (view: RunView) => Unit[]): Check {
  return check(id, 'each owner pushed only its own branch, pinned any force-with-lease to the last pushed SHA, kept a decision trail in its worker directory, and recorded self-proof', source, (view) => {
    const { actions } = readForge(view);
    const problems = observedUnits(view, units(view)).flatMap((unit) => {
      const worker = responsibleWorker(view, 'owner', unit.pr);
      const run = view.runs.find((entry) => worker !== undefined && entry.workers.includes(worker));
      if (worker === undefined || run === undefined) return [`PR ${unit.pr} has no unique owner`];
      const pushes = actions.filter((action) => ['push', 'ref-create', 'force-push'].includes(action.kind) && action.worker === unit.id && action.run === run.id);
      const foreign = pushes.filter((action) => action['ref'] !== `refs/heads/${unit.branch}`);
      const forced = pushes.filter((action) => action.kind === 'force-push' && (typeof action['old'] !== 'string' || !(worker.session?.toolCalls ?? []).some((call) => call.name === 'bash' && new RegExp(`--force-with-lease=(?:refs/heads/)?${unit.branch}:${String(action['old'])}\\b`).test(String(call.args['command'])))));
      const trails = readdirSync(worker.dir, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.tsv')).map((file) => readFileSync(join(worker.dir, file), 'utf8'));
      const receipts = run.receipts.filter((entry) => entry.runId === run.id && entry.target === `pr-${unit.pr}` && entry.artifacts.some((artifact) => artifact.path.startsWith(`${worker.dir}/`)));
      const receipt = receipts.length === 1 ? receipts[0] : undefined;
      return [...(pushes.length === 0 ? [`${unit.id} pushed nothing`] : []), ...(foreign.length > 0 ? [`${unit.id} pushed ${foreign.map((action) => String(action['ref'])).join(', ')}`] : []), ...(forced.length > 0 ? [`${unit.id} force-pushed`] : []), ...(!trails.some((trail) => /^ts\tphase\tdecision\twhy\tevidence\tresult\r?\n[^\n]+/m.test(trail)) ? [`${unit.id} left no decision trail in its worker directory`] : []), ...(receipt === undefined || receipt.verdict !== 'pass' ? [`${unit.id} has no passing self-proof receipt`] : [])];
    });
    return when(problems.length === 0, 'own branch only, safe leases, trail and self-proof recorded', problems.join('; '));
  });
}

/** Each PR's body carries the opening-a-pr sections in order. */
export const BODY_SECTIONS = ['Why', 'What changed', 'Scope', 'Blast Radius', 'Verification'];

export function bodyHasSections(body: string): string[] {
  const found = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1] as string);
  const order = found.filter((heading) => BODY_SECTIONS.includes(heading) || heading === 'Tradeoffs');
  const wanted = ['Why', 'What changed', 'Scope', 'Tradeoffs', 'Blast Radius', 'Verification'];
  const positions = order.map((heading) => wanted.indexOf(heading));
  return [...BODY_SECTIONS.filter((heading) => heading !== 'Blast Radius' && !found.includes(heading)).map((heading) => `lacks ## ${heading}`), ...(positions.some((position, index) => index > 0 && position < (positions[index - 1] as number)) ? ['sections out of order'] : [])];
}

function verifiersIndependent(id: string, source: Src | Src[], units: (view: RunView) => Unit[]): Check {
  return check(id, 'each PR has independent verifier lanes at the code-ready head after the owner reports it, with unambiguous responsibilities and clean verdicts', source, (view) => {
    const wanted = observedUnits(view, units(view));
    const problems = wanted.flatMap((unit) => {
      const owner = ownerWorkers(view).find((worker) => worker.id === unit.id);
      const lanes = verificationWorkers(view, unit.sha);
      if (owner === undefined || lanes.length === 0) return [`PR ${unit.pr} lacks an owner or verifier lanes`];
      const ownerRun = view.runs.find((entry) => entry.workers.includes(owner));
      const ownerWake = view.parent.messages.find((message) => message.customType === 'pstack-worker' && message.details?.['workerId'] === owner.id && message.details?.['runId'] === ownerRun?.id)?.order ?? Number.POSITIVE_INFINITY;
      const ambiguous = new Set(lanes.map((worker) => worker.brief)).size !== lanes.length;
      return [...(ambiguous ? [`PR ${unit.pr} has ambiguous verifier responsibilities`] : []), ...lanes.flatMap((worker) => {
        const spawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && call.args['assignmentPath'] === join(worker.dir, 'assignment.json'))?.order ?? -1;
        return [...(worker.id === owner.id ? [`${worker.id} verified its own PR`] : []), ...(spawn < ownerWake ? [`${worker.id} started before code-ready`] : []), ...(!laneClean(view, worker, unit.sha ?? '') ? [`${worker.id} has no clean verdict at ${unit.sha}`] : [])];
      })];
    });
    return when(wanted.length > 0 && problems.length === 0, 'independent lanes verified the reported heads', problems.join('; ') || 'no PRs were observed');
  });
}

const mergeVerified = (id: string, source: Src | Src[]): Check => check(id, 'each merge is authorized and follows independent clean lane reports at the merged head', source, (view) => {
  const { state, actions } = readForge(view);
  const merges = mergesIn(actions);
  const problems = merges.flatMap((merge) => {
    const owner = state.prs[String(merge.pr)]?.author ?? '';
    const go = mergeGo(view, owner);
    const head = String(merge['head']);
    const lanes = verificationWorkers(view, head);
    const collected = (worker: WorkerView) => view.parent.toolCalls.some((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect' && call.args['workerId'] === worker.id && call.order < (go?.order ?? -1));
    return lanes.length > 0 && lanes.every((worker) => worker.id !== owner && laneClean(view, worker, head) && collected(worker)) && go !== undefined && String(go.args['message']).includes(head) && Date.parse(go.at ?? '') < Date.parse(String(merge['ts'] ?? '')) ? [] : [`PR ${merge.pr} merged without collected independent clean lanes and a head-specific go`];
  });
  return when(mergeRequested(view.prompt) && merges.length > 0 && problems.length === 0, 'authorized merges at independently verified heads', problems.join('; ') || 'no authorized merge');
});

const rootAudited = (id: string, source: Src | Src[]): Check =>
  check(id, 'the root audited the receipts through pstack_evidence after the verifiers were collected and before any owner was told to merge', source, (view) => {
    const { state } = readForge(view);
    const prs = Object.values(state.prs);
    const problems = prs.flatMap((pr) => {
      const head = pr.mergedHead ?? revParse(bareOf(view.sandbox), `refs/heads/${pr.head}`);
      const lanes = verificationWorkers(view, head);
      const lastCollect = Math.max(...lanes.map((worker) => view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect' && call.args['workerId'] === worker.id && call.args['runId'] === view.runs.find((run) => run.workers.includes(worker))?.id)?.order ?? Number.POSITIVE_INFINITY));
      const go = mergeGo(view, pr.author)?.order ?? Number.POSITIVE_INFINITY;
      const audit = view.parent.toolCalls.some((call) => call.name === 'pstack_evidence' && ['list', 'verify'].includes(String(call.args['action'])) && !call.isError && call.order > lastCollect && call.order < go);
      return lanes.length > 0 && audit ? [] : [`PR ${pr.number}: no audit after lane collects (${lastCollect}) and before merge go (${go})`];
    });
    return when(prs.length > 0 && problems.length === 0, 'each PR audited after its lanes were collected and before its merge go', problems.join('; ') || 'no PRs');
  });

const hourlyWatch = (id: string, source: Src | Src[], options: { aborted: boolean }): Check =>
  check(id, `the root armed an hourly watch loop (watcher, sleep 3600, absolute cwd)${options.aborted ? ' and stopped it once no delegated work was left' : ''}`, source, (view) => {
    const watchers = allWorkers(view).filter((worker) => assignmentOf(worker).kind === 'watch');
    const watcher = watchers.length === 1 ? watchers[0] : undefined;
    const argv = watcher === undefined ? [] : assignmentOf(watcher).watch?.argv ?? [];
    const ownerSpawn = Math.min(...ownerWorkers(view).map((worker) => view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes(`/${worker.id}/`))?.order ?? Number.POSITIVE_INFINITY));
    const watchSpawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && watcher !== undefined && call.args['assignmentPath'] === join(watcher.dir, 'assignment.json'))?.order ?? -1;
    const abort = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'abort' && watcher !== undefined && call.args['workerId'] === watcher.id && call.args['runId'] === view.runs.find((run) => run.workers.includes(watcher))?.id && !call.isError)?.order ?? -1;
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

const unitsOf = (store: Store) => (view: RunView): Unit[] => {
  if (store.units.length > 0) return store.units;
  const { state } = readForge(view);
  return Object.values(state.prs).map((pr) => ({ id: pr.author, branch: pr.head, pr: pr.number, from: pr.base === state.repo.trunk ? view.base : revParse(bareOf(view.sandbox), `refs/heads/${pr.base}`), base: pr.base, files: {}, testFile: '', title: pr.title, sha: pr.mergedHead ?? revParse(bareOf(view.sandbox), `refs/heads/${pr.head}`) }));
};

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
    mergeVerified('autopilot.full.no-merge-without-a-verdict-at-that-head', AF('The owner merges only what you verified')),
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
      const missing = [/PR 31[\s\S]*PR 32[\s\S]*merged|merged[\s\S]*PR 31[\s\S]*PR 32/i, /verified PASS|verdict[\s\S]{0,80}clean|clean[\s\S]{0,80}verdict/i, /countersign/i, /operator gates|gates and countersigns/i, /parked follow.ups/i].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0 && openedAt(view.parent, 'generated/skills/ketchup/SKILL.md') !== -1, 'ketchup read, every part present', `missing ${missing.join(', ')}`);
    }),
  ],
  negatives: [
    ...todoNegatives(FULL_RUN, 'autopilot-full', { done: [1, 2, 3, 4, 5, 6], receipts: { 1: 'af-gates', 2: 'af-owners', 3: 'af-parallel', 4: 'af-swarm', 5: 'af-merge', 6: 'af-root-layer' } }),
    { name: 'an owner merged with no verdict posted for its PR', mutate: (sandbox) => editForge(sandbox, (actions) => actions.splice(0, actions.length, ...actions.filter((action) => !(action.kind === 'comment' && action.pr === 31)))), fails: ['autopilot.full.no-merge-without-a-verdict-at-that-head', 'autopilot.full.independent-verifier-per-pr-on-another-family-at-the-head'] },
    { name: 'an owner verified its own PR', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'comment' && action.pr === 32) action.worker = 'owner-b'; })), fails: ['autopilot.full.no-merge-without-a-verdict-at-that-head', 'autopilot.full.independent-verifier-per-pr-on-another-family-at-the-head'] },
    { name: 'a merge landed a head the lanes never verified', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'merge') action['head'] = '0'.repeat(40); })), fails: ['autopilot.full.no-merge-without-a-verdict-at-that-head'] },
    { name: 'the root merged instead of the owner', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'merge' && action.pr === 31) { action.worker = ''; action.container = false; } })), fails: ['autopilot.full.the-owner-merges-its-own-pr-after-the-root-says-go'] },
    { name: 'a verifier ran at the wrong head', mutate: (sandbox) => patchAssignment(sandbox, FULL_RUN, 'verifier-31', (assignment) => ((assignment['workspace'] as { inputCommit: string }).inputCommit = '0'.repeat(40))), fails: ['autopilot.full.independent-verifier-per-pr-on-another-family-at-the-head'] },
    { name: 'an owner ran in a worktree', mutate: (sandbox) => patchAssignment(sandbox, FULL_RUN, 'owner-a', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: (assignment['workspace'] as { inputCommit: string }).inputCommit })), fails: ['autopilot.full.one-container-owner-per-pr-off-trunk'] },
    { name: 'an owner had no forge capability', mutate: (sandbox) => patchAssignment(sandbox, FULL_RUN, 'owner-b', (assignment) => ((assignment['capabilities'] as Record<string, unknown>)['forge'] = false)), fails: ['autopilot.full.one-container-owner-per-pr-off-trunk'] },
    { name: 'an owner force-pushed', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'force-push', ref: 'refs/heads/feat-greet', worker: 'owner-a', run: FULL_RUN, actor: '', container: true } as ForgeAction)), fails: ['autopilot.full.owners-push-their-own-branch-and-keep-a-trail'] },
    { name: 'an owner pushed a branch that is not its own', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'push', ref: 'refs/heads/feat-shout', worker: 'owner-a', run: FULL_RUN, actor: '', container: true } as ForgeAction)), fails: ['autopilot.full.owners-push-their-own-branch-and-keep-a-trail'] },
    { name: 'a PR was opened as a draft', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'create' && action.pr === 31) action['draft'] = true; })), fails: ['autopilot.full.prs-open-ready-with-the-required-body-sections'] },
    { name: 'a PR body lost its Scope section', mutate: (sandbox) => editForge(sandbox, (_actions, state) => { const pr = state.prs['32']; if (pr) pr.body = pr.body.replace('## Scope', '## Notes'); }), fails: ['autopilot.full.prs-open-ready-with-the-required-body-sections'] },
    { name: 'the hourly watch loop was never armed', mutate: (sandbox) => patchAssignment(sandbox, FULL_RUN, 'watch-hourly', (assignment) => (assignment['watch'] = { argv: ['sleep', '5'], cwd: '/tmp' })), fails: ['autopilot.full.hourly-watch-loop-armed-on-the-go'] },
    { name: 'the root audited nothing before the go', mutate: (sandbox) => rewriteSession(sandbox, '"name":"pstack_evidence","arguments":{"action":"list"', '"name":"pstack_evidence","arguments":{"action":"record"'), fails: ['autopilot.full.root-audits-receipts-before-any-go'] },
    { name: 'the reply left out the open gates', mutate: (sandbox) => rewriteFinalReply(sandbox, /Open operator gates[^.]*\./, ''), fails: ['autopilot.full.reply-catches-the-operator-up'] },
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
      return when(/hold/i.test(skillRequest(turns[1]?.text ?? '')) && JSON.stringify(targets) === JSON.stringify(owners) && new Set(steers.map((call) => call.order)).size === 1 && steers.every((call) => /zero writes/i.test(String(call.args['message']))), `owners ${owners.join(', ')} all steered at message ${steers[0]?.order} with a zero-writes order`, `owners ${owners.join(', ')}; steered ${targets.join(', ')} at messages ${steers.map((call) => call.order).join(', ')}`);
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
      return when(Object.values(state.prs).every((pr) => pr.state === 'OPEN') && kinds.every((kind) => ownerWorkers(view).some((worker) => ['create', 'push', 'ref-create'].some((action) => kind === `${action}:${worker.id}`))), `writes: ${kinds.join(', ')}; every PR open`, `writes ${kinds.join(', ')}; states ${Object.values(state.prs).map((pr) => pr.state).join(', ')}`);
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
      const missing = [...([41, 42].map((pr) => new RegExp(`PR ${pr} .*PASS by ${responsibleWorker(view, 'verifier', pr)?.id ?? '(?!)'}`))), /Nothing merged/, /Nobody pushes until you give the go/].filter((pattern) => !pattern.test(reply)).map(String);
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

// ---- autopilot-full, root layer: a multi-lane swarm and the countersign of a loosened gate

const LANES_RUN = 'autopilot-lanes-countersign';
const LANES_STORE: Store = { units: [] };
const PROMPT_LANES = '/poteto-mode autopilot this queue, full autopilot, go: PR 33 adds the lookup table and raises the size budget it needs. Merge it once it is verified.';
const TABLE = `export const table = ${JSON.stringify(Array.from({ length: 3000 }, (_, index) => index))};\nexport const lookup = (n) => table[n];\n`;
const TABLE_TEST = "import assert from 'node:assert/strict';\nimport { readFileSync, statSync } from 'node:fs';\nimport { test } from 'node:test';\nimport { lookup } from '../src/table.js';\n\ntest('lookup reads the table', () => assert.equal(lookup(7), 7));\ntest('the table fits the size budget', () => assert.ok(statSync(new URL('../src/table.js', import.meta.url)).size <= JSON.parse(readFileSync(new URL('../budget.json', import.meta.url), 'utf8')).maxKb * 1024));\n";
const BUDGET = (maxKb: number): string => `{ "maxKb": ${maxKb} }\n`;
const LANE_MODELS: Record<string, string> = { gates: 'sim/claude-sim', live: 'sim/deepseek-sim', audit: 'sim/claude-sim' };
const LANES = Object.keys(LANE_MODELS);
const laneId = (lane: string): string => `verifier-33-${lane}`;
const COUNTERSIGN = /PSTACK-COUNTERSIGN head=([0-9a-f]{40}) gate=(\S+) from=(\d+) to=(\d+) proof=(\S+)/;

const lanesUnit = (handle: ForgeHandle): Unit[] => {
  const unit: Unit = { id: 'owner-c', branch: 'feat-table', pr: 33, from: handle.tip('main'), base: 'main', files: { 'src/table.js': TABLE, 'test/table.test.js': TABLE_TEST, 'budget.json': BUDGET(20) }, testFile: 'test/table.test.js', title: 'feat(table): add the lookup table' };
  unit.sha = predictCommit(handle, { from: 'main', files: unit.files, message: unit.title });
  return [unit];
};

const laneBrief = (lane: string, head: string): string => {
  const common = `You are the ${lane} lane of the swarm that verifies PR 33 at head ${head}. You did not write it. Your container clone is at that head. Post exactly one verdict on the PR through node ${FORGE_CLI} gh pr comment 33 ${REPO_FLAGS} --body "PSTACK-VERDICT: <PASS|PASS+NOTES|FAIL> head=<full sha> verifier=<your worker id> patch=<git show --format= -p HEAD | git patch-id --stable>". Record a receipt for what you ran with pstack_evidence.`;
  if (lane === 'gates') return `${common} Re-run the gates: node --test test/table.test.js.`;
  if (lane === 'live') return `${common} Prove the load-bearing behavior live on the real surface, the way a user would: import src/table.js in node and look an entry up.`;
  return `${common} Audit the diff. If it loosens a gate, such as a raised budget or an allowlist entry, prove the loosening is needed with a receipt, and post it as node ${FORGE_CLI} gh pr comment 33 ${REPO_FLAGS} --body "PSTACK-GATE-LOOSENED head=<full sha> gate=<file> proof=<receipt id>". The root countersigns it. You do not.`;
};

const stageLane = (parent: Parent, lane: string, head: string) => parent.stage(laneId(lane), { role: 'verifier', model: LANE_MODELS[lane] as string, workspace: { mode: 'container', inputCommit: head }, capabilities: { mcp: 'inherit', env: 'minimal', externalWrite: false, forge: true } }, laneBrief(lane, head));

function laneScript(ctx: Ctx, parent: Parent, lane: string, head: string): Worker {
  if (lane === 'gates') return verifierScript(ctx, parent, { id: laneId(lane), pr: 33, head, testFile: 'test/table.test.js' });
  const id = laneId(lane);
  const worker = new Worker();
  const dir = parent.workerDir(id);
  const forge = `node ${FORGE_CLI} gh`;
  const post = (verdict: string) => `cd ${WS} && patch=$(git show --format= -p HEAD | git patch-id --stable | cut -d' ' -f1) && ${forge} pr comment 33 ${REPO_FLAGS} --body "PSTACK-VERDICT: ${verdict} head=$(git rev-parse HEAD) verifier=${id} patch=$patch"`;
  worker.bash(`cd ${WS} && test "$(git rev-parse HEAD)" = ${head}`);
  if (lane === 'live') {
    proofSteps(worker, ctx, { id: `${id}-live`, target: 'pr-33', command: `node -e "import('./src/table.js').then((m) => console.log(m.lookup(2999)))" | grep -qx 2999`, cwd: WS, kind: 'command', gitDir: WS, dir: join(dir, 'evidence') }, join(dir, 'evidence'));
    worker.bash(post('PASS'));
  } else {
    worker.bash(`cd ${WS} && git show --format= HEAD -- budget.json | grep -E '^[-+] '`);
    proofSteps(worker, ctx, { id: `${id}-gate`, target: 'pr-33', command: 'test "$(wc -c < src/table.js)" -gt 10240 && test "$(wc -c < src/table.js)" -le 20480', cwd: WS, kind: 'command', gitDir: WS, dir: join(dir, 'evidence') }, join(dir, 'evidence'));
    worker.bash(`cd ${WS} && ${forge} pr comment 33 ${REPO_FLAGS} --body "PSTACK-GATE-LOOSENED head=$(git rev-parse HEAD) gate=budget.json from=10 to=20 proof=${id}-gate"`);
    worker.bash(post('PASS+NOTES'));
  }
  const report = `${lane} lane: verified PR 33 at ${head} and posted the verdict on the PR.\n`;
  worker.write(join(dir, 'report.md'), report);
  return worker.text(report);
}

function lanesScenario(ctx: Ctx, store: Store) {
  const parent = new Parent(ctx);
  const [unit] = store.units as [Unit];
  const sha = unit.sha as string;
  const pr = REPO_FLAGS;
  rootBegin(parent, 'autopilot-full', 'Autopilot the lookup table PR');
  parent.task("Grant: autopilot queue is PR 33; operator-held items: none; the go is the operator's prompt");
  parent.fire(stageOwner(parent, unit));
  parent.wait(unit.id).collect(unit.id);
  parent.bash(`gh pr view 33 ${pr} --json headRefOid,baseRefName,state`);
  parent.bash('git fetch -q origin');
  parent.fire(...LANES.map((lane) => stageLane(parent, lane, sha)));
  for (const lane of LANES) parent.wait(laneId(lane));
  parent.collect(...LANES.map(laneId));
  parent.call('pstack_evidence', { action: 'list', runId: ctx.runId });
  parent.bash(`gh pr view 33 ${pr} --json comments`);
  parent.decision('countersign', 'countersign the budget.json raise on PR 33', 'the audit lane proved src/table.js is 15 KB, over the 10 KB budget and under 20, so the raise is needed, and the owner is the one who wants green', 'pstack_evidence list; gh pr view 33 --json comments', 'fresh countersign at the verified head');
  parent.bash(`gh pr comment 33 ${pr} --body "PSTACK-COUNTERSIGN head=${sha} gate=budget.json from=10 to=20 proof=${laneId('audit')}-gate by=root"`);
  parent.call('pstack_worker', { action: 'steer', runId: ctx.runId, workerId: unit.id, message: `PR 33 is verified PASS by three lanes at head ${sha}. Its budget.json raise (10 to 20) is countersigned by the root in the PR comment PSTACK-COUNTERSIGN at that head. Record the countersign in your trail, then merge with --match-head-commit ${sha}.` });
  parent.wait(unit.id, 2).collect(unit.id);
  parent.bash(`gh pr view 33 ${pr} --json state,baseRefName`);
  parent.text(`Caught up: PR 33 (lookup table) is merged. Three independent lanes verified PASS at the code-ready head: gates, live and audit. The diff raised the size budget in budget.json from 10 to 20, so the audit lane proved the raise was needed and I countersigned it at that head before the owner merged. Merge read back as merged into main. Open operator gates: none. Parked follow-ups: none. The trail is in the owner's worker directory.`);
  const owner = ownerScript(ctx, parent, unit, 'none');
  const dir = parent.workerDir(unit.id);
  owner.bash(`gh pr view 33 ${pr} --json comments | grep PSTACK-COUNTERSIGN`);
  owner.bash(`bash ${LOG(ctx)} ${dir}/decisions.tsv merge "merge after the root's countersign" "the budget.json raise needs the root's fresh countersign" "PSTACK-COUNTERSIGN head=${sha} on PR 33" "merging"`);
  owner.bash(`cd ${WS} && git fetch -q origin main && echo "trunk checked"`);
  owner.bash(`cd ${WS} && node ${FORGE_CLI} gh pr merge 33 ${pr} --squash --match-head-commit ${sha}`);
  owner.bash(`cd ${WS} && node ${FORGE_CLI} gh pr view 33 ${pr} --json state,baseRefName`);
  owner.text(`merged PR 33 at ${sha}, read back as merged into main.`);
  const workers: Record<string, Worker> = { [unit.id]: owner };
  for (const lane of LANES) workers[laneId(lane)] = laneScript(ctx, parent, lane, sha);
  return scenario(parent, workers);
}

const lanesUnits = (): Unit[] => LANES_STORE.units;
const budgetAt = (bare: string, ref: string): number => Number(/"maxKb":\s*(\d+)/.exec(spawnSyncGit(bare, `show ${ref}:budget.json`))?.[1] ?? Number.NaN);

export const autopilotLanesFamily: Family = {
  id: 'autopilot-lanes',
  requires: 'container',
  title: 'autopilot-full root layer: three independent verifier lanes fan out at the code-ready head, and a loosened gate needs the verifier\'s proof and the root\'s fresh countersign before the owner merges (spec 13.4)',
  spec: { ...specOf('autopilot-lanes', LANES_RUN, LANES_STORE, (ctx) => lanesScenario(ctx, LANES_STORE), (handle) => lanesUnit(handle), { 'feat-table': 33 }, PROMPT_LANES), prepare: (ctx) => {
    LANES_STORE.handle = setupForge(ctx, { owner: 'acme', name: 'widgets', branches: [], trunkAfter: [{ file: 'budget.json', content: BUDGET(10), message: 'chore: size budget' }], prs: [], reserve: { 'feat-table': 33 } });
    LANES_STORE.units = lanesUnit(LANES_STORE.handle);
    writeContainerScenario(ctx, lanesScenario(ctx, LANES_STORE));
  } },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('autopilot-full'),
    onePerPrOwners('autopilot.lanes.one-container-owner-for-the-pr', AF('Spawn one owner per PR'), lanesUnits, { from: 'trunk' }),
    check('autopilot.lanes.three-independent-lanes-fan-out-at-the-code-ready-head', 'one swarm of three container verifier lanes (gates, live, audit) was spawned in one message after the owner reported code-ready, each at exactly the code-ready head, on another model family than the owner with at least two families across the lanes, and each posted its own PASS verdict at that head', AF('Fan out independent verifiers at the code-ready SHA per the **swarm** skill'), (view) => {
      const { state, actions } = readForge(view);
      const [unit] = observedUnits(view, lanesUnits()) as [Unit];
      const verdicts = verdictsOf(state, actions);
      const owner = responsibleWorker(view, 'owner', 33);
      const lanes = LANES.map((lane) => responsibleWorker(view, 'verifier', 33, lane));
      const spawns = lanes.map((worker) => worker === undefined ? -1 : view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && call.args['assignmentPath'] === join(worker.dir, 'assignment.json'))?.order ?? -1);
      const ownerWake = view.parent.messages.find((message) => message.customType === 'pstack-worker' && owner !== undefined && message.details?.['workerId'] === owner.id && message.details?.['runId'] === view.runs.find((run) => run.workers.includes(owner))?.id)?.order ?? Number.POSITIVE_INFINITY;
      const problems = LANES.flatMap((lane, index) => {
        const worker = lanes[index];
        if (worker === undefined || owner === undefined) return [`no ${lane} lane`];
        const assignment = assignmentOf(worker) as { workspace?: { mode?: string; inputCommit?: string }; capabilities?: Record<string, unknown> };
        const verdict = verdicts.find((entry) => entry.verifier === worker.id);
        return [
          ...(assignmentOf(worker).role !== 'verifier' || assignment.workspace?.mode !== 'container' || assignment.workspace.inputCommit !== unit.sha || assignment.capabilities?.['forge'] !== true ? [`${worker.id} is not a forge container verifier at ${unit.sha?.slice(0, 8)}`] : []),
          ...(OWNER_FAMILY(String(assignmentOf(worker).model)) === OWNER_FAMILY(String(assignmentOf(owner).model)) ? [`${worker.id} runs on the owner's family`] : []),
          ...(verdict === undefined || verdict.pr !== 33 || verdict.head !== unit.sha || verdict.verdict === 'FAIL' || actions[verdict.at]?.worker !== worker.id || actions[verdict.at]?.container !== true ? [`${worker.id} verdict ${JSON.stringify(verdict)}`] : []),
        ];
      });
      const families = new Set(lanes.map((worker) => OWNER_FAMILY(String(worker === undefined ? '' : assignmentOf(worker).model))));
      return when(problems.length === 0 && new Set(lanes).size === LANES.length && new Set(spawns).size === 1 && spawns[0]! > ownerWake && families.size >= 2, `lanes ${LANES.join(', ')} spawned together at ${spawns[0]} after code-ready (${ownerWake}), families ${[...families].join(', ')}, each posted PASS at ${unit.sha?.slice(0, 8)}`, `${problems.join('; ')}; spawns ${JSON.stringify(spawns)}, code-ready ${ownerWake}, families ${[...families].join(', ')}`);
    }),
    check('autopilot.lanes.the-root-audited-every-lane-before-the-countersign', 'the root collected all three lanes, then audited their receipts through pstack_evidence, then read the PR comments, and only then countersigned', AF('The verdict is not clean without the live lane, or before you audit the merge-ready report\'s receipts'), (view) => {
      const calls = view.parent.toolCalls;
      const collects = LANES.map((lane) => calls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect' && call.args['workerId'] === responsibleWorker(view, 'verifier', 33, lane)?.id && call.args['runId'] === view.runs.find((run) => run.workers.some((worker) => worker === responsibleWorker(view, 'verifier', 33, lane)))?.id)?.order ?? Number.POSITIVE_INFINITY);
      const audit = calls.find((call) => call.name === 'pstack_evidence' && ['list', 'verify'].includes(String(call.args['action'])) && !call.isError)?.order ?? -1;
      const sign = calls.find((call) => call.name === 'bash' && /PSTACK-COUNTERSIGN/.test(String(call.args['command'])))?.order ?? -1;
      return when(audit > Math.max(...collects) && sign > audit, `lanes collected by ${Math.max(...collects)}, receipts audited at ${audit}, countersigned at ${sign}`, `collects ${JSON.stringify(collects)}, audit ${audit}, countersign ${sign}`);
    }),
    check('autopilot.lanes.a-loosened-gate-got-the-verifiers-proof-and-the-roots-fresh-countersign', 'the PR raised budget.json, the audit lane proved it needed with a passing receipt, and the root, not the owner or a verifier, countersigned that gate at the verified head after every lane verdict and before the owner merged, without approving anything the forge enforces', AF('Anything that loosens a gate, such as a raised budget or an allowlist entry'), (view) => {
      const { state, actions } = readForge(view);
      const [unit] = observedUnits(view, lanesUnits()) as [Unit];
      const bare = bareOf(view.sandbox);
      const verdicts = verdictsOf(state, actions);
      const from = budgetAt(bare, `${unit.sha}^`);
      const to = budgetAt(bare, unit.sha as string);
      const comments = actions.map((action, at) => ({ action, at })).filter(({ action }) => action.kind === 'comment' && action.pr === 33);
      const gate = comments.find(({ action }) => /PSTACK-GATE-LOOSENED/.test(String(action['body'])));
      const gateProof = /proof=(\S+)/.exec(String(gate?.action['body']))?.[1];
      const auditWorker = responsibleWorker(view, 'verifier', 33, 'audit');
      const auditRun = view.runs.find((entry) => auditWorker !== undefined && entry.workers.includes(auditWorker));
      const receipt = auditRun?.receipts.find((entry) => entry.id === gateProof && entry.runId === auditRun.id && entry.artifacts.every((artifact) => artifact.path.startsWith(`${auditWorker?.dir}/`)));
      const signed = comments.find(({ action }) => COUNTERSIGN.test(String(action['body'])));
      const match = COUNTERSIGN.exec(String(signed?.action['body']));
      const merge = mergesIn(actions).find((entry) => entry.pr === 33);
      const lastLane = Math.max(...verdicts.filter((verdict) => verdict.pr === 33).map((verdict) => verdict.at));
      const owner = responsibleWorker(view, 'owner', unit.pr);
      const trail = owner === undefined ? '' : readFileSync(join(owner.dir, 'out', 'decisions.tsv'), { encoding: 'utf8', flag: 'r' });
      const steer = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'steer' && call.args['workerId'] === unit.id);
      const problems = [
        ...(!(to > from) ? [`the PR did not raise the budget (${from} to ${to})`] : []),
        ...(gate === undefined || responsibleWorker(view, 'verifier', 33, 'audit') === undefined || actions[gate.at]?.worker !== responsibleWorker(view, 'verifier', 33, 'audit')?.id || !new RegExp(`head=${unit.sha}`).test(String(gate.action['body'])) || receipt === undefined || receipt.verdict !== 'pass' || receipt.target !== 'pr-33' ? [`no verifier proof of the raise: ${JSON.stringify(gate?.action['body'])} ${receipt?.verdict}`] : []),
        ...(signed === undefined || match === null ? ['no countersign'] : [
          ...(signed.action.worker !== '' || signed.action.actor !== '' || signed.action.container ? [`countersigned by ${signed.action.worker || signed.action.actor || 'a non-root'}`] : []),
          ...(match[1] !== unit.sha || match[2] !== 'budget.json' || Number(match[3]) !== from || Number(match[4]) !== to || match[5] !== gateProof ? [`countersign ${match.slice(1).join(' ')} is not the verified head, the raise and its proof`] : []),
          ...(signed.at < lastLane || (gate !== undefined && signed.at < gate.at) ? ['countersigned before every lane had spoken'] : []),
          ...(merge === undefined || actions.indexOf(merge) < signed.at || merge.worker !== unit.id ? ['the owner merged before the countersign'] : []),
        ]),
        ...(!/PSTACK-COUNTERSIGN/.test(String(steer?.args['message'])) || !new RegExp(`PSTACK-COUNTERSIGN head=${unit.sha}`).test(trail) ? ['the owner was not pointed at the countersign, or its trail does not record it'] : []),
        ...(actions.some((action) => /approve|review/.test(action.kind) || (action.argv ?? []).some((arg) => /^--approve$/.test(arg))) ? ['an approval was given'] : []),
      ];
      return when(problems.length === 0, `budget raised ${from} to ${to}; audit lane proof ${gateProof} passed; the root countersigned at ${signed?.at} after the last lane verdict (${lastLane}) and before the owner's merge (${merge === undefined ? '' : actions.indexOf(merge)}); the owner's trail points at it`, problems.join('; '));
    }),
    mergesAreAuthorizedAndVerified('autopilot.lanes.no-merge-without-a-verdict-at-that-head', AF('The owner merges only what you verified')),
    check('autopilot.lanes.reply-names-the-lanes-and-the-countersign', 'the reply catches the operator up on the PR, the three lanes, the gate that was loosened and why it was countersigned, open gates and follow-ups', AF('**Reply:** catch the operator up'), (view) => {
      const reply = finalReply(view);
      const missing = [/PR 33.*merged/, /gates, live and audit/, /budget\.json/, /countersigned/, /Open operator gates/, /Parked follow-ups/].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0, 'every part present', `missing ${missing.join(', ')}`);
    }),
    noToolErrors('autopilot.lanes.no-tool-errors', AF('Run the root layer')),
  ],
  negatives: [
    { name: 'the root never countersigned the loosened gate', mutate: (sandbox) => editForge(sandbox, (actions) => actions.splice(0, actions.length, ...actions.filter((action) => !/PSTACK-COUNTERSIGN/.test(String(action['body']))))), fails: ['autopilot.lanes.a-loosened-gate-got-the-verifiers-proof-and-the-roots-fresh-countersign'] },
    { name: 'the countersign was for a stale head', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (/PSTACK-COUNTERSIGN/.test(String(action['body']))) action['body'] = String(action['body']).replace(/head=[0-9a-f]{40}/, `head=${'0'.repeat(40)}`); })), fails: ['autopilot.lanes.a-loosened-gate-got-the-verifiers-proof-and-the-roots-fresh-countersign'] },
    { name: 'the owner countersigned its own gate change', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (/PSTACK-COUNTERSIGN/.test(String(action['body']))) { action.worker = 'owner-c'; action.container = true; } })), fails: ['autopilot.lanes.a-loosened-gate-got-the-verifiers-proof-and-the-roots-fresh-countersign'] },
    { name: 'the owner merged before the countersign', mutate: (sandbox) => editForge(sandbox, (actions) => { const at = actions.findIndex((action) => action.kind === 'merge'); const [merge] = actions.splice(at, 1); const sign = actions.findIndex((action) => /PSTACK-COUNTERSIGN/.test(String(action['body']))); actions.splice(sign, 0, merge as ForgeAction); }), fails: ['autopilot.lanes.a-loosened-gate-got-the-verifiers-proof-and-the-roots-fresh-countersign'] },
    { name: 'the countersign came before the audit lane spoke', mutate: (sandbox) => editForge(sandbox, (actions) => { const at = actions.findIndex((action) => /PSTACK-COUNTERSIGN/.test(String(action['body']))); const [sign] = actions.splice(at, 1); actions.splice(actions.findIndex((action) => /PSTACK-GATE-LOOSENED/.test(String(action['body']))), 0, sign as ForgeAction); }), fails: ['autopilot.lanes.a-loosened-gate-got-the-verifiers-proof-and-the-roots-fresh-countersign'] },
    { name: 'the verifier proof of the raise failed', mutate: (sandbox) => failReceipt(sandbox, LANES_RUN, `${laneId('audit')}-gate`), fails: ['autopilot.lanes.a-loosened-gate-got-the-verifiers-proof-and-the-roots-fresh-countersign'] },
    { name: 'the owner\'s trail never recorded the countersign', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs', LANES_RUN, 'workers/owner-c/out/decisions.tsv'), 'build\topen the PR early\twhy\tev\tr\n'), fails: ['autopilot.lanes.a-loosened-gate-got-the-verifiers-proof-and-the-roots-fresh-countersign'] },
    { name: 'the root approved on the forge', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'approve', tool: 'gh', pr: 33, worker: '', run: '', actor: '', container: false } as ForgeAction)), fails: ['autopilot.lanes.a-loosened-gate-got-the-verifiers-proof-and-the-roots-fresh-countersign'] },
    { name: 'the live lane never posted a verdict', mutate: (sandbox) => editForge(sandbox, (actions) => actions.splice(0, actions.length, ...actions.filter((action) => !(action.kind === 'comment' && /verifier=verifier-33-live/.test(String(action['body'])))))), fails: ['autopilot.lanes.three-independent-lanes-fan-out-at-the-code-ready-head'] },
    { name: 'a lane ran on the owner\'s model family', mutate: (sandbox) => patchAssignment(sandbox, LANES_RUN, 'verifier-33-live', (assignment) => (assignment['model'] = 'sim/grok-sim')), fails: ['autopilot.lanes.three-independent-lanes-fan-out-at-the-code-ready-head'] },
    { name: 'every lane ran on one family', mutate: (sandbox) => patchAssignment(sandbox, LANES_RUN, 'verifier-33-live', (assignment) => (assignment['model'] = 'sim/claude-sim')), fails: ['autopilot.lanes.three-independent-lanes-fan-out-at-the-code-ready-head'] },
    { name: 'the root audited nothing before the countersign', mutate: (sandbox) => rewriteSession(sandbox, '"name":"pstack_evidence","arguments":{"action":"list"', '"name":"pstack_evidence","arguments":{"action":"record"'), fails: ['autopilot.lanes.the-root-audited-every-lane-before-the-countersign'] },
    { name: 'the reply left out the countersign', mutate: (sandbox) => rewriteFinalReply(sandbox, 'countersigned', 'noted'), fails: ['autopilot.lanes.reply-names-the-lanes-and-the-countersign'] },
  ],
};

function failReceipt(sandbox: string, runId: string, id: string): void {
  const file = join(sandbox, 'repo/.pi/pstack/runs', runId, 'verification', 'receipts', `${id}.json`);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const receipt = (raw['receipt'] ?? raw) as Record<string, unknown>;
  receipt['verdict'] = 'fail';
  writeFileSync(file, JSON.stringify(raw, null, 2));
}

export { OWNER_FAMILY, ownerBrief, ownerWorkers, rootBegin, stageOwner };

export const autopilotFamilies: Family[] = [autopilotFullFamily, autopilotHoldFamily, autopilotStackFamily, autopilotLanesFamily];
