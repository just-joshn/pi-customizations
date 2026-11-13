// Orchestrate family (spec 13.4): one owner per PR, a first unit taken all the way before the fan-out, verifiers on another
// model family than the owner they check, and a stalled worker judged by its side effects, aborted and replaced.
import { join } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { editForge, type ForgeAction, type ForgeHandle, forgeEnv, predictCommits, readForge, setupForge, WATCH_PR, writeContainerScenario } from '../fixtures/forge.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, src, type Src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, finalReply, noToolErrors, playbookReads, promptRoutes, todoChecks } from '../lib/checks.ts';
import type { Ctx } from '../lib/driver.ts';
import { patchAssignment, rewriteFinalReply, parentSession } from '../lib/mutate.ts';
import { orchestrateSubFamilies } from './pr-orchestrate-sub.ts';
import { ownerBrief, ownerScript, OWNER_FAMILY, ownerWorkers, type Unit } from './pr-autopilot.ts';
import { BASH, forgeResolvedOnce, REPO_FLAGS } from './pr-shared.ts';
import { mergesAreAuthorizedAndVerified, mergesIn, removeRunContainers, stageVerifier, verdictsOf, verifierScript } from './pr-shipping.ts';
import type { Family } from './types.ts';
import { readFileSync, writeFileSync } from 'node:fs';

const OR = (anchor: string): Src => src('poteto-mode/playbooks/orchestrate.md', anchor);

const RUN = 'orchestrate-program';
const GREET = { 'src/greet.js': 'export const greet = (name) => `hello ${name}`;\n', 'test/greet.test.js': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { greet } from '../src/greet.js';\n\ntest('greet says hello', () => assert.equal(greet('ada'), 'hello ada'));\n" };
const SHOUT = { 'src/shout.js': 'export const shout = (name) => `HELLO ${name.toUpperCase()}`;\n', 'test/shout.test.js': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { shout } from '../src/shout.js';\n\ntest('shout is loud', () => assert.equal(shout('ada'), 'HELLO ADA'));\n" };

interface Store {
  handle?: ForgeHandle;
  first: Unit;
  second: Unit;
}
const STORE: Store = { first: {} as Unit, second: {} as Unit };

const KICKOFF = (unit: Unit, extra = ''): string => `${ownerBrief(unit)} Evidence that proves it done: node --test ${unit.testFile} passes in your clone and the PR is open. Write only ${Object.keys(unit.files).join(' and ')}. Do not touch any other file, merge before the root steers you, or force-push.${extra}`;

function scenarioOf(ctx: Ctx, store: Store) {
  const parent = new Parent(ctx);
  const { first, second } = store;
  const dir = parent.runDir;
  const pr = REPO_FLAGS;
  parent.beginPlaybook('orchestrate', 'Orchestrate the greet and shout program');
  parent.write(join(dir, 'notes.md'), '# Program notes\n\nGoal: greet and shout land as two PRs, one owner each, each verified by a worker on another model family.\n\nUnits: PR 51 (greet) first, then PR 52 (shout).\n');
  parent.bash('command -v origin || echo "no origin CLI: staying on gh"');
  parent.task('Forge: gh (origin CLI absent, fallback recorded)');
  parent.task('Topology: one owner per PR; each PR gets a verifier on another model family; start with one unit, then fan out');
  const owner = (unit: Unit, extra = '') => parent.stage(unit.id, { role: 'owner', model: 'sim/grok-sim', workspace: { mode: 'container', inputCommit: unit.from }, capabilities: { mcp: 'inherit', env: 'minimal', externalWrite: false, forge: true } }, KICKOFF(unit, extra));
  // unit one, all the way: kickoff, owner, verifier, merge
  parent.fire(owner(first));
  parent.wait(first.id).collect(first.id);
  parent.bash('git fetch -q origin');
  parent.fire(stageVerifier(parent, 'verifier-51', 51, first.sha as string, first.testFile));
  parent.wait('verifier-51').collect('verifier-51');
  parent.call('pstack_worker', { action: 'steer', runId: ctx.runId, workerId: first.id, message: `PR 51 is verified PASS at head ${first.sha}. Merge it now with --match-head-commit ${first.sha}.` });
  parent.wait(first.id, 2).collect(first.id);
  parent.bash(`gh pr view 51 ${pr} --json state,baseRefName`);
  parent.decision('unit-1', 'first unit landed, fan out', 'kickoff, owner, verifier and merge all worked for PR 51', 'gh pr view 51', 'start the second unit');
  // unit two: the first owner stalls and is replaced
  parent.fire(parent.stage('owner-52a', { role: 'owner', model: 'sim/grok-sim', workspace: { mode: 'container', inputCommit: second.from }, capabilities: { mcp: 'inherit', env: 'minimal', externalWrite: false, forge: true } }, KICKOFF({ ...second, id: 'owner-52a' })));
  parent.bash('sleep 2; git ls-remote --heads origin feat-shout-orch | wc -l');
  parent.call('pstack_worker', { action: 'inspect', runId: ctx.runId, workerId: 'owner-52a' });
  parent.decision('unit-2', 'replace owner-52a', 'it pushed nothing and opened no PR after its probe window, so by its side effects it is stalled', 'git ls-remote --heads origin feat-shout-orch printed 0', 'abort it and retry the same kickoff');
  parent.call('pstack_worker', { action: 'abort', runId: ctx.runId, workerId: 'owner-52a' });
  parent.fire(owner(second, ' The previous owner for this PR, owner-52a, was aborted after it pushed nothing and opened no PR, so start from the kickoff and do not look for its work.'));
  parent.wait(second.id).collect(second.id);
  parent.bash('git fetch -q origin');
  parent.fire(stageVerifier(parent, 'verifier-52', 52, second.sha as string, second.testFile));
  parent.wait('verifier-52').collect('verifier-52');
  parent.call('pstack_worker', { action: 'steer', runId: ctx.runId, workerId: second.id, message: `PR 52 is verified PASS at head ${second.sha}. Merge it now with --match-head-commit ${second.sha}.` });
  parent.wait(second.id, 2).collect(second.id);
  parent.spawn('watch-52', { kind: 'watch', role: 'watcher', model: 'inherit-parent', workspace: parent.readonly(), watch: { argv: [WATCH_PR, '--owner', 'acme', '--repo', 'widgets', '--queued-stack', '--stack-prs', '52', '--interval', '0.3'], cwd: ctx.repo } }, '').wait('watch-52').collect('watch-52');
  parent.bash(`gh pr view 51 ${pr} --json state,baseRefName && gh pr view 52 ${pr} --json state,baseRefName`);
  parent.text('Landed against the goal: PR 51 (greet) and PR 52 (shout) are merged, each read back live as merged into main. PR 51: owner-51 built it, verifier-51 passed it at the head, owner-51 merged. PR 52: owner-52a stalled with no push and no PR, so I aborted it and replaced it with owner-52b, which built it; verifier-52 passed it at the head and owner-52b merged. Workers accounted for: owner-51 done, verifier-51 done, owner-52a replaced, owner-52b done, verifier-52 done, watch-52 done. Dropped: nothing. Decisions waiting on you: none.');
  const stalled = new Worker().bash('sleep 600');
  const workers: Record<string, Worker> = {
    [first.id]: ownerScript(ctx, parent, first, 'merge'),
    [second.id]: ownerScript(ctx, parent, second, 'merge'),
    'owner-52a': stalled,
    'verifier-51': verifierScript(ctx, parent, { id: 'verifier-51', pr: 51, head: first.sha as string, testFile: first.testFile }),
    'verifier-52': verifierScript(ctx, parent, { id: 'verifier-52', pr: 52, head: second.sha as string, testFile: second.testFile }),
  };
  return scenario(parent, workers);
}

export const orchestrateFamily: Family = {
  id: 'orchestrate',
  requires: 'container',
  title: 'orchestrate: one owner per PR within three levels, the first unit taken all the way before the fan-out, verifiers on another model family, a stalled owner judged by its side effects and replaced (spec 13.4)',
  spec: {
    family: 'orchestrate',
    holdWatchers: /.*/,
    runId: RUN,
    history: cartHistory,
    timeoutMs: 480_000,
    prepare: (ctx) => {
      STORE.handle = setupForge(ctx, { owner: 'acme', name: 'widgets', branches: [], prs: [], reserve: { 'feat-greet-orch': 51, 'feat-shout-orch': 52 } });
      const base = STORE.handle.tip('main');
      const first: Unit = { id: 'owner-51', branch: 'feat-greet-orch', pr: 51, from: base, base: 'main', files: GREET, testFile: 'test/greet.test.js', title: 'feat(greet): add greet' };
      const second: Unit = { id: 'owner-52b', branch: 'feat-shout-orch', pr: 52, from: base, base: 'main', files: SHOUT, testFile: 'test/shout.test.js', title: 'feat(shout): add shout' };
      const shas = [first, second].map((unit) => predictCommits(STORE.handle as ForgeHandle, { from: 'main', steps: [{ files: unit.files, message: unit.title }] })[0] as string);
      first.sha = shas[0] as string;
      second.sha = shas[1] as string;
      STORE.first = first;
      STORE.second = second;
      writeContainerScenario(ctx, scenarioOf(ctx, STORE));
    },
    env: (ctx, driver) => forgeEnv(ctx, STORE.handle as ForgeHandle, { container: true, scripted: driver === 'scripted' }),
    cleanup: () => removeRunContainers(RUN),
    prompt: () => '/poteto-mode orchestrate the program: land PR 51 (greet) and PR 52 (shout), one owner per PR, and merge each once it is verified. Do not stop to ask me.',
    scenario: (ctx) => scenarioOf(ctx, STORE),
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('orchestrate'),
    ...todoChecks({ playbook: 'orchestrate' }).filter((entry) => /run-from-playbook|steps-verbatim-in-order|parent-sole-writer/.test(entry.id)),
    forgeResolvedOnce('orchestrate.forge-resolved-once-gh-fallback-recorded', OR('Run it with your own tools'), 'gh'),
    check('orchestrate.one-owner-per-pr-the-only-writer-of-its-branch', 'each PR has exactly one owner that opened it and the only worker that pushed its branch; the replaced owner pushed nothing and opened nothing', OR('**One owner per PR.**'), (view) => {
      const { state, actions } = readForge(view);
      const refs = (branch: string) => [...new Set(actions.filter((action) => ['push', 'ref-create', 'force-push'].includes(action.kind) && action['ref'] === `refs/heads/${branch}`).map((action) => action.worker))];
      const creates = actions.filter((action) => action.kind === 'create' && action.tool === 'gh');
      const stalled = actions.filter((action) => action.worker === 'owner-52a' && !['read', 'log-view'].includes(action.kind));
      return when(state.prs['51']?.author === 'owner-51' && state.prs['52']?.author === 'owner-52b' && JSON.stringify(refs('feat-greet-orch')) === '["owner-51"]' && JSON.stringify(refs('feat-shout-orch')) === '["owner-52b"]' && creates.length === 2 && stalled.length === 0, 'PR 51 by owner-51 alone, PR 52 by owner-52b alone, two PRs opened, the stalled owner wrote nothing', `authors ${state.prs['51']?.author}, ${state.prs['52']?.author}; branch writers ${JSON.stringify(refs('feat-greet-orch'))}, ${JSON.stringify(refs('feat-shout-orch'))}; creates ${creates.length}; stalled owner writes ${stalled.length}`);
    }),
    check('orchestrate.owners-sit-two-levels-down-and-cannot-spawn', 'every worker ran at level 2 (its own report records PSTACK_DEPTH=2) under the root at level 1, and none holds the spawn capability, so the tree stays within three levels', OR('Stop at three levels'), (view) => {
      const owners = ownerWorkers(view).filter((worker) => worker.id !== 'owner-52a');
      const depths = owners.map((worker) => /depth=(\d)/.exec(worker.report ?? '')?.[1]);
      const spawners = allWorkers(view).filter((worker) => (assignmentOf(worker) as { capabilities?: { spawn?: boolean } }).capabilities?.spawn === true);
      return when(owners.length === 2 && depths.every((depth) => depth === '2') && spawners.length === 0, `owners report depth ${depths.join(', ')}; no worker can spawn`, `depths ${JSON.stringify(depths)}; spawners ${spawners.map((worker) => worker.id).join(', ') || 'none'}`);
    }),
    check('orchestrate.first-unit-goes-all-the-way-before-the-fan-out', 'PR 51 was owned, verified and merged before the second unit\'s first owner was spawned', OR('**Start with one unit.**'), (view) => {
      const { actions } = readForge(view);
      const merge = actions.findIndex((action) => action.kind === 'merge' && action.pr === 51);
      const secondOwner = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes('/owner-52a/'))?.order ?? -1;
      const mergeCollect = view.parent.toolCalls.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect' && call.args['workerId'] === 'owner-51').at(-1)?.order ?? -1;
      return when(merge !== -1 && secondOwner > mergeCollect && mergeCollect !== -1, `PR 51 merged (action ${merge}) and collected at ${mergeCollect}, before the second unit at ${secondOwner}`, `merge ${merge}, collect ${mergeCollect}, second unit spawn ${secondOwner}`);
    }),
    check('orchestrate.kickoffs-name-evidence-paths-and-forbidden-actions', 'each owner kickoff names the goal, the evidence that proves it done, the files it may write, and the actions it must not take', OR('**Each kickoff names the evidence that proves the work is done,**'), (view) => {
      const owners = ownerWorkers(view);
      const gaps = owners.flatMap((worker) => [['goal', /You own PR \d+/], ['evidence', /Evidence that proves it done: node --test \S+ passes/], ['paths it may write', /Write only \S+/], ['actions it must not take', /Do not touch any other file, merge before the root steers you, or force-push/]].filter(([, pattern]) => !(pattern as RegExp).test(worker.brief ?? '')).map(([name]) => `${worker.id} kickoff lacks ${String(name)}`));
      return when(owners.length === 3 && gaps.length === 0, `${owners.length} kickoffs carry goal, evidence, paths and fences`, gaps.join('; ') || `${owners.length} owners`);
    }),
    check('orchestrate.each-pr-has-a-verifier-on-another-family-and-merges-follow-the-verdict', 'each PR has a container verifier on a different model family than its owner whose verdict names the head, and each owner merged only after that verdict, pinned to the head', OR('**Each PR gets a verifier that isn\'t its author,** on a different model family'), (view) => {
      const { state, actions } = readForge(view);
      const verdicts = verdictsOf(state, actions);
      const problems = [[51, 'owner-51', STORE.first], [52, 'owner-52b', STORE.second]].flatMap(([pr, ownerId, unit]) => {
        const verifier = allWorkers(view).find((worker) => worker.id === `verifier-${String(pr)}`);
        const owner = allWorkers(view).find((worker) => worker.id === ownerId);
        const verdict = verdicts.find((entry) => entry.pr === pr);
        const merge = mergesIn(actions).find((entry) => entry.pr === pr);
        return [
          ...(verifier === undefined || owner === undefined || OWNER_FAMILY(String(assignmentOf(verifier).model)) === OWNER_FAMILY(String(assignmentOf(owner).model)) ? [`PR ${String(pr)} verifier family is not independent`] : []),
          ...(verdict === undefined || verdict.head !== (unit as Unit).sha || verdict.verdict === 'FAIL' ? [`PR ${String(pr)} has no PASS at its head`] : []),
          ...(merge === undefined || actions.indexOf(merge) < (verdict?.at ?? Number.POSITIVE_INFINITY) || merge.worker !== ownerId ? [`PR ${String(pr)} merge is not the owner's after the verdict`] : []),
        ];
      });
      return when(problems.length === 0, 'two independent verifiers, PASS at each head, owner merges after the verdicts', problems.join('; '));
    }),
    mergesAreAuthorizedAndVerified('orchestrate.no-merge-without-the-operators-request-and-a-verdict-at-that-head', OR('A verdict covers one head SHA, so a new push needs a new verdict')),
    check('orchestrate.a-stalled-worker-is-judged-by-its-side-effects-aborted-and-replaced-with-a-consolidated-kickoff', 'the stalled owner was probed for pushes before it was aborted, its abort is recorded, and its replacement was spawned after it with the original kickoff plus the reason', OR('**Stop or replace a worker that stalls or loops.**'), (view) => {
      const stalled = allWorkers(view).find((worker) => worker.id === 'owner-52a');
      const replacement = allWorkers(view).find((worker) => worker.id === 'owner-52b');
      const probe = BASH(view).find((entry) => /git ls-remote --heads origin feat-shout-orch/.test(entry.command))?.order ?? -1;
      const abort = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'abort' && call.args['workerId'] === 'owner-52a' && !call.isError)?.order ?? -1;
      const respawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes('/owner-52b/'))?.order ?? -1;
      const settles = (stalled?.state?.['settles'] as { phase: string }[] | undefined) ?? [];
      return when(probe !== -1 && abort > probe && respawn > abort && settles.some((settle) => settle.phase === 'aborted') && /owner-52a, was aborted/.test(replacement?.brief ?? '') && /Evidence that proves it done/.test(replacement?.brief ?? ''), `probe at ${probe}, abort at ${abort} (phase ${String(stalled?.state?.['phase'])}), replacement at ${respawn} with the kickoff and the reason`, `probe ${probe}, abort ${abort}, respawn ${respawn}, settles ${JSON.stringify(settles.map((settle) => settle.phase))}`);
    }),
    check('orchestrate.live-state-is-read-and-every-worker-is-accounted-for', 'before the reply the parent read both PRs live, a notes file and a decisions log exist in the run root, and the reply accounts for every worker as done or replaced without asking the user', OR('**Check a PR\'s live state before you report on it,**'), (view) => {
      const lastCollect = Math.max(...view.parent.toolCalls.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect').map((call) => call.order));
      const live = BASH(view).find((entry) => /^gh pr view 51 .*&& gh pr view 52/.test(entry.command) && entry.order > lastCollect);
      const run = view.runs[0];
      const reply = finalReply(view);
      const missing = allWorkers(view).filter((worker) => !reply.includes(worker.id)).map((worker) => worker.id);
      return when(live !== undefined && (run?.decisions?.length ?? 0) >= 3 && readFileSync(join(run?.dir ?? '', 'notes.md'), 'utf8').includes('Program notes') && missing.length === 0 && !reply.trim().endsWith('?'), 'live read after the last collect; notes and decisions present; every worker named in the reply; no question', `live read ${live?.order}; decisions ${run?.decisions?.length}; unaccounted workers ${missing.join(', ') || 'none'}`);
    }),
    check('orchestrate.a-watch-loop-follows-the-pr', 'the PR was watched with a watch-pr watcher in a watcher worker, not a script or sleep loop in the parent', OR('Watch each PR with a watch loop'), (view) => {
      const watcher = allWorkers(view).find((worker) => worker.id === 'watch-52');
      const argv = assignmentOf(watcher as never).watch?.argv ?? [];
      const loops = BASH(view).filter((entry) => /while true|until |for i in/.test(entry.command));
      return when(argv[0] === WATCH_PR && (watcher?.state?.['exit'] as { code: number } | undefined)?.code === 0 && loops.length === 0, 'watch-pr watcher exited COMPLETE, no loop in the parent', `argv ${JSON.stringify(argv)}; loops ${loops.length}`);
    }),
    noToolErrors('orchestrate.no-tool-errors', OR('**Ask the user only for a real decision or a blocker,**')),
  ],
  negatives: [
    { name: 'a second owner pushed the same branch', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'push', ref: 'refs/heads/feat-shout-orch', worker: 'owner-51', run: RUN, actor: '', container: true } as ForgeAction)), fails: ['orchestrate.one-owner-per-pr-the-only-writer-of-its-branch'] },
    { name: 'the stalled owner had pushed a branch', mutate: (sandbox) => editForge(sandbox, (actions) => actions.push({ kind: 'ref-create', ref: 'refs/heads/feat-shout-orch', worker: 'owner-52a', run: RUN, actor: '', container: true } as ForgeAction)), fails: ['orchestrate.one-owner-per-pr-the-only-writer-of-its-branch'] },
    { name: 'an owner could spawn workers', mutate: (sandbox) => patchAssignment(sandbox, RUN, 'owner-51', (assignment) => ((assignment['capabilities'] as Record<string, unknown>)['spawn'] = true)), fails: ['orchestrate.owners-sit-two-levels-down-and-cannot-spawn'] },
    { name: 'a worker reported a fourth level', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs', RUN, 'workers/owner-52b/report.md'), 'code-ready\ndepth=4\n'), fails: ['orchestrate.owners-sit-two-levels-down-and-cannot-spawn'] },
    { name: 'the fan-out started before the first unit merged', mutate: (sandbox) => editForge(sandbox, (actions) => { const at = actions.findIndex((action) => action.kind === 'merge' && action.pr === 51); actions.splice(at, 1); }), fails: ['orchestrate.first-unit-goes-all-the-way-before-the-fan-out'] },
    { name: 'a kickoff named no evidence', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs', RUN, 'workers/owner-51/brief.md'), 'Build PR 51.'), fails: ['orchestrate.kickoffs-name-evidence-paths-and-forbidden-actions'] },
    { name: 'the verifier ran on the owner\'s model family', mutate: (sandbox) => patchAssignment(sandbox, RUN, 'verifier-52', (assignment) => (assignment['model'] = 'sim/grok-sim')), fails: ['orchestrate.each-pr-has-a-verifier-on-another-family-and-merges-follow-the-verdict'] },
    { name: 'an owner merged before the verdict was posted', mutate: (sandbox) => editForge(sandbox, (actions) => { const at = actions.findIndex((action) => action.kind === 'merge' && action.pr === 52); const [merge] = actions.splice(at, 1); actions.unshift(merge as ForgeAction); }), fails: ['orchestrate.each-pr-has-a-verifier-on-another-family-and-merges-follow-the-verdict', 'orchestrate.no-merge-without-the-operators-request-and-a-verdict-at-that-head'] },
    { name: 'the stalled owner was never aborted', mutate: (sandbox) => rewriteSession(sandbox, '"action":"abort"', '"action":"inspect"'), fails: ['orchestrate.a-stalled-worker-is-judged-by-its-side-effects-aborted-and-replaced-with-a-consolidated-kickoff'] },
    { name: 'the replacement got a bare kickoff', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs', RUN, 'workers/owner-52b/brief.md'), 'Build PR 52.'), fails: ['orchestrate.a-stalled-worker-is-judged-by-its-side-effects-aborted-and-replaced-with-a-consolidated-kickoff', 'orchestrate.kickoffs-name-evidence-paths-and-forbidden-actions'] },
    { name: 'the reply forgot the replaced worker', mutate: (sandbox) => rewriteFinalReply(sandbox, /owner-52a/g, 'one owner'), fails: ['orchestrate.live-state-is-read-and-every-worker-is-accounted-for'] },
    { name: 'the reply asked the user', mutate: (sandbox) => rewriteFinalReply(sandbox, /$/, ' Should I continue?'), fails: ['orchestrate.live-state-is-read-and-every-worker-is-accounted-for'] },
    { name: 'the parent polled with its own loop', mutate: (sandbox) => appendLoop(sandbox), fails: ['orchestrate.a-watch-loop-follows-the-pr'] },
  ],
};

function rewriteSession(sandbox: string, from: string, to: string): void {
  const file = parentSession(sandbox);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll(from, to));
}

function appendLoop(sandbox: string): void {
  const file = parentSession(sandbox);
  const id = `forged-${Math.random().toString(36).slice(2, 8)}`;
  const stamp = new Date().toISOString();
  const lines = [
    { type: 'message', id: `${id}a`, parentId: null, timestamp: stamp, message: { role: 'assistant', content: [{ type: 'toolCall', id, name: 'bash', arguments: { command: 'while true; do gh pr view 52; sleep 30; done' } }], provider: 'sim', model: 'forged', stopReason: 'toolUse', timestamp: Date.now() } },
    { type: 'message', id: `${id}b`, parentId: `${id}a`, timestamp: stamp, message: { role: 'toolResult', toolCallId: id, toolName: 'bash', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: Date.now() } },
  ];
  writeFileSync(file, `${readFileSync(file, 'utf8')}${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

export const orchestrateFamilies: Family[] = [orchestrateFamily, ...orchestrateSubFamilies];
