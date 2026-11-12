// Families: verify-this, statechart, create-formal-verification-skill, create-verification-skill (spec 12.4).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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

/** The claim directory the parent worked in, from any string argument of any call: `ART=/tmp/verify-this/x` and a path under a sandbox's tmp/ both name it. */
const verifyDir = (view: RunView): string => {
  const strings = view.parent.toolCalls.flatMap((call) => Object.values(call.args).filter((value): value is string => typeof value === 'string'));
  return strings.map((text) => /((?:\/[\w.@+-]+)*\/tmp\/verify-this\/[\w.-]+)/.exec(text)?.[1]).find((path) => path !== undefined) ?? '';
};
/** Every file under a directory (recursively), as relative paths. */
const filesUnder = (dir: string): string[] => (existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((name) => statSync(join(dir, name)).isFile()) : []);
const textUnder = (dir: string): string => filesUnder(dir).map((name) => read(join(dir, name))).join('\n');
/** The reply as the skill's Output block shows it: a ```text fence around the shape is the presentation of the block, not part of the shape. */
const shapedReply = (view: RunView): string => finalReply(view).trim().replace(/^```[a-z]*\n/, '').replace(/\n```$/, '').trim();
/** Whether the claim directory names the commit (full or 7+ character prefix) in its claim, timeline, or verdict. */
const names = (dir: string, sha: string): boolean => ['claim.md', 'timeline.md', 'verdict.md'].some((file) => new RegExp(`\\b${sha.slice(0, 7)}`).test(read(join(dir, file))));

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
      // The skill names the three parts, not their format: a label, a bold label, or a heading each say it.
      const missing = ['condition', 'metric', 'threshold'].filter((word) => !new RegExp(`\\b${word}\\b`, 'i').test(claim));
      return when(missing.length === 0, 'claim.md names condition, metric and threshold', `claim.md lacks ${missing.join(', ')}`);
    }),
    check('verify-this.baseline-is-the-old-state-same-command', 'the baseline is the parent commit, the treatment is the changed commit (both named in the claim, timeline, or verdict), and both ran the same command', src('verify-this/SKILL.md', 'Capture treatment from the changed state with the same command, data, warmup, and environment'), (view) => {
      const dir = verifyDir(view);
      const parentOfTreatment = shell(view.repo, `git rev-parse ${view.base}^`).stdout.trim();
      const [a = '', b = ''] = ['baseline', 'treatment'].map((name) => read(join(dir, name, 'command.txt')).trim());
      // A run that records no command.txt shows the same command by running the same measurements on both sides: the same file names in each.
      const [left, right] = ['baseline', 'treatment'].map((name) => filesUnder(join(dir, name)).filter((file) => file !== 'commit.txt' && file !== 'command.txt').sort().join(','));
      const sameCommand = a !== '' || b !== '' ? a === b : left !== '' && left === right;
      return when(dir !== '' && names(dir, view.base) && names(dir, parentOfTreatment) && sameCommand, `the treatment ${view.base.slice(0, 8)} and its parent ${parentOfTreatment.slice(0, 8)} are named; one command`, `treatment named ${names(dir, view.base)}, parent ${parentOfTreatment.slice(0, 8)} named ${names(dir, parentOfTreatment)}, same command ${sameCommand} (${a === '' && b === '' ? `files ${left} vs ${right}` : 'command.txt differs'})`);
    }),
    check('verify-this.raw-artifacts-compared', 'raw output exists for both sides, the two differ, and the diff holds their difference', src('verify-this/SKILL.md', 'Compare raw artifacts'), (view) => {
      const dir = verifyDir(view);
      const [a, b, diff] = ['baseline', 'treatment', 'diff'].map((name) => textUnder(join(dir, name)).trim());
      return when(a !== '' && b !== '' && a !== b && diff !== '', `baseline ${a.split('\n')[0]?.slice(0, 40)}, treatment ${b.split('\n')[0]?.slice(0, 40)}, diff ${diff.split('\n').length} lines`, `baseline ${JSON.stringify(a.slice(0, 60))}, treatment ${JSON.stringify(b.slice(0, 60))}, diff ${JSON.stringify(diff.slice(0, 60))}`);
    }),
    check('verify-this.one-verdict-and-it-is-the-true-one', 'exactly one verdict is returned, the reply and verdict.md agree, and it equals what the checker derives by running the command on both commits itself', src('verify-this/SKILL.md', 'Return exactly one verdict'), (view) => {
      const dir = verifyDir(view);
      const verdict = read(join(dir, 'verdict.md')).trim().split('\n')[0] ?? '';
      const reply = shapedReply(view);
      const first = reply.split('\n')[0]?.trim() ?? '';
      const before = runAtCommit(view, `${view.base}^`, REPRO);
      const after = runAtCommit(view, view.base, REPRO);
      const derived = before.status !== 0 && after.status === 0 ? 'VERIFIED' : before.status === 0 && after.status === 0 ? 'NOT VERIFIED' : 'INCONCLUSIVE';
      return when(['VERIFIED', 'NOT VERIFIED', 'INCONCLUSIVE'].includes(verdict) && verdict === first && verdict === derived, `verdict ${verdict}; baseline exit ${before.status}, treatment exit ${after.status}`, `verdict.md ${verdict}, reply ${first}, derived ${derived} (baseline exit ${before.status}, treatment exit ${after.status})`);
    }),
    check('verify-this.output-shape', 'the reply has the verdict line, Claim, an Evidence line with baseline, treatment, delta and threshold, and Reasoning', src('verify-this/SKILL.md', 'Use this shape'), (view) => {
      const reply = shapedReply(view);
      // <...> in the shape is free text: a value may carry a unit or a note, and the paragraph may follow Reasoning: on the same line.
      return when(/^(VERIFIED|NOT VERIFIED|INCONCLUSIVE)\n/.test(reply) && /^Claim: \S/m.test(reply) && /baseline=[^\n]+?, treatment=[^\n]+?, delta=[^\n]+?, threshold=\S/.test(reply) && /^Reasoning:\s*\S/m.test(reply), 'reply has the four parts', `reply: ${reply.slice(0, 160)}`);
    }),
    repoUntouched('verify-this.leaves-the-repository-alone', 'verification changes nothing in the repository', src('verify-this/SKILL.md', 'Verification is not a recap')),
  ],
  negatives: [
    { name: 'the verdict was upgraded without the evidence', mutate: (sandbox) => verdictTo(sandbox, 'NOT VERIFIED'), fails: ['verify-this.one-verdict-and-it-is-the-true-one'] },
    { name: 'a clear verdict was softened to inconclusive', mutate: (sandbox) => verdictTo(sandbox, 'INCONCLUSIVE'), fails: ['verify-this.one-verdict-and-it-is-the-true-one'] },
    { name: 'the baseline is not the old state: the timeline names another commit', mutate: (sandbox) => { const path = join(sandbox, 'tmp/verify-this', VERIFY_SLUG, 'timeline.md'); writeFileSync(path, readFileSync(path, 'utf8').replace(/baseline [0-9a-f]{12}/, 'baseline deadbeef0000')); }, fails: ['verify-this.baseline-is-the-old-state-same-command'] },
    { name: 'the run keeps no commit.txt or command.txt, and its two sides hold the same files', mutate: (sandbox) => { for (const side of ['baseline', 'treatment']) for (const file of ['commit.txt', 'command.txt']) rmSync(join(sandbox, 'tmp/verify-this', VERIFY_SLUG, side, file)); }, fails: [], passes: ['verify-this.baseline-is-the-old-state-same-command', 'verify-this.raw-artifacts-compared'] },
    { name: 'the sides hold different measurements, with no command recorded', mutate: (sandbox) => { for (const side of ['baseline', 'treatment']) for (const file of ['commit.txt', 'command.txt']) rmSync(join(sandbox, 'tmp/verify-this', VERIFY_SLUG, side, file)); writeFileSync(join(sandbox, 'tmp/verify-this', VERIFY_SLUG, 'treatment/extra.txt'), 'x\n'); }, fails: ['verify-this.baseline-is-the-old-state-same-command'] },
    { name: 'the reply is the Output block in a text fence, with the evidence values carrying units and Reasoning on one line', mutate: (sandbox) => rewriteFinalReply(sandbox, /^[\s\S]*$/, '```text\nVERIFIED\nClaim: after the fix, a 150 percent coupon gives a total of at least 0.\n\nEvidence: total: baseline=-5 ($-5.00), treatment=0 ($0.00), delta=+5, threshold=>=0\n\nReasoning: same command, same data, only the code changed.\n```'), fails: [], passes: ['verify-this.output-shape', 'verify-this.one-verdict-and-it-is-the-true-one'] },
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

/** The scratch folder the reply names (`Scratch folder: <dir>`), else the folder outside the repository that holds the spec. */
function scratchOf(view: RunView): string {
  const named = /Scratch folder: (\/\S+)/.exec(finalReply(view))?.[1];
  if (named !== undefined) return named;
  const found = readdirSync(view.sandbox, { recursive: true, encoding: 'utf8' }).find((name) => name.endsWith('.tla') && !name.startsWith('repo/') && !name.includes('node_modules') && !name.split('/').slice(0, -1).includes('out'));
  return found === undefined ? '' : join(view.sandbox, dirname(found));
}
/** The spec, config and view the run wrote, by extension: the skill names none of them (`SPEC.tla`, `--config FILE`, `--view FILE`). */
function statechartFiles(view: RunView) {
  const scratch = scratchOf(view);
  const names = existsSync(scratch) ? readdirSync(scratch) : [];
  const [spec = '', cfg = '', viewFile = ''] = [names.find((name) => name.endsWith('.tla')), names.find((name) => name.endsWith('.cfg')), names.find((name) => /view.*\.m?js$/.test(name)) ?? names.find((name) => name.endsWith('.mjs'))];
  const specText = read(join(scratch, spec));
  const cfgText = read(join(scratch, cfg));
  const invariants = [...cfgText.matchAll(/^INVARIANT\s+(\w+)/gm)].map((match) => match[1] as string);
  const tlc = read(join(scratch, 'out', 'tlc.out'));
  const violated = [...tlc.matchAll(/Invariant (\w+) is violated/g)].map((match) => match[1] as string);
  return { scratch, spec, cfg, viewFile, specText, cfgText, invariants, tlc, violated, command: `${STATECHART} ${spec}${cfg === '' ? '' : ` --config ${cfg}`}${viewFile === '' ? '' : ` --view ${viewFile}`}` };
}

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
      const { scratch, spec } = statechartFiles(view);
      return when(scratch !== '' && !scratch.startsWith(view.repo) && spec !== '' && view.git.dirty.length === 0, `scratch ${scratch} holds ${spec}`, `scratch ${scratch || 'not found'}; spec ${spec || 'none'}; dirty ${view.git.dirty.join(', ') || 'none'}`);
    }),
    check('statechart.next-is-a-disjunction-and-rule-is-an-invariant', 'Next is a disjunction of the actions, and each rule is an INVARIANT in the config and defined in the spec', src('statechart/SKILL.md', 'Write each rule that the reader agrees to as an INVARIANT'), (view) => {
      const { specText, invariants } = statechartFiles(view);
      // `Next == A \/ B`, or a multi-line `Next == \/ A` that goes on until the next definition.
      const next = /^Next ==[^\n]*(?:\n[ \t]+[^\n]*)*/m.exec(specText)?.[0] ?? '';
      const disjunction = next.includes('\\/');
      const undefinedRules = invariants.filter((name) => !new RegExp(`^${name}\\s*==`, 'm').test(specText));
      return when(disjunction && invariants.length > 0 && undefinedRules.length === 0, `Next is a disjunction; INVARIANT ${invariants.join(', ')} defined in the spec`, `Next disjunction ${disjunction}; invariants ${invariants.join(', ') || 'none'}; undefined ${undefinedRules.join(', ') || 'none'}`);
    }),
    check('statechart.model-checker-really-ran', 'tlc.out is real TLC output: its banner and either the invariant violation it found or its clean finish', src('statechart/SKILL.md', '`tlc.out` is what TLC printed'), (view) => {
      const { tlc, violated } = statechartFiles(view);
      return when(/^TLC2 Version/m.test(tlc) && (violated.length > 0 || /No error has been found/.test(tlc)), `tlc.out has the TLC banner and ${violated.length > 0 ? `the violated invariant ${violated.join(', ')}` : 'a clean finish'}`, `tlc.out starts: ${tlc.slice(0, 120)}`);
    }),
    check('statechart.report-has-the-shortest-bug-path', 'when TLC found a broken rule, the report names it and its shortest path from the start, in the reader\'s words; when none broke, there is no bug path to hold', src('statechart/SKILL.md', 'The report gives the shortest path to each state that breaks a rule'), (view) => {
      const { scratch, violated } = statechartFiles(view);
      const report = read(join(scratch, 'out', 'report.md'));
      if (violated.length === 0) return when(report !== '', 'no rule broke, so the report holds no bug path', 'no report.md');
      const problems = violated.filter((rule) => !new RegExp(`## ${rule} breaks`).test(report));
      return when(problems.length === 0 && /The shortest path has \d+ steps?/.test(report) && /^1\. \S/m.test(report), `the report lists ${violated.join(', ')} with a numbered shortest path`, `report: ${report.slice(0, 200)}; missing ${problems.join(', ')}`);
    }),
    check('statechart.chart-is-mermaid-and-marks-the-bug', 'chart.mmd is a Mermaid state diagram that marks the state that breaks a rule (when one breaks) and stays small, with no variable names in its labels', src('statechart/SKILL.md', 'Show `chart.mmd` to the user as a `mermaid` code block'), (view) => {
      const { scratch, specText, violated } = statechartFiles(view);
      const chart = read(join(scratch, 'out', 'chart.mmd'));
      const arrows = (chart.match(/-->/g) ?? []).length;
      const variables = (/^VARIABLES?\s+([^\n]+)/m.exec(specText)?.[1] ?? '').split(/[,\s]+/).filter(Boolean);
      const labelled = variables.filter((name) => new RegExp(`\\b${name}\\b`).test(chart.replace(/\b[A-Z]\w*\b/g, '')));
      const marked = /class s\d+ (mayBreak|breaks)/.test(chart);
      return when(/stateDiagram-v2/.test(chart) && (violated.length === 0 || marked) && arrows <= 20 && labelled.length === 0, `${arrows} arrows, ${violated.length === 0 ? 'no rule broke' : 'a broken state is marked'}, no variable names in labels`, `chart: ${chart.slice(0, 160)}; marked ${marked}; variables in labels ${labelled.join(', ') || 'none'}`);
    }),
    check('statechart.command-reproduces-the-chart-and-report', 'running the same command again produces the identical chart and report', src('statechart/SKILL.md', 'Give the command that makes the files again, with a new `--out` folder'), (view) => {
      const { scratch, command } = statechartFiles(view);
      const again = mkdtempSync(join(tmpdir(), 'wf-again-'));
      try {
        const run = shell(scratch, `${command} --out ${again}/out`);
        const same = ['chart.mmd', 'report.md'].every((file) => read(join(again, 'out', file)) === read(join(scratch, 'out', file)) && read(join(scratch, 'out', file)) !== '');
        return when(same, 'chart.mmd and report.md are byte-identical on a second run', `second run exit ${run.status}; files differ from the recorded run`);
      } finally {
        rmSync(again, { recursive: true, force: true });
      }
    }),
    check('statechart.hand-off', 'the hand-off quotes the chart as a mermaid block, names each broken rule with its path (when one broke), says what the model leaves out, and gives the command with a new --out', src('statechart/SKILL.md', '## Hand off'), (view) => {
      const reply = finalReply(view);
      const { scratch, violated } = statechartFiles(view);
      const chart = read(join(scratch, 'out', 'chart.mmd'));
      const block = /```mermaid\n([\s\S]*?)\n```/.exec(reply)?.[1] ?? '';
      const outs = [...reply.matchAll(/--out ([\w./-]+)/g)].map((match) => match[1]);
      const bugs = violated.every((rule) => reply.includes(rule)) && (violated.length === 0 || /path 1|path/i.test(reply));
      return when(block.trim() === chart.trim() && bugs && /\b(leaves? out|omits?|does not (model|cover)|not model(l)?ed|leaves)\b/i.test(reply) && outs.length > 0 && outs.some((out) => out !== 'out'), 'the hand-off has the chart, any bug and its path, the omissions, and a command with a new out folder', `block matches chart: ${block.trim() === chart.trim()}; bugs named ${bugs}; outs ${outs.join(', ')}`);
    }),
  ],
  negatives: [
    {
      name: 'the spec has other names (Card.tla, Card.cfg) and its rule holds: no bug path is owed, and the checker\'s own files are used',
      mutate: (sandbox) => {
        const dir = join(sandbox, 'scratch/pay');
        writeFileSync(join(dir, 'Card.tla'), read(join(dir, 'Pay.tla')).replaceAll('MODULE Pay', 'MODULE Card').replace('Refund == phase \\in {"authorized", "paid"}', 'Refund == phase = "paid"'));
        writeFileSync(join(dir, 'Card.cfg'), read(join(dir, 'Pay.cfg')));
        rmSync(join(dir, 'Pay.tla'));
        rmSync(join(dir, 'Pay.cfg'));
        rmSync(join(dir, 'out'), { recursive: true, force: true });
        shell(dir, `${STATECHART} Card.tla --config Card.cfg --view view.mjs --out out`);
      },
      fails: [],
      passes: ['statechart.scratch-outside-the-repo', 'statechart.next-is-a-disjunction-and-rule-is-an-invariant', 'statechart.model-checker-really-ran', 'statechart.report-has-the-shortest-bug-path', 'statechart.chart-is-mermaid-and-marks-the-bug', 'statechart.command-reproduces-the-chart-and-report'],
    },
    {
      name: 'the rule was broken in the spec but the report was regenerated from a spec where it holds',
      mutate: (sandbox) => writeFileSync(join(sandbox, 'scratch/pay/out/tlc.out'), read(join(sandbox, 'scratch/pay/out/tlc.out')).replace(/Invariant RefundOnlyAfterCapture is violated/g, 'Invariant checked')),
      fails: ['statechart.model-checker-really-ran'],
    },
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

/** The project-local skill the run generated: the `.pi/skills/<name>` folder in the repository that holds a SKILL.md, whatever it named it. */
function generatedSkill(view: RunView): { dir: string; rel: string; text: string } {
  const root = join(view.repo, '.pi', 'skills');
  const name = existsSync(root) ? readdirSync(root).find((entry) => existsSync(join(root, entry, 'SKILL.md'))) : undefined;
  const dir = join(root, name ?? '');
  return { dir, rel: `.pi/skills/${name ?? ''}`, text: name === undefined ? '' : read(join(dir, 'SKILL.md')) };
}
/** The body of a `## Heading` (or deeper) section, up to the next heading of the same or higher level. */
function sectionText(text: string, heading: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^#{1,4}\\s*${heading}\\b`, 'i').test(line));
  if (start === -1) return '';
  const level = /^#+/.exec(lines[start] as string)?.[0].length ?? 2;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => new RegExp(`^#{1,${level}}\\s`).test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}
/** The first command a section shows: a fenced block's first non-empty line, else the first inline code span that starts like a command. */
function firstCommand(section: string): string {
  const fenced = /```[a-z]*\n([\s\S]*?)\n```/.exec(section)?.[1]?.split('\n').find((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  if (fenced !== undefined) return fenced.trim();
  return [...section.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] as string).find((span) => /^(node|sh|bash|npm|npx|\.|python3?)\b/.test(span) || span.includes('.sh')) ?? '';
}
/** The skill's one run command: `Run: \`cmd\`` inline, else the first command of its Run section, else of the first section that shows one. */
function formalCommand(view: RunView): string {
  const { text } = generatedSkill(view);
  const inline = /\bRun\b[^\n`]*`([^`\n]+)`/.exec(text)?.[1];
  if (inline !== undefined && SHELL_START.test(inline)) return inline;
  return firstCommand(sectionText(text, 'Run')) || firstCommand(text);
}
const SHELL_START = /^(node|sh|bash|npm|npx|\.\/|\.pi\/|python3?)\b|^\.?\.?\/?[\w./-]+\.sh\b/;

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
      const { text } = generatedSkill(view);
      const front = /^---\nname: (verify-[\w-]+)\ndescription: "?(.+?)"?\n---/.exec(text);
      return when(front !== null && (front[2] as string).length > 20, `name ${front?.[1]}`, `frontmatter missing or thin: ${text.slice(0, 80)}`);
    }),
    check('formal.coverage-record-and-sync-commit', 'the skill records the covered files and functions and a sync commit that resolves in the repository', src('create-formal-verification-skill/SKILL.md', 'Record which files and functions each check covers, and the commit'), (view) => {
      const { text } = generatedSkill(view);
      const sha = /sync commit[^\n]*?\b([0-9a-f]{7,40})\b/i.exec(text)?.[1] ?? '';
      const files = [...new Set(text.match(/src\/[\w./-]+\.js/g) ?? [])];
      const names = [...text.matchAll(/function `?(\w+)`?|`(\w+)`/g)].map((match) => (match[1] ?? match[2]) as string);
      const resolves = sha !== '' && shell(view.repo, `git cat-file -t ${sha}`).stdout.trim() === 'commit';
      const present = files.some((file) => names.some((name) => read(join(view.repo, file)).includes(`function ${name}`)));
      return when(resolves && present, `covers ${files.join(', ')} at ${sha.slice(0, 10)}`, `sync commit ${sha || 'not found'} resolves: ${resolves}; a covered function in ${files.join(', ') || 'no file'} is present: ${present}`);
    }),
    check('formal.states-property-harm-bounds-and-gaps', 'the skill states the property, the harm, the bounds, what is not covered, and a run command', src('create-formal-verification-skill/SKILL.md', 'Honest about scope'), (view) => {
      const { text } = generatedSkill(view);
      const missing = [{ name: 'property', pattern: /\bproperty\b/i }, { name: 'harm', pattern: /\bharm\b/i }, { name: 'bounds', pattern: /\b(bounds?|assumptions?|generated inputs?|up to)\b/i }, { name: 'not covered', pattern: /\b(does not cover|not covered|doesn't cover|what a pass does not cover|left out)\b/i }, { name: 'run command', pattern: /\bRun\b[^\n]*`[^`\n]+`|```[a-z]*\n[^\n`]+\n```/ }, { name: 'no placeholders', pattern: /^(?![\s\S]*(\bTODO\b|\bTBD\b|<placeholder>))/ }].filter(({ pattern }) => !pattern.test(text)).map(({ name }) => name);
      return when(missing.length === 0, 'property, harm, bounds, gaps and the command are present', `missing ${missing.join(', ')}`);
    }),
    check('formal.check-passes-on-the-code', 'the skill\'s command, run by the checker, passes on the real code', src('create-formal-verification-skill/SKILL.md', 'Cheap to rerun'), (view) => {
      const command = formalCommand(view);
      const run = shell(view.repo, command);
      return when(command !== '' && run.status === 0, run.stdout.trim().split('\n').at(-1) ?? '', `\`${command}\` exit ${run.status}: ${run.stdout}${run.stderr}`.slice(0, 300));
    }),
    check('formal.check-can-fail', 'the same command, run by the checker on a copy whose clamp is removed, fails', src('create-formal-verification-skill/SKILL.md', 'A check that you have never seen fail proves nothing'), (view) => {
      const command = formalCommand(view);
      const dir = mkdtempSync(join(tmpdir(), 'wf-formal-'));
      try {
        cpSync(view.repo, dir, { recursive: true, filter: (path) => !path.includes('/.git') });
        writeFileSync(join(dir, 'src/coupon.js'), 'export function clampPercent(percent) {\n  return Math.max(0, percent);\n}\n');
        const run = shell(dir, command);
        return when(command !== '' && run.status !== 0, `broken variant exits ${run.status}: ${run.stdout.split('\n')[0]}`, `broken variant exit ${run.status} for \`${command}\`, output ${run.stdout.slice(0, 120)}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }),
    check('formal.skill-was-run-on-a-real-break-and-restored', 'the parent saw the check fail on a scratch break in the real code, dropped the break, and saw it pass again, ending with a clean tree', src('create-formal-verification-skill/SKILL.md', 'Follow the generated skill once, as the next agent would, on a scratch change that breaks the property in the real code'), (view) => {
      const calls = view.parent.toolCalls;
      const command = formalCommand(view).slice(0, 30);
      const runs = calls.filter((call) => call.name === 'bash' && command !== '' && String(call.args['command']).includes(command));
      const touches = (call: { name: string; args: Record<string, unknown> }) => (call.name === 'edit' || call.name === 'write') && String(call.args['path']).endsWith('src/coupon.js');
      const edit = calls.find(touches);
      const red = runs.find((call) => edit !== undefined && call.order > edit.order);
      const restore = calls.find((call) => red !== undefined && call.order > red.order && ((call.name === 'bash' && /git (checkout|restore|stash)[^\n]*coupon\.js|git (checkout|restore) \.|git stash/.test(String(call.args['command']))) || touches(call)));
      const green = runs.find((call) => restore !== undefined && call.order > restore.order);
      return when(edit !== undefined && red?.isError === true && restore !== undefined && green?.isError === false && view.git.dirty.length === 0, `break at ${edit?.order}, red at ${red?.order}, restored at ${restore?.order}, green at ${green?.order}, tree clean`, `edit ${edit?.order}, red ${red?.order} err=${red?.isError}, restore ${restore?.order}, green ${green?.order} err=${green?.isError}, dirty ${view.git.dirty.join(', ') || 'none'}`);
    }),
    check('formal.hand-off', 'the hand-off says what was verified, the tool and why, the bounds, what the check found, how to run it, and what it does not cover', src('create-formal-verification-skill/SKILL.md', '## Hand off'), (view) => {
      const reply = finalReply(view);
      const command = formalCommand(view);
      const parts = [{ name: 'what was verified', pattern: /\bverif/i }, { name: 'the tool and why', pattern: /\btool\b[\s\S]{0,400}\b(because|since|chosen|why|so)\b|\b(because|since)\b[\s\S]{0,200}\btool\b/i }, { name: 'the bounds', pattern: /\b(bounds?|inputs|assumptions?)\b/i }, { name: 'what it found', pattern: /\b(found|finds?|finding|holds?|broke|bug)\b/i }, { name: 'how to run it', pattern: new RegExp(command === '' ? '^$' : command.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }, { name: 'what is not covered', pattern: /\b(not covered|does not cover|doesn't cover|left out|not cover)\b/i }];
      const missing = parts.filter(({ pattern }) => !pattern.test(reply)).map(({ name }) => name);
      return when(missing.length === 0, 'all six parts present', `missing ${missing.join(', ')}`);
    }),
  ],
  negatives: [
    {
      name: 'the skill folder has another name, its section labels are bold, and its coverage line is written in prose',
      mutate: (sandbox) => {
        const from = join(sandbox, 'repo', SKILL_DIR);
        const to = join(sandbox, 'repo/.pi/skills/verify-clamp-percent');
        cpSync(from, to, { recursive: true });
        rmSync(from, { recursive: true, force: true });
        writeFileSync(join(to, 'SKILL.md'), read(join(to, 'SKILL.md')).replaceAll('verify-coupon', 'verify-clamp-percent').replace('Property:', '**Property:**').replace('Harm:', '**Harm if it breaks:**').replace('Does not cover:', '**Scope, what a pass does not cover:**').replace('Covers: src/coupon.js, function clampPercent.', 'Verified code: `src/coupon.js`, `clampPercent`.').replace('Sync commit: ', 'Sync commit: `').replace(/(`[0-9a-f]{7,40})\./, '$1`.'));
      },
      fails: [],
      passes: ['formal.skill-registers', 'formal.coverage-record-and-sync-commit', 'formal.states-property-harm-bounds-and-gaps', 'formal.check-passes-on-the-code', 'formal.check-can-fail'],
    },
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
      const { text } = generatedSkill(view);
      const missing = ['Launch', 'Doctor', 'Drive', 'Evidence', 'Cleanup', 'Helpers'].filter((section) => !new RegExp(`^#{1,4} ${section}\\b`, 'm').test(text));
      // `<feature>`, `<label>`, `<price>` in a usage line are arguments, not unfilled template slots; a placeholder is a TODO, a TBD, or a slot named so.
      return when(/^---\nname: verify-[\w-]+\ndescription: "?.{20,}/.test(text) && missing.length === 0 && !/\bTODO\b|\bTBD\b|<placeholder>|<fill[ -]in>|<your[ -][\w -]+>/i.test(text), 'frontmatter and all six sections', `missing sections ${missing.join(', ') || 'none'}; frontmatter ok ${/^---\nname: verify-/.test(text)}`);
    }),
    check('verify-skill.feature-map', 'the feature map has a README index and one file per feature, each with the four H2s from the user\'s point of view', src('create-verification-skill/SKILL.md', 'The four H2s are `Sub-features`'), (view) => {
      const dir = join(generatedSkill(view).dir, 'features');
      const files = existsSync(dir) ? readdirSync(dir).filter((file) => file !== 'README.md' && file.endsWith('.md')) : [];
      const bad = files.filter((file) => !['Sub-features', 'How to get to it (user POV)', 'Driving it with', 'Gotchas'].every((heading) => read(join(dir, file)).includes(`## ${heading}`)));
      return when(existsSync(join(dir, 'README.md')) && files.length >= 2 && bad.length === 0, `${files.length} features, each with the four sections`, `features ${files.join(', ') || 'none'}; incomplete ${bad.join(', ')}`);
    }),
    check('verify-skill.helper-is-executable-and-shown', 'every helper script is executable and its invocation is shown in the skill body', src('create-verification-skill/SKILL.md', 'any script the skill ships is executable'), (view) => {
      const { dir, text } = generatedSkill(view);
      // The skill names no folder for its helpers: scripts/, helpers/, bin/, or any other folder beside features/ holds them.
      const folders = existsSync(dir) ? readdirSync(dir).filter((entry) => entry !== 'features' && statSync(join(dir, entry)).isDirectory()) : [];
      const helpers = folders.flatMap((folder) => readdirSync(join(dir, folder)).map((helper) => ({ folder, helper })));
      const bad = helpers.filter(({ folder, helper }) => (statSync(join(dir, folder, helper)).mode & 0o111) === 0 || !text.includes(`${folder}/${helper}`));
      return when(helpers.length > 0 && bad.length === 0, `${helpers.map(({ folder, helper }) => `${folder}/${helper}`).join(', ')} executable and shown`, `not executable or not shown: ${bad.map(({ folder, helper }) => `${folder}/${helper}`).join(', ') || 'no helpers'}`);
    }),
    check('verify-skill.doctor-and-drive-work-on-the-real-app', 'the checker runs the skill\'s doctor command and the first drive its feature map shows, and the output carries the end state the feature file promises', src('create-verification-skill/SKILL.md', 'drive ONE mapped feature'), (view) => {
      const { dir, text } = generatedSkill(view);
      const doctor = firstCommand(sectionText(text, 'Doctor'));
      const features = join(dir, 'features');
      // The first feature the map lists (README order) that shows a script to drive it with.
      const listed = [...read(join(features, 'README.md')).matchAll(/\(([\w./-]+\.md)\)/g)].map((match) => match[1] as string);
      const ordered = [...listed, ...(existsSync(features) ? readdirSync(features).filter((file) => file !== 'README.md' && file.endsWith('.md')).sort() : [])];
      const featureFile = ordered.find((file) => existsSync(join(features, file)) && /`[^`\n]*\.sh[^`\n]*`/.test(read(join(features, file))));
      const body = featureFile === undefined ? '' : read(join(features, featureFile));
      const driveSpan = /`([^`\n]*\.sh[^`\n]*)`/.exec(body);
      const drive = driveSpan?.[1]?.replace(/^\.pi\//, '.pi/') ?? '';
      // The end state is stated as "Observable end state: X", else it is the code span that follows the drive command (`total=4`).
      const after = body.slice((driveSpan?.index ?? 0) + (driveSpan?.[0].length ?? 0));
      const promised = /Observable end state: `?([^\n`]+?)`?\s*$/m.exec(body)?.[1] ?? /`([^`\n/]+)`/.exec(after)?.[1];
      // Run in a copy: a drive writes its evidence, and the checker must not leave evidence of its own in the run it is judging.
      const copy = mkdtempSync(join(tmpdir(), 'wf-drive-'));
      let doctorRun: ReturnType<typeof shell> | undefined;
      let driveRun: ReturnType<typeof shell> | undefined;
      try {
        cpSync(view.repo, copy, { recursive: true });
        doctorRun = doctor === '' ? undefined : shell(copy, doctor);
        driveRun = drive === '' ? undefined : shell(copy, SHELL_START.test(drive) ? drive : `sh ${drive}`);
      } finally {
        rmSync(copy, { recursive: true, force: true });
      }
      return when(doctorRun?.status === 0 && driveRun !== undefined && promised !== undefined && driveRun.stdout.includes(promised.trim()), `doctor ok, drive printed ${driveRun?.stdout.trim().split('\n').at(-1)} as promised (${promised})`, `doctor \`${doctor}\` exit ${doctorRun?.status}; drive \`${drive}\` exit ${driveRun?.status} printed ${driveRun?.stdout.trim().slice(0, 80)}; promised ${promised}`);
    }),
    check('verify-skill.evidence-survives-cleanup', 'after cleanup the evidence still exists at the location the skill names', src('create-verification-skill/SKILL.md', 'confirm the evidence still exists at the named location'), (view) => {
      const { text } = generatedSkill(view);
      // A named location is a code span under .pi/, artifacts/ or evidence/; a `<slot>` in it ends the fixed part (`artifacts/verify-cart/<feature>/<label>.txt`).
      const named = [...sectionText(text, 'Evidence').matchAll(/`((?:\.pi|artifacts|evidence)\/[^`\n]*)`/g)].map((match) => (match[1] as string).split('<')[0]?.replace(/\/$/, '') ?? '');
      const present = named.filter((path) => path !== '' && existsSync(join(view.repo, path)) && (statSync(join(view.repo, path)).isFile() || filesUnder(join(view.repo, path)).some((file) => statSync(join(view.repo, path, file)).size > 0)));
      return when(present.length > 0, `${present[0]} still holds evidence after cleanup`, `the skill names ${named.join(', ') || 'no evidence location'}; none holds a non-empty file`);
    }),
    check('verify-skill.was-run-before-handoff', 'the parent ran the skill\'s doctor command, then drove a feature the way the feature map shows, and cleaned up when the skill has a cleanup command', src('create-verification-skill/SKILL.md', 'A generated skill that was never executed is a draft, not a deliverable'), (view) => {
      const { dir, text } = generatedSkill(view);
      const commands = view.parent.toolCalls.filter((call) => call.name === 'bash').map((call) => String(call.args['command']));
      const doctor = firstCommand(sectionText(text, 'Doctor'));
      const features = join(dir, 'features');
      const driveHelper = /(\S*\.sh)\b/.exec(firstCommand(text.length > 0 && existsSync(features) ? read(join(features, readdirSync(features).filter((file) => file !== 'README.md' && file.endsWith('.md')).sort()[0] ?? 'README.md')) : ''))?.[1];
      const cleanup = firstCommand(sectionText(text, 'Cleanup'));
      const at = (needle: string) => (needle === '' ? -1 : commands.findIndex((command) => command.includes(needle)));
      const doctorAt = Math.max(at(doctor), commands.findIndex((command) => /\.sh[^\n]* doctor\b/.test(command) && !command.includes('skipped')));
      const driveAt = commands.findIndex((command, index) => index > doctorAt && /\.sh[^\n]*\b(drive|--)\b|\bbin\//.test(command));
      const cleanupAt = cleanup === '' || /\bnone\b|nothing/i.test(sectionText(text, 'Cleanup').slice(0, 120)) ? driveAt : commands.findIndex((command, index) => index > driveAt && command.includes(cleanup));
      void driveHelper;
      return when(doctorAt !== -1 && driveAt > doctorAt && cleanupAt >= driveAt, `doctor at ${doctorAt}, drive at ${driveAt}, cleanup at ${cleanupAt}`, `positions doctor ${doctorAt}, drive ${driveAt}, cleanup ${cleanupAt}`);
    }),
    repoUntouched('verify-skill.production-code-untouched', 'no production file changed (the skill under .pi/ and the evidence under artifacts/ are the deliverable)', src('create-verification-skill/SKILL.md', 'If the checkout doesn\'t build or start as-is, fix that first')),
  ],
  negatives: [
    {
      name: 'the helper folder is helpers/ instead of scripts/, the evidence location is a code span with slots, and the usage line has <feature> and <label> arguments',
      mutate: (sandbox) => {
        const dir = join(sandbox, 'repo', VDIR);
        cpSync(join(dir, 'scripts'), join(dir, 'helpers'), { recursive: true });
        rmSync(join(dir, 'scripts'), { recursive: true, force: true });
        for (const file of ['SKILL.md', 'features/README.md', 'features/total.md', 'features/coupon.md']) writeFileSync(join(dir, file), read(join(dir, file)).replaceAll('scripts/', 'helpers/').replace('.pi/verify-cart-evidence/<name>.txt', '.pi/verify-cart-evidence/<feature>/<label>.txt'));
        writeFileSync(join(dir, 'SKILL.md'), `${read(join(dir, 'SKILL.md'))}\nUsage: drive <feature> <label>\n`);
      },
      fails: [],
      passes: ['verify-skill.registers-with-the-required-sections', 'verify-skill.feature-map', 'verify-skill.helper-is-executable-and-shown', 'verify-skill.doctor-and-drive-work-on-the-real-app', 'verify-skill.evidence-survives-cleanup'],
    },
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
