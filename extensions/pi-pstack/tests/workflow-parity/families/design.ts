// Families: arena, architect, swarm, interrogate (spec 12.2).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { cartHistory, finalFile, lineOf } from '../fixtures/repos.ts';
import { type Check, check, fail, pass, src, when } from '../lib/check.ts';
import {
  allWorkers,
  assignmentOf,
  briefCarries,
  briefsContain,
  collectOrder,
  fanOutBeforeCollect,
  finalReply,
  noToolErrors,
  openedAt,
  panelCheck,
  parentOpenedFiles,
  parentReads,
  promptRoutes,
  receiptsFor,
  repoUntouched,
  settledAndCollected,
  skillFile,
  spawnOrder,
  spawnedAfterCollect,
  verifyReceipt,
  workersCheck,
  worktreeIsolation,
  writableWorkerRecords,
} from '../lib/checks.ts';
import { PI, SCRIPTED_ROLES } from '../lib/driver.ts';
import { corruptArtifact, deleteReceipt, dirtyRepo, type Negative, parentSession, patchAssignment, patchGit, removeWorker, rewriteFinalReply, setSessionCwd, workerSessionFile } from '../lib/mutate.ts';
import type { RunView } from '../lib/view.ts';
import { markPhase, phaseItems, phasesBeforeLaunch, replyHas, worktreeOf, writer } from './shared.ts';
import type { Family } from './types.ts';

const model = (line: string, index = 0): string => {
  const value = SCRIPTED_ROLES[line];
  return String(Array.isArray(value) ? value[index] : value);
};

const COUPON_A = `export function clampPercent(percent) {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new RangeError('percent must be 0..100');
  return percent;
}
`;
const COUPON_A_TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampPercent } from '../src/coupon.js';

test('keeps a valid percent', () => assert.equal(clampPercent(15), 15));
test('rejects a percent over 100', () => assert.throws(() => clampPercent(150), RangeError));
test('rejects NaN', () => assert.throws(() => clampPercent(Number.NaN), RangeError));
`;
const COUPON_B = `export function clampPercent(percent) {
  const value = Number(percent);
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
`;
const COUPON_B_TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampPercent } from '../src/coupon.js';

test('keeps a valid percent', () => assert.equal(clampPercent(15), 15));
test('clamps a percent over 100', () => assert.equal(clampPercent(150), 100));
test('turns NaN into 0', () => assert.equal(clampPercent(Number.NaN), 0));
`;

const RUBRIC = ['clampPercent returns a number from 0 to 100 for every number input', 'invalid input such as NaN has a defined outcome that a test covers', 'the public signature stays clampPercent(percent)'];
const ARENA_TASK = 'Produce src/coupon.js exporting clampPercent(percent) and test/coupon.test.js, so a coupon over 100 percent can no longer pay the customer.';
const PACKAGE_JSON = `${JSON.stringify({ name: 'synth', private: true, type: 'module', scripts: { test: 'node --test' } })}\n`;

function candidateBrief(path: string): string {
  return `${ARENA_TASK}\nWork only inside your worktree ${path}. Commit your work. Report a short rationale naming the alternatives you considered and what you rejected.`;
}

const LEAVES = ['principle-separate-before-serializing-shared-state', 'principle-redesign-from-first-principles', 'principle-prove-it-works'];
const ARENA_PHASES = [/Frame/, /Fan out/, /Cross-judge/, /Pick/, /Graft/, /Verify/];
const ARENA_PHASE_NAMES = ['Arena Frame', 'Arena Fan out', 'Arena Cross-judge', 'Arena Pick', 'Arena Graft', 'Arena Verify'];

/** Frame through Verify of the arena skill, shared by arena and the architect skill's Phase B. */
function arenaSteps(parent: Parent, options: { candidate: (index: number) => { id: string; role: string; line: string }; task: string; files: [Record<string, string>, Record<string, string>]; reports: [string, string]; testCommand: string; synthFiles: Record<string, string>; note: string }): { workers: Record<string, Worker> } {
  const { ctx } = parent;
  const ids = [options.candidate(0).id, options.candidate(1).id];
  const workers: Record<string, Worker> = {};
  const staged = ids.map((id, index) => parent.stage(id, { role: options.candidate(index).role, model: model(options.candidate(index).line, index), workspace: parent.worktree() }, candidateBrief(worktreeOf(parent, id))));
  markPhase(parent, ARENA_PHASE_NAMES[0] as string);
  parent.fire(...staged);
  ids.forEach((id, index) => {
    workers[id] = writer(parent, id, { units: [{ files: options.files[index as 0 | 1], commit: `candidate ${id}` }], test: 'node --test', report: options.reports[index as 0 | 1] });
  });
  markPhase(parent, ARENA_PHASE_NAMES[1] as string);
  for (const id of ids) parent.wait(id);
  parent.collect(...ids);
  parent.spawn('judge', { role: 'judge', model: model('arena cross-judge pool', 1), workspace: parent.readonly() }, `Rubric:\n${RUBRIC.map((criterion) => `- ${criterion}`).join('\n')}\n\nCandidates by path label:\n${ids.map((id) => `- ${id}: ${worktreeOf(parent, id)}`).join('\n')}\n\nScore each criterion for each candidate and recommend a base with a rationale.`);
  workers['judge'] = new Worker().read(join(worktreeOf(parent, ids[0] as string), 'src/coupon.js')).read(join(worktreeOf(parent, ids[1] as string), 'src/coupon.js')).text(`Scores per criterion: ${ids[0]} 3/3, ${ids[1]} 2/3. Recommended base: ${ids[0]}.`);
  parent.wait('judge').collect('judge');
  markPhase(parent, ARENA_PHASE_NAMES[2] as string);
  for (const id of ids) parent.read(join(worktreeOf(parent, id), 'src/coupon.js')).read(join(worktreeOf(parent, id), 'test/coupon.test.js'));
  markPhase(parent, ARENA_PHASE_NAMES[3] as string);
  const synth = join(ctx.sandbox, 'arena-synth');
  for (const [path, content] of Object.entries({ 'package.json': PACKAGE_JSON, ...options.synthFiles })) parent.write(join(synth, path), content);
  markPhase(parent, ARENA_PHASE_NAMES[4] as string);
  parent.proof({ id: 'arena-verify', target: 'arena-verify', command: options.testCommand, cwd: synth, kind: 'test' });
  markPhase(parent, ARENA_PHASE_NAMES[5] as string);
  parent.text(options.note);
  void options.task;
  return { workers };
}

const ARENA_NOTE = `Base: candidate-1, because it rejects invalid input at the boundary and every criterion holds. Cross-judge: judge scored candidate-1 3 of 3 and recommended it.
Grafts: the NaN test from candidate-2, folded in by hand.
Rejected: silently turning NaN into 0, because it hides caller bugs.
Convergence and dropouts: none dropped, both candidates kept the signature.
Verification: node --test passes on the synthesized artifact, receipt arena-verify.`;

function judgeNotParentFamily(id: string): Check {
  return check(id, "the judge is never from the parent's model family", src('arena/SKILL.md', "The judge is never from the parent's family"), (view) => {
    const judge = allWorkers(view).find((worker) => assignmentOf(worker).role === 'judge');
    if (judge === undefined) return fail('no judge');
    const parentModel = view.parent.models[0] ?? '';
    const judgeModel = String(assignmentOf(judge).model);
    const family = (value: string) => value.slice(value.indexOf('/') + 1).split(/[-.]/)[0];
    return when(judgeModel !== 'inherit-parent' && family(judgeModel) !== family(parentModel), `parent ${parentModel}, judge ${judgeModel}`, `judge ${judgeModel} is the parent's family (${parentModel})`);
  });
}

const ARENA_CHECKS = (prefix: string, skillName: string, runnerLine: string): Check[] => [
  panelCheck(`${prefix}.candidates`, `candidates run on the "${runnerLine}" models, one per entry, from at least two families, each in a writable worktree`, [src(`${skillName}/SKILL.md`, 'Spawn all N workers one after another without waiting'), src('arena/SKILL.md', 'Pick the runners')].slice(0, skillName === 'arena' ? 2 : 1), { role: 'candidate', line: runnerLine, mode: 'worktree' }),
  fanOutBeforeCollect(`${prefix}.fan-out-without-waiting`, src('arena/SKILL.md', 'Spawn all N workers one after another without waiting'), ['candidate']),
  worktreeIsolation(`${prefix}.separate-writable-locations`, src('arena/SKILL.md', 'Give each candidate its own output location')),
  check(`${prefix}.same-prompt`, 'every candidate got the same prompt: briefs are identical once each worker\'s own path is removed', src('arena/SKILL.md', 'Every candidate gets the same prompt'), (view) => {
    const workers = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'candidate');
    const normal = workers.map((worker) => (worker.brief ?? '').replaceAll(join(worker.dir, 'worktree'), '<own>'));
    return when(workers.length >= 2 && new Set(normal).size === 1, `${workers.length} briefs identical`, `${new Set(normal).size} distinct briefs`);
  }),
  check(`${prefix}.rubric-held-back`, 'the rubric reaches the judge and never a candidate: "Candidates only see the task"', src('arena/SKILL.md', 'Candidates only see the task'), (view) => {
    const judge = allWorkers(view).find((worker) => assignmentOf(worker).role === 'judge');
    const criteria = (judge?.brief ?? '').split('\n').filter((line) => line.startsWith('- ') && !/^- candidate/.test(line)).map((line) => line.slice(2));
    if (criteria.length < 3 || criteria.length > 6) return fail(`the judge brief carries ${criteria.length} rubric criteria, want 3 to 6`);
    const leaked = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'candidate' && criteria.some((criterion) => (worker.brief ?? '').includes(criterion)));
    return when(leaked.length === 0, `${criteria.length} criteria in the judge brief, none in ${allWorkers(view).filter((worker) => assignmentOf(worker).role === 'candidate').length} candidate briefs`, `rubric leaked to ${leaked.map((worker) => worker.id).join(', ')}`);
  }),
  writableWorkerRecords(`${prefix}.candidate-records`, src('arena/SKILL.md', 'instructions to produce the artifact and a short rationale'), ['candidate']),
  check(`${prefix}.candidates-committed`, 'each candidate committed its artifact on its own branch', src('arena/SKILL.md', 'instructions to produce the artifact and a short rationale'), (view) => {
    const bad = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'candidate').filter((worker) => {
      const run = view.runs.find((entry) => entry.workers.includes(worker));
      return (view.git.branchCommits[`pstack-run/${run?.id}/${worker.id}`]?.length ?? 0) < 1;
    });
    return when(bad.length === 0, 'every candidate branch holds at least one commit', `no commit on: ${bad.map((worker) => worker.id).join(', ')}`);
  }),
  workersCheck(`${prefix}.judge`, 'one judge, role judge, readonly on the repository root, model from the cross-judge pool', src('arena/SKILL.md', 'Spawn one judge worker with `role: "judge"`'), { role: 'judge', min: 1, max: 1, mode: 'readonly', rootPath: true, modelLine: 'arena cross-judge pool' }),
  judgeNotParentFamily(`${prefix}.judge-not-parent-family`),
  spawnedAfterCollect(`${prefix}.judge-after-candidates`, "the judge is spawned only after every candidate completes: \"Don't spawn it while candidates are still writing\"", src('arena/SKILL.md', "Don't spawn it while candidates are still writing"), ['judge'], ['candidate']),
  briefsContain(`${prefix}.judge-brief`, 'the judge brief carries the rubric and the candidates by path label', src('arena/SKILL.md', 'The judge sees the rubric and the candidates by path label'), ['judge'], [
    { name: 'rubric', pattern: /Rubric/ },
    { name: 'candidate path labels', pattern: /candidate-?[\w-]*: \/.+worktree/ },
  ]),
  parentOpenedFiles(`${prefix}.read-every-candidate`, 'the parent read every candidate end to end before picking', src('arena/SKILL.md', 'Read every candidate end to end before picking'), (view) => allWorkers(view).filter((worker) => assignmentOf(worker).role === 'candidate').map((worker) => `${worker.id}/worktree/src/coupon.js`)),
  receiptsFor(`${prefix}.verified`, 'a passing receipt verifies the synthesized artifact (Phase F)', src('arena/SKILL.md', 'Verify the synthesized artifact like any other output'), (receipt) => receipt.target === 'arena-verify' && receipt.kind === 'test', 1),
  replyHas(`${prefix}.synthesis-note`, 'the synthesis note names the base, the cross-judge verdict, the grafts with their source, what was rejected, convergence or dropouts, and the verification', src('arena/SKILL.md', 'with a short synthesis note alongside naming the base and why'), [
    { name: 'base', pattern: /\bBase\b/i },
    { name: 'cross-judge', pattern: /cross-judge/i },
    { name: 'grafts', pattern: /\bGrafts?\b/i },
    { name: 'rejected', pattern: /\bRejected\b/i },
    { name: 'dropouts', pattern: /dropouts?/i },
    { name: 'verification', pattern: /\bVerification\b/i },
  ]),
  settledAndCollected(`${prefix}.settled-and-collected`, src('arena/SKILL.md', 'After all Phase B candidates complete')),
  noToolErrors(`${prefix}.no-tool-errors`, src('arena/SKILL.md', '## Outputs')),
];

const swapNegatives = (id: string, prefix: string): Negative[] => [
  { name: 'two candidates ran in the same worktree', mutate: (sandbox) => setSessionCwd(workerSessionFile(sandbox, id, 'candidate-2'), join(sandbox, 'repo/.pi/pstack/runs', id, 'workers/candidate-1/worktree')), fails: [`${prefix}.separate-writable-locations`] },
  { name: 'the judge is the parent model family', mutate: (sandbox) => patchAssignment(sandbox, id, 'judge', (assignment) => (assignment['model'] = 'sim/claude-sim')), fails: [`${prefix}.judge-not-parent-family`] },
  { name: 'the rubric leaked into a candidate brief', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs', id, 'workers/candidate-1/brief.md'), `${candidateBrief('x')}\n${RUBRIC[0]}`), fails: [`${prefix}.rubric-held-back`, `${prefix}.same-prompt`] },
  { name: 'candidates did not share one prompt', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs', id, 'workers/candidate-2/brief.md'), 'Do something else.'), fails: [`${prefix}.same-prompt`] },
  { name: 'only one runner ran', mutate: (sandbox) => removeWorker(sandbox, id, 'candidate-2'), fails: [`${prefix}.candidates`] },
  { name: 'both runners are the same model', mutate: (sandbox) => patchAssignment(sandbox, id, 'candidate-2', (assignment) => (assignment['model'] = model('arena runners', 0))), fails: [`${prefix}.candidates`] },
  { name: 'a candidate produced no commit', mutate: (sandbox) => patchGit(sandbox, (git) => (git['branchCommits'] = {})), fails: [`${prefix}.candidates-committed`] },
  { name: 'the synthesized artifact was never verified', mutate: (sandbox) => deleteReceipt(sandbox, id, 'arena-verify'), fails: [`${prefix}.verified`] },
  { name: 'the verification artifact was tampered with', mutate: (sandbox) => corruptArtifact(sandbox, id, 'arena-verify'), fails: [`${prefix}.verified`] },
  { name: 'the reply forgot the cross-judge verdict', mutate: (sandbox) => rewriteFinalReply(sandbox, /cross-judge/gi, 'panel'), fails: [`${prefix}.synthesis-note`] },
];

export const arenaFamily: Family = {
  id: 'arena',
  title: 'arena: independent candidates in separate worktrees, blind rubric, cross-family judge, graft, verify (spec 12.2)',
  spec: {
    family: 'arena',
    runId: 'arena-coupon',
    history: cartHistory,
    prompt: () => `/arena ${ARENA_TASK}`,
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      parent.readSkill('arena');
      for (const leaf of LEAVES) parent.readSkill(leaf);
      parent.bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook feature --title "arena: clampPercent" --run-id ${ctx.runId}`);
      phaseItems(parent, ARENA_PHASE_NAMES);
      const { workers } = arenaSteps(parent, {
        candidate: (index) => ({ id: `candidate-${index + 1}`, role: 'candidate', line: 'arena runners' }),
        task: ARENA_TASK,
        files: [
          { 'src/coupon.js': COUPON_A, 'test/coupon.test.js': COUPON_A_TEST },
          { 'src/coupon.js': COUPON_B, 'test/coupon.test.js': COUPON_B_TEST },
        ],
        reports: ['Considered clamping and throwing. Rejected clamping because it hides caller bugs.', 'Considered throwing and clamping. Rejected throwing because callers pass user input.'],
        testCommand: 'node --test',
        synthFiles: { 'src/coupon.js': COUPON_A, 'test/coupon.test.js': COUPON_A_TEST },
        note: ARENA_NOTE,
      });
      return scenario(parent, workers);
    },
  },
  checks: [
    promptRoutes('arena'),
    parentReads('arena.reads-skill-and-leaves', 'the parent opens arena and the principle leaves it applies', [src('arena/SKILL.md', '**separate-before-serializing-shared-state** principle skill'), src('arena/SKILL.md', '**redesign-from-first-principles** principle skill'), src('arena/SKILL.md', '**prove-it-works** principle skill')], ['arena', ...LEAVES]),
    phasesBeforeLaunch('arena.phase-todos-before-fan-out', src('arena/SKILL.md', 'Add one `TODO.md` entry per phase (Frame, Fan out'), ARENA_PHASES, { allResolved: true }),
    ...ARENA_CHECKS('arena', 'arena', 'arena runners'),
  ],
  negatives: [
    ...swapNegatives('arena-coupon', 'arena'),
    { name: 'the phase entries were written after the fan-out', mutate: (sandbox) => writeFileSync(join(sandbox, 'claims.json'), JSON.stringify([{ runId: 'arena-coupon', workerId: 'candidate-1', seq: -1 }])), fails: ['arena.phase-todos-before-fan-out'] },
  ],
};

// ---- architect

const DESIGN_A = (shape: string) => `# Candidate design

## Problem
A coupon over 100 percent pays the customer. The cart owns percents and nothing guards them.

## Usage (caller's view)
\`\`\`js
import { clampPercent } from './coupon.js';
const percent = clampPercent(userInput);
total(items, percent);
\`\`\`

## Shape
${shape}

## Synthesis decision
Filled in by arena.

## Tradeoffs accepted
We accept a thrown RangeError in exchange for loud caller bugs.

## Alternatives considered
Clamping silently. It lost because it hides caller bugs and exposes nothing to callers.

## Open questions and risks
Should NaN be a RangeError or a TypeError?

## Next implementation step
Write src/coupon.js with clampPercent.
`;

const SHAPE_1 = 'A single function clampPercent(percent) in src/coupon.js that throws RangeError outside 0..100. The public surface is one function and it hides the range rule.';
const SHAPE_2 = 'A Percent branded type with parsePercent(input) returning Percent, and total() takes Percent only. Invalid states are unrepresentable.';

const ARCHITECT_PHASES = ['Architect Ground', 'Architect Sketch', 'Architect Agree', 'Architect Implement', 'Architect Scrap'];
const RATIONALE_HEADINGS = ['Problem', "Usage (caller's view)", 'Shape', 'Synthesis decision', 'Tradeoffs accepted', 'Alternatives considered', 'Open questions and risks', 'Next implementation step'];

export const architectFamily: Family = {
  id: 'architect',
  title: 'architect: ground with how, two structurally distinct designs through arena, red-flag screen, rationale, implement (spec 12.2)',
  spec: {
    family: 'architect',
    runId: 'architect-coupon',
    history: cartHistory,
    prompt: () => '/architect guard coupon percents so a coupon over 100 percent cannot pay the customer',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      parent.readSkill('architect').readSkill('how').readSkill('arena');
      parent.bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook feature --title "architect: coupon guard" --run-id ${ctx.runId}`);
      phaseItems(parent, ARCHITECT_PHASES);
      parent.spawn('ground', { role: 'general', model: model('how explainer'), workspace: parent.readonly() }, 'Simple path: explain how coupons flow through src/cart.js and src/checkout.js.');
      workers['ground'] = new Worker().read(join(ctx.repo, 'src/cart.js')).text(`### Overview\nCoupons are applied in src/cart.js:${lineOf(cartHistory, 'src/cart.js', 'export function applyCoupon')} with no range guard.`);
      parent.wait('ground').collect('ground');
      markPhase(parent, ARCHITECT_PHASES[0] as string);
      for (const file of ['references/runner-prompt.md', 'references/design-red-flags.md', 'references/rationale-template.md']) parent.read(join(ctx.pkg, 'generated/skills/architect', file));
      const ids = ['candidate-1', 'candidate-2'];
      const brief = (path: string) => `Read the architect skill in full first. Use generated/skills/architect/references/runner-prompt.md as your prompt.\nTask: guard coupon percents.\nGrounding: ground worker report.\nWrite your candidate design package to ${path}/design.md and commit it.`;
      const staged = ids.map((id, index) => parent.stage(id, { role: 'candidate', model: model('architect runners', index), workspace: parent.worktree() }, brief(worktreeOf(parent, id))));
      parent.fire(...staged);
      ids.forEach((id, index) => {
        workers[id] = writer(parent, id, { units: [{ files: { 'design.md': DESIGN_A(index === 0 ? SHAPE_1 : SHAPE_2) }, commit: `design ${id}` }], test: 'test -s design.md', testKind: 'command', report: `Design ${id} written. Alternatives considered: ${index === 0 ? 'branded type' : 'plain function'}.` });
      });
      for (const id of ids) parent.wait(id);
      parent.collect(...ids);
      parent.spawn('judge', { role: 'judge', model: model('arena cross-judge pool', 1), workspace: parent.readonly() }, `Rubric:\n- the design hides the range rule behind a small interface\n- invalid states are rejected at the boundary\n- the caller's usage and the signature agree\n\nCandidates by path label:\n${ids.map((id) => `- ${id}: ${worktreeOf(parent, id)}`).join('\n')}`);
      workers['judge'] = new Worker().read(join(worktreeOf(parent, 'candidate-1'), 'design.md')).text('Recommended base: candidate-1, the smaller interface.');
      parent.wait('judge').collect('judge');
      markPhase(parent, ARCHITECT_PHASES[1] as string);
      for (const id of ids) parent.read(join(worktreeOf(parent, id), 'design.md'));
      const rationale = join(ctx.sandbox, 'architect-out', 'coupon-guard-rationale.md');
      parent.write(rationale, `${DESIGN_A(SHAPE_1).replace('Filled in by arena.', 'Base candidate-1, grafted the typed parse boundary idea from candidate-2, rejected the branded type everywhere because it widens the interface.')}`);
      markPhase(parent, ARCHITECT_PHASES[2] as string);
      parent.spawn('implement', { role: 'poteto', model: model('feature, refactoring'), workspace: parent.worktree() }, `Implement the sketch in ${rationale}: src/coupon.js with clampPercent, replacing not implemented bodies. Commit.`);
      workers['implement'] = writer(parent, 'implement', { units: [{ files: { 'src/coupon.js': COUPON_A, 'test/coupon.test.js': COUPON_A_TEST }, commit: 'implement clampPercent against the sketch' }], test: 'node --test', report: 'Implemented the sketch without deviation.' });
      parent.wait('implement').collect('implement');
      markPhase(parent, ARCHITECT_PHASES[3] as string);
      markPhase(parent, ARCHITECT_PHASES[4] as string);
      parent.text('Implemented against the synthesized sketch. No scrap needed, the sketch absorbed the work. Rationale shipped alongside.');
      return scenario(parent, workers);
    },
  },
  checks: [
    promptRoutes('architect'),
    parentReads('architect.reads-skill-and-grounding', 'the parent opens architect, how (Phase A), and arena (Phase B)', [src('architect/SKILL.md', 'Run the **how** skill over the relevant subsystems'), src('architect/SKILL.md', 'Run the **arena** skill with the design-sketch task')], ['architect', 'how', 'arena']),
    check('architect.reads-runner-prompt-and-red-flags', 'the parent opens runner-prompt.md, design-red-flags.md and rationale-template.md', [src('architect/SKILL.md', 'Pass `references/runner-prompt.md` as each runner\'s prompt'), src('architect/SKILL.md', 'Screen every candidate against')], (view) => {
      const missing = ['runner-prompt.md', 'design-red-flags.md', 'rationale-template.md'].filter((file) => openedAt(view.parent, `generated/skills/architect/references/${file}`) === -1);
      return when(missing.length === 0, 'all three references opened', `not opened: ${missing.join(', ')}`);
    }),
    phasesBeforeLaunch('architect.phase-todos-before-work', src('architect/SKILL.md', 'Add one `TODO.md` entry per phase'), [/Ground/, /Sketch/, /Agree/, /Implement/, /Scrap/], { allResolved: true }),
    workersCheck('architect.phase-a-grounded-with-how', 'Phase A: how ran over the subsystem, a readonly explainer on the repository root', src('architect/SKILL.md', 'Produce the architectural explanation `how` prescribes'), { role: 'general', min: 1, mode: 'readonly', rootPath: true, modelLine: 'how explainer', id: /ground/ }),
    panelCheck('architect.runners-from-architect-line', 'Phase B: candidates run on the "architect runners" line, at least two structurally distinct designs, in separate writable worktrees', src('architect/SKILL.md', 'Take the runners from the `architect runners` line'), { role: 'candidate', line: 'architect runners', mode: 'worktree' }),
    check('architect.designs-are-distinct', 'at least two candidate design packages exist and differ ("Design it twice")', src('architect/SKILL.md', 'Require at least two structurally distinct candidates'), (view) => {
      const designs = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'candidate').map((worker) => (worker.worktree === null ? '' : safeRead(join(worker.worktree, 'design.md'))));
      return when(designs.length >= 2 && designs.every((design) => design !== '') && new Set(designs).size === designs.length, `${designs.length} distinct design packages`, `${designs.length} candidates, ${new Set(designs).size} distinct non-empty designs`);
    }),
    worktreeIsolation('architect.separate-writable-locations', src('arena/SKILL.md', 'Give each candidate its own output location')),
    judgeNotParentFamily('architect.judge-not-parent-family'),
    workersCheck('architect.judge-from-another-family', 'arena Phase C ran: one judge, readonly, from the cross-judge pool', src('architect/SKILL.md', 'Run the **arena** skill with the design-sketch task'), { role: 'judge', min: 1, max: 1, mode: 'readonly', rootPath: true, modelLine: 'arena cross-judge pool' }),
    spawnedAfterCollect('architect.judge-after-candidates', 'the judge is spawned after every candidate completes', src('arena/SKILL.md', "Don't spawn it while candidates are still writing"), ['judge'], ['candidate']),
    check('architect.rationale-shipped', 'the rationale ships alongside, shaped per rationale-template.md, with the usage section before the shape', src('architect/SKILL.md', 'The rationale ships alongside, shaped per `references/rationale-template.md`'), (view) => {
      const write = view.parent.toolCalls.find((call) => call.name === 'write' && typeof call.args['content'] === 'string' && String(call.args['content']).includes('## Synthesis decision'));
      if (write === undefined) return fail('the parent wrote no rationale document');
      const text = String(write.args['content']);
      const positions = RATIONALE_HEADINGS.map((heading) => text.indexOf(`## ${heading}`));
      if (positions.includes(-1)) return fail(`rationale lacks ${RATIONALE_HEADINGS.filter((_, index) => positions[index] === -1).join(', ')}`);
      return when(positions.every((position, index) => index === 0 || position > (positions[index - 1] as number)) && !/Filled in by arena\./.test(text), `rationale at ${String(write.args['path'])} has all eight sections in order and a filled synthesis decision`, 'sections are out of order or the synthesis decision is still the template note');
    }),
    check('architect.proceeds-to-implementation', 'with no checkpoint requested, implementation follows the synthesis directly: a writable worker commits after the judge was collected', src('architect/SKILL.md', 'Default: proceed directly to implementation with the synthesized design'), (view) => {
      const implement = allWorkers(view).find((worker) => assignmentOf(worker).role === 'poteto' || /implement/.test(worker.id));
      const run = view.runs[0];
      const commits = view.git.branchCommits[`pstack-run/${run?.id}/${implement?.id}`] ?? [];
      const judge = allWorkers(view).find((worker) => assignmentOf(worker).role === 'judge');
      return when(implement !== undefined && commits.length >= 1 && judge !== undefined && spawnOrder(view, implement.id) > collectOrder(view, judge.id), `${implement?.id} committed ${commits.length} after the judge was collected`, `implementer ${implement?.id}, commits ${commits.length}`);
    }),
    receiptsFor('architect.implementation-verified', 'the implementation worker recorded a passing test receipt', src('architect/SKILL.md', 'Replace `not implemented` bodies with code'), (receipt) => receipt.target === 'implement' && receipt.kind === 'test', 1),
    settledAndCollected('architect.settled-and-collected', src('arena/SKILL.md', 'After all Phase B candidates complete')),
    noToolErrors('architect.no-tool-errors', src('architect/SKILL.md', '## Outputs')),
  ],
  negatives: [
    { name: 'two candidates ran in the same worktree', mutate: (sandbox) => setSessionCwd(workerSessionFile(sandbox, 'architect-coupon', 'candidate-2'), join(sandbox, 'repo/.pi/pstack/runs/architect-coupon/workers/candidate-1/worktree')), fails: ['architect.separate-writable-locations'] },
    { name: 'a single design was explored', mutate: (sandbox) => removeWorker(sandbox, 'architect-coupon', 'candidate-2'), fails: ['architect.runners-from-architect-line', 'architect.designs-are-distinct'] },
    { name: 'both candidates wrote the same design', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/architect-coupon/workers/candidate-2/worktree/design.md'), DESIGN_A(SHAPE_1)), fails: ['architect.designs-are-distinct'] },
    { name: 'the rationale kept the template note for the synthesis decision', mutate: (sandbox) => rewriteSessionSynthesis(sandbox), fails: ['architect.rationale-shipped'] },
    { name: 'the implementation committed nothing', mutate: (sandbox) => patchGit(sandbox, (git) => (git['branchCommits'] = {})), fails: ['architect.proceeds-to-implementation'] },
    { name: 'the implementation receipt is gone', mutate: (sandbox) => deleteReceipt(sandbox, 'architect-coupon', 'implement-check'), fails: ['architect.implementation-verified'] },
    { name: 'the judge shares the parent family', mutate: (sandbox) => patchAssignment(sandbox, 'architect-coupon', 'judge', (assignment) => (assignment['model'] = 'sim/claude-sim')), fails: ['architect.judge-not-parent-family'] },
    { name: 'the phase entries were written after workers launched', mutate: (sandbox) => writeFileSync(join(sandbox, 'claims.json'), JSON.stringify([{ runId: 'architect-coupon', workerId: 'ground', seq: -1 }])), fails: ['architect.phase-todos-before-work'] },
  ],
};

function rewriteSessionSynthesis(sandbox: string): void {
  const file = parentSession(sandbox);
  writeFileSync(file, readFileSync(file, 'utf8').replace('Base candidate-1, grafted the typed parse boundary idea from candidate-2, rejected the branded type everywhere because it widens the interface.', 'Filled in by arena.'));
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

// ---- swarm

const SWARM_PHASES = ['Swarm Frame', 'Swarm Fan out', 'Swarm Aggregate', 'Swarm Report'];
const SLICES = ['src/cart.js', 'src/money.js', 'src/checkout.js'];

const sliceBrief = (parent: Parent, slice: string) =>
  `Goal: audit ${slice} for rounding bugs.\nScope: only ${slice}, read it at commit ${parent.ctx.base}.\nHow to verify: run \`node --test\` at commit ${parent.ctx.base}, 3 samples, one sample is one full test run, in order.\nReport: PASS, ISSUES, or BLOCKED with evidence. Record the commit SHA and the method you used. List every issue you can prove.`;

const SWARM_REPORT = (sha: string) => `Result table
| slice | result | evidence |
| src/cart.js | PASS | receipt slice-1-check at ${sha.slice(0, 12)} |
| src/money.js | ISSUES | roundCents drifts on 1.005, receipt slice-2-check |
| src/checkout.js | PASS | receipt slice-3b-check at ${sha.slice(0, 12)} |
Issues
- src/money.js: roundCents(1.005) returns 1 not 1.01.
Gaps and dropouts
- slice-3 first result did not record the commit SHA or the method, so it did not count and was respawned once as slice-3b.
Race rule: none, this was a coverage partition.`;

export const swarmFamily: Family = {
  id: 'swarm',
  title: 'swarm: partitioned workers, container first with a worktree fallback, PASS/ISSUES/BLOCKED, invalid result respawned once (spec 12.2)',
  spec: {
    family: 'swarm',
    runId: 'swarm-rounding',
    history: cartHistory,
    prompt: () => '/swarm audit src/cart.js, src/money.js and src/checkout.js for rounding bugs, one slice per worker',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      parent.readSkill('swarm');
      parent.bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook feature --title "swarm: rounding audit" --run-id ${ctx.runId}`);
      phaseItems(parent, SWARM_PHASES);
      markPhase(parent, SWARM_PHASES[0] as string);
      const worker = (id: string, slice: string, sha: boolean) => {
        const text = sha
          ? `PASS ${slice}: audited at ${ctx.base}, method: node --test x3, no rounding issue found.`
          : `PASS ${slice}: looked fine.`;
        workers[id] = writer(parent, id, { units: [{ files: { [`audit/${id}.md`]: `${text}\n` }, commit: `audit ${id}` }], test: 'node --test', testKind: 'test', report: text });
      };
      worker('slice-1', SLICES[0] as string, true);
      workers['slice-2'] = writer(parent, 'slice-2', { units: [{ files: { 'audit/slice-2.md': `ISSUES src/money.js: roundCents(1.005) is 1 at ${ctx.base}, method: node -e x3\n` }, commit: 'audit slice-2' }], test: 'node --test', report: `ISSUES src/money.js at ${ctx.base}, method: node --test x3. roundCents(1.005) returns 1 not 1.01.` });
      worker('slice-3', SLICES[2] as string, false);
      worker('slice-3b', SLICES[2] as string, true);
      // Container first: the skill says to try it, and spawn answers when none is installed.
      const containerAssignment = () => ({ role: 'general', model: model('swarm workers'), workspace: { mode: 'container', inputCommit: ctx.base } });
      const dir = (id: string) => join(parent.workerDir(id));
      parent.write(join(dir('slice-1'), 'brief.md'), sliceBrief(parent, SLICES[0] as string));
      parent.write(join(dir('slice-1'), 'assignment.json'), `${JSON.stringify({ schemaVersion: 1, runId: ctx.runId, workerId: 'slice-1', kind: 'pi', role: 'general', brief: 'brief.md', model: containerAssignment().model, thinkingLevel: null, workspace: containerAssignment().workspace, skills: [] }, null, 2)}\n`);
      parent.call('pstack_worker', { action: 'spawn', runId: ctx.runId, assignmentPath: join(dir('slice-1'), 'assignment.json') });
      const fields = () => ({ role: 'general', model: model('swarm workers'), workspace: parent.worktree() });
      const calls = [parent.stage('slice-1', fields(), sliceBrief(parent, SLICES[0] as string)), parent.stage('slice-2', fields(), sliceBrief(parent, SLICES[1] as string)), parent.stage('slice-3', fields(), sliceBrief(parent, SLICES[2] as string))];
      parent.fire(...calls);
      markPhase(parent, SWARM_PHASES[1] as string);
      for (const id of ['slice-1', 'slice-2', 'slice-3']) parent.wait(id);
      parent.collect('slice-1', 'slice-2', 'slice-3');
      parent.spawn('slice-3b', fields(), sliceBrief(parent, SLICES[2] as string));
      parent.wait('slice-3b').collect('slice-3b');
      markPhase(parent, SWARM_PHASES[2] as string);
      markPhase(parent, SWARM_PHASES[3] as string);
      parent.text(SWARM_REPORT(ctx.base));
      return scenario(parent, workers);
    },
  },
  checks: [
    promptRoutes('swarm'),
    parentReads('swarm.reads-skill', 'the parent opens the swarm skill', src('swarm/SKILL.md', '# Swarm'), ['swarm']),
    phasesBeforeLaunch('swarm.phase-todos-before-fan-out', src('swarm/SKILL.md', 'Add one `TODO.md` entry per phase'), [/Frame/, /Fan out/, /Aggregate/, /Report/], { allResolved: true }),
    check('swarm.container-tried-first', 'Phase B tries a container workspace first for the first worker', src('swarm/SKILL.md', '`workspace: { mode: "container", inputCommit }`'), (view) => {
      const firstSpawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn');
      if (firstSpawn === undefined) return fail('no spawn');
      const assignmentPath = String(firstSpawn.args['assignmentPath']);
      const write = view.parent.toolCalls.find((call) => call.name === 'write' && call.args['path'] === assignmentPath && call.order < firstSpawn.order);
      const mode = (JSON.parse(String(write?.args['content'] ?? '{}')) as { workspace?: { mode?: string } }).workspace?.mode;
      return when(mode === 'container', 'the first spawn asked for a container workspace', `the first spawn staged workspace.mode ${String(mode)}`);
    }),
    check('swarm.container-refusal-is-ContainerUnavailable', 'a refused container spawn answers ContainerUnavailable, which the swarm skill reads as its fallback signal', src('swarm/SKILL.md', 'or spawn returns `ContainerUnavailable`'), (view) => {
      const refused = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && call.isError);
      return refused === undefined ? fail('the container spawn was not refused') : when(/ContainerUnavailable/.test(refused.resultText), 'the refusal names ContainerUnavailable', `the refusal reads: ${refused.resultText.slice(0, 200)}`);
    }),
    check('swarm.falls-back-to-worktree', 'after the refusal each worker is spawned with a worktree workspace at the base commit', src('swarm/SKILL.md', 'spawn it with `workspace: { mode: "worktree", inputCommit }` instead'), (view) => {
      const workers = allWorkers(view);
      const bad = workers.filter((worker) => assignmentOf(worker).workspace?.mode !== 'worktree' || assignmentOf(worker).workspace?.inputCommit !== view.base);
      return when(workers.length >= 3 && bad.length === 0, `${workers.length} workers on worktrees at ${view.base.slice(0, 12)}`, `not worktree at base: ${bad.map((worker) => worker.id).join(', ') || 'too few workers'}`);
    }),
    check('swarm.workers-use-the-swarm-model-line', 'workers are role general on the "swarm workers" model line', src('swarm/SKILL.md', 'Pick the worker model from the `swarm workers` line'), (view) => {
      const bad = allWorkers(view).filter((worker) => assignmentOf(worker).role !== 'general' || ![model('swarm workers'), 'inherit-parent'].includes(String(assignmentOf(worker).model)));
      return when(allWorkers(view).length > 0 && bad.length === 0, `${allWorkers(view).length} workers, role general, ${model('swarm workers')}`, `off-contract workers: ${bad.map((worker) => `${worker.id}:${String(assignmentOf(worker).role)}:${String(assignmentOf(worker).model)}`).join(', ')}`);
    }),
    check('swarm.fan-out-without-waiting', 'the first N workers are spawned together before the parent collects any', src('swarm/SKILL.md', 'Spawn all N workers one after another without waiting'), (view) => {
      const first = ['slice-1', 'slice-2', 'slice-3'].map((id) => spawnOrder(view, id));
      const collect = Math.min(...['slice-1', 'slice-2', 'slice-3'].map((id) => collectOrder(view, id)).filter((order) => order !== -1));
      return when(!first.includes(-1) && Math.max(...first) < collect, `spawns at ${first.join(',')} before the first collect at ${collect}`, `spawns ${first.join(',')}, first collect ${collect}`);
    }),
    worktreeIsolation('swarm.separate-writable-outputs', src('swarm/SKILL.md', 'Give each worker its own writable output when it writes')),
    briefsContain('swarm.briefs-stand-alone', 'every brief names the goal, the scope, the exact commit SHA, the measurement method, and the PASS, ISSUES, BLOCKED report', src('swarm/SKILL.md', 'Every brief stands alone'), ['general'], [
      { name: 'goal', pattern: /Goal:/ },
      { name: 'scope', pattern: /Scope:/ },
      { name: 'exact SHA', pattern: /\b[0-9a-f]{40}\b/ },
      { name: 'method', pattern: /(samples?|method|order)/i },
      { name: 'PASS/ISSUES/BLOCKED', pattern: /PASS.*ISSUES.*BLOCKED/s },
    ]),
    check('swarm.results-record-sha-and-method', "every lane the report accepts rests on a result that records the commit SHA and the method its brief names; a result that does not is not a pass", src('swarm/SKILL.md', 'Drop a result that does not record the SHAs and method its brief names'), (view) => {
      const reply = finalReply(view);
      const rows = reply.split('\n').filter((line) => /^\|\s*src\//.test(line));
      const problems = rows.flatMap((row) => {
        const id = /receipt (slice-[\w]+?)-check/.exec(row)?.[1];
        const worker = allWorkers(view).find((entry) => entry.id === id);
        if (worker === undefined) return [`${row.slice(0, 40)} cites no worker receipt`];
        return worker.finalText.includes(view.base) && /method/i.test(worker.finalText) ? [] : [`${worker.id} is accepted but its result lacks the SHA or the method`];
      });
      return when(rows.length === SLICES.length && problems.length === 0, `${rows.length} accepted lanes all record the SHA and method`, problems.join('; ') || `${rows.length} rows`);
    }),
    check('swarm.one-replacement-per-slice', 'a dropped slice gets at most one justified replacement', src('swarm/SKILL.md', 'respawn that worker once'), (view) => {
      const bySlice = new Map<string, number>();
      for (const worker of allWorkers(view)) {
        const slice = worker.brief?.match(/src\/\w+\.js/)?.[0] ?? worker.id;
        bySlice.set(slice, (bySlice.get(slice) ?? 0) + 1);
      }
      const over = [...bySlice.entries()].filter(([, count]) => count > 2);
      return when(over.length === 0 && [...bySlice.values()].some((count) => count === 2), `workers per slice: ${[...bySlice.entries()].map(([slice, count]) => `${slice}=${count}`).join(', ')}`, `slices with more than one replacement: ${over.map(([slice]) => slice).join(', ')}`);
    }),
    check('swarm.pass-lanes-have-receipts', 'every lane the report calls PASS has a recorded receipt that re-verifies, and an abandoned result is not a passing lane', src('swarm/SKILL.md', 'Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence'), (view) => {
      const reply = finalReply(view);
      const rows = reply.split('\n').filter((line) => /^\|\s*src\//.test(line));
      const problems = rows.filter((row) => /\|\s*PASS\s*\|/.test(row)).flatMap((row) => {
        const id = /receipt (slice-[\w-]+?)-check/.exec(row)?.[1];
        const run = view.runs[0];
        const receipt = run?.receipts.find((entry) => entry.id === `${id}-check`);
        if (id === undefined || run === undefined || receipt === undefined) return [`${row.slice(0, 40)} has no recorded receipt`];
        const problem = verifyReceipt(run, receipt);
        return problem === null ? [] : [problem];
      });
      return when(rows.length === SLICES.length && problems.length === 0, `${rows.length} lanes, every PASS lane has a re-verifying receipt`, problems.join('; ') || `${rows.length} lane rows, want ${SLICES.length}`);
    }),
    check('swarm.report-keeps-outcome-distinctions', 'the report is one table with PASS, ISSUES, or BLOCKED per slice, issue one-liners, and gaps; no raw worker dumps', src('swarm/SKILL.md', 'Return one consolidated in-chat report'), (view) => {
      const reply = finalReply(view);
      const rows = reply.split('\n').filter((line) => /^\|\s*src\//.test(line));
      const outcomes = rows.map((row) => row.split('|')[2]?.trim());
      return when(rows.length === SLICES.length && outcomes.every((outcome) => ['PASS', 'ISSUES', 'BLOCKED'].includes(String(outcome))) && outcomes.includes('ISSUES') && /Gaps and dropouts/.test(reply) && !allWorkers(view).some((worker) => worker.finalText.length > 80 && reply.includes(worker.finalText)), `outcomes ${outcomes.join(', ')}`, `rows ${rows.length}, outcomes ${outcomes.join(', ')}`);
    }),
    settledAndCollected('swarm.settled-and-collected', src('swarm/SKILL.md', '## Phase C: Aggregate')),
    writableWorkerRecords('swarm.worker-records', src('swarm/SKILL.md', 'Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence')),
  ],
  negatives: [
    { name: 'two workers shared a worktree', mutate: (sandbox) => setSessionCwd(workerSessionFile(sandbox, 'swarm-rounding', 'slice-2'), join(sandbox, 'repo/.pi/pstack/runs/swarm-rounding/workers/slice-1/worktree')), fails: ['swarm.separate-writable-outputs'] },
    { name: 'a PASS lane has no receipt', mutate: (sandbox) => deleteReceipt(sandbox, 'swarm-rounding', 'slice-1-check'), fails: ['swarm.pass-lanes-have-receipts'] },
    { name: 'a PASS lane receipt was tampered with', mutate: (sandbox) => corruptArtifact(sandbox, 'swarm-rounding', 'slice-3b-check'), fails: ['swarm.pass-lanes-have-receipts'] },
    { name: 'a brief names no SHA', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/swarm-rounding/workers/slice-2/brief.md'), 'Goal: audit. Scope: src/money.js. Report PASS, ISSUES, or BLOCKED.'), fails: ['swarm.briefs-stand-alone'] },
    { name: 'the abandoned result was counted as a pass', mutate: (sandbox) => rewriteFinalReply(sandbox, '| src/checkout.js | PASS | receipt slice-3b-check', '| src/checkout.js | PASS | slice-3 receipt slice-3-check'), fails: ['swarm.results-record-sha-and-method'] },
    { name: 'the slice was respawned twice', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/swarm-rounding/workers/slice-2/brief.md'), 'Goal: x. Scope: src/checkout.js.'), fails: ['swarm.one-replacement-per-slice'] },
    { name: 'the report invented an outcome', mutate: (sandbox) => rewriteFinalReply(sandbox, '| ISSUES |', '| MOSTLY FINE |'), fails: ['swarm.report-keeps-outcome-distinctions'] },
    { name: 'the workers ran on the wrong model line', mutate: (sandbox) => patchAssignment(sandbox, 'swarm-rounding', 'slice-1', (assignment) => (assignment['model'] = 'sim/claude-sim')), fails: ['swarm.workers-use-the-swarm-model-line'] },
    { name: 'a worker was a read-only container-less fallback', mutate: (sandbox) => patchAssignment(sandbox, 'swarm-rounding', 'slice-1', (assignment) => (assignment['workspace'] = { mode: 'readonly', path: sandbox })), fails: ['swarm.falls-back-to-worktree'] },
  ],
};

// ---- interrogate

const NAN_REPRO = `node --input-type=module -e "import('./src/coupon.js').then((m)=>console.log(String(m.clampPercent(NaN))))"`;
const INTENT = 'The change makes a coupon percent safe: clampPercent(percent) must return a number from 0 to 100 for any input.';

const interrogateHistory = [
  ...cartHistory,
  { message: 'feat: clamp coupon percent (#140)', files: { 'src/coupon.js': 'export function clampPercent(percent) {\n  return Math.min(100, Math.max(0, percent));\n}\n' } },
];

const ADVERSARY_BRIEF = `Scope: the last commit, feat: clamp coupon percent (#140).\nIntent: ${INTENT}\n\nBreak this change. Prove each finding with a run against the real code, such as a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, run a prototype or probe the current tree. Keep repros in your own worktree. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Leave out anything you did not run. That covers style, naming, structure, and risks that need a future change to matter. No findings is a valid result.`;

const INTERROGATE_REPORT = `Intent
${INTENT}

Findings
- clampPercent(NaN) returns NaN. Command: ${NAN_REPRO}. Output: NaN. The intent requires a number from 0 to 100. Found by reviewer-1.

Dropped
- reviewer-1: 0 dropped.
- reviewer-2: 1 dropped, a naming opinion with no run.
- reviewer-3: 0 dropped, no findings.`;

export const interrogateFamily: Family = {
  id: 'interrogate',
  title: 'interrogate: independent adversaries in worktrees, only run-proven findings survive, report without fixing (spec 12.2)',
  spec: {
    family: 'interrogate',
    runId: 'interrogate-clamp',
    history: interrogateHistory,
    prompt: () => '/interrogate the last commit',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      parent.readSkill('interrogate').readSkill('in-your-own-words').readSkill('arena');
      parent.bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook feature --title "interrogate: clamp" --run-id ${ctx.runId}`);
      const ids = ['reviewer-1', 'reviewer-2', 'reviewer-3'];
      const staged = ids.map((id, index) => parent.stage(id, { role: 'reviewer', model: model('interrogate reviewers', index), workspace: parent.worktree() }, `${ADVERSARY_BRIEF}\nYour worktree: ${worktreeOf(parent, id)}`));
      parent.fire(...staged);
      workers['reviewer-1'] = writer(parent, 'reviewer-1', { units: [{ files: { 'repro.sh': `${NAN_REPRO}\n` }, commit: 'repro for NaN' }], test: NAN_REPRO, testKind: 'command', report: `Finding: clampPercent(NaN) returns NaN.\nCommand: ${NAN_REPRO}\nOutput: NaN\nRequired: a number from 0 to 100.` });
      workers['reviewer-2'] = writer(parent, 'reviewer-2', { units: [{ files: { 'notes.md': 'naming opinion\n' }, commit: 'notes' }], test: 'test -s notes.md', testKind: 'command', report: 'Finding: the name clampPercent could be clearer. No command was run for this.' });
      workers['reviewer-3'] = writer(parent, 'reviewer-3', { units: [{ files: { 'notes.md': 'no findings\n' }, commit: 'notes' }], test: 'test -s notes.md', testKind: 'command', report: 'No findings.' });
      for (const id of ids) parent.wait(id);
      parent.collect(...ids);
      parent.bash(NAN_REPRO);
      parent.text(INTERROGATE_REPORT);
      return scenario(parent, workers);
    },
  },
  checks: [
    promptRoutes('interrogate'),
    parentReads('interrogate.reads-skills', 'the parent opens interrogate, in-your-own-words (the intent), and arena (Phases A and B)', [src('interrogate/SKILL.md', 'State the intent with the **in-your-own-words** skill'), src('interrogate/SKILL.md', 'Run Phase A steps 3 and 4 and Phase B of the **arena** skill')], ['interrogate', 'in-your-own-words', 'arena']),
    panelCheck('interrogate.reviewers', 'adversaries run on the "interrogate reviewers" line, role reviewer, each in its own writable worktree, from at least two families', src('interrogate/SKILL.md', 'Read the `interrogate reviewers` line in place of `arena runners`'), { role: 'reviewer', line: 'interrogate reviewers', mode: 'worktree' }),
    worktreeIsolation('interrogate.separate-worktrees', src('interrogate/SKILL.md', 'Copy the scope\'s uncommitted changes into each worktree')),
    fanOutBeforeCollect('interrogate.fan-out-without-waiting', src('interrogate/SKILL.md', '## Fan out'), ['reviewer']),
    briefsContain('interrogate.adversary-brief', 'each adversary brief carries the scope, the intent, and the break-it brief that demands a run for every finding', src('interrogate/SKILL.md', '> Break this change. Prove each finding with a run against the real code'), ['reviewer'], [
      { name: 'scope', pattern: /Scope:/ },
      { name: 'intent', pattern: /Intent:/ },
      { name: 'Break this change', pattern: /Break this change\. Prove each finding with a run against the real code/ },
      { name: 'leave out anything you did not run', pattern: /Leave out anything you did not run/ },
    ]),
    check('interrogate.no-judge-no-graft', 'arena Phases C, D and E are skipped: no judge worker, no synthesized artifact', src('interrogate/SKILL.md', 'Skip arena Phases C, D, and E'), (view) => {
      const judges = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'judge');
      return when(judges.length === 0, 'no judge was spawned', `judge workers: ${judges.map((worker) => worker.id).join(', ')}`);
    }),
    check('interrogate.findings-verified-by-rerun', 'each finding in the report was re-run by the parent and its output shows the failure', src('interrogate/SKILL.md', 'Verify each finding per arena Phase F by rerunning its command'), (view) => {
      const reply = finalReply(view);
      const findings = reply.split('Findings')[1]?.split('Dropped')[0]?.split('\n').filter((line) => line.startsWith('- ')) ?? [];
      if (findings.length === 0) return fail('no findings listed');
      const problems = findings.flatMap((finding) => {
        const command = /Command: (.*?)\. Output:/.exec(finding)?.[1];
        const output = /Output: ([^\s.,;]+)/.exec(finding)?.[1];
        if (command === undefined || output === undefined) return [`finding without a command and output: ${finding.slice(0, 60)}`];
        const rerun = view.parent.toolCalls.find((call) => call.name === 'bash' && String(call.args['command']).includes(command));
        return rerun === undefined ? [`the parent never re-ran: ${command.slice(0, 50)}`] : rerun.resultText.includes(output) ? [] : [`rerun output ${rerun.resultText.slice(0, 40)} lacks ${output}`];
      });
      return when(problems.length === 0, `${findings.length} finding(s) re-run with the reported output`, problems.join('; '));
    }),
    check('interrogate.unrun-findings-dropped', 'a reviewer finding with no run is dropped, and each reviewer\'s dropped count is reported', src('interrogate/SKILL.md', '**Dropped**: for each adversary, the count of dropped findings and why'), (view) => {
      const reply = finalReply(view);
      const reviewers = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'reviewer');
      const missing = reviewers.filter((worker) => !new RegExp(`${worker.id}: \\d+ dropped`).test(reply));
      const nitpick = allWorkers(view).find((worker) => /No command was run/.test(worker.finalText));
      const findings = reply.split('Findings')[1]?.split('Dropped')[0] ?? '';
      return when(missing.length === 0 && reviewers.length > 0 && (nitpick === undefined || !findings.includes('clearer')), `${reviewers.length} reviewers each have a dropped count; the unrun finding is not listed`, `no dropped count for ${missing.map((worker) => worker.id).join(', ')}; unrun finding listed: ${String(findings.includes('clearer'))}`);
    }),
    replyHas('interrogate.output-shape', 'the report has Intent, Findings, and Dropped', src('interrogate/SKILL.md', '## Output'), [
      { name: 'Intent', pattern: /^Intent$/m },
      { name: 'Findings', pattern: /^Findings$/m },
      { name: 'Dropped', pattern: /^Dropped$/m },
    ]),
    repoUntouched('interrogate.reports-without-fixing', 'findings are reported and no fix is applied to the repository', src('interrogate/SKILL.md', 'Report the findings. Do not apply fixes.')),
    settledAndCollected('interrogate.settled-and-collected', src('interrogate/SKILL.md', '## Fan out')),
    writableWorkerRecords('interrogate.reviewer-records', src('interrogate/SKILL.md', 'Keep repros in your own worktree'), ['reviewer']),
    noToolErrors('interrogate.no-tool-errors', src('interrogate/SKILL.md', '## Output')),
  ],
  negatives: [
    { name: 'two reviewers share a worktree', mutate: (sandbox) => setSessionCwd(workerSessionFile(sandbox, 'interrogate-clamp', 'reviewer-2'), join(sandbox, 'repo/.pi/pstack/runs/interrogate-clamp/workers/reviewer-1/worktree')), fails: ['interrogate.separate-worktrees'] },
    { name: 'a fix was applied while interrogating', mutate: (sandbox) => dirtyRepo(sandbox, 'src/coupon.js', '\nexport const fixed = true;\n'), fails: ['interrogate.reports-without-fixing'] },
    { name: 'the reply lists a finding nobody ran', mutate: (sandbox) => rewriteFinalReply(sandbox, '\n\nDropped', '\n- The name clampPercent could be clearer. Found by reviewer-2.\n\nDropped'), fails: ['interrogate.findings-verified-by-rerun', 'interrogate.unrun-findings-dropped'] },
    { name: 'a judge was spawned', mutate: (sandbox) => patchAssignment(sandbox, 'interrogate-clamp', 'reviewer-3', (assignment) => (assignment['role'] = 'judge')), fails: ['interrogate.no-judge-no-graft'] },
    { name: 'the reviewers were one model family', mutate: (sandbox) => { for (const id of ['reviewer-2', 'reviewer-3']) patchAssignment(sandbox, 'interrogate-clamp', id, (assignment) => (assignment['model'] = model('interrogate reviewers', 0))); }, fails: ['interrogate.reviewers'] },
    { name: 'a finding was reported with output that does not match the rerun', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Output: NaN.', 'Output: 100.'), fails: ['interrogate.findings-verified-by-rerun'] },
    { name: 'the dropped section is missing', mutate: (sandbox) => rewriteFinalReply(sandbox, 'reviewer-2: 1 dropped', 'reviewer-2'), fails: ['interrogate.unrun-findings-dropped'] },
  ],
};

void [briefCarries, openedAt, skillFile, pass, finalFile, PI, readFileSync, parentOpenedFiles, markPhase];

export const designFamilies: Family[] = [arenaFamily, architectFamily, swarmFamily, interrogateFamily];

export type { RunView };
