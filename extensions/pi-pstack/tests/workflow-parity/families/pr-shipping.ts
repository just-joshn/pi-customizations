// Shipping families (spec 13.3): one container verifier per PR with the forge capability, a verdict that covers the head and
// the patch it examined, only the contiguous verified run from the root landing, bottom-up, never a merge from green CI.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Parent, proofSteps, scenario, shQuote, Worker } from '../fixtures/dsl.ts';
import { bareOf, editForge, type ForgeAction, type ForgeEvent, type ForgeHandle, type ForgeState, forgeEnv, patchIdOf, readForge, revParse, setupForge, WATCH_PR, writeContainerScenario } from '../fixtures/forge.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, checkAbsence, type Src, src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, finalReply, noToolErrors, playbookReads, promptRoutes, skillRequest, todoChecks, verifyReceipt } from '../lib/checks.ts';
import type { Ctx } from '../lib/driver.ts';
import { deleteStep, dropWakes, parentSession, patchAssignment, rewriteFinalReply, setStep } from '../lib/mutate.ts';
import type { RunView, WorkerView } from '../lib/view.ts';
import { BASH, forgeResolvedOnce, neverMutatesTopology, REPO_FLAGS, stepDone, watchers } from './pr-shared.ts';
import { todoNegatives } from './shared.ts';
import type { Family } from './types.ts';

export const SH = (anchor: string): Src => src('poteto-mode/playbooks/shipping.md', anchor);

export const containerRunLabel = (runId: string): string => `pstack.run=${runId}`;

/** Removes any container of the run the host left behind. */
export function removeRunContainers(runId: string): void {
  const listed = spawnSync('docker', ['ps', '--all', '--quiet', '--filter', `label=${containerRunLabel(runId)}`], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  if (listed.length > 0) spawnSync('docker', ['rm', '--force', ...listed], { stdio: 'ignore' });
}

const VERDICT = /PSTACK-VERDICT: (PASS\+NOTES|PASS|FAIL) head=([0-9a-f]{40}) verifier=(\S+) patch=(\S+)/;

export interface Verdict {
  pr: number;
  verdict: 'PASS' | 'PASS+NOTES' | 'FAIL';
  head: string;
  author: string;
  verifier: string;
  patch: string;
  /** Position of the comment among the forge's actions. */
  at: number;
}

const canonicalCommit = (view: RunView, ref: string): string => {
  if (!/^[0-9a-f]{7,40}$/.test(ref)) return ref;
  const result = spawnSync('git', ['--git-dir', bareOf(view.sandbox), 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : ref;
};

export function verdictsOf(state: ForgeState, actions: ForgeAction[], view?: RunView): Verdict[] {
  return actions.flatMap((action, at) => {
    if (action.kind !== 'comment' || action.pr === undefined) return [];
    const match = VERDICT.exec(String(action['body']));
    if (match !== null) return [{ pr: action.pr, verdict: match[1] as Verdict['verdict'], head: match[2] as string, author: action.worker || action.actor || 'operator', verifier: match[3] as string, patch: match[4] as string, at }];
    const body = String(action['body']).replace(/\*\*|`/g, '');
    const plain = /^\s*(?:#+\s*)?(?:PR\s+(\d+)\s+verification:\s*)?(PASS\+NOTES|PASS|FAIL|ISSUES|BLOCKED)\b/i.exec(body);
    if (plain?.[1] !== undefined && Number(plain[1]) !== action.pr) return [];
    const workers = view === undefined ? [] : allWorkers(view).filter((worker) => worker.id === action.worker && assignmentOf(worker).role === 'verifier');
    const worker = workers.length === 1 ? workers[0] : undefined;
    const assignedHead = worker === undefined ? undefined : assignmentOf(worker).workspace?.inputCommit;
    if (plain === null || assignedHead === undefined || view === undefined) return [];
    const statedHead = /\b(?:at|head(?:\s+verified)?\s*:?)\s+([0-9a-f]{7,40})\b/i.exec(body)?.[1];
    const head = statedHead === undefined || assignedHead.startsWith(statedHead) ? assignedHead : statedHead;
    return [{ pr: action.pr, verdict: /ISSUES|BLOCKED/i.test(plain[2] ?? '') ? 'FAIL' : plain[2]?.toUpperCase() as Verdict['verdict'], head, author: action.worker, verifier: action.worker, patch: patchIdOf(bareOf(view.sandbox), head), at }];
  }).filter((verdict) => state.prs[String(verdict.pr)] !== undefined).map((verdict) => view === undefined ? verdict : { ...verdict, head: canonicalCommit(view, verdict.head) });
}

/** Bottom-to-top PR numbers of the stack, from the bases and heads in the forge's own state. */
export function stackOrder(state: ForgeState): number[] {
  const prs = Object.values(state.prs);
  const order: number[] = [];
  let base = state.repo.trunk;
  for (;;) {
    const next = prs.find((pr) => (pr.baseAtStart ?? pr.base) === base && !order.includes(pr.number));
    if (next === undefined) return order;
    order.push(next.number);
    base = next.head;
  }
}

/** The contiguous run from the root whose verdict is PASS or PASS+NOTES at the PR's own head. */
export function verifiedPrefix(order: number[], state: ForgeState, verdicts: Verdict[], headOf: (pr: number) => string): number[] {
  const prefix: number[] = [];
  for (const number of order) {
    const found = verdicts.filter((verdict) => verdict.pr === number).at(-1);
    if (found === undefined || found.verdict === 'FAIL' || found.head !== headOf(number) || found.verifier === state.prs[String(number)]?.author) break;
    prefix.push(number);
  }
  return prefix;
}

export const headAt = (view: Pick<RunView, 'sandbox'>, state: ForgeState): ((pr: number) => string) => (pr) => spawnSync('git', ['--git-dir', bareOf(view.sandbox), 'rev-parse', `refs/heads/${state.prs[String(pr)]?.head}`], { encoding: 'utf8' }).stdout.trim();


export const containerWorkers = (view: RunView, role: string): WorkerView[] => allWorkers(view).filter((worker) => assignmentOf(worker).role === role);

/** A container verifier's script: run the PR's own test the way a user would, record a receipt, post the verdict through the forge CLI. */
export function verifierScript(ctx: Ctx, parent: Parent, options: { id: string; pr: number; head: string; testFile: string; runId?: string }): Worker {
  const worker = new Worker();
  const workerDir = parent.workerDir(options.id);
  const ws = '/tmp/workspace';
  const forgeCli = 'gh';
  if (existsSync(join(ctx.sandbox, 'forge'))) worker.bash(`node ${ctx.pkg}/tests/workflow-parity/fixtures/credential-isolation.mjs`);
  worker.bash(`cd ${ws} && test "$(git rev-parse HEAD)" = ${options.head}`);
  worker.bash(`cd ${ws} && node --test ${options.testFile}; true`);
  proofSteps(worker, ctx, { id: `${options.id}-run`, target: `pr-${options.pr}`, command: `node --test ${options.testFile}`, cwd: ws, kind: 'test', gitDir: ws, dir: join(workerDir, 'evidence') }, join(workerDir, 'evidence'));
  worker.bash(`cd ${ws} && patch=$(git show --format= -p HEAD | git patch-id --stable | cut -d' ' -f1) && if node --test ${options.testFile} >/dev/null 2>&1; then v=PASS; else v=FAIL; fi && ${forgeCli} pr comment ${options.pr} ${REPO_FLAGS} --body "PSTACK-VERDICT: $v head=$(git rev-parse HEAD) verifier=${options.id} patch=$patch"`);
  const report = `Verified PR ${options.pr} at ${options.head}: ran ${options.testFile} in the container clone and posted the verdict on the PR.\n`;
  worker.write(join(workerDir, 'report.md'), report);
  return worker.text(report);
}

export const verifierBrief = (pr: number, head: string, testFile: string): string =>
  `You are the independent verifier for PR ${pr} at head ${head}. You did not write it. Your container clone is at that head. Run the change the way a user would: node --test ${testFile}, against the head and its parent. Record a receipt for the run with pstack_evidence. Then post exactly one verdict on the PR through the forge CLI, gh pr comment ${pr} ${REPO_FLAGS} --body "PSTACK-VERDICT: <PASS|PASS+NOTES|FAIL> head=<full sha> verifier=<your worker id> patch=<git show --format= -p HEAD | git patch-id --stable>". Green CI is not a verdict.`;

export const stageVerifier = (parent: Parent, id: string, pr: number, head: string, testFile: string): { tool: string; args: Record<string, unknown> } =>
  parent.stage(id, { role: 'verifier', model: 'sim/claude-sim', workspace: { mode: 'container', inputCommit: head }, capabilities: { mcp: 'inherit', env: 'minimal', externalWrite: false, forge: true } }, verifierBrief(pr, head, testFile));

// ---- the stack: #21 root, #22 broken, #23 passes on its own

const S1 = "export const one = () => 1;\n";
const S2_BUG = "export const two = () => 3;\n";
const S3 = "export const three = () => 3;\n";
const testOf = (name: string, expected: number, mod: string) => `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { ${name} } from '../src/${mod}.js';\n\ntest('${name} returns ${expected}', () => assert.equal(${name}(), ${expected}));\n`;

const stackBranches = (broken: boolean) => [
  { name: 's-1', from: 'main', files: { 'src/s1.js': S1, 'test/s1.test.js': testOf('one', 1, 's1') }, message: 'feat(stack): one' },
  { name: 's-2', from: 's-1', files: { 'src/s2.js': broken ? S2_BUG : "export const two = () => 2;\n", 'test/s2.test.js': testOf('two', 2, 's2') }, message: 'feat(stack): two' },
  { name: 's-3', from: 's-2', files: { 'src/s3.js': S3, 'test/s3.test.js': testOf('three', 3, 's3') }, message: 'feat(stack): three' },
];
const stackPrs = [
  { number: 21, title: 'feat(stack): one', head: 's-1', base: 'main', author: 'owner-21' },
  { number: 22, title: 'feat(stack): two', head: 's-2', base: 's-1', author: 'owner-22' },
  { number: 23, title: 'feat(stack): three', head: 's-3', base: 's-2', author: 'owner-23' },
];

const SHIP_RUN = 'ship-stack';
const SHIP_STORE: { handle?: ForgeHandle; heads?: Record<number, string> } = {};

const prepareStack = (ctx: Ctx, store: typeof SHIP_STORE, scenarioOf: (ctx: Ctx) => unknown, extra: { events?: Parameters<typeof setupForge>[1]['events']; broken?: boolean } = {}): void => {
  store.handle = setupForge(ctx, { owner: 'acme', name: 'widgets', branches: stackBranches(extra.broken !== false), prs: stackPrs, ...(extra.events === undefined ? {} : { events: extra.events }) });
  store.heads = { 21: store.handle.tip('s-1'), 22: store.handle.tip('s-2'), 23: store.handle.tip('s-3') };
  writeContainerScenario(ctx, scenarioOf(ctx));
};

const TEST_FILE = (pr: number) => `test/s${pr - 20}.test.js`;

function shipScenario(ctx: Ctx, store: typeof SHIP_STORE) {
  const parent = new Parent(ctx);
  const dir = parent.runDir;
  const heads = store.heads as Record<number, string>;
  const pr = REPO_FLAGS;
  parent.beginPlaybook('shipping', 'Ship the stack 21, 22, 23');
  for (const skill of ['control-cli', 'control-ui']) parent.readSkill(skill);
  parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
  parent.task('Forge: gh (origin CLI absent, fallback recorded)');
  parent.bash(`gh pr list ${pr} --state open --limit 300 --json number,headRefName,baseRefName,isCrossRepository`);
  const staged = [21, 22, 23].map((n) => stageVerifier(parent, `verifier-${n}`, n, heads[n] as string, TEST_FILE(n)));
  parent.fire(...staged);
  for (const n of [21, 22, 23]) parent.wait(`verifier-${n}`);
  parent.collect('verifier-21', 'verifier-22', 'verifier-23');
  for (const n of [21, 22, 23]) parent.bash(`gh pr view ${n} ${pr} --json comments`);
  stepDone(parent, 'shipping', 1, 'sh-verifiers', `test $(gh pr view 21 ${pr} --json comments | grep -c PSTACK-VERDICT) -ge 1`);
  parent.decision('ship-run', 'land 21 only', 'verdicts PASS, FAIL, PASS: the contiguous verified run from the root is PR 21, so 22 is the ceiling gap and 23 waits', 'gh pr view 21..23 --json comments', 'ceiling is PR 21');
  stepDone(parent, 'shipping', 2, 'sh-prefix', `grep -q 'land 21 only' ${join(dir, 'decisions.tsv')}`);
  parent.bash(`git fetch -q origin && for b in s-1 s-2 s-3; do echo $b $(git show --format= -p origin/$b | git patch-id --stable | cut -d' ' -f1); done`);
  parent.bash(`test "$(git rev-parse origin/s-1)" = ${heads[21]} && echo "PR 21 head is the verdict head, so its verdict covers the code"`);
  stepDone(parent, 'shipping', 3, 'sh-fresh', `test "$(git -C ${ctx.repo} rev-parse origin/s-1)" = ${heads[21]}`);
  parent.bash(`gh pr merge 21 ${pr} --squash --match-head-commit ${heads[21]}`);
  parent.bash(`gh pr view 21 ${pr} --json state,mergedAt,baseRefName`);
  stepDone(parent, 'shipping', 4, 'sh-landed', `gh pr view 21 ${pr} --json state,baseRefName | grep -q '"state":"MERGED","baseRefName":"main"'`);
  parent.spawn('watch-ceiling', { kind: 'watch', role: 'watcher', model: 'inherit-parent', workspace: parent.readonly(), watch: { argv: [WATCH_PR, '--owner', 'acme', '--repo', 'widgets', '--queued-stack', '--stack-prs', '21', '--interval', '0.3'], cwd: ctx.repo } }, '').wait('watch-ceiling').collect('watch-ceiling');
  stepDone(parent, 'shipping', 5, 'sh-hands-off', `test -z "$(git --git-dir=${bareOfCtx(ctx)} for-each-ref refs/heads/s-2 --format='%(objectname)' | grep -v ${heads[22]})"`);
  stepDone(parent, 'shipping', 6, 'sh-ceiling', `gh pr view 22 ${pr} --json state | grep -q OPEN`);
  parent.text(`Verified run: PR 21, the ceiling. Verdicts: PR 21 PASS by verifier-21, PR 22 FAIL by verifier-22 (its own test returns 3, not 2), PR 23 PASS by verifier-23, which waits because it cannot land without PR 22. Landed: PR 21, confirmed with gh pr view, which reads MERGED with main as its base. The next gap: fix PR 22, then a new pass through step 1 for PR 22 and PR 23.`);
  const workers: Record<string, Worker> = Object.fromEntries([21, 22, 23].map((n) => [`verifier-${n}`, verifierScript(ctx, parent, { id: `verifier-${n}`, pr: n, head: heads[n] as string, testFile: TEST_FILE(n) })]));
  return scenario(parent, workers);
}

const bareOfCtx = (ctx: Ctx): string => join(ctx.sandbox, 'forge', 'origin.git');

const shippingSpec = (id: string, runId: string, store: typeof SHIP_STORE, scenarioOf: (ctx: Ctx, store: typeof SHIP_STORE) => ReturnType<typeof scenario>, prompt: string, extra: { events?: Parameters<typeof setupForge>[1]['events']; broken?: boolean } = {}): Family['spec'] => ({
  family: id,
  runId,
  history: cartHistory,
  timeoutMs: 420_000,
  holdWatchers: /.*/,
  prepare: (ctx) => prepareStack(ctx, store, (c) => scenarioOf(c, store), extra),
  env: (ctx, driver) => forgeEnv(ctx, store.handle as ForgeHandle, { container: true, scripted: driver === 'scripted' }),
  cleanup: () => removeRunContainers(runId),
  prompt: () => prompt,
  scenario: (ctx) => scenarioOf(ctx, store),
});

// ---- checks every shipping run shares

export const mergesIn = (actions: ForgeAction[]): ForgeAction[] => actions.filter((action) => action.kind === 'merge');

export const mergeRequested = (prompt: string): boolean => /\b(land|ship|merge|autopilot)\b/i.test(skillRequest(prompt)) && !/don't merge|do not merge/i.test(skillRequest(prompt));

/** Every merge has the operator's request, a PASS verdict from a worker that did not write the PR at exactly the merged head, posted earlier. */
export function mergesAreAuthorizedAndVerified(id: string, source: Src | Src[], by: 'head' | 'patch' = 'head'): Check {
  return check(id, `every merge has the operator's explicit request, a PASS or PASS+NOTES verdict ${by === 'head' ? 'at exactly the merged head' : 'whose patch-id equals the merged head\'s patch-id'} from a worker that did not write the PR`, source, (view) => {
    const { state, actions } = readForge(view);
    const verdicts = verdictsOf(state, actions, view);
    const merges = mergesIn(actions);
    const problems = merges.flatMap((merge) => {
      const at = actions.indexOf(merge);
      const found = verdicts.filter((verdict) => verdict.pr === merge.pr && verdict.at < at).at(-1);
      const author = state.prs[String(merge.pr)]?.author;
      return [
        ...(found === undefined || found.verdict === 'FAIL' ? [`PR ${merge.pr} merged with no PASS verdict before it`] : []),
        ...(found !== undefined && by === 'head' && canonicalCommit(view, found.head) !== canonicalCommit(view, String(merge['head'])) ? [`PR ${merge.pr} verdict head ${found.head.slice(0, 8)} is not the merged head ${String(merge['head']).slice(0, 8)}`] : []),
        ...(found !== undefined && by === 'patch' && found.patch !== patchIdOf(bareOf(view.sandbox), String(merge['head'])) ? [`PR ${merge.pr} verdict patch ${found.patch.slice(0, 8)} is not the merged head's patch`] : []),
        ...(found !== undefined && (found.verifier === author || found.author === author) ? [`PR ${merge.pr} was verified by its author`] : []),
      ];
    });
    return when(mergeRequested(view.prompt) && merges.length > 0 && problems.length === 0, `${merges.length} merge(s), each authorized by the request and verified at its head by another worker`, `${mergeRequested(view.prompt) ? '' : 'the request does not authorize a merge; '}${merges.length === 0 ? 'no merge at all; ' : ''}${problems.join('; ')}`);
  });
}

/** Only a prefix computed independently from the verdicts landed, one PR at a time from the root, each read back as merged into trunk. */
export function landsOnlyTheVerifiedPrefix(id: string, source: Src | Src[], expected: number[], by: 'head' | 'patch' = 'head'): Check {
  return check(id, `exactly the contiguous verified prefix (${expected.map((n) => `#${n}`).join(', ')}) merged, bottom-up, each read back as merged into trunk, nothing above the first unverified PR`, source, (view) => {
    const { state, actions } = readForge(view);
    const order = stackOrder(state);
    const heads = headAt(view, state);
    const verdicts = verdictsOf(state, actions, view);
    const current = (n: number) => state.prs[String(n)]?.mergedHead ?? heads(n);
    const lost = order.findIndex((n) => {
      const found = verdicts.filter((verdict) => verdict.pr === n).at(-1);
      return found === undefined || found.verdict === 'FAIL' || found.patch !== patchIdOf(bareOf(view.sandbox), current(n));
    });
    const prefix = by === 'head' ? verifiedPrefix(order, state, verdicts, current) : order.slice(0, lost === -1 ? order.length : lost);
    const merged = mergesIn(actions).map((action) => action.pr);
    const readBack = merged.filter((n) => BASH(view).some((entry) => new RegExp(`\\bgh pr view ${n} .*--json state,mergedAt,baseRefName`).test(entry.command)));
    const base = merged.map((n) => state.prs[String(n)]?.base);
    return when(JSON.stringify(prefix) === JSON.stringify(expected) && JSON.stringify(merged) === JSON.stringify(expected) && readBack.length === merged.length && base.every((entry) => entry === state.repo.trunk), `independent prefix ${prefix.join(', ')}; merged ${merged.join(', ')} in that order; read back; base ${base.join(', ')}`, `independent prefix ${JSON.stringify(prefix)}, merged ${JSON.stringify(merged)}, read back ${JSON.stringify(readBack)}, bases ${JSON.stringify(base)}, want ${JSON.stringify(expected)}`);
  });
}

type Check = ReturnType<typeof check>;

export { stepDone };

// ---- family: shipping

export function verifierFor(view: RunView, pr: number): WorkerView | undefined {
  const { actions } = readForge(view);
  const candidates = containerWorkers(view, 'verifier').filter((worker) => actions.some((action) => action.kind === 'comment' && action.pr === pr && action.worker === (worker.assignment['workerId'] ?? worker.id)));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function verifierChecks(prefix: string, mode: 'head' | 'patch'): Check[] {
  return [
    check(`${prefix}.one-container-verifier-per-pr-with-the-forge-capability`, 'three verifiers, one per PR, each a container worker at its PR head with capabilities mcp inherit, env minimal, externalWrite false, forge true, none the PR author, and each actually ran in a container clone', SH('One verifier per PR, each a container worker'), (view) => {
      const { state } = readForge(view);
      const heads = headAt(view, state);
      const verdictHeads = verdictsOf(state, readForge(view).actions, view);
      const workers = containerWorkers(view, 'verifier');
      const problems = [21, 22, 23].flatMap((n) => {
        const worker = verifierFor(view, n);
        if (worker === undefined) return [`no verifier for PR ${n}`];
        const assignment = assignmentOf(worker) as { workspace?: { mode?: string; inputCommit?: string }; capabilities?: Record<string, unknown> };
        const caps = assignment.capabilities ?? {};
        const merged = state.prs[String(n)]?.mergedHead;
        return [
          ...(assignment.workspace?.mode !== 'container' ? [`${worker.id} workspace ${String(assignment.workspace?.mode)}`] : []),
          ...(canonicalCommit(view, assignment.workspace?.inputCommit ?? '') !== canonicalCommit(view, (mode === 'head' ? (merged ?? heads(n)) : verdictHeads.find((verdict) => verdict.pr === n)?.head) ?? '') ? [`${worker.id} inputCommit is not the head it verified`] : []),
          ...(caps['forge'] !== true || caps['env'] !== 'minimal' || caps['externalWrite'] !== false || caps['mcp'] !== 'inherit' ? [`${worker.id} capabilities ${JSON.stringify(caps)}`] : []),
          ...(worker.id === state.prs[String(n)]?.author ? [`${worker.id} is the author`] : []),
          ...(worker.session?.cwd !== '/tmp/workspace' ? [`${worker.id} session ran in ${String(worker.session?.cwd)}, not the container clone`] : []),
          ...(view.driver === 'scripted' && !worker.session?.toolCalls.some((call) => call.name === 'bash' && String(call.args['command']).endsWith('/fixtures/credential-isolation.mjs') && call.resultText.includes('CREDENTIAL-ISOLATION PASS:')) ? [`${worker.id} has no passing credential isolation probe`] : []),
          ...(view.runs.flatMap((run) => run.events).find((event) => event['workerId'] === worker.id && event['kind'] === 'spawn' && ((event['data'] as { container?: { image?: { id?: string } } }).container?.image?.id ?? '') !== '') === undefined ? [`${worker.id} has no container spawn event with an image id`] : []),
        ];
      });
      return when(workers.length === 3 && new Set([21, 22, 23].map((pr) => verifierFor(view, pr))).size === 3 && problems.length === 0, `${workers.map((worker) => worker.id).join(', ')}: container, forge capability, ran in /tmp/workspace`, `${workers.length} verifiers; ${problems.join('; ')}`);
    }),
    check(`${prefix}.verifiers-were-spawned-in-parallel-and-collected-after-their-wakes`, 'each verifier was spawned and collected after it settled, observed through a wake, inspect, or the collect result', SH('One verifier per PR'), (view) => {
      const spawns = [21, 22, 23].map((n) => {
        const worker = verifierFor(view, n);
        return worker === undefined ? -1 : view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && call.args['assignmentPath'] === join(worker.dir, 'assignment.json'))?.order ?? -1;
      });
      const problems = [21, 22, 23].flatMap((n) => {
        const worker = verifierFor(view, n);
        const run = view.runs.find((entry) => worker !== undefined && entry.workers.includes(worker));
        if (worker === undefined || run === undefined) return [`no unique verifier for PR ${n}`];
        const wake = view.parent.messages.find((message) => message.customType === 'pstack-worker' && message.details?.['workerId'] === worker.id && message.details?.['runId'] === run.id)?.order ?? -1;
        const collected = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect' && call.args['workerId'] === worker.id && call.args['runId'] === run.id && !call.isError);
        const collect = collected?.order ?? -1;
        const inspected = view.parent.toolCalls.some((call) => call.order < collect && call.name === 'pstack_worker' && call.args['action'] === 'inspect' && call.args['workerId'] === worker.id && !call.isError && /idle|settled|exited/.test(call.resultText));
        return collected !== undefined && ((wake !== -1 && collect > wake) || inspected || /settled/.test(collected.resultText)) ? [] : [`${worker.id}: wake ${wake}, collect ${collect}`];
      });
      return when(!spawns.includes(-1) && problems.length === 0, `spawned at ${spawns.join(', ')}; each collected after settling`, `spawn orders ${spawns.join(', ')}; ${problems.join('; ')}`);
    }),
    check(`${prefix}.verdicts-are-by-the-verifiers-and-match-what-the-code-does`, 'one verdict per PR is posted on the PR by its verifier, names the PR head, and the checker re-runs the PR test at that head and gets the same answer', SH('and posts `PASS`, `PASS+NOTES`, or `FAIL` on that PR'), (view) => {
      const { state, actions } = readForge(view);
      const verdicts = verdictsOf(state, actions, view);
      const problems = [21, 22, 23].flatMap((n) => {
        const found = verdicts.filter((verdict) => verdict.pr === n);
        const verdict = found[0];
        if (found.length !== 1 || verdict === undefined) return [`PR ${n} has ${found.length} verdicts`];
        const head = mode === 'head' ? (state.prs[String(n)]?.mergedHead ?? headAt(view, state)(n)) : verdict.head;
        const action = actions[verdict.at] as ForgeAction;
        const worker = verifierFor(view, n);
        const run = view.runs.find((entry) => worker !== undefined && entry.workers.includes(worker));
        const fullSuite = /\bnpm\s+test\b/.test(String(action['body']));
        const base = revParse(bareOf(view.sandbox), `${head}^`);
        const inherited = verdict.verdict === 'PASS+NOTES' && fullSuite && testAt(view, head, TEST_FILE(n)) && inheritedFailureOnly(view, base, head);
        const rerun = inherited || testAt(view, head, fullSuite ? undefined : TEST_FILE(n));
        return [
          ...(canonicalCommit(view, verdict.head) !== canonicalCommit(view, head) ? [`PR ${n} verdict names ${verdict.head.slice(0, 8)}, not the head ${head.slice(0, 8)}`] : []),
          ...(worker === undefined || run === undefined || verdict.verifier !== worker.id || action.worker !== worker.id || action.run !== run.id || !action.container || action.authenticated !== true ? [`PR ${n} verdict was not posted by its authenticated container verifier (${action.worker}, container ${String(action.container)}, token ${String(action.authenticated)})`] : []),
          ...(verdict.verdict === 'FAIL' === rerun ? [`PR ${n} verdict ${verdict.verdict} disagrees with the test run at its head (${rerun ? 'passes' : 'fails'})`] : []),
          ...(verdict.patch !== patchIdOf(bareOf(view.sandbox), head) ? [`PR ${n} verdict patch-id is not the head's`] : []),
        ];
      });
      return when(problems.length === 0, 'three verdicts, each at its head, posted by its authenticated container verifier, equal to a fresh test run', problems.join('; '));
    }),
    check(`${prefix}.each-verifier-recorded-its-own-receipt`, 'each verifier left a receipt in its own evidence folder that the host ingested, the artifact hashes re-verify, and the receipt verdict matches the verdict posted', src('poteto-mode/references/worker-assignment.md', 'A writable worker saves it under its worker directory'), (view) => {
      const { state, actions } = readForge(view);
      const verdicts = verdictsOf(state, actions, view);
      const problems = [21, 22, 23].flatMap((n) => {
        const selected = verifierFor(view, n);
        const worker = selected?.id;
        const run = view.runs.find((entry) => selected !== undefined && entry.workers.includes(selected));
        const receipts = run?.receipts.filter((entry) => entry.runId === run?.id && entry.artifacts.some((artifact) => resolve(run.dir, artifact.path).startsWith(`${selected?.dir}/evidence/`))) ?? [];
        const receipt = receipts.find((entry) => (entry.verdict === 'pass') !== (verdicts.find((verdict) => verdict.pr === n)?.verdict === 'FAIL'));
        if (receipt === undefined || run === undefined) return [`${worker} has no recorded receipt`];
        const posted = verdicts.find((verdict) => verdict.pr === n)?.verdict;
        const artifactsOk = receipt.artifacts.length > 0 && receipt.artifacts.every((artifact) => existsSync(resolve(run.dir, artifact.path)) && resolve(run.dir, artifact.path).startsWith(`${selected?.dir}/evidence/`));
        const hashes = verifyReceipt(run, { ...receipt, verdict: 'pass' });
        return [...(!artifactsOk ? [`${worker} receipt artifacts are not in its own evidence`] : []), ...(hashes !== null ? [hashes] : []), ...((receipt.verdict === 'pass') === (posted === 'FAIL') ? [`${worker} receipt verdict ${receipt.verdict} contradicts the posted ${String(posted)}`] : [])];
      });
      return when(problems.length === 0, 'three ingested receipts, artifacts inside each verifier\'s folder, verdicts consistent', problems.join('; '));
    }, 'adaptation'),
  ];
}

export const shippingFamily: Family = {
  id: 'shipping',
  requires: 'container',
  title: 'shipping a stack with a failed middle PR: container verifiers with the forge capability record receipts, only the contiguous verified prefix merges bottom-up, green CI is not a verdict (spec 13.3)',
  spec: shippingSpec('shipping', SHIP_RUN, SHIP_STORE, shipScenario, '/poteto-mode ship the stack: land PR 21, PR 22 and PR 23'),
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('shipping'),
    ...todoChecks({ playbook: 'shipping' }),
    forgeResolvedOnce('ship.forge-resolved-once-gh-fallback-recorded', SH('GitHub CLI (`gh`) is the default'), 'gh'),
    ...verifierChecks('ship', 'head'),
    landsOnlyTheVerifiedPrefix('ship.only-the-contiguous-verified-prefix-from-the-root-merged', SH('Land only the contiguous verified run rooted at the bottom'), [21]),
    mergesAreAuthorizedAndVerified('ship.no-merge-without-the-operators-request-and-a-verdict-at-that-head', SH('Only a verdict from an agent that did not write the code counts')),
    check('ship.green-ci-did-not-decide', 'every check on every PR is green, including the PR that failed verification, and the failed PR and the PR above it did not merge', SH('Green CI and an approving bot review are not verdicts'), (view) => {
      const { state } = readForge(view);
      const green = Object.values(state.prs).every((pr) => pr.checks.every((entry) => entry.state === 'SUCCESS'));
      const open = [22, 23].every((n) => state.prs[String(n)]?.state === 'OPEN');
      return when(green && open, 'all checks green; PR 22 (failed) and PR 23 (above it) are still open', `all green ${green}; 22 and 23 open ${open}`);
    }),
    neverMutatesTopology('ship.stack-left-alone-above-the-ceiling', SH('Leave the stack alone while it lands')),
    check('ship.ceiling-watched-with-the-queued-watcher-until-COMPLETE', 'the run was watched with the queued watcher over exactly the landing run, in a watcher worker, until COMPLETE at the ceiling', SH('until it reports `COMPLETE` at the ceiling'), (view) => {
      const found = watchers(view);
      const argv = found.map((worker) => assignmentOf(worker).watch?.argv ?? []);
      const exit = (found[0]?.state?.['exit'] as { code: number } | undefined)?.code;
      return when(found.length === 1 && argv[0]?.[0] === WATCH_PR && argv[0].includes('--queued-stack') && argv[0][argv[0].indexOf('--stack-prs') + 1] === '21' && exit === 0, 'queued watcher over 21 exited COMPLETE (0)', `watchers ${found.length}, argv ${JSON.stringify(argv)}, exit ${String(exit)}`);
    }),
    check('ship.reply-names-the-run-the-verdicts-what-landed-and-the-next-gap', 'the reply gives the verified run and ceiling, each verdict with its producer, what landed and how it was confirmed, and what the next gap needs', SH('**Reply:** the verified run and its ceiling'), (view) => {
      const reply = finalReply(view).replace(/[`*]/g, '');
      const verdicts = verdictsOf(readForge(view).state, readForge(view).actions, view);
      const chunks = reply.split(/(?=\bPR \d+\b)/);
      const producers = [21, 22, 23].filter((pr) => {
        const verdict = verdicts.find((entry) => entry.pr === pr);
        return verdict === undefined || !chunks.some((chunk) => chunk.startsWith(`PR ${pr}`) && chunk.includes(verdict.verdict) && chunk.includes(verdict.verifier));
      });
      const missing = [/verified run[^.]*PR 21/i, /PR 21[^.]*ceiling|ceiling[^.]*PR 21/i, /(?:landed|merged)/i, /confirm[^.]*merge|read(?:ing)?[^.]*PR[^.]*back|read it back as MERGED|gh pr view|(?:PR|it)[^.]*reads? MERGED/i, /next gap|PR 22[^.]*needs?[^.]*fix|fix PR 22/i].filter((pattern) => !pattern.test(reply)).map(String);
      missing.push(...producers.map((pr) => `PR ${pr} verdict and producer`));
      return when(missing.length === 0, 'all parts present', `missing ${missing.join(', ')}`);
    }),
    noToolErrors('ship.no-tool-errors', SH('Stop at the ceiling')),
  ],
  negatives: [
    ...todoNegatives(SHIP_RUN, 'shipping', { done: [1, 2, 3, 4, 5, 6], receipts: { 1: 'sh-verifiers', 2: 'sh-prefix', 3: 'sh-fresh', 4: 'sh-landed', 5: 'sh-hands-off', 6: 'sh-ceiling' } }),
    { name: 'verifier assignments may use unambiguous abbreviated commit IDs', mutate: (sandbox) => {
      for (const pr of [21, 22, 23]) patchAssignment(sandbox, SHIP_RUN, `verifier-${pr}`, (assignment) => {
        const workspace = assignment['workspace'] as { inputCommit: string };
        workspace.inputCommit = workspace.inputCommit.slice(0, 7);
      });
    }, fails: [], passes: ['ship.one-container-verifier-per-pr-with-the-forge-capability', 'ship.verdicts-are-by-the-verifiers-and-match-what-the-code-does', 'ship.no-merge-without-the-operators-request-and-a-verdict-at-that-head'] },
    { name: 'the tip was merged because it passed, over the failed middle', mutate: (sandbox) => editForge(sandbox, (actions, state) => { actions.push({ kind: 'merge', tool: 'gh', pr: 23, head: (state.prs['23'] as { head: string }).head, requested: null, worker: '', run: '', actor: '', container: false }); (state.prs['23'] as { state: string }).state = 'MERGED'; }), fails: ['ship.only-the-contiguous-verified-prefix-from-the-root-merged', 'ship.no-merge-without-the-operators-request-and-a-verdict-at-that-head'] },
    { name: 'the failed middle PR was merged', mutate: (sandbox) => editForge(sandbox, (actions, state) => { actions.push({ kind: 'merge', tool: 'gh', pr: 22, head: 'x', requested: 'x', worker: '', run: '', actor: '', container: false }); (state.prs['22'] as { state: string }).state = 'MERGED'; }), fails: ['ship.only-the-contiguous-verified-prefix-from-the-root-merged', 'ship.green-ci-did-not-decide'] },
    { name: 'the verdict of the failed PR was flipped to PASS', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'comment' && action.pr === 22) action['body'] = String(action['body']).replace('FAIL', 'PASS'); })), fails: ['ship.verdicts-are-by-the-verifiers-and-match-what-the-code-does', 'ship.only-the-contiguous-verified-prefix-from-the-root-merged'] },
    { name: 'the root was merged with no verdict at all', mutate: (sandbox) => editForge(sandbox, (actions) => actions.splice(0, actions.length, ...actions.filter((action) => !(action.kind === 'comment' && action.pr === 21)))), fails: ['ship.no-merge-without-the-operators-request-and-a-verdict-at-that-head', 'ship.verdicts-are-by-the-verifiers-and-match-what-the-code-does'] },
    { name: 'the author verified its own PR', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'comment' && action.pr === 21) action.worker = 'owner-21'; })), fails: ['ship.no-merge-without-the-operators-request-and-a-verdict-at-that-head', 'ship.verdicts-are-by-the-verifiers-and-match-what-the-code-does'] },
    { name: 'the verdict covers an older head', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'comment' && action.pr === 21) action['body'] = String(action['body']).replace(/head=[0-9a-f]{40}/, `head=${'0'.repeat(40)}`); })), fails: ['ship.verdicts-are-by-the-verifiers-and-match-what-the-code-does', 'ship.no-merge-without-the-operators-request-and-a-verdict-at-that-head'] },
    { name: 'the merged head differs from the verified head', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'merge') action['head'] = '0'.repeat(40); })), fails: ['ship.no-merge-without-the-operators-request-and-a-verdict-at-that-head'] },
    { name: 'the root was never read back as merged into trunk', mutate: (sandbox) => rewriteSessionSafe(sandbox, '--json state,mergedAt,baseRefName', '--json state'), fails: ['ship.only-the-contiguous-verified-prefix-from-the-root-merged'] },
    { name: 'the stack was rebased while it landed', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'force-push', ref: 'refs/heads/s-2', worker: '', run: '', actor: '', container: false } as ForgeAction)), fails: ['ship.stack-left-alone-above-the-ceiling'] },
    { name: 'a verifier ran in a worktree instead of a container', mutate: (sandbox) => patchAssignment(sandbox, SHIP_RUN, 'verifier-22', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: (assignment['workspace'] as { inputCommit: string }).inputCommit })), fails: ['ship.one-container-verifier-per-pr-with-the-forge-capability'] },
    {
      name: 'a verifier omitted the credential isolation probe',
      mutate: omitCredentialIsolationProbe,
      fails: ['ship.one-container-verifier-per-pr-with-the-forge-capability'],
    },
    {
      name: 'a real-model verifier is not required to run a scripted fixture probe',
      mutate: (sandbox, view) => {
        omitCredentialIsolationProbe(sandbox, view);
        const file = join(sandbox, 'meta.json');
        writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), driver: 'real' }));
      },
      fails: [],
      passes: ['ship.one-container-verifier-per-pr-with-the-forge-capability'],
    },
    { name: 'a verifier had no forge capability', mutate: (sandbox) => patchAssignment(sandbox, SHIP_RUN, 'verifier-23', (assignment) => ((assignment['capabilities'] as Record<string, unknown>)['forge'] = false)), fails: ['ship.one-container-verifier-per-pr-with-the-forge-capability'] },
    { name: 'a verifier receipt was forged away', mutate: (sandbox) => rmSync(join(sandbox, 'repo/.pi/pstack/runs', SHIP_RUN, 'verification/receipts/verifier-22-run.json'), { force: true }), fails: ['ship.each-verifier-recorded-its-own-receipt'] },
    { name: 'a verifier receipt artifact was altered', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs', SHIP_RUN, 'workers/verifier-21/evidence/verifier-21-run.txt'), 'tampered\n'), fails: ['ship.each-verifier-recorded-its-own-receipt'] },
    { name: 'a verifier was never spawned with the others', mutate: (sandbox) => rewriteSessionSafe(sandbox, '/verifier-23/assignment.json', '/verifier-23x/assignment.json'), fails: ['ship.verifiers-were-spawned-in-parallel-and-collected-after-their-wakes'] },
    { name: 'the parent never collected its verifiers', mutate: (sandbox) => { dropWakes(sandbox); rewriteSessionSafe(sandbox, '"action":"collect"', '"action":"inspect"'); }, fails: ['ship.verifiers-were-spawned-in-parallel-and-collected-after-their-wakes'] },
    { name: 'the reply left out the next gap', mutate: (sandbox) => rewriteFinalReply(sandbox, /The next gap[\s\S]*$/, ''), fails: ['ship.reply-names-the-run-the-verdicts-what-landed-and-the-next-gap'] },
    { name: 'the ceiling was watched in plain mode', mutate: (sandbox) => patchAssignment(sandbox, SHIP_RUN, 'watch-ceiling', (assignment) => ((assignment['watch'] as { argv: string[] }).argv = ['sleep', '1'])), fails: ['ship.ceiling-watched-with-the-queued-watcher-until-COMPLETE'] },
  ],
};

// ---- family: shipping-freshness (a verdict covers a patch, not a SHA)

const FRESH_RUN = 'ship-fresh';
const FRESH_STORE: { handle?: ForgeHandle; heads?: Record<number, string> } = {};
const FRESH_EVENTS: ForgeEvent[] = [
  {
    when: { op: 'comment', verdictsFor: [21, 22, 23] },
    do: [
      { type: 'advance-trunk', branch: 'main', file: 'src/trunk-note.js', content: 'export const note = 1;\n', message: 'chore: trunk moves' },
      { type: 'rebase', onto: 'main', branches: ['s-1', 's-2', 's-3'], edits: { 's-3': { file: 'src/s3.js', content: `${S3}// zero guard\n` } } },
    ],
  },
];

const VERDICT_HEAD = (n: number) => `gh pr view ${n} ${REPO_FLAGS} --json comments | node -e 'const c=JSON.parse(require("fs").readFileSync(0,"utf8")).comments.filter((x)=>/PSTACK-VERDICT/.test(x.body)).at(-1).body;process.stdout.write(/head=([0-9a-f]{40})/.exec(c)[1])'`;

function freshScenario(ctx: Ctx, store: typeof FRESH_STORE) {
  const parent = new Parent(ctx);
  const dir = parent.runDir;
  const heads = store.heads as Record<number, string>;
  const pr = REPO_FLAGS;
  const compare = join(dir, 'compare-verdicts.sh');
  const move = join(dir, 'move-next.sh');
  const wt = join(ctx.sandbox, 'tmp', 'w22');
  parent.beginPlaybook('shipping', 'Ship the stack 21, 22, 23 after a chain rebase');
  for (const skill of ['control-cli', 'control-ui']) parent.readSkill(skill);
  parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
  parent.task('Forge: gh (origin CLI absent, fallback recorded)');
  parent.bash(`gh pr list ${pr} --state open --limit 300 --json number,headRefName,baseRefName,isCrossRepository`);
  parent.fire(...[21, 22, 23].map((n) => stageVerifier(parent, `verifier-${n}`, n, heads[n] as string, TEST_FILE(n))));
  for (const n of [21, 22, 23]) parent.wait(`verifier-${n}`);
  parent.collect('verifier-21', 'verifier-22', 'verifier-23');
  stepDone(parent, 'shipping', 1, 'sf-verifiers', `test $(gh pr view 23 ${pr} --json comments | grep -c PSTACK-VERDICT) -ge 1`);
  parent.write(compare, `set -e\ncd ${ctx.repo}\ngit fetch -q origin\nfor n in 21 22 23; do\n  b=s-$((n-20))\n  v=$(${VERDICT_HEAD(0).replace('view 0', 'view $n')})\n  cur=$(git rev-parse origin/$b)\n  pv=$(git show --format= -p $v | git patch-id --stable | cut -d' ' -f1)\n  pc=$(git show --format= -p $cur | git patch-id --stable | cut -d' ' -f1)\n  if [ "$v" = "$cur" ]; then s=same-sha; elif [ "$pv" = "$pc" ]; then s=same-patch; else s=changed-patch; fi\n  echo PR $n verdict-sha=\${v:0:8} head=\${cur:0:8} $s\ndone\n`);
  parent.bash(`bash ${compare}`);
  parent.decision('ship-run', 'land 21 and 22, hold 23', 'the chain rebase kept the patch-id of 21 and 22, so their verdicts stand, and changed the patch of 23, so its verdict is void', 'compare-verdicts.sh output', 'ceiling is PR 22');
  stepDone(parent, 'shipping', 2, 'sf-prefix', `grep -q 'land 21 and 22' ${join(dir, 'decisions.tsv')}`);
  stepDone(parent, 'shipping', 3, 'sf-fresh', `bash ${compare} | grep -c same-patch | grep -q 2`);
  parent.bash(`cd ${ctx.repo} && git fetch -q origin && gh pr merge 21 ${pr} --squash --match-head-commit $(git rev-parse origin/s-1)`);
  parent.bash(`gh pr view 21 ${pr} --json state,mergedAt,baseRefName`);
  parent.bash(`gh pr edit 22 ${pr} --base main`);
  parent.write(move, `set -e\ncd ${ctx.repo}\ngit fetch -q origin\nOLD=$(git rev-parse origin/s-2)\ngit worktree add -q --detach ${wt} origin/s-2\ncd ${wt}\ngit -c user.name=ship -c user.email=ship@example.com rebase -q --onto origin/main origin/s-1 HEAD\ngit push -q --force-with-lease=s-2:$OLD origin HEAD:refs/heads/s-2\ncd ${ctx.repo}\ngit worktree remove --force ${wt}\n`);
  parent.bash(`bash ${move}`);
  parent.bash(`bash ${compare} | grep "PR 22"`);
  parent.bash(`gh pr checks 22 ${pr}`);
  parent.bash(`cd ${ctx.repo} && git fetch -q origin && gh pr merge 22 ${pr} --squash --match-head-commit $(git rev-parse origin/s-2)`);
  parent.bash(`gh pr view 22 ${pr} --json state,mergedAt,baseRefName`);
  stepDone(parent, 'shipping', 4, 'sf-landed', `gh pr view 22 ${pr} --json state,baseRefName | grep -q '"state":"MERGED","baseRefName":"main"'`);
  parent.spawn('watch-ceiling', { kind: 'watch', role: 'watcher', model: 'inherit-parent', workspace: parent.readonly(), watch: { argv: [WATCH_PR, '--owner', 'acme', '--repo', 'widgets', '--queued-stack', '--stack-prs', '21,22', '--interval', '0.3'], cwd: ctx.repo } }, '').wait('watch-ceiling').collect('watch-ceiling');
  stepDone(parent, 'shipping', 5, 'sf-hands-off', `gh pr view 23 ${pr} --json state | grep -q OPEN`);
  stepDone(parent, 'shipping', 6, 'sf-ceiling', `gh pr view 23 ${pr} --json baseRefName | grep -q s-2`);
  parent.text('Verified run: PR 21 and PR 22, the ceiling is PR 22. PR 21 PASS by verifier-21 and PR 22 PASS by verifier-22 kept their verdicts through the chain rebase: git patch-id is unchanged at the new heads. PR 23 PASS by verifier-23 lost its verdict because the rebase changed its patch, so it was not merged. Landed: PR 21 then PR 22, one at a time, each confirmed with gh pr view, which reads MERGED with main as its base. The next gap: a fresh verdict for PR 23 at its new head.');
  const workers: Record<string, Worker> = Object.fromEntries([21, 22, 23].map((n) => [`verifier-${n}`, verifierScript(ctx, parent, { id: `verifier-${n}`, pr: n, head: heads[n] as string, testFile: TEST_FILE(n) })]));
  return scenario(parent, workers);
}

export const shippingFreshnessFamily: Family = {
  id: 'shipping-freshness',
  requires: 'container',
  title: 'shipping after a chain rebase: a verdict covers the patch, so a rebased head with the same patch-id keeps it and a changed patch loses it; the shipper moves only the next PR, with --force-with-lease (spec 13.3)',
  spec: shippingSpec('shipping-freshness', FRESH_RUN, FRESH_STORE, freshScenario, '/poteto-mode ship the stack: land PR 21, PR 22 and PR 23', { events: FRESH_EVENTS, broken: false }),
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('shipping'),
    ...todoChecks({ playbook: 'shipping' }),
    forgeResolvedOnce('ship.fresh.forge-resolved-once-gh-fallback-recorded', SH('GitHub CLI (`gh`) is the default'), 'gh'),
    ...verifierChecks('ship.fresh', 'patch'),
    check('ship.fresh.the-chain-rebase-moved-every-head-and-changed-one-patch', 'after the verdicts the chain was rebased by the operator, every head moved, the patch-id of PR 21 and PR 22 is unchanged and the patch-id of PR 23 changed', SH('a chain rebase moves every PR above it to a new SHA without failing any check'), (view) => {
      const { state, actions } = readForge(view);
      const verdicts = verdictsOf(state, actions, view);
      const bare = bareOf(view.sandbox);
      const forced = actions.filter((action) => action.kind === 'force-push' && action.actor === 'operator-sim').map((action) => String(action['ref']));
      const afterVerdicts = actions.findIndex((action) => action.kind === 'force-push' && action.actor === 'operator-sim') > Math.max(...verdicts.map((verdict) => verdict.at));
      const sameSha = [21, 22, 23].filter((n) => verdicts.find((verdict) => verdict.pr === n)?.head === revParse(bare, `refs/heads/${state.prs[String(n)]?.head}`) || state.prs[String(n)]?.mergedHead === verdicts.find((verdict) => verdict.pr === n)?.head);
      const patchSame = [21, 22, 23].map((n) => verdicts.find((verdict) => verdict.pr === n)?.patch === patchIdOf(bare, state.prs[String(n)]?.mergedHead ?? revParse(bare, `refs/heads/${state.prs[String(n)]?.head}`)));
      return when(afterVerdicts && forced.length === 3 && sameSha.length === 0 && JSON.stringify(patchSame) === JSON.stringify([true, true, false]), 'three force-pushes by the operator after the verdicts; no head kept its SHA; patch-ids: 21 same, 22 same, 23 changed', `forced ${forced.join(', ')}, after the verdicts ${afterVerdicts}, heads unchanged for ${sameSha.join(', ') || 'none'}, patch unchanged ${JSON.stringify(patchSame)}`);
    }),
    check('ship.fresh.the-parent-compared-patch-ids-before-trusting-a-verdict', 'before any merge the parent compared git patch-id at each verdict SHA with the current head, and its own output matches the independent computation', SH('Compare `git patch-id` at the verdict SHA with the current head'), (view) => {
      const compare = view.parent.toolCalls.find((call) => call.name === 'bash' && /^bash \S+compare-verdicts\.sh$/.test(String(call.args['command'])));
      const firstMerge = view.parent.toolCalls.find((call) => call.name === 'bash' && /gh pr merge/.test(String(call.args['command'])))?.order ?? Number.POSITIVE_INFINITY;
      const out = compare?.resultText ?? '';
      const want = ['PR 21 .* same-patch', 'PR 22 .* same-patch', 'PR 23 .* changed-patch'];
      const missing = want.filter((pattern) => !new RegExp(pattern).test(out));
      return when(compare !== undefined && compare.order < firstMerge && missing.length === 0, `compared at ${compare?.order}, before the first merge at ${firstMerge}: 21 same-patch, 22 same-patch, 23 changed-patch`, `compare at ${compare?.order}, first merge ${firstMerge}; missing ${missing.join(', ')}; output ${out.slice(0, 200)}`);
    }),
    landsOnlyTheVerifiedPrefix('ship.fresh.only-the-patches-a-verdict-covers-merged', SH('A verdict covers a patch'), [21, 22], 'patch'),
    mergesAreAuthorizedAndVerified('ship.fresh.no-merge-without-a-verdict-that-covers-the-patch', SH('Only a verdict from an agent that did not write the code counts'), 'patch'),
    check('ship.fresh.a-kept-verdict-survives-a-new-sha-and-a-changed-patch-is-not-merged', 'PR 21 and PR 22 merged at a head that is not the verdict head, and PR 23 never merged or armed', SH('so step 3\'s patch-id rule decides whether the verdict survives'), (view) => {
      const { state, actions } = readForge(view);
      const verdicts = verdictsOf(state, actions, view);
      const merges = mergesIn(actions);
      const moved = merges.filter((merge) => verdicts.find((verdict) => verdict.pr === merge.pr)?.head !== merge['head']).map((merge) => merge.pr);
      const p23 = state.prs['23'];
      return when(JSON.stringify(moved) === JSON.stringify([21, 22]) && p23?.state === 'OPEN' && p23.autoMerge !== true && p23.queued !== true, 'PR 21 and 22 merged at new heads that keep their verdicts; PR 23 stays open and unarmed', `merged at a new head: ${moved.join(', ')}; PR 23 state ${p23?.state}`);
    }),
    check('ship.fresh.only-the-next-pr-moves-and-it-is-pushed-with-force-with-lease', 'after PR 21 merged, the shipper retargeted PR 22 to trunk and pushed its moved patch with --force-with-lease pinned to the SHA it fetched, and changed no other branch or base', SH('After a merge lands, retarget the PR whose base was the merged branch to trunk'), (view) => {
      const { actions } = readForge(view);
      const parentRefs = actions.filter((action) => ['push', 'force-push', 'ref-create', 'ref-delete'].includes(action.kind) && action.worker === '' && action.actor === '');
      const edits = actions.filter((action) => action.kind === 'edit-base');
      const merge21 = actions.findIndex((action) => action.kind === 'merge' && action.pr === 21);
      const merge22 = actions.findIndex((action) => action.kind === 'merge' && action.pr === 22);
      const edit = actions.findIndex((action) => action.kind === 'edit-base');
      const push = actions.findIndex((action) => action.kind === 'force-push' && action.worker === '' && action.actor === '');
      const lease = BASH(view).some((entry) => /git push -q --force-with-lease=s-2:\$OLD origin HEAD:refs\/heads\/s-2/.test(entry.command)) || view.parent.toolCalls.some((call) => call.name === 'write' && /--force-with-lease=s-2:\$OLD/.test(String(call.args['content'])));
      return when(parentRefs.length === 1 && parentRefs[0]?.['ref'] === 'refs/heads/s-2' && edits.length === 1 && edits[0]?.pr === 22 && edits[0]?.['to'] === 'main' && merge21 < edit && edit < push && push < merge22 && lease, `merge 21 (${merge21}), retarget 22 (${edit}), forced push of s-2 (${push}), merge 22 (${merge22}); one ref update by the shipper, one retarget, lease pinned`, `shipper ref updates ${parentRefs.map((action) => String(action['ref'])).join(', ')}; retargets ${edits.map((action) => `#${action.pr}->${String(action['to'])}`).join(', ')}; order ${merge21}, ${edit}, ${push}, ${merge22}; lease ${lease}`);
    }),
    check('ship.fresh.ceiling-watched-until-COMPLETE', 'the landing run was watched with the queued watcher over 21,22 until COMPLETE', SH('until it reports `COMPLETE` at the ceiling'), (view) => {
      const found = watchers(view);
      const argv = found.map((worker) => assignmentOf(worker).watch?.argv ?? []);
      const exit = (found[0]?.state?.['exit'] as { code: number } | undefined)?.code;
      return when(found.length === 1 && argv[0]?.includes('--queued-stack') === true && argv[0][argv[0].indexOf('--stack-prs') + 1] === '21,22' && exit === 0, 'queued watcher over 21,22 exited COMPLETE', `watchers ${found.length} ${JSON.stringify(argv)} exit ${String(exit)}`);
    }),
    check('ship.fresh.reply-says-the-changed-patch-needs-a-fresh-verdict', 'the reply names the ceiling, why PR 23 lost its verdict, what landed and the next gap', SH('**Reply:** the verified run and its ceiling'), (view) => {
      const reply = finalReply(view);
      const missing = [/the ceiling is PR 22/, /kept their verdicts.*patch-id is unchanged/, /PR 23 .*lost its verdict.*changed its patch, so it was not merged/, /Landed: PR 21 then PR 22/, /next gap: a fresh verdict for PR 23/].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0, 'all parts present', `missing ${missing.join(', ')}`);
    }),
    noToolErrors('ship.fresh.no-tool-errors', SH('Stop at the ceiling')),
  ],
  negatives: [
    ...todoNegatives(FRESH_RUN, 'shipping', { done: [1, 2, 3, 4, 5, 6], receipts: { 1: 'sf-verifiers', 2: 'sf-prefix', 3: 'sf-fresh', 4: 'sf-landed', 5: 'sf-hands-off', 6: 'sf-ceiling' } }),
    { name: 'PR 23 was merged on its old verdict though its patch changed', mutate: (sandbox) => editForge(sandbox, (actions, state) => { const head = revParse(bareOf(sandbox), 'refs/heads/s-3'); actions.push({ kind: 'merge', tool: 'gh', pr: 23, head, requested: head, worker: '', run: '', actor: '', container: false }); (state.prs['23'] as { state: string }).state = 'MERGED'; (state.prs['23'] as { mergedHead?: string }).mergedHead = head; }), fails: ['ship.fresh.only-the-patches-a-verdict-covers-merged', 'ship.fresh.no-merge-without-a-verdict-that-covers-the-patch', 'ship.fresh.a-kept-verdict-survives-a-new-sha-and-a-changed-patch-is-not-merged'] },
    { name: 'PR 22 was merged with a verdict of a different patch', mutate: (sandbox) => editForge(sandbox, (actions) => actions.forEach((action) => { if (action.kind === 'comment' && action.pr === 22) action['body'] = String(action['body']).replace(/patch=\S+/, 'patch=0123456789abcdef'); })), fails: ['ship.fresh.no-merge-without-a-verdict-that-covers-the-patch', 'ship.fresh.only-the-patches-a-verdict-covers-merged'] },
    { name: 'the shipper never compared patch-ids', mutate: (sandbox) => rewriteSessionSafe(sandbox, 'compare-verdicts.sh', 'compare-other.sh'), fails: ['ship.fresh.the-parent-compared-patch-ids-before-trusting-a-verdict'] },
    { name: 'the shipper force-pushed without the lease on a second branch', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'force-push', ref: 'refs/heads/s-3', worker: '', run: '', actor: '', container: false } as ForgeAction)), fails: ['ship.fresh.only-the-next-pr-moves-and-it-is-pushed-with-force-with-lease'] },
    { name: 'the shipper retargeted PR 23 as well', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'edit-base', tool: 'gh', pr: 23, from: 's-2', to: 'main', worker: '', run: '', actor: '', container: false })), fails: ['ship.fresh.only-the-next-pr-moves-and-it-is-pushed-with-force-with-lease'] },
    { name: 'PR 22 was merged before it moved onto the merge result', mutate: (sandbox) => editForge(sandbox, (actions) => { const at = actions.findIndex((action) => action.kind === 'merge' && action.pr === 22); const [merge] = actions.splice(at, 1); actions.splice(actions.findIndex((action) => action.kind === 'edit-base'), 0, merge as ForgeAction); }), fails: ['ship.fresh.only-the-next-pr-moves-and-it-is-pushed-with-force-with-lease'] },
    { name: 'the chain rebase never happened', mutate: (sandbox) => editForge(sandbox, (actions) => actions.splice(0, actions.length, ...actions.filter((action) => action.actor !== 'operator-sim'))), fails: ['ship.fresh.the-chain-rebase-moved-every-head-and-changed-one-patch'] },
    { name: 'the reply says PR 23 shipped', mutate: (sandbox) => rewriteFinalReply(sandbox, 'so it was not merged', 'so it shipped'), fails: ['ship.fresh.reply-says-the-changed-patch-needs-a-fresh-verdict'] },
    { name: 'a verifier ran in a worktree', mutate: (sandbox) => patchAssignment(sandbox, FRESH_RUN, 'verifier-21', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: (assignment['workspace'] as { inputCommit: string }).inputCommit })), fails: ['ship.fresh.one-container-verifier-per-pr-with-the-forge-capability'] },
  ],
};

// ---- families: shipping blocked (ContainerUnavailable, ForgeUnavailable) lands nothing

type BlockedKind = 'ContainerUnavailable' | 'ForgeUnavailable';

function blockedFamily(kind: BlockedKind): Family {
  const runId = kind === 'ContainerUnavailable' ? 'ship-blocked-engine' : 'ship-blocked-forge';
  const store: typeof SHIP_STORE = {};
  const id = kind === 'ContainerUnavailable' ? 'shipping-no-engine' : 'shipping-no-forge-token';
  const reason = kind === 'ContainerUnavailable' ? 'no container engine answers' : 'the operator has no forge token to give a worker';
  const scenarioOf = (ctx: Ctx) => {
    const parent = new Parent(ctx);
    const blocked = `step 1 is blocked: ${kind}, so nothing lands`;
    parent.beginPlaybook('shipping', `Ship the stack, blocked by ${kind}`);
    for (const skill of ['control-cli', 'control-ui']) parent.readSkill(skill);
    parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
    parent.task('Forge: gh (origin CLI absent, fallback recorded)');
    parent.bash(`gh pr list ${REPO_FLAGS} --state open --limit 300 --json number,headRefName,baseRefName,isCrossRepository`);
    parent.spawn('verifier-21', { role: 'verifier', model: 'sim/claude-sim', workspace: { mode: 'container', inputCommit: (store.heads as Record<number, string>)[21] as string }, capabilities: { mcp: 'inherit', env: 'minimal', externalWrite: false, forge: true } }, verifierBrief(21, (store.heads as Record<number, string>)[21] as string, TEST_FILE(21)));
    parent.decision('ship-run', `blocked: ${kind}`, `pstack_worker spawn answered ${kind}, so the independent verification cannot run and no PR may land`, 'pstack_worker spawn result', 'landed nothing');
    for (const n of [1, 2, 3, 4, 5, 6]) parent.skip('shipping', n, blocked);
    parent.text(`Shipping is blocked: ${kind}. The verifier for PR 21 could not start (${reason}), so I verified nothing and landed nothing. Every PR is still open and unchanged. Fix the cause and say ship again.`);
    return scenario(parent);
  };
  return {
    id,
    ...(kind === 'ForgeUnavailable' ? { requires: 'container' as const } : {}),
    title: `shipping blocked by ${kind}: the container verifier cannot start, so the step is reported blocked, no local fallback verifies, and nothing lands (spec 13.3)`,
    spec: {
      family: id,
      runId,
      history: cartHistory,
      timeoutMs: 120_000,
      prepare: (ctx) => {
        store.handle = setupForge(ctx, { owner: 'acme', name: 'widgets', branches: stackBranches(true), prs: stackPrs, noToken: kind === 'ForgeUnavailable' });
        store.heads = { 21: store.handle.tip('s-1'), 22: store.handle.tip('s-2'), 23: store.handle.tip('s-3') };
        writeContainerScenario(ctx, scenarioOf(ctx));
      },
      env: (ctx, driver) => forgeEnv(ctx, store.handle as ForgeHandle, { container: true, scripted: driver === 'scripted', ...(kind === 'ContainerUnavailable' ? { engine: false } : { token: false }) }),
      cleanup: () => removeRunContainers(runId),
      prompt: () => '/poteto-mode ship the stack: land PR 21, PR 22 and PR 23',
      scenario: scenarioOf,
    },
    checks: [
      promptRoutes('poteto-mode'),
      ...playbookReads('shipping'),
      ...todoChecks({ playbook: 'shipping', skipReason: { 1: /blocked/, 2: /blocked/, 3: /blocked/, 4: /blocked/, 5: /blocked/, 6: /blocked/ } }).filter((entry) => !entry.id.endsWith('done-steps-proven')),
      check(`ship.blocked.spawn-is-refused-with-${kind}`, `the container verifier spawn failed with an error that starts with ${kind}, and left no running worker`, SH('When spawn returns `ContainerUnavailable` or `ForgeUnavailable`, this step is blocked'), (view) => {
        const refused = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && call.isError && new RegExp(`^(Error: )?${kind}`).test(call.resultText.trim()));
        const started = allWorkers(view).filter((worker) => worker.state !== null);
        return when(refused?.isError === true && new RegExp(`^(Error: )?${kind}`).test(refused.resultText.trim()) && started.length === 0, `spawn refused: ${refused?.resultText.slice(0, 90)}; no worker started`, `spawn error ${String(refused?.isError)} text "${refused?.resultText.slice(0, 120)}"; started workers ${started.length}`);
      }),
      check('ship.blocked.no-local-fallback-verifies', 'no worktree or readonly verifier was written or spawned: a verdict from the parent or a local worker would not count', SH('Only a verdict from an agent that did not write the code counts'), (view) => {
        const spawns = view.parent.toolCalls.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn');
        const local = allWorkers(view).filter((worker) => assignmentOf(worker).workspace?.mode !== 'container');
        return when(spawns.length > 0 && local.length === 0, 'spawn attempts used containers only', `${spawns.length} spawn attempts; non-container workers ${local.map((worker) => worker.id).join(', ') || 'none'}`);
      }),
      checkAbsence('ship.blocked.lands-nothing', 'the forge saw reads only: no verdict, no merge, no queue entry, no ref update, and every PR is still open', SH('Report it blocked and land nothing'), (view) => {
        const { state, actions } = readForge(view);
        const writes = actions.filter((action) => !['read', 'log-view'].includes(action.kind));
        return when(writes.length === 0 && Object.values(state.prs).every((pr) => pr.state === 'OPEN'), `${actions.length} forge actions, all reads; every PR open`, `forge writes ${writes.map((action) => action.kind).join(', ')}; states ${Object.values(state.prs).map((pr) => pr.state).join(', ')}`);
      }),
      forgeResolvedOnce('ship.blocked.forge-resolved-once-gh-fallback-recorded', SH('GitHub CLI (`gh`) is the default'), 'gh'),
      check('ship.blocked.reply-reports-blocked', `the reply says shipping is blocked by ${kind} and that nothing landed`, SH('Report it blocked and land nothing'), (view) => {
        const reply = finalReply(view);
        return when(/\b(?:blocked|blocker)\b/i.test(reply) && reply.includes(kind) && /\b(?:landed nothing|nothing (?:has )?landed|nothing is landed)\b/i.test(reply), 'blocked and landed nothing', `reply: ${reply.slice(0, 120)}`);
      }),
      noToolErrors('ship.blocked.no-other-tool-errors', SH('Stop at the ceiling'), [new RegExp(kind)]),
    ],
    negatives: [
      ...(kind === 'ForgeUnavailable' ? [{ name: 'the kept no-token reply reports the blocker and no landing in different words', mutate: (sandbox: string) => rewriteFinalReply(sandbox, /^.*$/s, readFileSync(new URL('../fixtures/shipping-no-forge-token-reply.txt', import.meta.url), 'utf8')), fails: [], passes: ['ship.blocked.reply-reports-blocked'] }] : []),
      { name: 'the reply omits the blocker', mutate: (sandbox) => rewriteFinalReply(sandbox, /^.*$/s, `Nothing landed. ${kind}. Every PR is still open and unchanged.`), fails: ['ship.blocked.reply-reports-blocked'] },
      { name: 'a step was left open', mutate: (sandbox) => setStep(sandbox, runId, 1, ' '), fails: ['todo.shipping.every-step-resolved'] },
      { name: 'a step was skipped with no reason', mutate: (sandbox) => setStep(sandbox, runId, 2, '~', (line) => line.replace(/ \(skip: [^)]*\)/, '')), fails: ['todo.shipping.skips-explained'] },
      { name: 'a playbook step was deleted from TODO.md', mutate: (sandbox) => deleteStep(sandbox, runId, 3), fails: ['todo.shipping.steps-verbatim-in-order'] },
      { name: 'a local worktree verifier was used instead', mutate: (sandbox) => patchAssignment(sandbox, runId, 'verifier-21', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: (assignment['workspace'] as { inputCommit: string }).inputCommit })), fails: ['ship.blocked.no-local-fallback-verifies'] },
      { name: 'the PR was merged anyway', mutate: (sandbox) => editForge(sandbox, (actions, state) => { actions.push({ kind: 'merge', tool: 'gh', pr: 21, worker: '', run: '', actor: '', container: false }); (state.prs['21'] as { state: string }).state = 'MERGED'; }), fails: ['ship.blocked.lands-nothing'] },
      { name: 'the refusal was not the named error', mutate: (sandbox) => rewriteSessionSafe(sandbox, kind, 'SomethingElse'), fails: [`ship.blocked.spawn-is-refused-with-${kind}`, 'ship.blocked.reply-reports-blocked'] },
      { name: 'the reply claims the stack shipped', mutate: (sandbox) => rewriteFinalReply(sandbox, 'landed nothing', 'landed everything'), fails: ['ship.blocked.reply-reports-blocked'] },
    ],
  };
}

export const shippingNoEngineFamily = blockedFamily('ContainerUnavailable');
export const shippingNoForgeTokenFamily = blockedFamily('ForgeUnavailable');

/** Replays the claimed package suite, or the PR's own test, in a clean commit export. */
export function inheritedFailureOnly(view: Pick<RunView, 'sandbox'>, base: string, head: string): boolean {
  const failures = (sha: string): string[] | undefined => {
    const command = `d=$(mktemp -d) && git --git-dir ${shQuote(bareOf(view.sandbox))} archive ${sha} | tar -x -C "$d" && cd "$d" && npm test -- --test-reporter=tap; code=$?; rm -rf "$d"; exit $code`;
    const result = spawnSync('sh', ['-c', command], { encoding: 'utf8', timeout: 60_000 });
    const names = [...result.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => String(match[1]).replace(/\/[^\s]*\/test\//g, 'test/')).sort();
    return result.status === 1 && names.length > 0 ? names : undefined;
  };
  const before = failures(base);
  const after = failures(head);
  return before !== undefined && after !== undefined && JSON.stringify(before) === JSON.stringify(after);
}

export function testAt(view: Pick<RunView, 'sandbox'>, sha: string, file: string | undefined): boolean {
  const test = file === undefined ? 'npm test' : `node --test ${shQuote(file)}`;
  const command = `d=$(mktemp -d) && git --git-dir ${shQuote(bareOf(view.sandbox))} archive ${sha} | tar -x -C "$d" && cd "$d" && ${test} >/dev/null 2>&1; code=$?; rm -rf "$d"; exit $code`;
  return spawnSync('sh', ['-c', command], { timeout: 60_000 }).status === 0;
}

function rewriteSessionSafe(sandbox: string, from: string, to: string): void {
  const file = parentSession(sandbox);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll(from, to));
}

function omitCredentialIsolationProbe(sandbox: string, view: RunView): void {
  for (const { runId, worker } of view.runs.flatMap((run) => run.workers.map((worker) => ({ runId: run.id, worker })))) {
    const dir = join(sandbox, 'repo/.pi/pstack/runs', runId, 'workers', worker.id);
    for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.jsonl'))) {
      const path = join(dir, file);
      writeFileSync(path, readFileSync(path, 'utf8').replaceAll('CREDENTIAL-ISOLATION PASS:', 'CREDENTIAL-ISOLATION OMITTED:'));
    }
  }
}

export const shippingFamilies: Family[] = [shippingFamily, shippingFreshnessFamily, shippingNoEngineFamily, shippingNoForgeTokenFamily];

