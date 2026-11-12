// Families: how, why, teach, and the Investigation playbook (spec 12.1).
import { join } from 'node:path';

import { type Check, check, fail, pass, src, when } from '../lib/check.ts';
import {
  allWorkers,
  assignmentOf,
  briefCarries,
  citationsResolve,
  finalReply,
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
  repoUntouched,
  replyLacks,
  replySections,
  settledAndCollected,
  spawnedAfterCollect,
  spawnedTogether,
  todoChecks,
  workersCheck,
} from '../lib/checks.ts';
import { PI, SCRIPTED_ROLES } from '../lib/driver.ts';
import { appendToolCall, dirtyRepo, dropWakes, parentSession, patchAssignment, removeWorker, rewriteSession, rewriteFinalReply, setStep, stripEvidence, workerSessionFile, deleteReceipt, deleteStep, corruptArtifact, reorderHistory } from '../lib/mutate.ts';
import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { cartHistory, lineOf } from '../fixtures/repos.ts';
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
  checks: [
    promptRoutes('how'),
    parentReads('how.reads-skill-and-templates', 'the parent opens how SKILL.md and both prompt templates before its first spawn', [src('how/SKILL.md', 'Spawn all explorers in a single message, each with `references/explorer-prompt.md`'), src('how/SKILL.md', 'spawn one explainer with `references/explainer-prompt.md`')], ['how'], { beforeFirstSpawn: true }),
    check('how.reads-templates', 'the parent opens references/explorer-prompt.md and explainer-prompt.md', src('how/SKILL.md', 'Spawn all explorers in a single message, each with `references/explorer-prompt.md`'), (view) => {
      const missing = ['generated/skills/how/references/explorer-prompt.md', 'generated/skills/how/references/explainer-prompt.md'].filter((path) => openedAt(view.parent, path) === -1);
      return when(missing.length === 0, 'both templates were opened', `not opened: ${missing.join(', ')}`);
    }),
    workersCheck('how.explorers', '2 to 4 explorers, role explorer, readonly on the repository root, on the "how explorer" model line', [src('how/SKILL.md', 'Decompose the question into 2 to 4 angles'), src('how/SKILL.md', 'Every spawn is a `pstack_worker` worker with `workspace: { mode: "readonly"')], { role: 'explorer', min: 2, max: 4, mode: 'readonly', rootPath: true, modelLine: 'how explorer' }),
    workersCheck('how.explainer', 'exactly one explainer, role general, readonly on the repository root, on the "how explainer" model line', src('how/SKILL.md', '`role: "general"` for explainers'), { role: 'general', min: 1, max: 1, mode: 'readonly', rootPath: true, modelLine: 'how explainer' }),
    spawnedTogether('how.explorers-in-one-message', src('how/SKILL.md', 'Spawn all explorers in a single message'), ['explorer']),
    spawnedAfterCollect('how.explainer-after-explorers', 'the explainer is spawned only after every explorer has returned', src('how/SKILL.md', 'Once all explorers have returned, spawn one explainer'), ['general'], ['explorer']),
    briefCarries('how.explainer-brief-has-findings', "the explainer's brief carries every explorer's findings", src('how/SKILL.md', 'every explorer\'s findings filled in'), ['general'], ['explorer']),
    check('how.explorer-output-shape', "each explorer's reply has the template's Components Found, Flow, Files Read, Boundaries sections", src('how/references/explorer-prompt.md', '### Components Found'), (view) => {
      const explorers = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'explorer');
      const bad = explorers.filter((worker) => !['Components Found', 'Flow', 'Files Read', 'Boundaries'].every((section) => worker.finalText.includes(`### ${section}`)));
      return when(explorers.length > 0 && bad.length === 0, `${explorers.length} explorer replies have all four sections`, `incomplete: ${bad.map((worker) => worker.id).join(', ') || 'no explorers'}`);
    }),
    readonlyEnforced('how.readonly-enforced', src('how/SKILL.md', 'Every spawn is a `pstack_worker` worker with `workspace: { mode: "readonly"'), ['explorer', 'general']),
    repoUntouched('how.no-writes', 'the repository is untouched: how is read-only', src('poteto-mode/playbooks/investigation.md', 'Investigation requests are read-only')),
    settledAndCollected('how.settled-and-collected', src('how/SKILL.md', 'Once all explorers have returned')),
    check('how.output-sections', 'the reply uses only the five how sections and presents the explainer output', src('how/SKILL.md', 'Do not substantially rewrite it'), (view) => {
      const reply = finalReply(view);
      const headings = [...reply.matchAll(/^#{1,4}\s*(.+)$/gm)].map((match) => (match[1] as string).trim());
      const unknown = headings.filter((heading) => !HOW_SECTIONS.includes(heading));
      const explainer = allWorkers(view).find((worker) => assignmentOf(worker).role === 'general');
      return when(headings.length > 0 && unknown.length === 0 && explainer !== undefined && reply.includes(explainer.finalText.slice(0, 60)), `sections ${headings.join(', ')}; reply presents the explainer output`, `unknown headings: ${unknown.join(', ') || 'none'}; explainer text present: ${String(explainer !== undefined && reply.includes(explainer.finalText.slice(0, 60)))}`);
    }),
    citationsResolve('how.citations-resolve', src('how/references/explainer-prompt.md', 'Reference specific files and functions'), { min: 3 }),
    noToolErrors('how.no-tool-errors', src('how/SKILL.md', '## 4. Present')),
  ],
  negatives: [
    { name: 'a readonly explorer wrote a file', mutate: (sandbox) => appendToolCall(workerSessionFile(sandbox, 'how-checkout', 'explorer-1'), 'write', { path: '/x/src/cart.js', content: 'x' }), fails: ['how.readonly-enforced'] },
    { name: 'the main checkout was edited during a read-only investigation', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['how.no-writes'] },
    { name: 'an explorer got a writable worktree', mutate: (sandbox) => patchAssignment(sandbox, 'how-checkout', 'explorer-1', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: 'abc1234' })), fails: ['how.explorers'] },
    { name: 'only one explorer ran', mutate: (sandbox) => removeWorker(sandbox, 'how-checkout', 'explorer-2'), fails: ['how.explorers'] },
    { name: 'an explorer ran on the wrong model line', mutate: (sandbox) => patchAssignment(sandbox, 'how-checkout', 'explorer-1', (assignment) => (assignment['model'] = 'sim/grok-sim')), fails: ['how.explorers'] },
    { name: 'the reply cites a file that does not exist', mutate: (sandbox) => rewriteFinalReply(sandbox, /src\/cart\.js:/g, 'src/nope.js:'), fails: ['how.citations-resolve'] },
    { name: 'the parent never opened the how skill', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'generated/skills/how/SKILL.md', 'generated/skills/zzz/SKILL.md'), fails: ['how.reads-skill-and-templates'] },
    { name: 'no wake reached the parent', mutate: (sandbox) => dropWakes(sandbox), fails: ['how.settled-and-collected'] },
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

const whyChecks = (prefix: string): Check[] => [
  parentRanBeforeSpawn(`${prefix}.code-anchor`, 'the parent builds the code anchor (git blame, git log --follow, git log) before any investigator spawns', src('why/SKILL.md', 'Run `git blame -L <start>,<end> <file>`'), [/git blame/, /git log --follow/, /git log --oneline/]),
  check(`${prefix}.mcp-discovery`, 'the parent discovers MCP servers (pi mcp list) before spawning investigators', src('why/SKILL.md', 'Otherwise run `pi mcp list`'), (view) => {
    const spawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn')?.order ?? Number.POSITIVE_INFINITY;
    const listed = view.parent.toolCalls.find((call) => call.name === 'bash' && /\bmcp list\b/.test(String(call.args['command'])) && call.order < spawn);
    return listed === undefined ? fail('no `pi mcp list` before the first spawn') : pass(`mcp list answered: ${listed.resultText.split('\n')[0]?.slice(0, 80)}`);
  }),
  workersCheck(`${prefix}.investigators`, 'one investigator per evidence category that has an MCP (source control always), readonly on the root, MCP inherited, on the "why investigators" line', [src('why/SKILL.md', 'Spawn one investigator per category that has a matching MCP'), src('why/SKILL.md', '**Do not set `capabilities.mcp: "none"`.**')], { role: 'investigator', min: 1, max: 1, mode: 'readonly', rootPath: true, mcpInherit: true, modelLine: 'why investigators' }),
  workersCheck(`${prefix}.synthesizer`, 'one synthesizer, role general, readonly, MCP inherited, on the "why synthesizer" line', src('why/SKILL.md', 'Spawn one synthesizer'), { role: 'general', min: 1, mode: 'readonly', rootPath: true, mcpInherit: true, modelLine: 'why synthesizer', id: /synth/ }),
  spawnedAfterCollect(`${prefix}.synthesizer-after-investigators`, 'the synthesizer is spawned after every investigator is collected', src('why/SKILL.md', '## Step 4. Synthesize'), ['general'], ['investigator']),
  briefCarries(`${prefix}.synthesizer-brief-has-findings`, "the synthesizer's brief carries the investigator findings", src('why/SKILL.md', 'The investigator findings, including any null results'), ['general'], ['investigator']),
  readonlyEnforced(`${prefix}.readonly-enforced`, src('why/SKILL.md', 'A readonly worker runs `git` and `gh` through `bash_readonly` and cannot write files'), ['investigator', 'general']),
  repoUntouched(`${prefix}.no-writes`, 'the repository is untouched', src('why/SKILL.md', "Investigators still shouldn't write anything")),
  settledAndCollected(`${prefix}.settled-and-collected`, src('why/SKILL.md', '## Step 5. Present')),
  check(`${prefix}.sources-consulted-covers-seven-categories`, 'Sources Consulted names all seven evidence categories, each with a result or the reason it was skipped', src('why/SKILL.md', 'keep Sources Consulted as one line per investigator'), (view) => {
    const reply = finalReply(view);
    const block = reply.split(/Sources Consulted/i)[1]?.split(/###? ?Confidence Summary/i)[0] ?? '';
    const lines = block.split('\n');
    const missing = CATEGORIES.filter((category) => !lines.some((line) => line.toLowerCase().includes(category.toLowerCase()) && /(found|skipped|no matching|searched|nothing|null)/i.test(line)));
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
    { name: 'no code anchor before the spawn', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'git blame', 'git status'), fails: ['why.code-anchor'] },
    { name: 'the investigator wrote a file', mutate: (sandbox) => appendToolCall(workerSessionFile(sandbox, 'why-coupons', 'git-investigator'), 'write', { path: '/x', content: 'x' }), fails: ['why.readonly-enforced'] },
    { name: 'the tree was edited', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['why.no-writes'] },
  ],
};

// ---- teach

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
    parentReads('teach.reads-how-and-why', 'the parent opens teach, how, why, and unslop', src('teach/SKILL.md', 'Teach sits on top of `how` and `why`'), ['teach', 'how', 'why', 'unslop']),
    workersCheck('teach.how-ran', 'how ran: an explainer worker, readonly on the root, on the "how explainer" line', src('teach/SKILL.md', 'then run `how` for how it works'), { role: 'general', min: 1, mode: 'readonly', rootPath: true, modelLine: 'how explainer', id: /how/ }),
    workersCheck('teach.why-ran', 'why ran: an investigator, readonly, MCP inherited, and a synthesizer, on the why lines', src('teach/SKILL.md', 'and `why` for why'), { role: 'investigator', min: 1, mode: 'readonly', rootPath: true, mcpInherit: true, modelLine: 'why investigators' }),
    check('teach.how-and-why-in-parallel', 'how and why workers were spawned together, "run them in parallel"', src('teach/SKILL.md', 'Run them in parallel and combine the results'), (view) => {
      const how = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes('/how-'));
      const why = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes('/why-investigator'));
      return when(how !== undefined && why !== undefined && how.order === why.order, `both spawned in message ${how?.order}`, `how spawn at ${how?.order}, why spawn at ${why?.order}`);
    }),
    check('teach.why-narrowed', "the why investigator's brief narrows the sweep and records skipped categories", src('teach/SKILL.md', 'Keep `why` narrow by default'), (view) => {
      const investigator = allWorkers(view).find((worker) => assignmentOf(worker).role === 'investigator');
      return when(investigator?.brief !== null && investigator !== undefined && /narrow/i.test(investigator.brief ?? '') && /skipped|no matching MCP/i.test(investigator.brief ?? ''), 'brief narrows and names the skipped categories', `brief: ${(investigator?.brief ?? '').slice(0, 160)}`);
    }),
    readonlyEnforced('teach.readonly-enforced', src('teach/SKILL.md', 'The goal is that they understand it, not that you change anything'), ['general', 'investigator']),
    repoUntouched('teach.no-writes', 'teach changes nothing in the repository', src('teach/SKILL.md', 'not that you change anything')),
    settledAndCollected('teach.settled-and-collected', src('teach/SKILL.md', 'Those are real skill invocations that do their own digging')),
    replyLacks('teach.no-framing-labels', 'the reply prints none of the labels the skill bans', src('teach/SKILL.md', 'Don\'t print framing labels'), [/the one idea to hold onto/i, /the thing to walk away with/i, /the key insight/i, /\bat its core\b/i, /\bTL;DR\b/i, /^\s*Pause\b/im, /the sentence to nail/i, /here is the part worth slowing down on/i]),
    replyLacks('teach.no-long-dashes', 'the reply contains no long dash', src('teach/SKILL.md', 'No em dashes'), [/—/, /–/]),
    check('teach.why-hedges-kept-verbatim', "the why synthesizer's confidence language reaches the reply intact", src('teach/SKILL.md', "Keep `why`'s confidence language intact"), (view) => {
      const synthesizer = allWorkers(view).find((worker) => assignmentOf(worker).role === 'general' && /synth/.test(worker.id));
      const hedge = synthesizer?.finalText.split('\n').find((line) => /not recorded in the sources searched/.test(line));
      const reply = finalReply(view).replace(/\s+/g, ' ');
      return hedge !== undefined && reply.includes(hedge.replace(/\s+/g, ' ').trim()) ? pass('the unknown stays an unknown in the reply') : fail(`reply lacks the synthesizer's hedge: ${String(hedge)}`);
    }),
    citationsResolve('teach.citations-resolve', src('teach/SKILL.md', 'Open the diff, the code, or the debugger'), { min: 2 }),
  ],
  negatives: [
    { name: 'the reply opens with TL;DR', mutate: (sandbox) => rewriteFinalReply(sandbox, 'A cart total is', 'TL;DR A cart total is'), fails: ['teach.no-framing-labels'] },
    { name: 'the reply softens the why hedge', mutate: (sandbox) => rewriteFinalReply(sandbox, 'is not recorded in the sources searched. The history', 'is obviously a product call. The history'), fails: ['teach.why-hedges-kept-verbatim'] },
    { name: 'the reply uses a long dash', mutate: (sandbox) => rewriteFinalReply(sandbox, 'rounded to cents,', 'rounded to cents \u2014'), fails: ['teach.no-long-dashes'] },
    { name: 'why was never run', mutate: (sandbox) => removeWorker(sandbox, 'teach-checkout', 'why-investigator'), fails: ['teach.why-ran'] },
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
    check('investigation.throughput-checkpoint-line', 'the one-line throughput checkpoint is written verbatim', src('poteto-mode/playbooks/investigation.md', 'Throughput checkpoint stays one line'), (view) => {
      const todo = primaryRun(view, 'investigation')?.todoText?.split('## Task-specific work')[1] ?? '';
      return when(todo.includes('throughput checkpoint: n/a, read-only investigation'), 'TODO.md carries the checkpoint line', 'TODO.md lacks `throughput checkpoint: n/a, read-only investigation`');
    }),
    workersCheck('investigation.routed-through-how', 'the question was routed through how: an explainer or explorers, readonly on the root', src('poteto-mode/playbooks/investigation.md', 'Route through the **how** skill'), { role: ['explainer', 'explorer', 'general'], min: 1, mode: 'readonly', rootPath: true, modelLine: 'how explainer' }),
    readonlyEnforced('investigation.readonly-enforced', src('poteto-mode/playbooks/investigation.md', 'Investigation requests are read-only'), ['general', 'explorer']),
    repoUntouched('investigation.no-code-change', 'no code change: the tree is clean, HEAD is at the base commit, parent writes stay under .pi/pstack', src('poteto-mode/playbooks/investigation.md', 'They produce a cited explanation or a recommendation, not a code change')),
    parentNeverOpened('investigation.no-architect', 'no architect skill, no PR playbook, and no babysit', src('poteto-mode/playbooks/investigation.md', 'No PR, no babysit, no `architect`'), ['architect', 'poteto-mode/playbooks/babysit']),
    check('investigation.no-pr-commands', 'the parent ran no PR command', src('poteto-mode/playbooks/investigation.md', 'No PR, no babysit'), (view) => {
      const pr = view.parent.toolCalls.filter((call) => call.name === 'bash' && /\b(gh pr|origin pr|git push)\b/.test(String(call.args['command'])));
      return when(pr.length === 0, 'no gh pr, origin pr, or git push', pr.map((call) => String(call.args['command'])).join(' | '));
    }),
    check('investigation.output-is-how-shaped', 'the reply has the how-shaped sections and cited file:line references', src('poteto-mode/playbooks/investigation.md', 'Produce the `how`-shaped output'), (view) => {
      const reply = finalReply(view);
      const missing = HOW_SECTIONS.filter((section) => !new RegExp(`^#{1,4}\\s*${section}`, 'm').test(reply));
      return when(missing.length === 0, 'all five sections present', `missing: ${missing.join(', ')}`);
    }),
    citationsResolve('investigation.citations-resolve', src('poteto-mode/playbooks/investigation.md', 'cited explanation'), { min: 2 }),
    parentReads('investigation.applies-unslop', 'the parent opened the unslop skill for the reply', src('poteto-mode/playbooks/investigation.md', 'Apply the **unslop** skill to the reply'), ['unslop']),
    settledAndCollected('investigation.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
    receiptsFor('investigation.receipts-recorded', 'four receipts are recorded under verification/receipts and re-verify', src('poteto-mode/SKILL.md', 'once `pstack_evidence` `verify` passes for it'), () => true, 4),
    noToolErrors('investigation.no-tool-errors', src('poteto-mode/playbooks/investigation.md', '**Reply:** the investigation output')),
  ],
  negatives: [
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
    { name: 'a worker wrote the TODO.md', mutate: (sandbox) => appendToolCall(workerSessionFile(sandbox, 'investigate-checkout', 'explainer'), 'write', { path: `${sandbox}/repo/.pi/pstack/runs/investigate-checkout/TODO.md`, content: 'x' }), fails: ['todo.investigation.parent-sole-writer'] },
  ],
};

export const investigationFamilies: Family[] = [howFamily, whyFamily, teachFamily, investigationFamily];

void when;
