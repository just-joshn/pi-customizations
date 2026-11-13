// swarm race rules (first pass, rank all, best-of), the second-miss gap and the dropout, and the arena dropout path.
import { execFileSync } from 'node:child_process';
import { cpSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, fail, src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, collectOrder, finalReply, spawnedTogether, spawnOrder, worktreeIsolation } from '../lib/checks.ts';
import { SCRIPTED_ROLES } from '../lib/driver.ts';
import { appendToolCall, parentSession, patchAssignment, patchGit, rewriteFinalReply, rewriteSession, workerSessionFile } from '../lib/mutate.ts';
import type { RunView, WorkerView } from '../lib/view.ts';
import { markPhase, phaseItems, phasesBeforeLaunch, worktreeOf, writer } from './shared.ts';
import type { Family } from './types.ts';

const SWARM_PHASES = ['Swarm Frame', 'Swarm Fan out', 'Swarm Aggregate', 'Swarm Report'];
const SWARM_PHASE_PATTERNS = [/Swarm Frame/, /Swarm Fan out/, /Swarm Aggregate/, /Swarm Report/];
const FRAME_SRC = src('swarm/SKILL.md', 'declare `first pass`, `rank all`, or `best-of` before spawning');
const AGG_SRC = src('swarm/SKILL.md', 'apply the selection rule declared up front');
const settleAt = (worker: WorkerView, phase = 'idle'): number => Date.parse(((worker.state?.['settles'] as { phase: string; at: string }[] | undefined) ?? []).find((entry) => entry.phase === phase)?.at ?? '');
const scoreOf = (worker: WorkerView): number => Number(/score=(\d+)/.exec(worker.finalText)?.[1] ?? Number.NaN);
const arenaCandidates = (view: RunView) => allWorkers(view).filter((worker) => assignmentOf(worker).role === 'candidate');
const candidateCommits = (view: RunView, worker: WorkerView) => view.git.branchCommits[`pstack-run/${view.runs[0]?.id}/${worker.id}`]?.length ?? -1;
const arenaDropouts = (view: RunView) => arenaCandidates(view).filter((worker) => candidateCommits(view, worker) === 0 && worker.worktree !== null && (view.git.worktreeDirty[worker.worktree] ?? []).length === 0);
const passes = (view: RunView) => allWorkers(view).filter((worker) => /^PASS/.test(worker.finalText));

// ---- race rules

type Rule = 'first pass' | 'rank all' | 'best-of';
const ARMS = [
  { id: 'arm-a', model: 'sim/claude-sim', delay: 4, verdict: 'PASS', score: 7 },
  { id: 'arm-b', model: 'sim/grok-sim', delay: 1.5, verdict: 'PASS', score: 5 },
  { id: 'arm-c', model: 'sim/deepseek-sim', delay: 0, verdict: 'ISSUES', score: 9 },
];
const METHOD = '3 samples of node --test, one sample is one full run, in order';

function race(rule: Rule): Family {
  const id = `swarm-race-${rule.replace(' ', '-')}`;
  const runId = id;
  return {
    id,
    title: `swarm race, selection rule "${rule}": declared before the spawn, same brief for every arm, applied when aggregating (swarm Phase A step 2 and Phase C)`,
    spec: {
      family: id,
      runId,
      history: cartHistory,
      prompt: () => `/swarm race three arms on the same task and use the "${rule}" rule`,
      scenario: (ctx) => {
        const parent = new Parent(ctx);
        const workers: Record<string, Worker> = {};
        parent.readSkill('swarm').bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook feature --title "swarm race ${rule}" --run-id ${ctx.runId}`);
        phaseItems(parent, SWARM_PHASES);
        parent.task(`Race rule: ${rule}. Arms: ${ARMS.map((arm) => `${arm.id} on ${arm.model}`).join(', ')}.`);
        markPhase(parent, SWARM_PHASES[0] as string);
        const brief = `Goal: make sum(values) in src/sum.js the fastest correct version.\nScope: src/sum.js only, from commit ${ctx.base}.\nHow to verify: node --test at commit ${ctx.base}, ${METHOD}.\nReport: PASS or ISSUES with score=<ms> (lower is better), the commit SHA ${ctx.base} and the method you used.`;
        const staged = ARMS.map((arm) => parent.stage(arm.id, { role: 'general', model: arm.model, workspace: parent.worktree() }, brief));
        parent.fire(...staged);
        for (const arm of ARMS) {
          const report = `${arm.verdict} score=${arm.score} sha=${ctx.base} method=${METHOD}`;
          workers[arm.id] = writer(parent, arm.id, { before: arm.delay === 0 ? [] : [`sleep ${arm.delay}`], units: [{ files: { 'src/sum.js': `export const sum = (values) => values.reduce((total, value) => total + value, ${arm.score});\n` }, commit: `arm ${arm.id}` }], test: 'true', testKind: 'measurement', report });
        }
        markPhase(parent, SWARM_PHASES[1] as string);
        if (rule === 'first pass') parent.wait('arm-c').collect('arm-c').wait('arm-b').collect('arm-b').call('pstack_worker', { action: 'abort', runId: ctx.runId, workerId: 'arm-a' });
        else parent.wait('arm-a').wait('arm-b').wait('arm-c').collect('arm-a', 'arm-b', 'arm-c');
        markPhase(parent, SWARM_PHASES[2] as string);
        markPhase(parent, SWARM_PHASES[3] as string);
        const table = `| arm | result | score |\n| arm-a | ${rule === 'first pass' ? 'aborted' : 'PASS'} | ${rule === 'first pass' ? '-' : 7} |\n| arm-b | PASS | 5 |\n| arm-c | ISSUES | 9 |`;
        const reply = { 'first pass': `Race rule: first pass.\nWinner: arm-b, the first arm to report PASS. arm-c reported ISSUES first and did not count. arm-a was aborted after the winner.\n${table}\nGaps: none.`, 'rank all': `Race rule: rank all.\nRanking: 1. arm-a (7), 2. arm-b (5).\narm-c reported ISSUES and is not ranked.\n${table}\nGaps: none.`, 'best-of': `Race rule: best-of.\nBest: arm-a (7), the highest score among the passing arms. arm-b (5) and arm-c (ISSUES) were not chosen.\n${table}\nGaps: none.` }[rule];
        parent.text(reply);
        return scenario(parent, workers);
      },
    },
    checks: [
      phasesBeforeLaunch(`${id}.phases-before-launch`, src('swarm/SKILL.md', 'Add one `TODO.md` entry per phase'), SWARM_PHASE_PATTERNS),
      check(`${id}.rule-declared-before-spawning`, `the rule "${rule}" and each arm's model are written into TODO.md before the first worker is claimed`, FRAME_SRC, (view) => {
        const history = view.todoHistory[view.runs[0]?.id ?? ''] ?? [];
        const first = history.find((snapshot) => snapshot.text.includes(`Race rule: ${rule}.`) && allWorkers(view).length === 3 && allWorkers(view).every((arm) => snapshot.text.includes(`${arm.id} on ${String(assignmentOf(arm).model)}`)));
        const claim = Math.min(...view.claims.map((entry) => entry.seq));
        return when(first !== undefined && first.seq < claim, `declared at seq ${first?.seq}, first claim at seq ${claim}`, first === undefined ? 'no TODO.md names the rule and the arms' : `declared at seq ${first.seq}, after the first claim ${claim}`);
      }),
      spawnedTogether(`${id}.arms-spawned-together`, src('swarm/SKILL.md', 'Spawn all N workers one after another without waiting'), ['general']),
      check(`${id}.identical-briefs-and-named-models`, 'every arm has the same brief and runs on the model its TODO line names, three models', src('swarm/SKILL.md', 'For a model race, name each arm\'s model up front'), (view) => {
        const arms = allWorkers(view);
        const briefs = new Set(arms.map((worker) => worker.brief));
        const declared = (view.todoHistory[view.runs[0]?.id ?? ''] ?? []).find((snapshot) => snapshot.text.includes(`Race rule: ${rule}.`));
        const wrong = arms.filter((worker) => !declared?.text.includes(`${worker.id} on ${String(assignmentOf(worker).model)}`));
        return when(arms.length === 3 && briefs.size === 1 && wrong.length === 0 && new Set(arms.map((worker) => assignmentOf(worker).model)).size === 3, '3 arms, one brief, three named models', `${arms.length} arms, ${briefs.size} distinct briefs, wrong models: ${wrong.map((worker) => worker.id).join(', ')}`);
      }),
      worktreeIsolation(`${id}.separate-writable-outputs`, src('swarm/SKILL.md', 'Give each worker its own writable output when it writes')),
      check(`${id}.results-record-sha-and-method`, 'each arm that finished recorded the SHA and method its brief names', src('swarm/SKILL.md', 'Drop a result that does not record the SHAs and method its brief names'), (view) => {
        const done = allWorkers(view).filter((worker) => worker.finalText !== '');
        const bad = done.filter((worker) => !worker.finalText.includes(view.base) || !worker.finalText.includes(METHOD));
        return when(done.length >= 2 && bad.length === 0, `${done.length} results carry ${view.base.slice(0, 10)} and the method`, `without sha or method: ${bad.map((worker) => worker.id).join(', ')}`);
      }),
      check(`${id}.selection-follows-the-declared-rule`, rule === 'first pass' ? 'the winner is the first arm that settled with PASS by the workers\' own settle times, and the arm still running was aborted and not counted' : rule === 'rank all' ? 'every arm was collected and the ranking lists the passing arms by score, best first' : 'every arm was collected and the one winner is the highest score among passing arms', AGG_SRC, (view) => {
        const reply = finalReply(view);
        const arms = allWorkers(view);
        const byScore = passes(view).sort((a, b) => scoreOf(b) - scoreOf(a));
        if (rule === 'first pass') {
          const winner = passes(view).filter((worker) => !Number.isNaN(settleAt(worker))).sort((a, b) => settleAt(a) - settleAt(b))[0];
          const aborted = view.parent.toolCalls.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'abort' && !call.isError).map((call) => String(call.args['workerId']));
          const losers = arms.filter((worker) => worker.id !== winner?.id && !/^ISSUES/.test(worker.finalText));
          return when(winner !== undefined && reply.includes(`Winner: ${winner.id}`) && losers.every((worker) => aborted.includes(worker.id)), `first PASS to settle is ${winner?.id}; ${losers.map((worker) => worker.id).join(', ')} aborted`, `first PASS ${winner?.id}; reply names ${/Winner: (\S+)/.exec(reply)?.[1]}; aborted ${aborted.join(',')}`);
        }
        const allCollected = arms.every((worker) => collectOrder(view, worker.id) !== -1);
        if (rule === 'rank all') {
          const ranking = /Ranking:(.*)/.exec(reply)?.[1] ?? '';
          const order = [...ranking.matchAll(/\d+\.\s+([\w-]+)\s*\(/g)].map((match) => match[1]);
          return when(allCollected && JSON.stringify(order) === JSON.stringify(byScore.map((worker) => worker.id)), `ranking ${order.join(' > ')} matches the scores ${byScore.map((worker) => scoreOf(worker)).join(' > ')}`, `ranking ${order.join(',')} vs by score ${byScore.map((worker) => worker.id).join(',')}; all collected ${allCollected}`);
        }
        return when(allCollected && reply.includes(`Best: ${byScore[0]?.id}`), `best passing arm is ${byScore[0]?.id}`, `best passing ${byScore[0]?.id}; reply: ${/Best: (\S+)/.exec(reply)?.[1]}; all collected ${allCollected}`);
      }),
      check(`${id}.report-states-the-rule-and-gaps`, 'the report is one table with the race rule and the gaps, not raw worker dumps', src('swarm/SKILL.md', 'Return one consolidated in-chat report with a result table'), (view) => {
        const reply = finalReply(view);
        const dumps = allWorkers(view).filter((worker) => worker.finalText !== '' && reply.includes(worker.finalText));
        return when(reply.includes(`Race rule: ${rule}`) && allWorkers(view).length === 3 && allWorkers(view).every((worker) => reply.includes(`| ${worker.id} |`)) && /Gaps:/.test(reply) && dumps.length === 0, 'rule, table and gaps present, no pasted worker result', `reply: ${reply.slice(0, 120)}; pasted: ${dumps.map((worker) => worker.id).join(',')}`);
      }),
    ],
    negatives: [
      { name: 'the report names the wrong selection', mutate: (sandbox) => rewriteFinalReply(sandbox, rule === 'first pass' ? 'Winner: arm-b' : rule === 'rank all' ? '1. arm-a (7), 2. arm-b (5)' : 'Best: arm-a', rule === 'first pass' ? 'Winner: arm-a' : rule === 'rank all' ? '1. arm-b (5), 2. arm-a (7)' : 'Best: arm-c'), fails: [`${id}.selection-follows-the-declared-rule`] },
      { name: 'an arm had a different brief', mutate: (sandbox) => writeBrief(sandbox, runId, 'arm-b', 'Do something else.'), fails: [`${id}.identical-briefs-and-named-models`] },
      { name: 'an arm ran on a model the TODO did not name', mutate: (sandbox) => patchAssignment(sandbox, runId, 'arm-b', (assignment) => (assignment['model'] = 'sim/claude-sim')), fails: [`${id}.identical-briefs-and-named-models`] },
      { name: 'an arm\'s result lacks the SHA', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, runId, 'arm-b'), execFileSync('git', ['-C', join(sandbox, 'repo'), 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), 'none'), fails: [`${id}.results-record-sha-and-method`] },
      { name: 'the report omits the rule', mutate: (sandbox) => rewriteFinalReply(sandbox, `Race rule: ${rule}.`, 'Result.'), fails: [`${id}.report-states-the-rule-and-gaps`] },
    ],
  };
}

import { writeFileSync } from 'node:fs';

function writeBrief(sandbox: string, runId: string, workerId: string, text: string): void {
  writeFileSync(join(sandbox, 'repo/.pi/pstack/runs', runId, 'workers', workerId, 'brief.md'), text);
}

// ---- second miss and dropout

const SM_RUN = 'swarm-second-miss';
const SLICES = ['src/cart.js', 'src/money.js', 'src/checkout.js'];

const secondMiss: Family = {
  id: 'swarm-second-miss',
  title: 'swarm: a result that misses the SHA and method twice is respawned once, then recorded as a gap that is not a pass; a dropout leaves N-1 and is noted (swarm Phase B and C)',
  spec: {
    family: 'swarm-second-miss',
    runId: SM_RUN,
    history: cartHistory,
    prompt: () => '/swarm audit three files for rounding bugs, one slice per worker, and one extra slice for the checkout flow',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      parent.readSkill('swarm').bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook feature --title "swarm second miss" --run-id ${ctx.runId}`);
      phaseItems(parent, SWARM_PHASES);
      markPhase(parent, SWARM_PHASES[0] as string);
      const brief = (slice: string) => `Goal: audit ${slice} for rounding bugs.\nScope: only ${slice}, at commit ${ctx.base}.\nHow to verify: node --test at commit ${ctx.base}, ${METHOD}.\nReport: PASS, ISSUES or BLOCKED with evidence. Record the commit SHA and the method you used.`;
      const good = (slice: string) => `PASS ${slice}: audited at ${ctx.base}, method: ${METHOD}, no rounding issue.`;
      const bad = (slice: string) => `PASS ${slice}: looked fine.`;
      const ids = ['slice-1', 'slice-2', 'slice-3', 'slice-4'];
      const staged = ids.map((id, index) => parent.stage(id, { role: 'general', model: 'sim/deepseek-sim', workspace: parent.worktree() }, brief(SLICES[index] ?? 'src/extra.js')));
      parent.fire(...staged);
      workers['slice-1'] = writer(parent, 'slice-1', { units: [{ files: { 'audit/1.md': 'ok\n' }, commit: 'audit 1' }], test: 'true', report: good('src/cart.js') });
      workers['slice-2'] = writer(parent, 'slice-2', { units: [{ files: { 'audit/2.md': 'ok\n' }, commit: 'audit 2' }], test: 'true', report: good('src/money.js') });
      workers['slice-3'] = writer(parent, 'slice-3', { units: [{ files: { 'audit/3.md': 'ok\n' }, commit: 'audit 3' }], test: 'true', report: bad('src/checkout.js') });
      workers['slice-4'] = new Worker().bash('sleep 30').text('late');
      markPhase(parent, SWARM_PHASES[1] as string);
      parent.wait('slice-1').wait('slice-2').wait('slice-3').collect('slice-1', 'slice-2', 'slice-3');
      parent.spawn('slice-3b', { role: 'general', model: 'sim/deepseek-sim', workspace: parent.worktree() }, `${brief('src/checkout.js')}\nYour previous result for this slice did not record the commit SHA and the method, so it did not count. Record both.`);
      workers['slice-3b'] = writer(parent, 'slice-3b', { units: [{ files: { 'audit/3b.md': 'ok\n' }, commit: 'audit 3b' }], test: 'true', report: bad('src/checkout.js') });
      parent.wait('slice-3b').collect('slice-3b').call('pstack_worker', { action: 'abort', runId: ctx.runId, workerId: 'slice-4' });
      markPhase(parent, SWARM_PHASES[2] as string);
      markPhase(parent, SWARM_PHASES[3] as string);
      parent.text(`Result table
| slice | result | evidence |
| src/cart.js | PASS | slice-1 at ${ctx.base.slice(0, 10)} |
| src/money.js | PASS | slice-2 at ${ctx.base.slice(0, 10)} |
| src/checkout.js | GAP | two results, slice-3 and slice-3b, did not record the SHA or the method |
| extra flow | DROPOUT | slice-4 never finished |
Gaps and dropouts
- src/checkout.js is a gap after a second miss. A gap does not count as a pass, so coverage is incomplete.
- slice-4 dropped out and the swarm proceeded with 3 workers.
Race rule: none, this was a coverage partition.`);
      return scenario(parent, workers);
    },
  },
  checks: [
    phasesBeforeLaunch('swarm-second-miss.phases-before-launch', src('swarm/SKILL.md', 'Add one `TODO.md` entry per phase'), SWARM_PHASE_PATTERNS),
    check('swarm-second-miss.respawned-exactly-once', 'the slice whose result missed the SHA and method was respawned once, after the first result was collected, and never a third time', src('swarm/SKILL.md', 'respawn that worker once. After a second miss, record a gap'), (view) => {
      const workers = allWorkers(view).filter((worker) => /src\/checkout\.js/.test(worker.brief ?? '')).sort((a, b) => spawnOrder(view, a.id) - spawnOrder(view, b.id));
      const [initial, retry] = workers;
      if (workers.length !== 2 || initial === undefined || retry === undefined) return fail(`expected exactly two checkout attempts, got ${workers.length}`);
      const first = collectOrder(view, initial.id);
      const respawn = spawnOrder(view, retry.id);
      return when(first !== -1 && respawn > first, 'exactly two checkout attempts, the retry follows collection', `retry ${respawn}; first collect ${first}`);
    }),
    check('swarm-second-miss.miss-is-judged-from-the-result', 'both results of that slice really lack the SHA or the method, and the other slices carry both', src('swarm/SKILL.md', 'Drop a result that does not record the SHAs and method its brief names'), (view) => {
      const complete = (worker: WorkerView) => worker.finalText.includes(view.base) && worker.finalText.includes(METHOD);
      const checkout = allWorkers(view).filter((worker) => /src\/checkout\.js/.test(worker.brief ?? ''));
      const slices = ['src/cart.js', 'src/money.js'].map((file) => allWorkers(view).filter((worker) => (worker.brief ?? '').includes(file)));
      return when(checkout.length === 2 && checkout.every((worker) => !complete(worker)) && slices.every((workers) => workers.length === 1 && workers.every(complete)), 'two checkout misses and two complete independent slices', 'the recorded results do not split as expected');
    }),
    check('swarm-second-miss.gap-is-not-a-pass', 'the report records the second miss as a gap, never as PASS, and does not claim full coverage', src('swarm/SKILL.md', 'A gap does not count as a pass'), (view) => {
      const reply = finalReply(view);
      const row = /\| src\/checkout\.js \| (\w+)/.exec(reply)?.[1];
      return when(row === 'GAP' && /coverage is incomplete/i.test(reply) && !/all slices (pass|covered)|coverage is complete/i.test(reply), 'the checkout slice is a GAP and coverage is called incomplete', `row says ${row}; reply: ${reply.slice(0, 120)}`);
    }),
    check('swarm-second-miss.dropout-leaves-n-minus-one', 'a worker that never finished was aborted, the swarm proceeded with the rest and the report notes the dropout', src('swarm/SKILL.md', 'If a worker drops out, proceed with N-1 and note it.'), (view) => {
      const drops = allWorkers(view).filter((worker) => /src\/extra\.js/.test(worker.brief ?? ''));
      const [dropped] = drops;
      if (drops.length !== 1 || dropped === undefined) return fail(`expected one extra-flow worker, got ${drops.length}`);
      const aborted = view.parent.toolCalls.some((call) => call.name === 'pstack_worker' && call.args['action'] === 'abort' && call.args['workerId'] === dropped.id && !call.isError);
      const reply = finalReply(view);
      return when(aborted && dropped.finalText !== 'late' && reply.includes(`${dropped.id} dropped out`) && /proceeded with 3 workers/.test(reply), 'the extra-flow worker was aborted before answering and the report notes N-1', `aborted ${aborted}; final text ${dropped.finalText}; dropout ${dropped.id}`);
    }),
    check('swarm-second-miss.report-is-consolidated', 'one result table with gaps and dropouts, no pasted worker result', src('swarm/SKILL.md', 'Return one consolidated in-chat report with a result table, issue one-liners, gaps or dropouts'), (view) => {
      const reply = finalReply(view);
      const pasted = allWorkers(view).filter((worker) => worker.finalText !== '' && reply.includes(worker.finalText));
      return when(/Result table/.test(reply) && /Gaps and dropouts/.test(reply) && pasted.length === 0, 'table and gap section, nothing pasted', `pasted ${pasted.map((worker) => worker.id).join(',')}`);
    }),
  ],
  negatives: [
    { name: 'the slice was respawned a third time', mutate: (sandbox) => cpSync(join(sandbox, 'repo/.pi/pstack/runs', SM_RUN, 'workers/slice-3b'), join(sandbox, 'repo/.pi/pstack/runs', SM_RUN, 'workers/slice-3c'), { recursive: true }), fails: ['swarm-second-miss.respawned-exactly-once'] },
    { name: 'the second miss was reported as a pass', mutate: (sandbox) => rewriteFinalReply(sandbox, '| src/checkout.js | GAP |', '| src/checkout.js | PASS |'), fails: ['swarm-second-miss.gap-is-not-a-pass'] },
    { name: 'the report claims full coverage', mutate: (sandbox) => rewriteFinalReply(sandbox, 'coverage is incomplete', 'coverage is complete'), fails: ['swarm-second-miss.gap-is-not-a-pass'] },
    { name: 'the dropout was not noted', mutate: (sandbox) => rewriteFinalReply(sandbox, 'slice-4 dropped out', 'slice-4 was fine'), fails: ['swarm-second-miss.dropout-leaves-n-minus-one'] },
    { name: 'the first result had carried the SHA and method', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, SM_RUN, 'slice-3'), 'looked fine.', `audited at ${execFileSync('git', ['-C', join(sandbox, 'repo'), 'rev-parse', 'main'], { encoding: 'utf8' }).trim()}, method: ${METHOD}`), fails: ['swarm-second-miss.miss-is-judged-from-the-result'] },
  ],
};

// ---- arena dropout

const AR_RUN = 'arena-dropout';
const ARENA_PHASES = ['Arena Frame', 'Arena Fan out', 'Arena Cross-judge', 'Arena Pick', 'Arena Graft', 'Arena Verify'];
const AR_TASK = 'Produce src/pad.js exporting pad(value, width) that left-pads with zeros, and test/pad.test.js.';
const PAD = "export const pad = (value, width) => String(value).padStart(width, '0');\n";
const PAD_TEST = "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { pad } from '../src/pad.js';\n\ntest('pads', () => assert.equal(pad(7, 3), '007'));\n";

const arenaDropout: Family = {
  id: 'arena-dropout',
  title: 'arena: a candidate that produces no output is a dropout, the arena proceeds with N-1, the judge sees only the survivors and the note names the dropout (arena Phase B)',
  spec: {
    family: 'arena-dropout',
    runId: AR_RUN,
    history: cartHistory,
    prompt: () => `/arena ${AR_TASK}`,
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      parent.readSkill('arena').bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook feature --title "arena dropout" --run-id ${ctx.runId}`);
      phaseItems(parent, ARENA_PHASES);
      markPhase(parent, ARENA_PHASES[0] as string);
      const ids = ['candidate-1', 'candidate-2', 'candidate-3'];
      const models = ['sim/claude-sim', 'sim/grok-sim', 'sim/claude-sim'];
      const staged = ids.map((id, index) => parent.stage(id, { role: 'candidate', model: models[index] as string, workspace: parent.worktree() }, `${AR_TASK}\nWork only inside your worktree ${worktreeOf(parent, id)}. Commit your work. Report a short rationale.`));
      parent.fire(...staged);
      for (const id of ids.slice(0, 2)) workers[id] = writer(parent, id, { units: [{ files: { 'src/pad.js': PAD, 'test/pad.test.js': PAD_TEST }, commit: `candidate ${id}` }], test: 'node --test', report: `Rationale for ${id}: padStart, rejected a manual loop.` });
      workers['candidate-3'] = new Worker().text('I could not produce anything for this task.');
      markPhase(parent, ARENA_PHASES[1] as string);
      for (const id of ids) parent.wait(id);
      parent.collect(...ids);
      const survivors = ids.slice(0, 2);
      parent.spawn('judge', { role: 'judge', model: 'sim/grok-sim', workspace: parent.readonly() }, `Rubric:\n- pad returns a string of at least width characters\n- a test covers padding\n- the signature is pad(value, width)\n\nCandidates by path label:\n${survivors.map((id) => `- ${id}: ${worktreeOf(parent, id)}`).join('\n')}`);
      workers['judge'] = new Worker().read(join(worktreeOf(parent, 'candidate-1'), 'src/pad.js')).text('Both survivors satisfy the rubric. Recommended base: candidate-1.');
      parent.wait('judge').collect('judge');
      markPhase(parent, ARENA_PHASES[2] as string);
      for (const id of survivors) parent.read(join(worktreeOf(parent, id), 'src/pad.js')).read(join(worktreeOf(parent, id), 'test/pad.test.js'));
      markPhase(parent, ARENA_PHASES[3] as string);
      const synth = join(ctx.sandbox, 'arena-synth');
      for (const [path, content] of Object.entries({ 'package.json': '{"type":"module","scripts":{"test":"node --test"}}\n', 'src/pad.js': PAD, 'test/pad.test.js': PAD_TEST })) parent.write(join(synth, path), content);
      markPhase(parent, ARENA_PHASES[4] as string);
      parent.proof({ id: 'arena-verify', target: 'arena-verify', command: 'node --test', cwd: synth, kind: 'test' });
      markPhase(parent, ARENA_PHASES[5] as string);
      parent.text('Base: candidate-1. Cross-judge: the judge recommended candidate-1 over candidate-2.\nGrafts: none, the survivors converged on padStart.\nRejected: nothing.\nDropouts: candidate-3 produced no output, so the arena proceeded with 2 candidates.\nVerification: node --test passes on the synthesized artifact, receipt arena-verify.');
      return scenario(parent, workers);
    },
  },
  checks: [
    phasesBeforeLaunch('arena-dropout.phases-before-launch', src('arena/SKILL.md', 'Add one `TODO.md` entry per phase'), ARENA_PHASES.map((phase) => new RegExp(phase))),
    check('arena-dropout.the-dropout-left-nothing', 'candidate-3 left no commit and no file in its worktree, while the other two committed', src('arena/SKILL.md', 'If a candidate produces no output, proceed with N-1 and note the dropout.'), (view) => {
      const candidates = arenaCandidates(view);
      const dropouts = arenaDropouts(view);
      return when(candidates.length === 3 && dropouts.length === 1 && candidates.filter((worker) => candidateCommits(view, worker) >= 1).length === 2, 'one empty clean candidate and two committed survivors', `dropouts ${dropouts.map((worker) => worker.id).join(',')}`);
    }),
    check('arena-dropout.judge-sees-only-the-survivors', 'the judge is spawned after all three candidates were collected, and its brief labels only the two that produced output', src('arena/SKILL.md', 'The judge sees the rubric and the candidates by path label'), (view) => {
      const judges = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'judge');
      const candidates = arenaCandidates(view);
      const dropouts = arenaDropouts(view);
      const [judge] = judges;
      if (judges.length !== 1 || judge === undefined || candidates.length !== 3 || dropouts.length !== 1) return fail('expected one judge, two survivors and one dropout');
      const labels = [...(judge.brief ?? '').matchAll(/^- ([\w-]+): (.+)$/gm)];
      const survivors = candidates.filter((worker) => !dropouts.includes(worker));
      const collects = candidates.map((worker) => collectOrder(view, worker.id));
      return when(labels.length === 2 && survivors.every((worker) => labels.some((label) => label[1] === worker.id && label[2] === worker.worktree)) && collects.every((at) => at !== -1) && spawnOrder(view, judge.id) > Math.max(...collects), 'only two surviving paths labeled after all candidate collects', `labels ${labels.map((label) => label[1]).join(',')}`);
    }),
    check('arena-dropout.not-respawned-and-not-waited-on', 'no replacement candidate was spawned, and exactly three candidates exist', src('arena/SKILL.md', 'proceed with N-1'), (view) => {
      const candidates = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'candidate');
      return when(candidates.length === 3, '3 candidates, no respawn', `${candidates.map((worker) => worker.id).join(', ')}`);
    }),
    check('arena-dropout.parent-read-only-survivors', 'the parent read both surviving candidates and did not read the dropout\'s empty tree', src('arena/SKILL.md', 'Read every candidate end to end before picking'), (view) => {
      const dropouts = arenaDropouts(view);
      const candidates = arenaCandidates(view);
      const read = (worker: WorkerView) => view.parent.toolCalls.some((call) => call.name === 'read' && call.args['path'] === `${worker.worktree}/src/pad.js`);
      return when(candidates.length === 3 && dropouts.length === 1 && candidates.every((worker) => read(worker) === !dropouts.includes(worker)), 'only the two survivors were read', `dropouts ${dropouts.map((worker) => worker.id).join(',')}`);
    }),
    check('arena-dropout.note-names-the-dropout', 'the synthesis note names the dropout and the count it proceeded with, and the base is a survivor', src('arena/SKILL.md', 'any convergence or dropouts'), (view) => {
      const reply = finalReply(view);
      const base = /Base: ([\w-]+)/.exec(reply)?.[1];
      const dropouts = arenaDropouts(view);
      const survivors = arenaCandidates(view).filter((worker) => candidateCommits(view, worker) >= 1);
      return when(dropouts.length === 1 && survivors.length === 2 && dropouts.every((worker) => reply.includes(`Dropouts: ${worker.id} produced no output`)) && /proceeded with 2 candidates/.test(reply) && survivors.some((worker) => worker.id === base), `note names the dropout and two survivors; base ${base}`, `reply: ${reply.slice(0, 200)}`);
    }),
    check('arena-dropout.synthesis-verified', 'a passing test receipt verifies the synthesized artifact', src('arena/SKILL.md', 'Verify the synthesized artifact like any other output'), (view) => when(view.runs[0]?.receipts.some((receipt) => receipt.target === 'arena-verify' && receipt.kind === 'test' && receipt.verdict === 'pass') === true, 'receipt arena-verify passes', 'no passing arena-verify receipt')),
  ],
  negatives: [
    { name: 'the judge was shown the dropout', mutate: (sandbox) => writeBrief(sandbox, AR_RUN, 'judge', 'Candidates by path label:\n- candidate-1: /a\n- candidate-2: /b\n- candidate-3: /c'), fails: ['arena-dropout.judge-sees-only-the-survivors'] },
    { name: 'the note forgot the dropout', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Dropouts: candidate-3 produced no output', 'Dropouts: none'), fails: ['arena-dropout.note-names-the-dropout'] },
    { name: 'the dropout was replaced by a new candidate', mutate: (sandbox) => cpSync(join(sandbox, 'repo/.pi/pstack/runs', AR_RUN, 'workers/candidate-2'), join(sandbox, 'repo/.pi/pstack/runs', AR_RUN, 'workers/candidate-4'), { recursive: true }), fails: ['arena-dropout.not-respawned-and-not-waited-on'] },
    { name: 'the dropout had actually committed', mutate: (sandbox) => patchGit(sandbox, (git) => ((git['branchCommits'] as Record<string, string[]>)[`pstack-run/${AR_RUN}/candidate-3`] = ['deadbeef'])), fails: ['arena-dropout.the-dropout-left-nothing'] },
  ],
};

export const swarmRuleFamilies: Family[] = [race('first pass'), race('rank all'), race('best-of'), secondMiss, arenaDropout];
void [fail, appendToolCall, parentSession, worktreeOf, SCRIPTED_ROLES, writeBrief, rewriteSession];
