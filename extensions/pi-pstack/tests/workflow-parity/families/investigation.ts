// Families: how, why, teach, and the Investigation playbook (spec 12.1).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { cartHistory, lineOf } from '../fixtures/repos.ts';
import { type Check, check, fail, type Outcome, pass, type Src, src, when } from '../lib/check.ts';
import {
  allWorkers,
  assignmentOf,
  briefCarries,
  citationsResolve,
  collectOrder,
  expectedModels,
  fileReferencesResolve,
  finalReply,
  modelIdentity,
  noInventedSources,
  noToolErrors,
  openedAt,
  parentNeverOpened,
  parentRanBeforeSpawn,
  parentReads,
  playbookReads,
  primaryRun,
  promptRoutes,
  readonlyEnforced,
  receiptsFor,
  replyLacks,
  replySections,
  repoUntouched,
  settledAndCollected,
  skillFile,
  spawnedAfterCollect,
  spawnedTogether,
  spawnOrder,
  todoChecks,
  workersCheck,
} from '../lib/checks.ts';
import { PI, SCRIPTED_ROLES } from '../lib/driver.ts';
import { appendToBrief, appendToolCall, cloneWorker, corruptArtifact, deleteReceipt, deleteStep, dirtyRepo, dropWakes, overwrite, parentSession, patchAssignment, removeWorker, reorderHistory, rewriteFinalReply, rewriteSession, setStep, stripEvidence, workerSessionFile } from '../lib/mutate.ts';
import type { RunView } from '../lib/view.ts';
import type { Family } from './types.ts';

const model = (line: string) => String(SCRIPTED_ROLES[line]);
const cart = (needle: string, path = 'src/cart.js') => lineOf(cartHistory, path, needle);

const HOW_SECTIONS = ['Overview', 'Key Concepts', 'How It Works', 'Where Things Live', 'Gotchas'];

const EXPLORER_1 = `### Components Found
- lineTotal, subtotal, applyCoupon and total in src/cart.js:${cart('export function lineTotal')}. total() composes subtotal() and applyCoupon().
### Flow
total(items, couponPercent) at src/cart.js:${cart('export function total')} sums the rounded lines, then applyCoupon() at src/cart.js:${cart('export function applyCoupon')} takes the percent off and rounds to cents.
### Files Read
src/cart.js, src/money.js
### Boundaries
Input is an items array of price and qty. Output is a number of dollars.`;

const EXPLORER_2 = `### Components Found
- checkout() in src/checkout.js:${cart('export function checkout', 'src/checkout.js')} and formatMoney() in src/money.js:${cart('export function formatMoney', 'src/money.js')}.
### Flow
checkout() calls total() from src/cart.js, then formatMoney() to build the label.
### Files Read
src/checkout.js, src/money.js
### Boundaries
checkout() is the only caller of formatMoney().`;

const EXPLAINER = `### Overview
The cart prices a list of items and takes a coupon percent off. checkout() is the entry point.
### Key Concepts
total() in src/cart.js:${cart('export function total')} is the pricing function. formatMoney() in src/money.js:${cart('export function formatMoney', 'src/money.js')} only formats.
### How It Works
checkout() in src/checkout.js:${cart('export function checkout', 'src/checkout.js')} calls total(), which sums rounded lines and applies applyCoupon() at src/cart.js:${cart('export function applyCoupon')}.
### Where Things Live
Pricing is src/cart.js. Formatting is src/money.js. The entry point is src/checkout.js.
### Gotchas
A coupon percent above 100 is not clamped in applyCoupon().`;

function dropCheckpointLine(sandbox: string): void {
  overwrite(join(sandbox, 'repo/.pi/pstack/runs/investigate-checkout/TODO.md'), (text) => text.split('\n').filter((line) => !line.includes('- [ ] throughput checkpoint')).join('\n'));
}

function explorerScript(findings: string, files: string[]): Worker {
  const worker = new Worker();
  for (const file of files) worker.read(join('{repo}', file));
  return worker.call('bash_readonly', { command: 'git log --oneline -4' }).text(findings);
}

const withRepo = (worker: Worker, repo: string): Worker => {
  for (const step of worker.steps) {
    const calls = (Array.isArray(step) ? step : [step]) as { args?: { path?: string } }[];
    for (const call of calls) if (call.args?.path !== undefined) call.args.path = call.args.path.replace('{repo}', repo);
  }
  return worker;
};

// how has two paths (how/SKILL.md "1. Assess complexity"). A run is on the complex path when it spawned explorers and on
// the simple path when it spawned none, so each check below holds the run to the contract of the path it took.
type HowPath = 'simple' | 'complex';
const howPath = (view: RunView): HowPath => (allWorkers(view).some((worker) => assignmentOf(worker).role === 'explorer') ? 'complex' : 'simple');
const SIMPLE_SPAN = src('how/SKILL.md', 'no explorers. Spawn one explainer that explores and explains in one pass');
const COMPLEX_SPAN = src('how/SKILL.md', 'Decompose the question into 2 to 4 angles');

/** A check that runs `complex` on the complex path and `simple` on the simple path, citing the span for each. */
function byPath(id: string, title: string, sources: Src[], simple: (view: RunView) => Outcome, complex: (view: RunView) => Outcome): Check {
  return check(id, title, sources, (view) => {
    const path = howPath(view);
    const outcome = path === 'simple' ? simple(view) : complex(view);
    return 'skip' in outcome || 'inconclusive' in outcome ? outcome : { ...outcome, evidence: `${path} path: ${outcome.evidence}` };
  });
}

/**
 * The assistant message that presents the explainer's output (how/SKILL.md "4. Present"). A wake that lands after the
 * parent has already collected starts another, shorter turn, so the last message is not always the one that presents.
 */
function presentedHow(view: RunView): string {
  const explainer = allWorkers(view).find((worker) => assignmentOf(worker).role === 'general');
  // The explainer may open with a sentence before its first section ("All checks done. ..."); a light edit drops it (how SKILL.md: "Light
  // edits for clarity ... are fine"), so the opening that must survive is the first how section's.
  const body = (text: string) => {
    const section = new RegExp(`^#{1,4}\\s*(${HOW_SECTIONS.join('|')})\\b`, 'im').exec(text);
    return text.slice(section?.index ?? 0);
  };
  const probe = (text: string) => body(text).replace(/\s+/g, ' ').trim().slice(0, 60);
  if (explainer === undefined || probe(explainer.finalText) === '') return '';
  return [...view.parent.messages].reverse().find((message) => message.role === 'assistant' && message.text.replace(/\s+/g, ' ').includes(probe(explainer.finalText)))?.text ?? '';
}

const notAnExplorerPath = (what: string) => (): Outcome => pass(`${what} applies only to the complex path, and no explorer ran`);

function howChecks(): Check[] {
  const explorers = workersCheck('how.explorers', '', [], { role: 'explorer', min: 2, max: 4, mode: 'readonly', rootPath: true, modelLine: 'how explorer' });
  const explainerAfter = spawnedAfterCollect('how.explainer-after-explorers', '', [], ['general'], ['explorer']);
  const together = spawnedTogether('how.explorers-in-one-message', [], ['explorer']);
  const findings = briefCarries('how.explainer-brief-has-findings', '', [], ['general'], ['explorer']);
  return [
    promptRoutes('how'),
    parentReads('how.reads-skill-and-templates', 'the parent opens how SKILL.md before its first spawn', src('how/SKILL.md', 'spawn one explainer with `references/explainer-prompt.md`'), ['how'], { beforeFirstSpawn: true }),
    byPath(
      'how.reads-templates',
      'the parent opens the explainer template, and the explorer template when it spawns explorers',
      [SIMPLE_SPAN, COMPLEX_SPAN],
      (view) => when(openedAt(view.parent, 'generated/skills/how/references/explainer-prompt.md') !== -1, 'explainer-prompt.md was opened', 'explainer-prompt.md was not opened'),
      (view) => {
        const missing = ['explorer-prompt.md', 'explainer-prompt.md'].filter((file) => openedAt(view.parent, `generated/skills/how/references/${file}`) === -1);
        return when(missing.length === 0, 'both templates were opened', `not opened: ${missing.join(', ')}`);
      },
    ),
    byPath('how.explorers', 'complex: 2 to 4 explorers, role explorer, readonly on the repository root, on the "how explorer" line. Simple: no explorers', [SIMPLE_SPAN, COMPLEX_SPAN], () => pass('no explorers'), explorers.run),
    workersCheck('how.explainer', 'exactly one explainer, role general, readonly on the repository root, on the "how explainer" model line', src('how/SKILL.md', '`role: "general"` for explainers'), { role: 'general', min: 1, max: 1, mode: 'readonly', rootPath: true, modelLine: 'how explainer' }),
    byPath('how.explorers-in-one-message', 'complex: the explorers were spawned in a single message', [COMPLEX_SPAN, src('how/SKILL.md', 'Spawn all explorers in a single message')], notAnExplorerPath('spawning explorers together'), together.run),
    byPath(
      'how.explainer-after-explorers',
      'complex: the explainer is spawned only after every explorer has returned. Simple: it is the only worker',
      [src('how/SKILL.md', 'Once all explorers have returned, spawn one explainer'), SIMPLE_SPAN],
      (view) => when(allWorkers(view).length === 1, 'the explainer is the only worker', `${allWorkers(view).length} workers on the simple path`),
      explainerAfter.run,
    ),
    byPath(
      'how.explainer-brief-has-findings',
      "complex: the explainer's brief carries every explorer's findings. Simple: its brief has no explorer-findings section",
      [src('how/SKILL.md', 'every explorer\'s findings filled in'), src('how/SKILL.md', 'without the explorer-findings section')],
      (view) => {
        const explainer = allWorkers(view).find((worker) => assignmentOf(worker).role === 'general');
        return when(explainer !== undefined && !/explorer findings/i.test(explainer.brief ?? ''), 'the brief has no explorer-findings section', 'the explainer brief carries an explorer-findings section on the simple path');
      },
      findings.run,
    ),
    byPath(
      'how.explorer-output-shape',
      "complex: each explorer's reply has the template's Components Found, Flow, Files Read, Boundaries sections",
      [COMPLEX_SPAN, src('how/references/explorer-prompt.md', '### Components Found')],
      notAnExplorerPath('the explorer reply shape'),
      (view) => {
        const found = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'explorer');
        const bad = found.filter((worker) => !['Components Found', 'Flow', 'Files Read', 'Boundaries'].every((section) => worker.finalText.includes(`### ${section}`)));
        return when(found.length > 0 && bad.length === 0, `${found.length} explorer replies have all four sections`, `incomplete: ${bad.map((worker) => worker.id).join(', ') || 'no explorers'}`);
      },
    ),
    readonlyEnforced('how.readonly-enforced', src('how/SKILL.md', 'Every spawn is a `pstack_worker` worker with `workspace: { mode: "readonly"'), ['explorer', 'general']),
    repoUntouched('how.no-writes', 'the repository is untouched: how is read-only', src('poteto-mode/playbooks/investigation.md', 'Investigation requests are read-only')),
    settledAndCollected('how.settled-and-collected', src('how/SKILL.md', '## 4. Present')),
    check('how.output-sections', 'the explainer output is presented with only the five how sections (under at most one H1 title)', src('how/SKILL.md', 'Do not substantially rewrite it'), (view) => {
      const explainer = allWorkers(view).find((worker) => assignmentOf(worker).role === 'general');
      const reply = presentedHow(view);
      if (explainer === undefined || reply === '') return fail(`no assistant message presents the explainer output (${explainer === undefined ? 'no explainer' : 'none repeats its opening'})`);
      const all = [...reply.matchAll(/^(#{1,4})\s*(.+)$/gm)].map((match) => ({ level: (match[1] as string).length, text: (match[2] as string).trim() }));
      // One H1 or H2 that opens the reply is the answer's title, not a section: how's five sections sit below it, at a deeper level.
      const isSection = (text: string) => HOW_SECTIONS.some((section) => section.toLowerCase() === text.toLowerCase());
      const [first] = all;
      const titled = first !== undefined && first.level <= 2 && !isSection(first.text) && all.slice(1).every((heading) => heading.level > first.level);
      const headings = (titled ? all.slice(1) : all).map((heading) => heading.text);
      const unknown = headings.filter((heading) => !HOW_SECTIONS.some((section) => section.toLowerCase() === heading.toLowerCase()));
      return when(headings.length > 0 && unknown.length === 0, `sections ${headings.join(', ')}; the explainer output is presented`, `unknown headings: ${unknown.join(', ') || 'none'}`);
    }),
    fileReferencesResolve('how.references-resolve', src('how/references/explainer-prompt.md', 'Reference specific files and functions'), { min: 3, from: presentedHow }),
    noToolErrors('how.no-tool-errors', src('how/SKILL.md', '## 4. Present')),
  ].map((inner): Check => ({ ...inner, run: (view) => {
    const workers = allWorkers(view);
    const missingExplainer = !workers.some((worker) => assignmentOf(worker).role === 'general');
    const needsExplainer = ['how.explainer-after-explorers', 'how.explainer-brief-has-findings', 'how.output-sections'].includes(inner.id);
    const needsWorkers = ['how.readonly-enforced', 'how.settled-and-collected'].includes(inner.id);
    return missingExplainer && (needsExplainer || (needsWorkers && workers.length === 0)) ? { inconclusive: 'derived from how.explainer: no explainer ran, so its ordering, output, and execution cannot be assessed' } : inner.run(view);
  } }));
}

const HOW_QUESTION = 'how does checkout compute the total, and where do coupons apply?';

export const howFamily: Family = {
  id: 'how',
  title: 'how: explorers and an explainer, all readonly (spec 12.1)',
  spec: {
    family: 'how',
    runId: 'how-checkout',
    history: cartHistory,
    prompt: () => `/how ${HOW_QUESTION}`,
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const explorer = () => ({ role: 'explorer', model: model('how explorer'), workspace: parent.readonly() });
      parent
        .readSkill('how')
        .readReference('how', 'explorer-prompt.md')
        .readReference('how', 'explainer-prompt.md')
        .bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook investigation --title "how: checkout totals" --run-id ${ctx.runId}`);
      const one = parent.stage('explorer-1', explorer(), `Question: ${HOW_QUESTION}\nAngle: pricing arithmetic in src/cart.js. Report components, flow, files read, boundaries.`);
      const two = parent.stage('explorer-2', explorer(), `Question: ${HOW_QUESTION}\nAngle: checkout and formatting in src/checkout.js and src/money.js. Report components, flow, files read, boundaries.`);
      parent.fire(one, two).wait('explorer-1').wait('explorer-2').collect('explorer-1', 'explorer-2');
      parent.spawn('explainer', { role: 'general', model: model('how explainer'), workspace: parent.readonly() }, `Question: ${HOW_QUESTION}\n\n## Explorer Findings\n\n${EXPLORER_1}\n\n${EXPLORER_2}\n\nWrite the explanation with Overview, Key Concepts, How It Works, Where Things Live, Gotchas.`);
      parent.wait('explainer').collect('explainer').text(EXPLAINER);
      return scenario(parent, {
        'explorer-1': withRepo(explorerScript(EXPLORER_1, ['src/cart.js', 'src/money.js']), ctx.repo),
        'explorer-2': withRepo(explorerScript(EXPLORER_2, ['src/checkout.js', 'src/money.js']), ctx.repo),
        explainer: withRepo(new Worker().read(join('{repo}', 'src/cart.js')).text(EXPLAINER), ctx.repo),
      });
    },
  },
  checks: howChecks(),
  negatives: [
    { name: 'a readonly explorer wrote a file', mutate: (sandbox) => appendToolCall(workerSessionFile(sandbox, 'how-checkout', 'explorer-1'), 'write', { path: '/x/src/cart.js', content: 'x' }), fails: ['how.readonly-enforced'] },
    { name: 'the main checkout was edited during a read-only investigation', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['how.no-writes'] },
    { name: 'an explorer got a writable worktree', mutate: (sandbox) => patchAssignment(sandbox, 'how-checkout', 'explorer-1', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: 'abc1234' })), fails: ['how.explorers'] },
    { name: 'only one explorer ran', mutate: (sandbox) => removeWorker(sandbox, 'how-checkout', 'explorer-2'), fails: ['how.explorers'] },
    { name: 'an explorer ran on the wrong model line', mutate: (sandbox) => patchAssignment(sandbox, 'how-checkout', 'explorer-1', (assignment) => (assignment['model'] = 'sim/grok-sim')), fails: ['how.explorers'] },
    { name: 'the reply cites a file that does not exist', mutate: (sandbox) => rewriteFinalReply(sandbox, /src\/cart\.js:/g, 'src/nope.js:'), fails: ['how.references-resolve'] },
    { name: 'the parent never opened the how skill', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'generated/skills/how/SKILL.md', 'generated/skills/zzz/SKILL.md'), fails: ['how.reads-skill-and-templates'] },
    { name: 'no wake reached the parent', mutate: (sandbox) => dropWakes(sandbox), fails: ['how.settled-and-collected'] },
  ],
};

const SIMPLE_QUESTION = 'how does formatMoney in src/money.js build its label?';
const SIMPLE_EXPLAINER = `### Overview
formatMoney() in src/money.js:${cart('export function formatMoney', 'src/money.js')} turns a number of dollars into a label for the checkout.
### Key Concepts
It only formats. The amount arrives already rounded from total() in src/cart.js:${cart('export function total')}.
### How It Works
checkout() in src/checkout.js:${cart('export function checkout', 'src/checkout.js')} calls total(), then passes the result to formatMoney().
### Where Things Live
Formatting is src/money.js. The caller is src/checkout.js.
### Gotchas
formatMoney() does not round, so a caller that skips total() can print a long fraction.`;

/** how/SKILL.md "Simple ... no explorers. Spawn one explainer", with no start-run.mjs: spawn makes the run. */
export const howSimpleFamily: Family = {
  id: 'how-simple',
  title: 'how, simple path: one explainer and no explorers, with no run set up beforehand (spec 12.1)',
  spec: {
    family: 'how-simple',
    runId: 'how-money',
    history: cartHistory,
    prompt: () => `/how ${SIMPLE_QUESTION}`,
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      parent.readSkill('how').readReference('how', 'explainer-prompt.md');
      parent.spawn('explainer', { role: 'general', model: model('how explainer'), workspace: parent.readonly() }, `Question: ${SIMPLE_QUESTION}\n\nExplore src/money.js and explain it in one pass. Write the explanation with Overview, Key Concepts, How It Works, Where Things Live, Gotchas.`);
      parent.wait('explainer').collect('explainer').text(SIMPLE_EXPLAINER);
      return scenario(parent, { explainer: withRepo(new Worker().read(join('{repo}', 'src/money.js')).text(SIMPLE_EXPLAINER), ctx.repo) });
    },
  },
  checks: howChecks(),
  negatives: [
    { name: 'the explainer opened with a sentence the parent dropped before presenting the sections', mutate: (sandbox) => rewriteSession(workerSessionFile(sandbox, 'how-money', 'explainer'), '### Overview', 'All checks done, my report follows.\\n\\n### Overview'), fails: [], passes: ['how.output-sections'] },
    { name: 'no message presents the explainer sections at all', mutate: (sandbox) => rewriteFinalReply(sandbox, /### Overview[\s\S]*### Gotchas[^\n]*\n?[^\n]*/, 'It formats money.'), fails: ['how.output-sections'] },
    { name: 'the presented answer opens with one H2 title above the five sections', mutate: (sandbox) => rewriteFinalReply(sandbox, '### Overview', '## How formatMoney builds its label\n\n### Overview'), fails: [], passes: ['how.output-sections'] },
    { name: 'the presented answer has an H2 title and a second H2 further down', mutate: (sandbox) => rewriteFinalReply(sandbox, /### Overview[\s\S]*### Gotchas/, (text) => `## Title\n\n${text.replace('### Gotchas', '## Gotchas')}`), fails: ['how.output-sections'] },
    { name: 'the presented answer opens with one H1 title above the five sections', mutate: (sandbox) => rewriteFinalReply(sandbox, '### Overview', '# How formatMoney builds its label\n\n### Overview'), fails: [], passes: ['how.output-sections'] },
    { name: 'the presented answer lowercases the second word of its section titles', mutate: (sandbox) => rewriteFinalReply(sandbox, /### (Key|Where|How) (Concepts|Things|It)/g, (_m, a: string, b: string) => `### ${a} ${b.toLowerCase()}`), fails: [], passes: ['how.output-sections'] },
    { name: 'the presented answer adds a section the how template does not have', mutate: (sandbox) => rewriteFinalReply(sandbox, '### Gotchas', '### Extras\nmore\n### Gotchas'), fails: ['how.output-sections'] },
    { name: 'the presented answer has an H1 title and a second H1 further down', mutate: (sandbox) => rewriteFinalReply(sandbox, /### Overview[\s\S]*### Gotchas/, (text) => `# Title\n\n${text.replace('### Gotchas', '# Gotchas')}`), fails: ['how.output-sections'] },
    { name: 'an explorer ran alongside the explainer: one explorer is not 2 to 4', mutate: (sandbox) => cloneWorker(sandbox, 'how-money', 'explainer', 'explorer-1', { role: 'explorer' }), fails: ['how.explorers'] },
    { name: 'the simple path brief still carries an explorer-findings section', mutate: (sandbox) => appendToBrief(sandbox, 'how-money', 'explainer', '\n## Explorer Findings\n\nnone'), fails: ['how.explainer-brief-has-findings'] },
    { name: 'a second worker ran after the explainer', mutate: (sandbox) => cloneWorker(sandbox, 'how-money', 'explainer', 'extra', {}), fails: ['how.explainer', 'how.explainer-after-explorers'] },
    { name: 'the explainer got a writable worktree', mutate: (sandbox) => patchAssignment(sandbox, 'how-money', 'explainer', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: 'abc1234' })), fails: ['how.explainer'] },
    { name: 'the parent never opened the explainer template', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'references/explainer-prompt.md', 'references/zzz.md'), fails: ['how.reads-templates'] },
    { name: 'the explainer wrote a file', mutate: (sandbox) => appendToolCall(workerSessionFile(sandbox, 'how-money', 'explainer'), 'write', { path: '/x/src/money.js', content: 'x' }), fails: ['how.readonly-enforced'] },
  ],
};

// ---- why (spec 12.1: MCP kept, no invented sources)

const CATEGORIES = ['Source control', 'Issue / ticket tracker', 'Long-form documents', 'Real-time team chat', 'Infrastructure observability', 'Error / exception tracking', 'Product analytics warehouse'];

const WHY_QUESTION = 'why does applyCoupon take a percent instead of an amount off?';

const INVESTIGATOR = `Source control findings
- The coupon was added in "feat: coupon percent off (#118)", whose total() takes couponPercent and subtracts amount * couponPercent / 100.
- "fix: round totals to cents (#124)" later wrapped the result in a round helper.
- "refactor: split money helpers and add checkout (#130)" moved applyCoupon into src/cart.js:${cart('export function applyCoupon')}.
No review discussion was available offline, so the rationale itself is not recorded in git.`;

const SYNTHESIS = `### The Question
${WHY_QUESTION}
### The Code in Question
src/cart.js:${cart('export function applyCoupon')} applyCoupon(amount, percent).
### What We Found
Coupons arrived as a percent in #118 and were rounded in #124. #130 extracted applyCoupon.
### What We Can Reasonably Infer
The percent shape was the simplest first version of a coupon, inferred from the #118 commit subject.
### Competing Hypotheses
A fixed amount off was not built first, and no source says why.
### What We Don't Know
The product reason for percent coupons is not recorded in the sources searched.
### Sources Consulted
- Source control: git log and blame, found #118, #124, #130.
- Issue / ticket tracker: skipped, no matching MCP available.
- Long-form documents: skipped, no matching MCP available.
- Real-time team chat: skipped, no matching MCP available.
- Infrastructure observability: skipped, no matching MCP available.
- Error / exception tracking: skipped, no matching MCP available.
- Product analytics warehouse: skipped, no matching MCP available.
### Confidence Summary
Low confidence on the motive, high confidence on the history.`;

const WHY_SECTIONS = ['The Question', 'The Code in Question', 'What We Found', 'What We Can Reasonably Infer', 'Competing Hypotheses', "What We Don't Know", 'Sources Consulted', 'Confidence Summary'];

function whyParent(parent: Parent, options: { skills: string[]; teach?: boolean }): void {
  const { ctx } = parent;
  parent.readSkill('why');
  for (const file of ['epistemics.md', 'investigator-prompt.md', 'synthesizer-prompt.md', 'source-playbook.md']) parent.readReference('why', file);
  parent
    .bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook investigation --title "why: coupon percent" --run-id ${ctx.runId}`)
    .bash('git blame -L 1,20 src/cart.js')
    .bash('git log --follow -p -- src/cart.js | head -60')
    .bash('git log --oneline -20 -- src/cart.js')
    .bash('git log -1 --format=%B HEAD')
    .bash(`${PI} mcp list`);
  void options;
}

const whyWorkers = (parent: Parent) => ({
  investigator: { role: 'investigator', model: model('why investigators'), workspace: parent.readonly(), capabilities: { mcp: 'inherit', env: 'inherit', externalWrite: false } },
  synthesizer: { role: 'general', model: model('why synthesizer'), workspace: parent.readonly(), capabilities: { mcp: 'inherit', env: 'inherit', externalWrite: false } },
});

// why answers inline only "in the rare provably-redundant case" (why/SKILL.md "Step 3"): a run that spawned no worker took
// that branch and owes the explicit statement the skill asks for; every other run holds to the investigator contract.
type WhyPath = 'inline' | 'investigated';
const whyPath = (view: RunView): WhyPath => (allWorkers(view).length === 0 ? 'inline' : 'investigated');
const INLINE_SPAN = src('why/SKILL.md', 'you may answer inline **only after** confirming all seven available category searches would be redundant');

/** Runs `inner` on an investigated run; an inline run has no workers for it to read. */
function whenInvestigated(inner: Check): Check {
  return check(inner.id, inner.title, inner.src, (view) => (whyPath(view) === 'inline' ? pass('inline answer: no worker was spawned, so there is nothing to hold to this contract') : inner.run(view)));
}

const whyChecks = (prefix: string): Check[] => [
  parentRanBeforeSpawn(`${prefix}.code-anchor`, 'the parent builds the code anchor (git blame, git log --follow, git log) before any investigator spawns', src('why/SKILL.md', 'Run `git blame -L <start>,<end> <file>`'), [/git blame/, /git log --follow/, /git log --oneline/]),
  check(`${prefix}.mcp-discovery`, 'the parent discovers MCP servers before spawning investigators: `pi mcp list`, or the mcp__ tools the session already lists', [src('why/SKILL.md', 'Otherwise run `pi mcp list`'), src('why/SKILL.md', 'Use the `mcp_servers` section of the system prompt')], (view) => {
    const spawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn')?.order ?? Number.POSITIVE_INFINITY;
    const listed = view.parent.toolCalls.find((call) => call.name === 'bash' && /\bmcp list\b/.test(String(call.args['command'])) && call.order < spawn);
    if (listed !== undefined) return pass(`mcp list answered: ${listed.resultText.split('\n')[0]?.slice(0, 80)}`);
    const tool = view.parent.toolCalls.find((call) => call.name.startsWith('mcp__') && call.order < spawn);
    return tool === undefined ? fail('no `pi mcp list` and no mcp__ tool call before the first spawn') : pass(`the session's own ${tool.name} tool was used before the first spawn`);
  }),
  whenInvestigated(workersCheck(`${prefix}.investigators`, 'one investigator per evidence category that has an MCP (source control always, so 1 to 7), readonly on the root, MCP inherited, on the "why investigators" line', [src('why/SKILL.md', 'Spawn one investigator per category that has a matching MCP'), src('why/SKILL.md', '**Do not set `capabilities.mcp: "none"`.**')], { role: 'investigator', min: 1, max: 7, mode: 'readonly', rootPath: true, mcpInherit: true, modelLine: 'why investigators' })),
  whenInvestigated(workersCheck(`${prefix}.synthesizer`, 'one synthesizer, role general, readonly, MCP inherited, on the "why synthesizer" line', src('why/SKILL.md', 'Spawn one synthesizer'), { role: 'general', min: 1, max: 1, mode: 'readonly', rootPath: true, mcpInherit: true, modelLine: 'why synthesizer' })),
  whenInvestigated(spawnedAfterCollect(`${prefix}.synthesizer-after-investigators`, 'the synthesizer is spawned after every investigator is collected', src('why/SKILL.md', '## Step 4. Synthesize'), ['general'], ['investigator'])),
  whenInvestigated(briefCarries(`${prefix}.synthesizer-brief-has-findings`, "the synthesizer's brief carries the investigator findings", src('why/SKILL.md', 'The investigator findings, including any null results'), ['general'], ['investigator'])),
  whenInvestigated(readonlyEnforced(`${prefix}.readonly-enforced`, src('why/SKILL.md', 'A readonly worker runs `git` and `gh` through `bash_readonly` and cannot write files'), ['investigator', 'general'])),
  repoUntouched(`${prefix}.no-writes`, 'the repository is untouched', src('why/SKILL.md', "Investigators still shouldn't write anything")),
  whenInvestigated(settledAndCollected(`${prefix}.settled-and-collected`, src('why/SKILL.md', '## Step 5. Present'))),
  check(`${prefix}.inline-answer-is-justified`, 'an inline answer says explicitly that every category search would be redundant', INLINE_SPAN, (view) => {
    if (whyPath(view) === 'investigated') return pass('investigators ran: no inline answer to justify');
    const reply = finalReply(view);
    return when(/redundant/i.test(reply) && /(single|one) commit|PR description/i.test(reply), 'the reply says the searches would be redundant and why', 'an inline answer without saying that all seven category searches would be redundant');
  }),
  check(`${prefix}.sources-consulted-covers-seven-categories`, 'Sources Consulted names all seven evidence categories, each with a result or the reason it was skipped', src('why/SKILL.md', 'keep Sources Consulted as one line per investigator'), (view) => {
    if (whyPath(view) === 'inline') return pass('inline answer: the justification above replaces the per-category lines');
    const reply = finalReply(view);
    const block = reply.split(/Sources Consulted/i)[1]?.split(/###? ?Confidence Summary/i)[0] ?? '';
    const lines = block.split('\n');
    // A line accounts for a category with a result word, or with a sentence of its own: the skill asks for "one line per investigator" with the reason and prescribes no vocabulary.
    const accounts = (line: string, category: string) => {
      const at = line.toLowerCase().indexOf(category.toLowerCase());
      return at !== -1 && (/(found|skipped|no matching|searched|nothing|null)/i.test(line) || line.slice(at + category.length).replace(/[^\w ]/g, '').trim().length >= 30);
    };
    const missing = CATEGORIES.filter((category) => !lines.some((line) => accounts(line, category)));
    return when(missing.length === 0, `all ${CATEGORIES.length} categories accounted for`, `categories with no line: ${missing.join(', ')}`);
  }),
  noInventedSources(`${prefix}.no-invented-sources`, src('why/references/investigator-prompt.md', '**Never invent.**')),
];

export const whyFamily: Family = {
  id: 'why',
  title: 'why: code anchor, MCP discovery, investigators, synthesizer, honest gaps (spec 12.1)',
  spec: {
    family: 'why',
    runId: 'why-coupons',
    history: cartHistory,
    prompt: () => `/why ${WHY_QUESTION}`,
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      whyParent(parent, { skills: [] });
      const kinds = whyWorkers(parent);
      parent.spawn('git-investigator', kinds.investigator, `Question: ${WHY_QUESTION}\nOwn exactly one source: git history and gh. Anchor: src/cart.js applyCoupon and total.`).wait('git-investigator').collect('git-investigator');
      parent.spawn('synth', kinds.synthesizer, `Question: ${WHY_QUESTION}\n\n## Investigator Findings\n\n${INVESTIGATOR}\n\n## Sources That Weren't Searched\n\nIssue tracker, documents, chat, observability, error tracking, analytics: no matching MCP available.`).wait('synth').collect('synth').text(SYNTHESIS);
      return scenario(parent, {
        'git-investigator': new Worker().call('bash_readonly', { command: 'git log --format=%h\\ %s -10 -- src/cart.js' }).text(INVESTIGATOR),
        synth: new Worker().read(join(ctx.repo, 'src/cart.js')).text(SYNTHESIS),
      });
    },
  },
  checks: [
    promptRoutes('why'),
    parentReads('why.reads-skill-and-references', 'the parent opens why SKILL.md and its epistemics and prompt templates before spawning', src('why/SKILL.md', 'Read `references/epistemics.md` for the full confidence framework'), ['why'], { beforeFirstSpawn: true }),
    ...whyChecks('why'),
    replySections('why.output-sections', 'the reply keeps the eight why sections', src('why/SKILL.md', 'The structure is the one in `references/synthesizer-prompt.md`'), WHY_SECTIONS),
    citationsResolve('why.citations-resolve', src('why/SKILL.md', 'cited read on decisions'), { min: 1 }),
  ],
  negatives: [
    { name: 'the investigator was given no MCP', mutate: (sandbox) => patchAssignment(sandbox, 'why-coupons', 'git-investigator', (assignment) => (assignment['capabilities'] = { mcp: 'none', env: 'inherit', externalWrite: false })), fails: ['why.investigators'] },
    { name: 'the reply cites a PR the run never saw', mutate: (sandbox) => rewriteFinalReply(sandbox, '#118', '#999'), fails: ['why.no-invented-sources'] },
    { name: 'the reply drops the skipped-source accounting', mutate: (sandbox) => rewriteFinalReply(sandbox, /skipped, no matching MCP available/g, 'fine'), fails: ['why.sources-consulted-covers-seven-categories'] },
    { name: 'the reply gives each category a line of its own sentence with no result word', mutate: (sandbox) => rewriteFinalReply(sandbox, /skipped, no matching MCP available/g, 'an MCP for it was not configured on this machine at all'), fails: [], passes: ['why.sources-consulted-covers-seven-categories'] },
    { name: 'no code anchor before the spawn', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'git blame', 'git status'), fails: ['why.code-anchor'] },
    { name: 'the investigator wrote a file', mutate: (sandbox) => appendToolCall(workerSessionFile(sandbox, 'why-coupons', 'git-investigator'), 'write', { path: '/x', content: 'x' }), fails: ['why.readonly-enforced'] },
    { name: 'the tree was edited', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['why.no-writes'] },
    { name: 'an eighth investigator beyond the seven categories', mutate: (sandbox) => ['b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach((id) => cloneWorker(sandbox, 'why-coupons', 'git-investigator', `inv-${id}`, {})), fails: ['why.investigators'] },
    {
      name: 'an inline answer after confirming every category search would be redundant',
      mutate: (sandbox) => {
        removeWorker(sandbox, 'why-coupons', 'git-investigator');
        removeWorker(sandbox, 'why-coupons', 'synth');
        rewriteFinalReply(sandbox, '### The Question', 'The PR description of a single commit holds the whole answer, so all seven category searches would be redundant.\n### The Question');
      },
      fails: [],
      passes: ['why.investigators', 'why.synthesizer', 'why.settled-and-collected', 'why.readonly-enforced', 'why.inline-answer-is-justified', 'why.no-writes', 'why.code-anchor', 'why.mcp-discovery'],
    },
    {
      name: 'an inline answer that never says the searches were redundant',
      mutate: (sandbox) => {
        removeWorker(sandbox, 'why-coupons', 'git-investigator');
        removeWorker(sandbox, 'why-coupons', 'synth');
      },
      fails: ['why.inline-answer-is-justified'],
    },
    { name: 'investigators ran without any MCP discovery', mutate: (sandbox) => rewriteSession(parentSession(sandbox), /mcp list/g, 'mcp status'), fails: ['why.mcp-discovery'] },
  ],
};

// ---- teach

/**
 * teach runs how and why, "maybe one is enough for a small change" (teach/SKILL.md step 2). The why synthesizer is the
 * general worker whose brief carries the synthesizer template's Investigator Findings section; every other
 * explorer or general worker is how.
 */
function teachSides(view: RunView) {
  const workers = allWorkers(view);
  const investigators = workers.filter((worker) => assignmentOf(worker).role === 'investigator');
  const synth = workers.filter((worker) => assignmentOf(worker).role === 'general' && /Investigator Findings/i.test(worker.brief ?? ''));
  const how = workers.filter((worker) => assignmentOf(worker).role === 'explorer' || (assignmentOf(worker).role === 'general' && !synth.includes(worker)));
  return { how, investigators, synth, whyRan: investigators.length > 0 || synth.length > 0 };
}

const TEACH_REPLY = `A cart total is the sum of each line's price times quantity, rounded to cents, with a coupon percent taken off the end. In this repo total() in src/cart.js:${cart('export function total')} does that, and checkout() in src/checkout.js:${cart('export function checkout', 'src/checkout.js')} formats it.

When you call checkout(items, 10), it asks total() for the amount. total() sums the lines, then applyCoupon() at src/cart.js:${cart('export function applyCoupon')} removes ten percent. formatMoney() turns the number into a label.

The product reason for percent coupons is not recorded in the sources searched. The history shows the percent shape in #118 and rounding in #124.

Want me to go deeper on the rounding or the coupon history?`;

export const teachFamily: Family = {
  id: 'teach',
  title: 'teach: how and why run in parallel and are woven into one plain explanation (spec 12.1)',
  spec: {
    family: 'teach',
    runId: 'teach-checkout',
    history: cartHistory,
    prompt: () => '/teach explain how checkout totals work and why coupons are percentages',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      parent.readSkill('teach').readSkill('how').readSkill('why').readSkill('unslop');
      for (const file of ['explainer-prompt.md']) parent.readReference('how', file);
      for (const file of ['epistemics.md', 'investigator-prompt.md', 'synthesizer-prompt.md']) parent.readReference('why', file);
      parent
        .bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook investigation --title "teach: checkout totals" --run-id ${ctx.runId}`)
        .bash('git blame -L 1,20 src/cart.js')
        .bash('git log --oneline -20 -- src/cart.js')
        .bash(`${PI} mcp list`);
      const kinds = whyWorkers(parent);
      const how = parent.stage('how-explainer', { role: 'general', model: model('how explainer'), workspace: parent.readonly() }, `Simple path: explore and explain how checkout totals work in one pass. Sections: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.`);
      const why = parent.stage('why-investigator', kinds.investigator, `Narrow why: git history and one source only. Question: ${WHY_QUESTION}. The skipped categories are recorded as skipped, no matching MCP available.`);
      parent.fire(how, why).wait('how-explainer').wait('why-investigator').collect('how-explainer', 'why-investigator');
      parent.spawn('why-synth', kinds.synthesizer, `Question: ${WHY_QUESTION}\n\n## Investigator Findings\n\n${INVESTIGATOR}\n\n## Sources That Weren't Searched\n\nSix categories: no matching MCP available.`).wait('why-synth').collect('why-synth').text(TEACH_REPLY);
      return scenario(parent, {
        'how-explainer': new Worker().read(join(ctx.repo, 'src/cart.js')).text(EXPLAINER),
        'why-investigator': new Worker().call('bash_readonly', { command: 'git log --format=%h\\ %s -10 -- src/cart.js' }).text(INVESTIGATOR),
        'why-synth': new Worker().read(join(ctx.repo, 'src/cart.js')).text(`${SYNTHESIS}\nThe product reason for percent coupons is not recorded in the sources searched.`),
      });
    },
  },
  checks: [
    promptRoutes('teach'),
    check('teach.reads-the-skills-it-ran', 'the parent opens teach and unslop, and how and why for whichever of them ran', [src('teach/SKILL.md', 'Teach sits on top of `how` and `why`'), src('teach/SKILL.md', 'Write every response through the **unslop** skill')], (view) => {
      const sides = teachSides(view);
      const names = ['teach', 'unslop', ...(sides.how.length > 0 ? ['how'] : []), ...(sides.whyRan ? ['why'] : [])];
      const missing = names.filter((name) => openedAt(view.parent, skillFile(name)) === -1);
      return when(missing.length === 0, `parent opened ${names.join(', ')}`, `parent never opened ${missing.map(skillFile).join(', ')}`);
    }),
    check('teach.ran-how-or-why', 'at least one of how and why ran: "maybe one is enough" for a small change', src('teach/SKILL.md', 'maybe one is enough for a small change'), (view) => {
      const sides = teachSides(view);
      return when(sides.how.length > 0 || sides.whyRan, `how workers: ${sides.how.map((worker) => worker.id).join(', ') || 'none'}; why ran: ${sides.whyRan}`, 'neither how nor why ran');
    }),
    check('teach.how-ran', 'when how ran: readonly workers on the root, explorers on the "how explorer" line and the explainer on the "how explainer" line', src('teach/SKILL.md', 'then run `how` for how it works'), (view) => {
      const { how } = teachSides(view);
      if (how.length === 0) return pass('how did not run');
      const problems = how.flatMap((worker) => {
        const assignment = assignmentOf(worker);
        const line = assignment.role === 'explorer' ? 'how explorer' : 'how explainer';
        const allowed = expectedModels(view, line);
        return [
          ...(assignment.workspace?.mode === 'readonly' && assignment.workspace.path === view.repo ? [] : [`${worker.id} is not readonly on the repository root`]),
          ...(allowed.length === 0 || allowed.includes(modelIdentity(String(assignment.model))) ? [] : [`${worker.id} model ${String(assignment.model)} is not the "${line}" line`]),
        ];
      });
      return when(problems.length === 0, `${how.map((worker) => `${worker.id}:${String(assignmentOf(worker).role)}`).join(', ')}`, problems.join('; '));
    }),
    check('teach.why-ran', 'when why ran: investigators (readonly, MCP inherited, "why investigators" line), then one synthesizer on the "why synthesizer" line', src('teach/SKILL.md', 'and `why` for why'), (view) => {
      const sides = teachSides(view);
      if (!sides.whyRan) return pass('why did not run');
      const problems: string[] = [];
      if (sides.investigators.length < 1 || sides.investigators.length > 7) problems.push(`${sides.investigators.length} investigators, want 1 to 7`);
      if (sides.synth.length !== 1) problems.push(`${sides.synth.length} synthesizers, want 1`);
      for (const worker of [...sides.investigators, ...sides.synth]) {
        const assignment = assignmentOf(worker);
        const allowed = expectedModels(view, assignment.role === 'investigator' ? 'why investigators' : 'why synthesizer');
        if (assignment.workspace?.mode !== 'readonly' || assignment.workspace.path !== view.repo) problems.push(`${worker.id} is not readonly on the repository root`);
        if (assignment.capabilities?.mcp === 'none') problems.push(`${worker.id} sets capabilities.mcp none`);
        if (allowed.length > 0 && !allowed.includes(modelIdentity(String(assignment.model)))) problems.push(`${worker.id} model ${String(assignment.model)} is off its why line`);
      }
      const firstSynth = Math.min(...sides.synth.map((worker) => spawnOrder(view, worker.id)));
      const lastCollect = Math.max(...sides.investigators.map((worker) => collectOrder(view, worker.id)));
      if (sides.synth.length > 0 && sides.investigators.length > 0 && !(firstSynth > lastCollect && lastCollect !== -1)) problems.push(`the synthesizer spawned at ${firstSynth}, before the investigators were collected at ${lastCollect}`);
      return when(problems.length === 0, `${sides.investigators.length} investigators and one synthesizer`, problems.join('; '));
    }),
    check('teach.how-and-why-in-parallel', 'when both ran, both were started before either was collected: "Run them in parallel and combine the results"', src('teach/SKILL.md', 'Run them in parallel and combine the results'), (view) => {
      const sides = teachSides(view);
      if (sides.how.length === 0 || sides.investigators.length === 0) return pass('only one of how and why ran, so there is nothing to overlap');
      const firstHow = Math.min(...sides.how.map((worker) => spawnOrder(view, worker.id)));
      const firstWhy = Math.min(...sides.investigators.map((worker) => spawnOrder(view, worker.id)));
      const firstCollect = Math.min(...[...sides.how, ...sides.investigators].map((worker) => collectOrder(view, worker.id)).filter((order) => order !== -1));
      return when(firstHow !== -1 && firstWhy !== -1 && Math.max(firstHow, firstWhy) < firstCollect, `how spawned at ${firstHow} and why at ${firstWhy}, before the first collect at ${firstCollect}`, `how spawned at ${firstHow}, why at ${firstWhy}, first collect at ${firstCollect}`);
    }),
    check('teach.why-scope-recorded', 'when why ran short of all seven categories, the synthesizer is told which were not searched, so the skipped categories stay on record', src('teach/SKILL.md', 'so `why` records the skipped categories per its own contract'), (view) => {
      const sides = teachSides(view);
      if (!sides.whyRan) return pass('why did not run');
      if (sides.investigators.length >= 7) return pass('why searched all seven categories');
      const brief = sides.synth[0]?.brief ?? '';
      return when(/skipped|not searched|weren't searched|no matching mcp/i.test(brief), 'the synthesizer brief names the categories that were not searched', `the synthesizer brief does not record the unsearched categories: ${brief.slice(0, 160)}`);
    }),
    readonlyEnforced('teach.readonly-enforced', src('teach/SKILL.md', 'The goal is that they understand it, not that you change anything'), ['general', 'investigator', 'explorer']),
    repoUntouched('teach.no-writes', 'teach changes nothing in the repository', src('teach/SKILL.md', 'not that you change anything')),
    settledAndCollected('teach.settled-and-collected', src('teach/SKILL.md', 'Those are real skill invocations that do their own digging')),
    replyLacks('teach.no-framing-labels', 'the reply prints none of the labels the skill bans', src('teach/SKILL.md', 'Don\'t print framing labels'), [/the one idea to hold onto/i, /the thing to walk away with/i, /the key insight/i, /\bat its core\b/i, /\bTL;DR\b/i, /^\s*Pause\b/im, /the sentence to nail/i, /here is the part worth slowing down on/i]),
    replyLacks('teach.no-long-dashes', 'the reply contains no long dash', src('teach/SKILL.md', 'No em dashes'), [/—/, /–/]),
    check('teach.why-hedges-kept-verbatim', "the why synthesizer's What We Don't Know lines reach the reply intact (at least half, verbatim)", src('teach/SKILL.md', "Keep `why`'s confidence language intact"), (view) => {
      const synthesizer = teachSides(view).synth[0];
      if (synthesizer === undefined) return pass('why did not run, so there is no hedge to keep');
      const lines = synthesizer.finalText.split('\n');
      const start = lines.findIndex((line) => /^#{1,4}\s*What We Don't Know\s*$/.test(line));
      const rest = start === -1 ? [] : lines.slice(start + 1);
      const next = rest.findIndex((line) => /^#{1,4}\s/.test(line));
      const section = (next === -1 ? rest : rest.slice(0, next)).join('\n');
      const flat = (text: string) => text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
      const hedges = section.split('\n').map((line) => flat(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''))).filter((line) => line.length >= 30).slice(0, 4);
      if (hedges.length === 0) return fail("the synthesizer's text has no What We Don't Know lines to keep");
      const reply = flat(finalReply(view));
      const kept = hedges.filter((hedge) => reply.includes(hedge));
      return when(kept.length * 2 >= hedges.length, `${kept.length} of the synthesizer's ${hedges.length} What We Don't Know lines reach the reply verbatim`, `reply keeps ${kept.length} of ${hedges.length} What We Don't Know lines; missing: ${hedges.filter((hedge) => !kept.includes(hedge)).map((hedge) => hedge.slice(0, 60)).join(' | ')}`);
    }),
    // teach asks to open the code and says nothing of citing it, so a reply owes no file:line; one that cites must cite what exists.
    citationsResolve('teach.citations-resolve', src('teach/SKILL.md', 'Open the diff, the code, or the debugger'), { min: 0 }),
  ],
  negatives: [
    { name: 'the reply cites a file and line that do not exist', mutate: (sandbox) => rewriteFinalReply(sandbox, 'A cart total is', 'A cart total (src/nope.js:3) is'), fails: ['teach.citations-resolve'] },
    { name: 'the reply cites no file at all', mutate: (sandbox) => rewriteFinalReply(sandbox, /\b[\w/.-]+\.js:\d+/g, 'the cart module'), fails: [], passes: ['teach.citations-resolve'] },
    { name: 'the reply opens with TL;DR', mutate: (sandbox) => rewriteFinalReply(sandbox, 'A cart total is', 'TL;DR A cart total is'), fails: ['teach.no-framing-labels'] },
    { name: 'the reply softens the why hedge', mutate: (sandbox) => rewriteFinalReply(sandbox, 'is not recorded in the sources searched. The history', 'is obviously a product call. The history'), fails: ['teach.why-hedges-kept-verbatim'] },
    { name: 'the reply uses a long dash', mutate: (sandbox) => rewriteFinalReply(sandbox, 'rounded to cents,', 'rounded to cents \u2014'), fails: ['teach.no-long-dashes'] },
    { name: 'why ran without its investigator', mutate: (sandbox) => removeWorker(sandbox, 'teach-checkout', 'why-investigator'), fails: ['teach.why-ran'] },
    {
      name: 'a small change that needed only how',
      mutate: (sandbox) => {
        removeWorker(sandbox, 'teach-checkout', 'why-investigator');
        removeWorker(sandbox, 'teach-checkout', 'why-synth');
      },
      fails: [],
      passes: ['teach.ran-how-or-why', 'teach.how-ran', 'teach.why-ran', 'teach.how-and-why-in-parallel', 'teach.why-scope-recorded', 'teach.reads-the-skills-it-ran'],
    },
    {
      name: 'a question that needed only why',
      mutate: (sandbox) => removeWorker(sandbox, 'teach-checkout', 'how-explainer'),
      fails: [],
      passes: ['teach.ran-how-or-why', 'teach.how-ran', 'teach.why-ran', 'teach.how-and-why-in-parallel', 'teach.why-scope-recorded'],
    },
    {
      name: 'neither how nor why ran',
      mutate: (sandbox) => ['how-explainer', 'why-investigator', 'why-synth'].forEach((id) => removeWorker(sandbox, 'teach-checkout', id)),
      fails: ['teach.ran-how-or-why'],
    },
    { name: 'the why spawn is missing, so how and why did not overlap', mutate: (sandbox) => rewriteSession(parentSession(sandbox), '/why-investigator/assignment.json', '/zzz/assignment.json'), fails: ['teach.how-and-why-in-parallel'] },
    { name: 'the why synthesizer was not told what went unsearched', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/teach-checkout/workers/why-synth/brief.md'), '## Investigator Findings\n\nGit history only.'), fails: ['teach.why-scope-recorded'] },
    { name: 'the repository was edited', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['teach.no-writes'] },
  ],
};

// ---- Investigation playbook

const INVESTIGATION_ANSWER = `# Answer

### Overview
checkout() asks total() for the amount and formats it. See src/checkout.js:${cart('export function checkout', 'src/checkout.js')}.

### Key Concepts
total() in src/cart.js:${cart('export function total')}.

### How It Works
Lines are rounded and summed, then applyCoupon() at src/cart.js:${cart('export function applyCoupon')} takes the percent off.

### Where Things Live
src/cart.js, src/money.js, src/checkout.js.

### Gotchas
A percent over 100 is not clamped.
`;

export const investigationFamily: Family = {
  id: 'investigation',
  title: 'Investigation playbook: read-only, routed through how, cited answer, no PR (spec 12.1)',
  spec: {
    family: 'investigation',
    runId: 'investigate-checkout',
    history: cartHistory,
    prompt: () => `/poteto-mode ${HOW_QUESTION} Investigate only, change nothing.`,
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const answer = join(parent.runDir, 'verification', 'artifacts', 'answer.md');
      parent.beginPlaybook('investigation', 'Investigation: how checkout totals work');
      parent.readSkill('how').readReference('how', 'explainer-prompt.md').readSkill('unslop');
      parent.spawn('explainer', { role: 'general', model: model('how explainer'), workspace: parent.readonly() }, `Simple path. Question: ${HOW_QUESTION}`).wait('explainer').collect('explainer');
      parent.task('throughput checkpoint: n/a, read-only investigation');
      parent.write(answer, INVESTIGATION_ANSWER);
      parent.proof({ id: 'inv-routed', target: 'step-1', command: `ls ${parent.workerDir('explainer')}`, kind: 'command' });
      parent.proof({ id: 'inv-checkpoint', target: 'step-2', command: `grep -F 'throughput checkpoint: n/a, read-only investigation' ${join(parent.runDir, 'TODO.md')}` });
      parent.proof({ id: 'inv-shape', target: 'step-3', command: `grep -c '^### ' ${answer}`, kind: 'review' });
      parent.proof({ id: 'inv-unslop', target: 'step-4', command: `! grep -n '\u2014' ${answer}`, kind: 'review' });
      parent.done('investigation', 1, 'inv-routed').done('investigation', 2, 'inv-checkpoint').done('investigation', 3, 'inv-shape').done('investigation', 4, 'inv-unslop');
      parent.text(INVESTIGATION_ANSWER);
      return scenario(parent, { explainer: new Worker().read(join(ctx.repo, 'src/cart.js')).text(EXPLAINER) });
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('investigation', ['why']),
    ...todoChecks({ playbook: 'investigation' }),
    check('investigation.throughput-checkpoint-line', 'the one-line throughput checkpoint is written: a task-specific line with the text, or playbook step 2 done with its evidence', src('poteto-mode/playbooks/investigation.md', 'Throughput checkpoint stays one line'), (view) => {
      const run = primaryRun(view, 'investigation');
      const line = 'throughput checkpoint: n/a, read-only investigation';
      const task = run?.todoText?.split('## Task-specific work')[1] ?? '';
      if (task.includes(line)) return pass('TODO.md carries the checkpoint line under Task-specific work');
      const step = run?.steps.find((entry) => entry.text.includes(line));
      return when(step?.state === 'done', `playbook step ${step?.n} carries the line and is done`, `Task-specific work lacks \`${line}\` and ${step === undefined ? 'no playbook step carries it' : `step ${step.n} is ${step.state}`}`);
    }),
    check('investigation.routed-through-how', 'the question was routed through how: an explainer, or explorers then an explainer, readonly on the root, each on its own how model line', src('poteto-mode/playbooks/investigation.md', 'Route through the **how** skill'), (view) => {
      const workers = allWorkers(view).filter((worker) => ['explorer', 'general'].includes(String(assignmentOf(worker).role)));
      if (workers.length === 0) return fail('no how worker');
      const problems = workers.flatMap((worker) => {
        const assignment = assignmentOf(worker);
        const allowed = expectedModels(view, assignment.role === 'explorer' ? 'how explorer' : 'how explainer');
        return [
          ...(assignment.workspace?.mode === 'readonly' && assignment.workspace.path === view.repo ? [] : [`${worker.id} is not readonly on the repository root`]),
          ...(allowed.length === 0 || allowed.includes(modelIdentity(String(assignment.model))) ? [] : [`${worker.id} model ${String(assignment.model)} is not its how line`]),
        ];
      });
      return when(problems.length === 0, workers.map((worker) => `${worker.id}:${String(assignmentOf(worker).role)}`).join(', '), problems.join('; '));
    }),
    readonlyEnforced('investigation.readonly-enforced', src('poteto-mode/playbooks/investigation.md', 'Investigation requests are read-only'), ['general', 'explorer']),
    repoUntouched('investigation.no-code-change', 'no code change: the tree is clean, HEAD is at the base commit, parent writes stay under .pi/pstack', src('poteto-mode/playbooks/investigation.md', 'They produce a cited explanation or a recommendation, not a code change')),
    parentNeverOpened('investigation.no-architect', 'no architect skill, no PR playbook, and no babysit', src('poteto-mode/playbooks/investigation.md', 'No PR, no babysit, no `architect`'), ['architect', 'poteto-mode/playbooks/babysit']),
    check('investigation.no-pr-commands', 'the parent ran no PR command', src('poteto-mode/playbooks/investigation.md', 'No PR, no babysit'), (view) => {
      const pr = view.parent.toolCalls.filter((call) => call.name === 'bash' && /\b(gh pr|origin pr|git push)\b/.test(String(call.args['command'])));
      return when(pr.length === 0, 'no gh pr, origin pr, or git push', pr.map((call) => String(call.args['command'])).join(' | '));
    }),
    check('investigation.output-is-how-shaped', 'the reply has the how-shaped sections, or for a decision between alternatives a recommendation with a tradeoffs table', [src('poteto-mode/playbooks/investigation.md', 'Produce the `how`-shaped output'), src('poteto-mode/playbooks/investigation.md', 'or a recommendation with a tradeoffs table')], (view) => {
      const reply = finalReply(view);
      if (/^\s*\|.*\|\s*$/m.test(reply) && /^\s*\|[\s:|-]*-[\s:|-]*\|\s*$/m.test(reply) && /recommend/i.test(reply) && /tradeoff/i.test(reply)) return pass('a recommendation with a tradeoffs table');
      const missing = HOW_SECTIONS.filter((section) => !new RegExp(`^#{1,4}\\s*${section}`, 'im').test(reply));
      return when(missing.length === 0, 'all five sections present', `missing: ${missing.join(', ')}`);
    }),
    citationsResolve('investigation.citations-resolve', src('poteto-mode/playbooks/investigation.md', 'cited explanation'), { min: 2 }),
    parentReads('investigation.applies-unslop', 'the parent opened the unslop skill for the reply', src('poteto-mode/playbooks/investigation.md', 'Apply the **unslop** skill to the reply'), ['unslop']),
    settledAndCollected('investigation.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
    { ...receiptsFor('investigation.receipts-recorded', 'four receipts are recorded under verification/receipts and re-verify', src('poteto-mode/SKILL.md', 'once `pstack_evidence` `verify` passes for it'), () => true, 4), scope: 'adaptation' },
    noToolErrors('investigation.no-tool-errors', src('poteto-mode/playbooks/investigation.md', '**Reply:** the investigation output')),
  ],
  negatives: [
    { name: 'the checkpoint is carried by playbook step 2 done, with no task-specific line', mutate: (sandbox) => dropCheckpointLine(sandbox), fails: [], passes: ['investigation.throughput-checkpoint-line'] },
    { name: 'no checkpoint line and playbook step 2 left open', mutate: (sandbox) => { dropCheckpointLine(sandbox); setStep(sandbox, 'investigate-checkout', 2, ' ', stripEvidence); }, fails: ['investigation.throughput-checkpoint-line'] },
    { name: 'a step was skipped and left open', mutate: (sandbox) => setStep(sandbox, 'investigate-checkout', 2, ' ', stripEvidence), fails: ['todo.investigation.every-step-resolved'] },
    { name: 'a step was marked done with no receipt id', mutate: (sandbox) => setStep(sandbox, 'investigate-checkout', 3, 'x', stripEvidence), fails: ['todo.investigation.done-steps-proven'] },
    { name: 'a step cites a receipt that was never recorded', mutate: (sandbox) => deleteReceipt(sandbox, 'investigate-checkout', 'inv-shape'), fails: ['todo.investigation.done-steps-proven'] },
    { name: 'the artifact changed after the receipt hashed it', mutate: (sandbox) => corruptArtifact(sandbox, 'investigate-checkout', 'inv-unslop'), fails: ['todo.investigation.done-steps-proven'] },
    { name: 'a step was skipped with no reason', mutate: (sandbox) => setStep(sandbox, 'investigate-checkout', 4, '~', (line) => stripEvidence(line)), fails: ['todo.investigation.skips-explained'] },
    { name: 'steps were resolved out of order', mutate: (sandbox) => reorderHistory(sandbox, 'investigate-checkout', 4), fails: ['todo.investigation.resolved-in-order'] },
    { name: 'a step in the middle was deleted from the list', mutate: (sandbox) => deleteStep(sandbox, 'investigate-checkout', 2), fails: ['todo.investigation.steps-verbatim-in-order'] },
    { name: 'the main checkout was edited during a read-only investigation', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['investigation.no-code-change'] },
    { name: 'the parent opened the architect skill', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'read', { path: join(sandbox, '..', 'x', 'generated/skills/architect/SKILL.md') }), fails: ['investigation.no-architect'] },
    { name: 'the parent opened a PR', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: 'gh pr create --fill' }), fails: ['investigation.no-pr-commands'] },
    {
      name: 'a decision question answered with a recommendation and a tradeoffs table',
      mutate: (sandbox) => rewriteFinalReply(sandbox, /^[\s\S]*$/, 'Recommendation: keep percent coupons.\n\n| option | tradeoff |\n|---|---|\n| percent | one rule for every price |\n| amount | needs a cap per cart |'),
      fails: [],
      passes: ['investigation.output-is-how-shaped'],
    },
    { name: 'a reply with neither the how sections nor a tradeoffs table', mutate: (sandbox) => rewriteFinalReply(sandbox, /^[\s\S]*$/, 'It works fine.'), fails: ['investigation.output-is-how-shaped'] },
    { name: 'a worker wrote the TODO.md', mutate: (sandbox) => appendToolCall(workerSessionFile(sandbox, 'investigate-checkout', 'explainer'), 'write', { path: `${sandbox}/repo/.pi/pstack/runs/investigate-checkout/TODO.md`, content: 'x' }), fails: ['todo.investigation.parent-sole-writer'] },
  ],
};

export const investigationFamilies: Family[] = [howFamily, howSimpleFamily, whyFamily, teachFamily, investigationFamily];

void when;
