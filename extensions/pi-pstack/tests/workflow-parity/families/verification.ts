// Families: verify-this, statechart, create-formal-verification-skill, create-verification-skill (spec 12.4).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Parent, scenario } from '../fixtures/dsl.ts';
import { couponHistory, fixedHistory } from '../fixtures/repos.ts';
import { check, fail, src, when } from '../lib/check.ts';
import { finalReply, parentReads, promptRoutes, repoUntouched, runAtCommit } from '../lib/checks.ts';
import { PKG } from '../lib/driver.ts';
import { dirtyRepo, parentSession, rewriteFinalReply } from '../lib/mutate.ts';
import type { RunView } from '../lib/view.ts';
import type { Family } from './types.ts';

const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const shell = (cwd: string, command: string) => spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', timeout: 90_000 });

// ---- verify-this

const REPRO = `node --input-type=module -e "import('./src/cart.js').then((m)=>{const t=m.total([{price:10,qty:1}],150);console.log('total='+t);process.exit(t<0?1:0)})"`;
const VERIFY_SLUG = 'coupon-over-100';

const verifyDir = (view: RunView): string => {
  const hit = view.parent.toolCalls.map((call) => /([^\s"\\]*\/tmp\/verify-this\/[\w-]+)/.exec(JSON.stringify(call.args))?.[1]).find((path) => path !== undefined);
  return hit ?? '';
};

export const verifyThisFamily: Family = {
  id: 'verify-this',
  title: 'verify-this: a falsifiable claim, baseline and treatment on the same command, raw artifacts, one verdict the checker re-derives (spec 12.4)',
  spec: {
    family: 'verify-this',
    runId: 'verify-this-unused',
    history: fixedHistory,
    prompt: () => '/verify-this the coupon fix: after it, a 150 percent coupon on a 10 dollar cart no longer makes the total negative',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const dir = join(ctx.sandbox, 'tmp', 'verify-this', VERIFY_SLUG);
      const treatment = ctx.base;
      const baseline = ctx.commits.at(-2) as string;
      const side = (name: string, sha: string) => `mkdir -p ${dir}/${name}/tree && git -C ${ctx.repo} archive ${sha} | tar -x -C ${dir}/${name}/tree && echo ${sha} > ${dir}/${name}/commit.txt && echo ${JSON.stringify(REPRO)} > ${dir}/${name}/command.txt && ( cd ${dir}/${name}/tree && ${REPRO} > ${dir}/${name}/output.txt 2>&1; echo "exit=$?" >> ${dir}/${name}/output.txt ); true`;
      parent
        .readSkill('verify-this')
        .write(join(dir, 'claim.md'), `Claim: after ${treatment.slice(0, 12)}, total([{price:10,qty:1}], 150) is not negative.\nCondition: a 150 percent coupon on a 10 dollar cart.\nMetric: the total the repro prints, and its exit status.\nThreshold: total is at least 0.\n`)
        .write(join(dir, 'timeline.md'), `baseline ${baseline.slice(0, 12)} then treatment ${treatment.slice(0, 12)}, same command, same data.\n`)
        .bash(side('baseline', baseline))
        .bash(side('treatment', treatment))
        .bash(`mkdir -p ${dir}/diff && diff -u ${dir}/baseline/output.txt ${dir}/treatment/output.txt > ${dir}/diff/output.diff; true`)
        .write(join(dir, 'verdict.md'), 'VERIFIED\n')
        .text('VERIFIED\nClaim: after the fix, a 150 percent coupon on a 10 dollar cart gives a total of at least 0.\n\nEvidence:\ntotal: baseline=-5, treatment=0, delta=5, threshold=>=0\n\nReasoning:\nThe same command ran on the parent commit and on the fix commit with the same data. Only the code changed, and the total moved from negative to zero.');
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('verify-this'),
    parentReads('verify-this.reads-skill', 'the parent opens the verify-this skill', src('verify-this/SKILL.md', '# Verify This'), ['verify-this']),
    check('verify-this.artifact-layout', 'the claim directory holds claim.md, timeline.md, baseline/, treatment/, diff/ and verdict.md', src('verify-this/SKILL.md', '/tmp/verify-this/<claim-slug>/'), (view) => {
      const dir = verifyDir(view);
      const missing = ['claim.md', 'timeline.md', 'baseline', 'treatment', 'diff', 'verdict.md'].filter((name) => !existsSync(join(dir, name)));
      return when(dir !== '' && missing.length === 0, `${dir} has the full layout`, `${dir || '(no verify-this directory)'} lacks ${missing.join(', ')}`);
    }),
    check('verify-this.claim-is-falsifiable', 'the claim states a condition, a metric, and a threshold', src('verify-this/SKILL.md', 'Restate the claim in falsifiable form: condition, metric, and threshold'), (view) => {
      const claim = read(join(verifyDir(view), 'claim.md'));
      const missing = ['Condition:', 'Metric:', 'Threshold:'].filter((word) => !claim.includes(word));
      return when(missing.length === 0, 'claim.md names condition, metric and threshold', `claim.md lacks ${missing.join(', ')}`);
    }),
    check('verify-this.baseline-is-the-old-state-same-command', 'the baseline is the parent commit, the treatment is the changed commit, and both ran the same command', src('verify-this/SKILL.md', 'Capture treatment from the changed state with the same command, data, warmup, and environment'), (view) => {
      const dir = verifyDir(view);
      const [baseline = '', treatment = ''] = ['baseline', 'treatment'].map((name) => read(join(dir, name, 'commit.txt')).trim());
      const [a = '', b = ''] = ['baseline', 'treatment'].map((name) => read(join(dir, name, 'command.txt')).trim());
      const parentOfTreatment = shell(view.repo, `git rev-parse ${treatment}^`).stdout.trim();
      return when(treatment === view.base && baseline === parentOfTreatment && a !== '' && a === b, `baseline ${baseline?.slice(0, 8)} is the parent of treatment ${treatment?.slice(0, 8)}; one command`, `baseline ${baseline}, parent of treatment ${parentOfTreatment}, commands equal: ${a === b}`);
    }),
    check('verify-this.raw-artifacts-compared', 'raw output exists for both sides and the diff holds their difference', src('verify-this/SKILL.md', 'Compare raw artifacts'), (view) => {
      const dir = verifyDir(view);
      const [a = '', b = ''] = ['baseline', 'treatment'].map((name) => read(join(dir, name, 'output.txt')));
      const diff = read(join(dir, 'diff', 'output.diff'));
      return when(/total=/.test(a) && /total=/.test(b) && a !== b && diff.includes('-total=') && diff.includes('+total='), `baseline ${a.split('\n')[0]}, treatment ${b.split('\n')[0]}, diff ${diff.split('\n').length} lines`, `baseline ${JSON.stringify(a)}, treatment ${JSON.stringify(b)}, diff ${JSON.stringify(diff.slice(0, 80))}`);
    }),
    check('verify-this.one-verdict-and-it-is-the-true-one', 'exactly one verdict is returned, the reply and verdict.md agree, and it equals what the checker derives by running the command on both commits itself', src('verify-this/SKILL.md', 'Return exactly one verdict'), (view) => {
      const dir = verifyDir(view);
      const verdict = read(join(dir, 'verdict.md')).trim().split('\n')[0] ?? '';
      const reply = finalReply(view);
      const first = reply.split('\n')[0]?.trim() ?? '';
      const before = runAtCommit(view, read(join(dir, 'baseline', 'commit.txt')).trim(), REPRO);
      const after = runAtCommit(view, read(join(dir, 'treatment', 'commit.txt')).trim(), REPRO);
      const derived = before.status !== 0 && after.status === 0 ? 'VERIFIED' : before.status === 0 && after.status === 0 ? 'NOT VERIFIED' : 'INCONCLUSIVE';
      return when(['VERIFIED', 'NOT VERIFIED', 'INCONCLUSIVE'].includes(verdict) && verdict === first && verdict === derived, `verdict ${verdict}; baseline exit ${before.status}, treatment exit ${after.status}`, `verdict.md ${verdict}, reply ${first}, derived ${derived} (baseline exit ${before.status}, treatment exit ${after.status})`);
    }),
    check('verify-this.output-shape', 'the reply has the verdict line, Claim, an Evidence line with baseline, treatment, delta and threshold, and Reasoning', src('verify-this/SKILL.md', 'Use this shape'), (view) => {
      const reply = finalReply(view);
      return when(/^(VERIFIED|NOT VERIFIED|INCONCLUSIVE)\n/.test(reply) && /^Claim: \S/m.test(reply) && /baseline=\S+, treatment=\S+, delta=\S+, threshold=\S+/.test(reply) && /^Reasoning:\n\S/m.test(reply), 'reply has the four parts', `reply: ${reply.slice(0, 160)}`);
    }),
    repoUntouched('verify-this.leaves-the-repository-alone', 'verification changes nothing in the repository', src('verify-this/SKILL.md', 'Verification is not a recap')),
  ],
  negatives: [
    { name: 'the verdict was upgraded without the evidence', mutate: (sandbox) => verdictTo(sandbox, 'NOT VERIFIED'), fails: ['verify-this.one-verdict-and-it-is-the-true-one'] },
    { name: 'a clear verdict was softened to inconclusive', mutate: (sandbox) => verdictTo(sandbox, 'INCONCLUSIVE'), fails: ['verify-this.one-verdict-and-it-is-the-true-one'] },
    { name: 'the baseline is not the old state', mutate: (sandbox) => writeFileSync(join(sandbox, 'tmp/verify-this', VERIFY_SLUG, 'baseline/commit.txt'), 'deadbeef\n'), fails: ['verify-this.baseline-is-the-old-state-same-command'] },
    { name: 'the treatment used another command', mutate: (sandbox) => writeFileSync(join(sandbox, 'tmp/verify-this', VERIFY_SLUG, 'treatment/command.txt'), 'node --test\n'), fails: ['verify-this.baseline-is-the-old-state-same-command'] },
    { name: 'the diff directory is empty', mutate: (sandbox) => writeFileSync(join(sandbox, 'tmp/verify-this', VERIFY_SLUG, 'diff/output.diff'), ''), fails: ['verify-this.raw-artifacts-compared'] },
    { name: 'the claim has no threshold', mutate: (sandbox) => writeFileSync(join(sandbox, 'tmp/verify-this', VERIFY_SLUG, 'claim.md'), 'Claim: it works.\n'), fails: ['verify-this.claim-is-falsifiable'] },
    { name: 'the timeline file is missing', mutate: (sandbox) => rmSync(join(sandbox, 'tmp/verify-this', VERIFY_SLUG, 'timeline.md')), fails: ['verify-this.artifact-layout'] },
    { name: 'the reply dropped the evidence line', mutate: (sandbox) => rewriteFinalReply(sandbox, /baseline=\S+, treatment=\S+, delta=\S+, threshold=\S+/, 'it moved'), fails: ['verify-this.output-shape'] },
    { name: 'the repository was edited', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['verify-this.leaves-the-repository-alone'] },
  ],
};

function verdictTo(sandbox: string, verdict: string): void {
  writeFileSync(join(sandbox, 'tmp/verify-this', VERIFY_SLUG, 'verdict.md'), `${verdict}\n`);
  rewriteFinalReply(sandbox, /^VERIFIED/, verdict);
}

// ---- statechart

const PAY_TLA = `---- MODULE Pay ----
EXTENDS Naturals
VARIABLES phase, captured
vars == <<phase, captured>>
Init == phase = "idle" /\\ captured = FALSE
Authorize == phase = "idle" /\\ phase' = "authorized" /\\ UNCHANGED captured
Capture == phase = "authorized" /\\ phase' = "paid" /\\ captured' = TRUE
Refund == phase \\in {"authorized", "paid"} /\\ phase' = "refunded" /\\ UNCHANGED captured
Done == phase \\in {"paid", "refunded"} /\\ UNCHANGED vars
Next == Authorize \\/ Capture \\/ Refund \\/ Done
Spec == Init /\\ [][Next]_vars
RefundOnlyAfterCapture == phase = "refunded" => captured
====
`;
const PAY_CFG = 'SPECIFICATION Spec\nINVARIANT RefundOnlyAfterCapture\n';
const PAY_VIEW = `export const title = 'Payment';
export const state = (v) => (v.phase === 'idle' ? 'Idle' : v.phase === 'authorized' ? 'Card authorized' : v.phase === 'paid' ? 'Paid' : 'Refunded');
export const step = (action) => ({ Authorize: 'you authorize the card', Capture: 'the store captures the payment', Refund: 'you ask for a refund', Done: null })[action] ?? null;
`;
const STATECHART = join(PKG, 'generated/skills/statechart/scripts/statechart');

/** Runs the real statechart command once at scenario build time, so the hand-off can quote its real output. */
function statechartOutput(): { chart: string; report: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wf-statechart-'));
  try {
    writeFileSync(join(dir, 'Pay.tla'), PAY_TLA);
    writeFileSync(join(dir, 'Pay.cfg'), PAY_CFG);
    writeFileSync(join(dir, 'view.mjs'), PAY_VIEW);
    shell(dir, `${STATECHART} Pay.tla --config Pay.cfg --view view.mjs --out out`);
    return { chart: read(join(dir, 'out', 'chart.mmd')), report: read(join(dir, 'out', 'report.md')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const scratchOf = (view: RunView): string => /Scratch folder: (\/\S+)/.exec(finalReply(view))?.[1] ?? '';

export const statechartFamily: Family = {
  id: 'statechart',
  title: 'statechart: the TLC model checker really runs, rules stay invariants, the chart and report reproduce, bug paths are handed off (spec 12.4)',
  requires: 'tlc',
  spec: {
    family: 'statechart',
    runId: 'statechart-unused',
    history: fixedHistory,
    prompt: () => '/statechart a card payment goes idle, authorized, paid, and may be refunded; a refund must only follow a capture',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const scratch = join(ctx.sandbox, 'scratch', 'pay');
      const { chart, report } = statechartOutput();
      const command = `${STATECHART} Pay.tla --config Pay.cfg --view view.mjs --out out`;
      parent
        .readSkill('statechart')
        .write(join(scratch, 'Pay.tla'), PAY_TLA)
        .write(join(scratch, 'Pay.cfg'), PAY_CFG)
        .write(join(scratch, 'view.mjs'), PAY_VIEW)
        .bash(`cd ${scratch} && ${command}`)
        .read(join(scratch, 'out', 'report.md'))
        .read(join(scratch, 'out', 'chart.mmd'))
        .text(`Scratch folder: ${scratch}\n\n\`\`\`mermaid\n${chart.trim()}\n\`\`\`\n\nBug: RefundOnlyAfterCapture. A refund can happen on a card that was only authorized. The shortest path is path 1 in the report: Idle, you authorize the card, you ask for a refund.\n\nThe model leaves out partial refunds and expiry. The chart hides the Done steps.\n\nTo make the files again, run \`cd ${scratch} && ${STATECHART} Pay.tla --config Pay.cfg --view view.mjs --out out-again\`.\n\n${report.split('\n').slice(0, 3).join(' ')}`);
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('statechart'),
    parentReads('statechart.reads-skill', 'the parent opens the statechart skill', src('statechart/SKILL.md', '# Statechart'), ['statechart']),
    check('statechart.scratch-outside-the-repo', 'the spec, config and view live in a scratch folder outside the repository', src('statechart/SKILL.md', 'Work in a scratch folder outside the repo'), (view) => {
      const scratch = scratchOf(view);
      return when(scratch !== '' && !scratch.startsWith(view.repo) && existsSync(join(scratch, 'Pay.tla')) && view.git.dirty.length === 0, `scratch ${scratch}`, `scratch ${scratch}; dirty ${view.git.dirty.join(', ') || 'none'}`);
    }),
    check('statechart.next-is-a-disjunction-and-rule-is-an-invariant', 'Next is a disjunction of the actions, and the rule the reader agreed to is an INVARIANT in the config and defined in the spec', src('statechart/SKILL.md', 'Write each rule that the reader agrees to as an INVARIANT'), (view) => {
      const scratch = scratchOf(view);
      const spec = read(join(scratch, 'Pay.tla'));
      const cfg = read(join(scratch, 'Pay.cfg'));
      return when(/^Next == .*\\\/.*$/m.test(spec) && /^INVARIANT RefundOnlyAfterCapture$/m.test(cfg) && /^RefundOnlyAfterCapture ==/m.test(spec), 'Next is a disjunction, the rule is an INVARIANT and is defined', `Next disjunction ${/^Next == .*\\\/.*$/m.test(spec)}, cfg ${JSON.stringify(cfg)}`);
    }),
    check('statechart.model-checker-really-ran', 'tlc.out is real TLC output: its banner, the model and the violation it found', src('statechart/SKILL.md', '`tlc.out` is what TLC printed'), (view) => {
      const out = read(join(scratchOf(view), 'out', 'tlc.out'));
      return when(/^TLC2 Version/m.test(out) && /Invariant RefundOnlyAfterCapture is violated/.test(out), 'tlc.out has the TLC banner and the violated invariant', `tlc.out starts: ${out.slice(0, 120)}`);
    }),
    check('statechart.report-has-the-shortest-bug-path', 'the report names the broken rule and its shortest path from the start, in the reader\'s words', src('statechart/SKILL.md', 'The report gives the shortest path to each state that breaks a rule'), (view) => {
      const report = read(join(scratchOf(view), 'out', 'report.md'));
      return when(/## RefundOnlyAfterCapture breaks/.test(report) && /The shortest path has 2 steps/.test(report) && /1\. you authorize the card/.test(report) && /2\. you ask for a refund/.test(report), 'report lists the rule and the two-step path', `report: ${report.slice(0, 200)}`);
    }),
    check('statechart.chart-is-mermaid-and-marks-the-bug', 'chart.mmd is a Mermaid state diagram that marks the state that breaks the rule and stays small', src('statechart/SKILL.md', 'Show `chart.mmd` to the user as a `mermaid` code block'), (view) => {
      const chart = read(join(scratchOf(view), 'out', 'chart.mmd'));
      const arrows = (chart.match(/-->/g) ?? []).length;
      return when(/stateDiagram-v2/.test(chart) && /class s\d+ (mayBreak|breaks)/.test(chart) && arrows <= 20 && !/\b(phase|captured)\b/.test(chart.replace(/RefundOnlyAfterCapture/g, '')), `${arrows} arrows, a broken state is marked, no variable names in labels`, `chart: ${chart.slice(0, 160)}`);
    }),
    check('statechart.command-reproduces-the-chart-and-report', 'running the same command again produces the identical chart and report', src('statechart/SKILL.md', 'Give the command that makes the files again, with a new `--out` folder'), (view) => {
      const scratch = scratchOf(view);
      const again = mkdtempSync(join(tmpdir(), 'wf-again-'));
      try {
        const run = shell(scratch, `${STATECHART} Pay.tla --config Pay.cfg --view view.mjs --out ${again}/out`);
        const same = ['chart.mmd', 'report.md'].every((file) => read(join(again, 'out', file)) === read(join(scratch, 'out', file)) && read(join(scratch, 'out', file)) !== '');
        return when(same, 'chart.mmd and report.md are byte-identical on a second run', `second run exit ${run.status}; files differ from the recorded run`);
      } finally {
        rmSync(again, { recursive: true, force: true });
      }
    }),
    check('statechart.hand-off', 'the hand-off quotes the chart as a mermaid block, names each bug as rule plus path, says what the model leaves out, and gives the command with a new --out', src('statechart/SKILL.md', '## Hand off'), (view) => {
      const reply = finalReply(view);
      const chart = read(join(scratchOf(view), 'out', 'chart.mmd'));
      const block = /```mermaid\n([\s\S]*?)\n```/.exec(reply)?.[1] ?? '';
      const outs = [...reply.matchAll(/--out ([\w./-]+)/g)].map((match) => match[1]);
      return when(block.trim() === chart.trim() && /RefundOnlyAfterCapture/.test(reply) && /path 1/.test(reply) && /leaves out/i.test(reply) && outs.length > 0 && outs.some((out) => out !== 'out'), 'the hand-off has the chart, the bug and its path, the omissions, and a command with a new out folder', `block matches chart: ${block.trim() === chart.trim()}; outs ${outs.join(', ')}`);
    }),
  ],
  negatives: [
    { name: 'the chart was drawn without running the model checker', mutate: (sandbox) => rmSync(join(sandbox, 'scratch/pay/out/tlc.out')), fails: ['statechart.model-checker-really-ran'] },
    { name: 'the chart does not match what the checker computes', mutate: (sandbox) => writeFileSync(join(sandbox, 'scratch/pay/out/chart.mmd'), read(join(sandbox, 'scratch/pay/out/chart.mmd')).replace('Card authorized', 'Mystery')), fails: ['statechart.command-reproduces-the-chart-and-report'] },
    { name: 'the rule was weakened to make it hold', mutate: (sandbox) => writeFileSync(join(sandbox, 'scratch/pay/Pay.cfg'), 'SPECIFICATION Spec\n'), fails: ['statechart.next-is-a-disjunction-and-rule-is-an-invariant', 'statechart.command-reproduces-the-chart-and-report'] },
    { name: 'Next names no actions', mutate: (sandbox) => writeFileSync(join(sandbox, 'scratch/pay/Pay.tla'), read(join(sandbox, 'scratch/pay/Pay.tla')).replace('Next == Authorize \\/ Capture \\/ Refund \\/ Done', 'Next == TRUE')), fails: ['statechart.next-is-a-disjunction-and-rule-is-an-invariant'] },
    { name: 'the report lost the bug path', mutate: (sandbox) => writeFileSync(join(sandbox, 'scratch/pay/out/report.md'), '# Pay\n\nNothing broke.\n'), fails: ['statechart.report-has-the-shortest-bug-path', 'statechart.command-reproduces-the-chart-and-report'] },
    { name: 'the spec was written into the repository', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['statechart.scratch-outside-the-repo'] },
    { name: 'the hand-off dropped the regenerate command', mutate: (sandbox) => rewriteFinalReply(sandbox, '--out out-again', '--out out'), fails: ['statechart.hand-off'] },
    { name: 'the hand-off dropped the omissions', mutate: (sandbox) => rewriteFinalReply(sandbox, 'leaves out', 'covers'), fails: ['statechart.hand-off'] },
    { name: 'a variable name leaked into a label', mutate: (sandbox) => writeFileSync(join(sandbox, 'scratch/pay/out/chart.mmd'), `${read(join(sandbox, 'scratch/pay/out/chart.mmd'))}\n  s0: phase idle\n`), fails: ['statechart.chart-is-mermaid-and-marks-the-bug'] },
  ],
};

// ---- create-formal-verification-skill

const SKILL_DIR = '.pi/skills/verify-coupon';
const CHECK_MJS = `import { clampPercent } from '../../../src/coupon.js';

const inputs = [-1e9, -100.5, -1, -0.0001, 0, 0.0001, 1, 50, 99.999, 100, 100.0001, 101, 150, 1e9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
let broken = 0;
for (const input of inputs) {
  const output = clampPercent(input);
  const ok = typeof output === 'number' && output >= 0 && output <= 100;
  if (!ok) {
    broken += 1;
    console.log('COUNTEREXAMPLE clampPercent(' + String(input) + ') returned ' + String(output));
  }
}
console.log('checked ' + inputs.length + ' inputs, ' + broken + ' violations');
process.exit(broken === 0 ? 0 : 1);
`;

const skillText = (sha: string) => `---
name: verify-coupon
description: Checks that clampPercent in src/coupon.js always returns a percent from 0 to 100. Use when a change touches src/coupon.js or any caller that relies on the coupon range.
---

# Verify the coupon range

Property: clampPercent(percent) returns a number from 0 to 100 for every number input, including NaN and the infinities.
Harm: a coupon over 100 percent pays the customer instead of charging them.

Tool: generated inputs, because no verifier runs on plain JavaScript here, and a hand model of the function would not test the real code.

Run: \`node .pi/skills/verify-coupon/check.mjs\`. It exits 0 when every input holds and 1 with a counterexample otherwise.

## Coverage

- Covers: src/coupon.js, function clampPercent.
- Sync commit: ${sha}. Move it forward only after you confirm the check still describes the code at the new commit.
- Bounds and assumptions: 17 inputs, finite and non-finite, no random sampling. A pass covers those inputs, not every number.
- Does not cover: callers of clampPercent, or the rounding in src/cart.js.

## When a change touches the covered code

Run the check. A counterexample is a real bug unless the property itself is changing on purpose, then update the check and the sync commit.
`;

const FORMAL_REPLY = `Verified: the property that clampPercent in src/coupon.js always returns a percent from 0 to 100.
Tool: generated inputs run against the real code, because no verifier runs on plain JavaScript here and a hand model would not test the code.
Bounds: 17 inputs including NaN and both infinities.
Found: the current code holds the property, nothing to report.
Run it with: node .pi/skills/verify-coupon/check.mjs
Not covered: the callers of clampPercent and the rounding in src/cart.js.`;

export const formalFamily: Family = {
  id: 'create-formal-verification-skill',
  title: 'create-formal-verification-skill: a project-local skill whose check passes on the code and fails on a broken variant (spec 12.4)',
  spec: {
    family: 'create-formal-verification-skill',
    runId: 'formal-unused',
    history: couponHistory,
    prompt: () => '/create-formal-verification-skill make sure clampPercent can never return a percent outside 0 to 100',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const dir = join(ctx.repo, SKILL_DIR);
      const coupon = join(ctx.repo, 'src/coupon.js');
      parent
        .readSkill('create-formal-verification-skill')
        .read(coupon)
        .write(join(dir, 'SKILL.md'), skillText(ctx.base))
        .write(join(dir, 'check.mjs'), CHECK_MJS)
        .bash(`cd ${ctx.repo} && node ${SKILL_DIR}/check.mjs`)
        .edit(coupon, 'return Math.min(100, Math.max(0, Number.isNaN(percent) ? 0 : percent));', 'return Math.max(0, percent);')
        .bash(`cd ${ctx.repo} && node ${SKILL_DIR}/check.mjs`)
        .bash(`cd ${ctx.repo} && git checkout -- src/coupon.js`)
        .bash(`cd ${ctx.repo} && node ${SKILL_DIR}/check.mjs`)
        .text(FORMAL_REPLY);
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('create-formal-verification-skill'),
    parentReads('formal.reads-skill', 'the parent opens the create-formal-verification-skill skill', src('create-formal-verification-skill/SKILL.md', '# Create a formal verification skill'), ['create-formal-verification-skill']),
    check('formal.skill-registers', 'the generated skill has frontmatter with a name and a description, so it registers', src('create-formal-verification-skill/SKILL.md', 'Without frontmatter, the skill never registers'), (view) => {
      const text = read(join(view.repo, SKILL_DIR, 'SKILL.md'));
      const front = /^---\nname: (verify-[\w-]+)\ndescription: (.+)\n---/.exec(text);
      return when(front !== null && (front[2] as string).length > 20, `name ${front?.[1]}`, `frontmatter missing or thin: ${text.slice(0, 80)}`);
    }),
    check('formal.coverage-record-and-sync-commit', 'the skill records the covered files and functions and a sync commit that resolves in the repository', src('create-formal-verification-skill/SKILL.md', 'Record which files and functions each check covers, and the commit'), (view) => {
      const text = read(join(view.repo, SKILL_DIR, 'SKILL.md'));
      const sha = /Sync commit: ([0-9a-f]{7,40})/.exec(text)?.[1] ?? '';
      const covered = /Covers: (src\/[\w./-]+), function (\w+)/.exec(text);
      const resolves = sha !== '' && shell(view.repo, `git cat-file -t ${sha}`).stdout.trim() === 'commit';
      const present = covered !== null && read(join(view.repo, covered[1] as string)).includes(`function ${covered[2]}`);
      return when(resolves && present, `covers ${covered?.[1]} ${covered?.[2]} at ${sha.slice(0, 10)}`, `sync commit resolves: ${resolves}; covered code present: ${present}`);
    }),
    check('formal.states-property-harm-bounds-and-gaps', 'the skill states the property, the harm, the bounds, what is not covered, and one run command', src('create-formal-verification-skill/SKILL.md', 'Honest about scope'), (view) => {
      const text = read(join(view.repo, SKILL_DIR, 'SKILL.md'));
      const missing = [{ name: 'property', pattern: /^Property:/m }, { name: 'harm', pattern: /^Harm:/m }, { name: 'bounds', pattern: /Bounds and assumptions:/ }, { name: 'not covered', pattern: /Does not cover:/ }, { name: 'run command', pattern: /Run: `node [^`]+`/ }, { name: 'no placeholders', pattern: /^(?![\s\S]*(TODO|TBD|<placeholder>))/ }].filter(({ pattern }) => !pattern.test(text)).map(({ name }) => name);
      return when(missing.length === 0, 'property, harm, bounds, gaps and the command are present', `missing ${missing.join(', ')}`);
    }),
    check('formal.check-passes-on-the-code', 'the skill\'s one command, run by the checker, passes on the real code', src('create-formal-verification-skill/SKILL.md', 'Cheap to rerun'), (view) => {
      const run = shell(view.repo, `node ${SKILL_DIR}/check.mjs`);
      return when(run.status === 0, run.stdout.trim().split('\n').at(-1) ?? '', `exit ${run.status}: ${run.stdout}${run.stderr}`);
    }),
    check('formal.check-can-fail', 'the same command, run by the checker on a copy whose clamp is removed, fails and prints the counterexample', src('create-formal-verification-skill/SKILL.md', 'A check that you have never seen fail proves nothing'), (view) => {
      const dir = mkdtempSync(join(tmpdir(), 'wf-formal-'));
      try {
        cpSync(view.repo, dir, { recursive: true, filter: (path) => !path.includes('/.git') });
        writeFileSync(join(dir, 'src/coupon.js'), 'export function clampPercent(percent) {\n  return Math.max(0, percent);\n}\n');
        const run = shell(dir, `node ${SKILL_DIR}/check.mjs`);
        return when(run.status !== 0 && /COUNTEREXAMPLE clampPercent\(150\)/.test(run.stdout), `broken variant exits ${run.status}: ${run.stdout.split('\n')[0]}`, `broken variant exit ${run.status}, output ${run.stdout.slice(0, 120)}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }),
    check('formal.skill-was-run-on-a-real-break-and-restored', 'the parent saw the check fail on a scratch break in the real code, dropped the break, and saw it pass again, ending with a clean tree', src('create-formal-verification-skill/SKILL.md', 'Follow the generated skill once, as the next agent would, on a scratch change that breaks the property in the real code'), (view) => {
      const calls = view.parent.toolCalls;
      const runs = calls.filter((call) => call.name === 'bash' && /verify-coupon\/check\.mjs/.test(String(call.args['command'])));
      const edit = calls.find((call) => call.name === 'edit' && String(call.args['path']).endsWith('src/coupon.js'));
      const red = runs.find((call) => edit !== undefined && call.order > edit.order);
      const restore = calls.find((call) => call.name === 'bash' && /git checkout -- src\/coupon\.js/.test(String(call.args['command'])));
      const green = runs.find((call) => restore !== undefined && call.order > restore.order);
      return when(edit !== undefined && red?.isError === true && restore !== undefined && green?.isError === false && view.git.dirty.length === 0 && view.git.commitsSinceBase.length === 0, `break at ${edit?.order}, red at ${red?.order}, restored at ${restore?.order}, green at ${green?.order}, tree clean`, `edit ${edit?.order}, red ${red?.order} err=${red?.isError}, restore ${restore?.order}, green ${green?.order} err=${green?.isError}, dirty ${view.git.dirty.join(', ') || 'none'}`);
    }),
    check('formal.hand-off', 'the hand-off says what was verified, the tool and why, the bounds, what the check found, how to run it, and what it does not cover', src('create-formal-verification-skill/SKILL.md', '## Hand off'), (view) => {
      const reply = finalReply(view);
      const missing = [/Verified:/, /Tool:.*because/s, /Bounds:/, /Found:/, /node \.pi\/skills\/verify-coupon\/check\.mjs/, /Not covered:/].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0, 'all six parts present', `missing ${missing.join(', ')}`);
    }),
  ],
  negatives: [
    { name: 'the skill has no frontmatter', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'), read(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md')).replace(/^---[\s\S]*?---\n/, '')), fails: ['formal.skill-registers'] },
    { name: 'the check always passes', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', SKILL_DIR, 'check.mjs'), 'console.log("ok");\nprocess.exit(0);\n'), fails: ['formal.check-can-fail'] },
    { name: 'the sync commit does not exist', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'), read(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md')).replace(/Sync commit: [0-9a-f]+/, 'Sync commit: 1234567')), fails: ['formal.coverage-record-and-sync-commit'] },
    { name: 'the covered function is not the one the skill names', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'), read(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md')).replace('function clampPercent', 'function clampPercentage')), fails: ['formal.coverage-record-and-sync-commit'] },
    { name: 'the scratch break was left in the code', mutate: (sandbox) => dirtyRepo(sandbox, 'src/coupon.js'), fails: ['formal.skill-was-run-on-a-real-break-and-restored'] },
    { name: 'the check fails on the real code', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/src/coupon.js'), 'export function clampPercent(percent) {\n  return percent;\n}\n'), fails: ['formal.check-passes-on-the-code'] },
    { name: 'the skill never states what it does not cover', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'), read(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md')).replace('Does not cover:', 'Notes:')), fails: ['formal.states-property-harm-bounds-and-gaps'] },
    { name: 'the skill kept a placeholder', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'), `${read(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'))}\nTODO fill in\n`), fails: ['formal.states-property-harm-bounds-and-gaps'] },
    { name: 'the hand-off hid the gaps', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Not covered:', 'Also:'), fails: ['formal.hand-off'] },
  ],
};

// ---- create-verification-skill

const VDIR = '.pi/skills/verify-cart';
const DRIVE_SH = `#!/bin/sh
set -eu
root=$(git rev-parse --show-toplevel)
evidence="$root/.pi/verify-cart-evidence"
case "\${1:-}" in
  launch) cd "$root" && node --version >/dev/null && echo ready ;;
  doctor) cd "$root" && test -f bin/cart.js && node bin/cart.js 1 1 >/dev/null && echo "doctor ok" ;;
  drive) mkdir -p "$evidence"; cd "$root"; node bin/cart.js "$2" "$3" "$4" | tee "$evidence/$5.txt" ;;
  cleanup) echo "nothing to stop: the CLI is short-lived, evidence stays in $evidence" ;;
  *) echo "usage: drive.sh launch|doctor|drive <price> <qty> <percent> <name>|cleanup" >&2; exit 2 ;;
esac
`;
const VSKILL = `---
name: verify-cart
description: Drives the cart CLI (bin/cart.js) the way a user does and captures its output as proof. Use when a change touches src/cart.js or bin/cart.js.
---

# Verify the cart CLI

## Launch

\`sh .pi/skills/verify-cart/scripts/drive.sh launch\` checks that node runs. It prints \`ready\`. A short-lived CLI keeps no server, so each drive starts its own process.

## Doctor

\`sh .pi/skills/verify-cart/scripts/drive.sh doctor\` is read-only. It prints \`doctor ok\` when bin/cart.js exists and runs.

## Drive

\`sh .pi/skills/verify-cart/scripts/drive.sh drive <price> <qty> <percent> <name>\` runs \`node bin/cart.js\` and prints the total, the way a user sees it. Stable handle: the \`total=\` line.

## Evidence

Each drive saves its output to \`.pi/verify-cart-evidence/<name>.txt\`. Proof standards: run the real CLI, capture the output, never call src/cart.js directly.

## Cleanup

\`sh .pi/skills/verify-cart/scripts/drive.sh cleanup\`. It removes nothing, and the evidence in \`.pi/verify-cart-evidence/\` survives teardown.

## Helpers

\`scripts/drive.sh\` is executable and its invocation is shown above.

## Feature map

See [features/README.md](features/README.md).
`;
const FEATURE = (name: string, how: string, end: string) => `# ${name}\n\n## Sub-features\nOne price, one quantity, an optional coupon percent.\n\n## How to get to it (user POV)\nRun the cart CLI with a price, a quantity and a percent.\n\n## Driving it with drive.sh\n${how}\n\nObservable end state: ${end}\n\n## Gotchas\nA percent over 100 is not bounded by the CLI.\n`;

const VERIFY_SKILL_REPLY = 'Generated .pi/skills/verify-cart with launch, doctor, drive, evidence, cleanup and helpers, plus a feature map of two features. I ran launch, doctor, drove the total feature, cleaned up, and the evidence in .pi/verify-cart-evidence/total.txt survived. Run /maintain-verification-skill when the app changes.';

export const verificationSkillFamily: Family = {
  id: 'create-verification-skill',
  title: 'create-verification-skill: a project-local skill with a real-app harness and feature map, run on one mapped feature (spec 12.4)',
  spec: {
    family: 'create-verification-skill',
    runId: 'verification-unused',
    history: couponHistory,
    prompt: () => '/create-verification-skill make a control skill for the cart CLI in bin/cart.js',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const dir = join(ctx.repo, VDIR);
      parent
        .readSkill('create-verification-skill')
        .read(join(ctx.repo, 'bin/cart.js'))
        .write(join(dir, 'SKILL.md'), VSKILL)
        .write(join(dir, 'scripts/drive.sh'), DRIVE_SH)
        .bash(`chmod +x ${dir}/scripts/drive.sh`)
        .write(join(dir, 'features/README.md'), '# Features\n\n- [total](total.md)\n- [coupon](coupon.md)\n')
        .write(join(dir, 'features/total.md'), FEATURE('Total', '`sh .pi/skills/verify-cart/scripts/drive.sh drive 5 2 0 total`', 'total=10'))
        .write(join(dir, 'features/coupon.md'), FEATURE('Coupon', '`sh .pi/skills/verify-cart/scripts/drive.sh drive 5 2 50 coupon`', 'total=5'))
        .bash(`cd ${ctx.repo} && sh ${VDIR}/scripts/drive.sh launch && sh ${VDIR}/scripts/drive.sh doctor`)
        .bash(`cd ${ctx.repo} && sh ${VDIR}/scripts/drive.sh drive 5 2 0 total`)
        .bash(`cd ${ctx.repo} && sh ${VDIR}/scripts/drive.sh cleanup && test -s .pi/verify-cart-evidence/total.txt`)
        .text(VERIFY_SKILL_REPLY);
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('create-verification-skill'),
    parentReads('verify-skill.reads-skill', 'the parent opens the create-verification-skill skill', src('create-verification-skill/SKILL.md', '# Create a verification skill'), ['create-verification-skill']),
    check('verify-skill.registers-with-the-required-sections', 'the skill has frontmatter and the Launch, Doctor, Drive, Evidence, Cleanup and Helpers sections, with no placeholders', src('create-verification-skill/SKILL.md', 'Write `.pi/skills/verify-<app>/SKILL.md` with YAML frontmatter'), (view) => {
      const text = read(join(view.repo, VDIR, 'SKILL.md'));
      const missing = ['Launch', 'Doctor', 'Drive', 'Evidence', 'Cleanup', 'Helpers'].filter((section) => !new RegExp(`^## ${section}\\b`, 'm').test(text));
      return when(/^---\nname: verify-cart\ndescription: .{20,}\n---/.test(text) && missing.length === 0 && !/TODO|TBD|<[a-z ]+>(?!\s*<)/.test(text.replace(/<(price|qty|percent|name)>/g, '')), 'frontmatter and all six sections', `missing sections ${missing.join(', ') || 'none'}; frontmatter ok ${/^---\nname: verify-cart/.test(text)}`);
    }),
    check('verify-skill.feature-map', 'the feature map has a README index and one file per feature, each with the four H2s from the user\'s point of view', src('create-verification-skill/SKILL.md', 'The four H2s are `Sub-features`'), (view) => {
      const dir = join(view.repo, VDIR, 'features');
      const files = existsSync(dir) ? readdirSync(dir).filter((file) => file !== 'README.md' && file.endsWith('.md')) : [];
      const bad = files.filter((file) => !['Sub-features', 'How to get to it (user POV)', 'Driving it with', 'Gotchas'].every((heading) => read(join(dir, file)).includes(`## ${heading}`)));
      return when(existsSync(join(dir, 'README.md')) && files.length >= 2 && bad.length === 0, `${files.length} features, each with the four sections`, `features ${files.join(', ') || 'none'}; incomplete ${bad.join(', ')}`);
    }),
    check('verify-skill.helper-is-executable-and-shown', 'every helper script is executable and its invocation is shown in the skill body', src('create-verification-skill/SKILL.md', 'any script the skill ships is executable'), (view) => {
      const dir = join(view.repo, VDIR, 'scripts');
      const helpers = existsSync(dir) ? readdirSync(dir) : [];
      const body = read(join(view.repo, VDIR, 'SKILL.md'));
      const bad = helpers.filter((helper) => (statSync(join(dir, helper)).mode & 0o111) === 0 || !body.includes(`scripts/${helper}`));
      return when(helpers.length > 0 && bad.length === 0, `${helpers.join(', ')} executable and shown`, `not executable or not shown: ${bad.join(', ') || 'no helpers'}`);
    }),
    check('verify-skill.doctor-and-drive-work-on-the-real-app', 'the checker runs doctor and drives the mapped total feature, and the output equals the observable end state the feature file promises', src('create-verification-skill/SKILL.md', 'drive ONE mapped feature'), (view) => {
      const script = join(view.repo, VDIR, 'scripts/drive.sh');
      const doctor = shell(view.repo, `sh ${script} doctor`);
      const promised = /Observable end state: (total=\d+)/.exec(read(join(view.repo, VDIR, 'features/total.md')))?.[1];
      const drive = shell(view.repo, `sh ${script} drive 5 2 0 checker-total`);
      return when(doctor.status === 0 && promised !== undefined && drive.stdout.trim() === promised, `doctor ok, drive printed ${drive.stdout.trim()} as promised`, `doctor ${doctor.status}; promised ${promised}; drive ${drive.status} printed ${drive.stdout.trim()}`);
    }),
    check('verify-skill.evidence-survives-cleanup', 'after cleanup the evidence still exists at the location the skill names', src('create-verification-skill/SKILL.md', 'confirm the evidence still exists at the named location'), (view) => {
      const evidence = join(view.repo, '.pi', 'verify-cart-evidence', 'total.txt');
      const named = read(join(view.repo, VDIR, 'SKILL.md')).includes('.pi/verify-cart-evidence/');
      return when(named && existsSync(evidence) && read(evidence).includes('total=10'), `${evidence} holds ${read(evidence).trim()}`, `named ${named}; evidence exists ${existsSync(evidence)}`);
    }),
    check('verify-skill.was-run-before-handoff', 'the parent ran launch, doctor, one drive, and cleanup, in that order, and the cleanup step confirmed the evidence file', src('create-verification-skill/SKILL.md', 'A generated skill that was never executed is a draft, not a deliverable'), (view) => {
      const commands = view.parent.toolCalls.filter((call) => call.name === 'bash').map((call) => String(call.args['command']));
      const at = (word: string) => commands.findIndex((command) => command.includes(`drive.sh ${word}`));
      const order = ['launch', 'doctor', 'drive', 'cleanup'].map(at);
      return when(!order.includes(-1) && order[0] === order[1] && (order[1] as number) < (order[2] as number) && (order[2] as number) < (order[3] as number) && /test -s \.pi\/verify-cart-evidence/.test(commands[order[3] as number] ?? ''), `launch/doctor, drive, cleanup ran in order at ${order.join(',')}`, `positions ${order.join(',')}`);
    }),
    repoUntouched('verify-skill.production-code-untouched', 'no production file changed', src('create-verification-skill/SKILL.md', 'If the checkout doesn\'t build or start as-is, fix that first')),
  ],
  negatives: [
    { name: 'a required section is missing', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', VDIR, 'SKILL.md'), read(join(sandbox, 'repo', VDIR, 'SKILL.md')).replace('## Doctor', '## Check')), fails: ['verify-skill.registers-with-the-required-sections'] },
    { name: 'a feature file lacks its Gotchas', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', VDIR, 'features/coupon.md'), read(join(sandbox, 'repo', VDIR, 'features/coupon.md')).replace('## Gotchas', '## Notes')), fails: ['verify-skill.feature-map'] },
    { name: 'the feature map is only an index', mutate: (sandbox) => { rmSync(join(sandbox, 'repo', VDIR, 'features/total.md')); rmSync(join(sandbox, 'repo', VDIR, 'features/coupon.md')); }, fails: ['verify-skill.feature-map'] },
    { name: 'the helper is not executable', mutate: (sandbox) => spawnSync('chmod', ['-x', join(sandbox, 'repo', VDIR, 'scripts/drive.sh')]), fails: ['verify-skill.helper-is-executable-and-shown'] },
    { name: 'the drive prints something other than the promised end state', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', VDIR, 'features/total.md'), read(join(sandbox, 'repo', VDIR, 'features/total.md')).replace('total=10', 'total=11')), fails: ['verify-skill.doctor-and-drive-work-on-the-real-app'] },
    { name: 'cleanup ate the evidence', mutate: (sandbox) => rmSync(join(sandbox, 'repo/.pi/verify-cart-evidence'), { recursive: true, force: true }), fails: ['verify-skill.evidence-survives-cleanup'] },
    { name: 'the skill was never run', mutate: (sandbox) => rewriteSkillRuns(sandbox), fails: ['verify-skill.was-run-before-handoff'] },
    { name: 'the skill kept a placeholder', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', VDIR, 'SKILL.md'), `${read(join(sandbox, 'repo', VDIR, 'SKILL.md'))}\nTODO write this later\n`), fails: ['verify-skill.registers-with-the-required-sections'] },
    { name: 'production code was edited', mutate: (sandbox) => dirtyRepo(sandbox, 'bin/cart.js'), fails: ['verify-skill.production-code-untouched'] },
  ],
};

function rewriteSkillRuns(sandbox: string): void {
  const file = parentSession(sandbox);
  writeFileSync(file, read(file).replaceAll('drive.sh doctor', 'drive.sh skipped'));
}

export const verificationFamilies: Family[] = [verifyThisFamily, statechartFamily, formalFamily, verificationSkillFamily];

void [mkdirSync, fail];
