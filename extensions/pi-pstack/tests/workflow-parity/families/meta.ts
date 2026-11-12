// Families: authoring-a-skill, multi-phase-plan, eval.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, fail, src, when } from '../lib/check.ts';
import {
  allWorkers,
  assignmentOf,
  finalReply,
  noToolErrors,
  openedAt,
  panelCheck,
  parentReads,
  playbookReads,
  primaryRun,
  promptRoutes,
  repoUntouched,
  settledAndCollected,
  skillFile,
  todoChecks,
  workersCheck,
} from '../lib/checks.ts';
import { type Commit, PKG, SCRIPTED_ROLES } from '../lib/driver.ts';
import { appendToolCall, dirtyRepo, parentSession, patchAssignment, patchGit, rewriteFinalReply } from '../lib/mutate.ts';
import { todoNegatives, worktreeOf } from './shared.ts';
import type { Family } from './types.ts';

const model = (line: string, index = 0) => String(Array.isArray(SCRIPTED_ROLES[line]) ? (SCRIPTED_ROLES[line] as string[])[index] : SCRIPTED_ROLES[line]);
const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const rewriteSession = (sandbox: string, from: string | RegExp, to: string) => {
  const file = parentSession(sandbox);
  writeFileSync(file, typeof from === 'string' ? read(file).replaceAll(from, to) : read(file).replace(from, to));
};
const CHECK_PLAN = join(PKG, 'generated/skills/poteto-mode/scripts/check-plan.mjs');

// ---- authoring a skill

const SKILL_NAME = 'run-cart-tests';
const SKILL_DIR = `.pi/skills/${SKILL_NAME}`;
const AUTHORED = `---
name: run-cart-tests
description: Runs the cart repository's tests and reads their output. Use when a change touches src/ or test/, or the user asks whether the cart still works.
---

# Run the cart tests

Run \`node --test\` from the repository root. It prints one line per test and a summary with \`# pass\` and \`# fail\`.

A \`# fail\` above 0 means a real failure. Read the first failing test name and its diff before touching anything.

Output details live in [references/output.md](references/output.md).
`;
const OUTPUT_MD = '# Reading the output\n\nEach test prints `ok` or `not ok`. The summary lines `# pass N` and `# fail N` are the verdict.\n';
const VALIDATOR = `import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const file = process.argv[2];
const text = readFileSync(file, 'utf8');
const front = /^---\\nname: ([a-z0-9-]+)\\ndescription: (.+)\\n---/.exec(text);
const problems = [];
if (!front) problems.push('frontmatter needs name and description');
else if (front[1] !== dirname(file).split('/').pop()) problems.push('name does not match its directory');
for (const match of text.matchAll(/\\]\\(([^)#]+)\\)/g)) if (!existsSync(join(dirname(file), match[1]))) problems.push('link does not resolve: ' + match[1]);
console.log(problems.length === 0 ? 'valid' : problems.join('; '));
process.exit(problems.length === 0 ? 0 : 1);
`;

const skillValidation = (repo: string, dir = SKILL_DIR): string[] => {
  const file = join(repo, dir, 'SKILL.md');
  const text = read(file);
  const front = /^---\nname: (.+)\ndescription: (.+)\n---/.exec(text);
  const problems: string[] = [];
  if (front === null) return ['no frontmatter with name and description'];
  const name = front[1] as string;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) problems.push(`name ${name} is not a valid skill name`);
  if (name !== dir.split('/').pop()) problems.push(`name ${name} does not match its directory`);
  if ((front[2] as string).length > 1024 || (front[2] as string).trim() === '') problems.push('description is empty or over 1024 characters');
  for (const link of text.matchAll(/\]\(([^)#]+)\)/g)) if (!existsSync(join(repo, dir, link[1] as string))) problems.push(`link ${link[1]} does not resolve`);
  for (const ref of text.matchAll(/`(references\/[\w./-]+)`/g)) if (!existsSync(join(repo, dir, ref[1] as string))) problems.push(`referenced file ${ref[1]} is missing`);
  if (text.split('\n').length > 150) problems.push('the skill is over 150 lines');
  if (/TODO|TBD|<placeholder>/.test(text)) problems.push('placeholder left in the skill');
  return problems;
};

export const authoringFamily: Family = {
  id: 'authoring-a-skill',
  title: 'Authoring a skill playbook: Pi\'s docs followed, a valid project-local skill, validated, concise (spec 12.4)',
  spec: {
    family: 'authoring-a-skill',
    runId: 'author-skill',
    history: cartHistory,
    prompt: () => '/poteto-mode write a skill that tells agents how to run this repository\'s tests and read the output',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const artifacts = join(parent.runDir, 'verification', 'artifacts');
      const dir = join(ctx.repo, SKILL_DIR);
      parent.beginPlaybook('authoring-a-skill', 'Authoring a skill: run-cart-tests');
      parent.readSkill('principle-encode-lessons-in-structure').read(join(PKG, 'node_modules/@earendil-works/pi-coding-agent/docs/skills.md'));
      parent.proof({ id: 'author-docs', target: 'step-1', command: `test -s ${PKG}/node_modules/@earendil-works/pi-coding-agent/docs/skills.md`, kind: 'review' });
      parent.done('authoring-a-skill', 1, 'author-docs');
      parent.write(join(dir, 'SKILL.md'), AUTHORED).write(join(dir, 'references/output.md'), OUTPUT_MD).write(join(artifacts, 'validate-skill.mjs'), VALIDATOR);
      parent.proof({ id: 'author-valid', target: 'step-2', command: `node ${artifacts}/validate-skill.mjs ${dir}/SKILL.md`, kind: 'command' });
      parent.done('authoring-a-skill', 2, 'author-valid');
      parent.skip('authoring-a-skill', 3, 'the skill is a short instruction with no structural behavior, so test cases would be subjective');
      parent.skip('authoring-a-skill', 4, 'this repository has no remote, so no PR is opened here');
      parent.text('Summary: .pi/skills/run-cart-tests tells an agent to run node --test and read the pass and fail summary.\nDesign decisions: one short body, the output details moved to a reference, the description says what it does and when to use it.\nValidation notes: frontmatter name matches the directory, the reference link resolves, validated by a script.');
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('authoring-a-skill'),
    ...todoChecks({ playbook: 'authoring-a-skill', skipReason: { 4: /PR|remote/i } }),
    check('author.reads-pi-skills-docs', "step 1: the parent opens Pi's Agent Skills documentation from the installed pi-coding-agent package", src('poteto-mode/playbooks/authoring-a-skill.md', "Follow Pi's Agent Skills documentation"), (view) => when(openedAt(view.parent, 'pi-coding-agent/docs/skills.md') !== -1, 'docs/skills.md opened', 'docs/skills.md was never opened')),
    check('author.skill-is-valid-and-project-local', 'step 2: the skill sits in .pi/skills/<name>/ with a name matching its directory, a description, resolving links and files, no placeholders, and fewer than 150 lines', src('poteto-mode/playbooks/authoring-a-skill.md', 'Validate the skill: frontmatter has `name` and `description`'), (view) => {
      const problems = skillValidation(view.repo);
      return when(problems.length === 0, `${SKILL_DIR} is valid`, problems.join('; '));
    }),
    check('author.never-edits-the-installed-package', 'the skill is never written into the installed package or node_modules', src('poteto-mode/playbooks/authoring-a-skill.md', 'Follow Pi\'s Agent Skills documentation'), (view) => {
      const bad = view.parent.toolCalls.filter((call) => (call.name === 'write' || call.name === 'edit') && /generated\/skills|node_modules/.test(String(call.args['path'])));
      return when(bad.length === 0, 'no write into the package', bad.map((call) => String(call.args['path'])).join(', '));
    }),
    check('author.validation-ran-and-recorded', 'a validator ran on the skill and its receipt records a pass', src('poteto-mode/playbooks/authoring-a-skill.md', 'Validate the skill'), (view) => {
      const receipt = primaryRun(view, 'authoring-a-skill')?.receipts.find((entry) => entry.id === 'author-valid');
      return when(receipt?.exitCode === 0 && receipt.verdict === 'pass', 'validator exit 0', `receipt ${JSON.stringify(receipt?.exitCode)}`);
    }),
    check('author.reply-has-summary-decisions-validation', 'the reply gives a summary of the skill, key design decisions, and validation notes', src('poteto-mode/playbooks/authoring-a-skill.md', '**Reply:** summary of the skill'), (view) => {
      const reply = finalReply(view);
      const missing = [/Summary:/, /Design decisions:/, /Validation notes:/].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0, 'three parts present', `missing ${missing.join(', ')}`);
    }),
    repoUntouched('author.production-code-untouched', 'no production file changed', src('poteto-mode/playbooks/authoring-a-skill.md', '**You own the skill\'s voice.**')),
    noToolErrors('author.no-tool-errors', src('poteto-mode/playbooks/authoring-a-skill.md', '**Reply:** summary of the skill')),
  ],
  negatives: [
    ...todoNegatives('author-skill', 'authoring-a-skill', { done: [1, 2], receipts: { 1: 'author-docs', 2: 'author-valid' } }),
    { name: 'the name does not match the directory', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'), read(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md')).replace('name: run-cart-tests', 'name: run-tests')), fails: ['author.skill-is-valid-and-project-local'] },
    { name: 'a link does not resolve', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'), `${read(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'))}\nSee [more](references/missing.md).\n`), fails: ['author.skill-is-valid-and-project-local'] },
    { name: 'the description is missing', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'), read(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md')).replace(/description: .*\n/, '')), fails: ['author.skill-is-valid-and-project-local'] },
    { name: 'the skill kept a placeholder', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'), `${read(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'))}\nTODO fill in\n`), fails: ['author.skill-is-valid-and-project-local'] },
    { name: 'the skill grew past 150 lines', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'), `${read(join(sandbox, 'repo', SKILL_DIR, 'SKILL.md'))}${'filler\n'.repeat(160)}`), fails: ['author.skill-is-valid-and-project-local'] },
    { name: 'Pi\'s skills documentation was never read', mutate: (sandbox) => rewriteSession(sandbox, 'pi-coding-agent/docs/skills.md', 'pi-coding-agent/docs/other.md'), fails: ['author.reads-pi-skills-docs'] },
    { name: 'the skill was written into the installed package', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'write', { path: `${PKG}/generated/skills/x/SKILL.md`, content: 'x' }), fails: ['author.never-edits-the-installed-package'] },
    { name: 'production code was edited', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['author.production-code-untouched'] },
  ],
};

// ---- multi-phase plan

const RULE = 'Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.';
const lanes = (pr: string) => Array.from({ length: 10 }, (_, index) => (index === 0 ? `- [ ] Lane 1. Regression lane against trunk. Run the checkout scenario at trunk and head. If trunk lacks the feature, record that and gate the new behavior. Save \`${pr}-lane-1.png\`. Pass when the total matches.` : `- [ ] Lane ${index + 1}. Drive scenario ${index + 1} through the control skill. Save \`${pr}-lane-${index + 1}.png\`. Pass when the screen shows the expected total.`)).join('\n');
const prSection = (id: string, title: string, depends: string) => `## ${title} (${id})

**Depends on.** ${depends}

**Files.**

- [ ] Edit \`src/cart.js\`.

**Build.**

- [ ] Change one function in \`src/cart.js\`.

**You see.**

- [ ] The CLI prints the new total.

**Verify, unit.** ${RULE}

- [ ] Add a case to \`test/cart.test.js\`. Run \`node --test\`.

**Verify, live.** ${RULE} Ten lanes on \`grok-4.7-xhigh-fast\` at the PR head, per the boot recipe.

${lanes(id)}

**Verify, perf.** ${RULE}

- [ ] Metric. Comparisons counted by the benchmark at trunk and head.
- [ ] Probe. Run \`node bench/bench.js\` at trunk and at the head, interleaved.
- [ ] Baseline. Record the trunk value first.
- [ ] Rule. Head must not exceed trunk by more than ten percent.

**Review gate.** None. ${id} is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
`;

const PLAN = `# Coupon bounds plan

Bound the coupon percent in three PRs for shoppers, so a coupon never pays the customer. PR ids in order are PR-1, PR-2 and PR-3.

## How to read this

One box is one unit of work and names the evidence that checks it. Check a box only when its evidence exists. The body is a how-to, the appendices explain and record.

The program runs \`<pi-pstack>/generated/skills/poteto-mode/playbooks/autopilot-stack.md\`. The operator lands every PR.

${RULE}

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from the installed pi-pstack package at program start.
  - [ ] \`cat <pi-pstack>/generated/skills/swarm/SKILL.md\`
- [ ] On the operator's go, arm the audit tick as an hourly watch loop. Spawn a \`kind: "watch"\` worker with \`role: "watcher"\`, \`watch.argv: ["sleep", "3600"]\`, and the tick prompt, and post a status message only on a tracked change.

### Spawn owners

- [ ] Spawn one owner per PR.

### PR mechanics, for every PR

- [ ] Open the PR ready per \`<pi-pstack>/generated/skills/poteto-mode/playbooks/opening-a-pr.md\`.

### Verdict and merge, for every PR

- [ ] A full swarm runs once at the code-ready head.

### Boot recipe, for every live lane

- [ ] Start the backend and the surface, and wait for ready.

${prSection('PR-1', 'Bound the percent in the cart', 'None.')}
${prSection('PR-2', 'Reject bad input at the CLI', 'PR-1.')}
${prSection('PR-3', 'Show the bound in the checkout label', 'PR-2.')}
## Close the program

- [ ] Every box above is checked with its evidence.

## Appendix A. Prototype evidence

No open question needed a prototype.

## Appendix B. Alternatives rejected

Clamping silently was rejected because it hides caller bugs.

## Appendix C. Risks

The CLI has no control skill beyond the cart harness, so lanes drive it through a shell.

## Appendix D. Links and reading list

Read \`<pi-pstack>/generated/skills/how/SKILL.md\` before PR-1.
`;

export const planFamily: Family = {
  id: 'multi-phase-plan',
  title: 'Multi-phase plan playbook: a validated plan file, no implementation, ten lanes per PR, execution only on the explicit go (spec 11.2)',
  spec: {
    family: 'multi-phase-plan',
    runId: 'plan-coupon',
    history: cartHistory,
    prompt: () => '/poteto-mode write a plan, only a plan, for bounding coupon percents across three PRs. Do not implement anything.',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const plan = join(ctx.repo, '.pi/pstack/plans/coupon-bounds.md');
      const artifacts = join(parent.runDir, 'verification', 'artifacts');
      parent.beginPlaybook('multi-phase-plan', 'Plan: coupon bounds');
      for (const skill of ['principle-never-block-on-the-human', 'principle-guard-the-context-window', 'principle-sequence-verifiable-units', 'principle-encode-lessons-in-structure', 'principle-prove-it-works', 'swarm', 'technical-writing', 'unslop', 'control-cli', 'control-ui']) parent.readSkill(skill);
      parent.proof({ id: 'plan-three-prs', target: 'step-1', command: `printf 'three PRs, so a plan is needed\\n'`, kind: 'review' });
      parent.done('multi-phase-plan', 1, 'plan-three-prs');
      parent.skip('multi-phase-plan', 2, 'no open factual fork needs a prototype: the approach is settled');
      parent.spawn('explore', { role: 'poteto', model: model('feature, refactoring'), workspace: parent.readonly() }, 'Return file pointers, conventions, test commands and entry points for bounding the coupon percent. No inlined dumps.');
      parent.wait('explore').collect('explore');
      parent.proof({ id: 'plan-explored', target: 'step-3', command: `ls ${parent.workerDir('explore')}/assignment.json`, kind: 'review' });
      parent.done('multi-phase-plan', 3, 'plan-explored');
      parent.write(plan, PLAN);
      parent.proof({ id: 'plan-written', target: 'step-4', command: `test -s ${plan}`, kind: 'command' });
      parent.done('multi-phase-plan', 4, 'plan-written');
      parent.proof({ id: 'plan-prose', target: 'step-5', command: `! grep -n '\u2014' ${plan}`, kind: 'review' });
      parent.done('multi-phase-plan', 5, 'plan-prose');
      parent.proof({ id: 'plan-checked', target: 'step-6', command: `node ${CHECK_PLAN} ${plan}`, kind: 'command' });
      parent.done('multi-phase-plan', 6, 'plan-checked');
      parent.bash(`mkdir -p ${artifacts}`);
      parent.proof({ id: 'plan-handed-back', target: 'step-7', command: `cat ${artifacts}/plan-checked.txt; test -s ${plan}`, kind: 'review' });
      parent.done('multi-phase-plan', 7, 'plan-handed-back');
      parent.text(`Plan: ${plan}\nPR ids: PR-1, PR-2 after PR-1, PR-3 after PR-2. None is review-gated. No prototypes were needed.\ncheck-plan output: 0 problems, exit 0.\nI am stopping here. Execution starts on your explicit go, under the Autopilot-stack playbook the plan names.`);
      return scenario(parent, { explore: new Worker().call('bash_readonly', { command: 'grep -rn applyCoupon src' }).text('Pointers: src/cart.js applyCoupon, test/cart.test.js, bin/ none, entry point src/checkout.js. Test command: node --test.') });
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('multi-phase-plan', ['swarm']),
    ...todoChecks({ playbook: 'multi-phase-plan', skipReason: { 2: /.+/ } }),
    parentReads('plan.reads-swarm-and-control', 'the parent opens the swarm skill and a control skill the plan relies on', src('poteto-mode/playbooks/multi-phase-plan.md', 'per the **swarm** skill'), ['swarm', 'control-cli']),
    check('plan.file-passes-the-validator', 'step 6: the plan is a Markdown file under .pi/pstack/plans/ and the shipped check-plan.mjs, run by the checker, accepts it', src('poteto-mode/playbooks/multi-phase-plan.md', 'Run `node <pi-pstack>/generated/skills/poteto-mode/scripts/check-plan.mjs <plan.md>`'), (view) => {
      const plan = view.plans[0];
      const run = plan === undefined ? { status: 1, stdout: '', stderr: '' } : spawnSync('node', [CHECK_PLAN, plan.path], { encoding: 'utf8' });
      return when(plan !== undefined && run.status === 0, `${plan?.path} passes check-plan: ${run.stdout.trim()}`, `check-plan exit ${run.status}: ${run.stdout}${run.stderr}`.trim());
    }),
    check('plan.names-an-execution-playbook-that-exists', 'the plan names the execution playbook, and the file exists', src('poteto-mode/playbooks/multi-phase-plan.md', 'Name the execution playbook in **How to read this**'), (view) => {
      const text = view.plans[0]?.text ?? '';
      const name = /The program runs `<pi-pstack>\/generated\/skills\/poteto-mode\/playbooks\/([\w-]+)\.md`/.exec(text)?.[1];
      return when(name !== undefined && ['autopilot-full', 'autopilot-stack', 'orchestrate'].includes(name) && existsSync(join(PKG, 'generated/skills/poteto-mode/playbooks', `${name}.md`)), `execution playbook ${name}`, `execution playbook ${name}`);
    }),
    check('plan.every-pr-has-unit-live-perf-and-ten-lanes', 'every PR has unit, live and perf verification, ten lanes with one regression lane against trunk, and a review gate line', src('poteto-mode/playbooks/multi-phase-plan.md', 'The live block is mandatory'), (view) => {
      const text = view.plans[0]?.text ?? '';
      const prs = text.split(/^## /m).filter((section) => /\(PR-\d+\)/.test(section.split('\n')[0] ?? ''));
      const bad = prs.filter((section) => (section.match(/^- \[ \] Lane \d+\./gm) ?? []).length !== 10 || (section.match(/Regression lane against trunk\./g) ?? []).length !== 1 || !/\*\*Verify, unit\.\*\*/.test(section) || !/\*\*Verify, perf\.\*\*/.test(section) || !/\*\*Review gate\.\*\*/.test(section));
      return when(prs.length >= 2 && bad.length === 0, `${prs.length} PRs, each with ten lanes and a trunk regression lane`, `PRs ${prs.length}; incomplete: ${bad.map((section) => section.split('\n')[0]).join(', ')}`);
    }),
    check('plan.is-plan-only-no-implementation', 'a plan request creates no branch, no worktree, no commit, no edit outside .pi/, and the plan stays unexecuted', src('poteto-mode/playbooks/multi-phase-plan.md', 'The plan is the deliverable. Do not implement.'), (view) => {
      const worktrees = view.git.worktrees.filter((tree) => tree.path !== view.repo);
      const writers = allWorkers(view).filter((worker) => assignmentOf(worker).workspace?.mode !== 'readonly');
      const writes = view.parent.toolCalls.filter((call) => (call.name === 'write' || call.name === 'edit') && String(call.args['path']).startsWith(view.repo) && !String(call.args['path']).includes('/.pi/'));
      return when(view.git.branches.join() === 'main' && worktrees.length === 0 && view.git.commitsSinceBase.length === 0 && view.git.dirty.length === 0 && writers.length === 0 && writes.length === 0 && !/\[x\]/.test(view.plans[0]?.text ?? ''), 'only main, no worktree, no commit, no writable worker, no checked box', `branches ${view.git.branches.join()}; worktrees ${worktrees.length}; commits ${view.git.commitsSinceBase.length}; writable workers ${writers.length}; writes ${writes.length}`);
    }),
    check('plan.prose-has-no-long-dashes', 'the plan contains no long dash', src('poteto-mode/playbooks/multi-phase-plan.md', 'No long dashes.'), (view) => when(view.plans[0] !== undefined && !/[\u2014\u2013]/.test(view.plans[0].text), 'no long dash', 'the plan contains a long dash')),
    workersCheck('plan.exploration-in-poteto-workers', 'step 3: exploration ran in a poteto worker with an explicit model', src('poteto-mode/playbooks/multi-phase-plan.md', 'Explore in workers with `role: "poteto"` and an explicit model'), { role: 'poteto', min: 1, mode: 'readonly', rootPath: true }),
    check('plan.hands-back-and-waits-for-the-go', 'the reply posts the plan path and the validator output, then stops and says execution starts only on the explicit go; nothing is spawned after the plan is written', src('poteto-mode/playbooks/multi-phase-plan.md', 'Execution starts on the operator\'s explicit go'), (view) => {
      const reply = finalReply(view);
      const writeAt = view.parent.toolCalls.find((call) => call.name === 'write' && String(call.args['path']).includes('/.pi/pstack/plans/'))?.order ?? Number.POSITIVE_INFINITY;
      const spawnsAfter = view.parent.toolCalls.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && call.order > writeAt);
      return when(view.plans[0] !== undefined && reply.includes(view.plans[0].path) && /check-plan output:/.test(reply) && /explicit go/.test(reply) && spawnsAfter.length === 0, 'path, validator output and the wait for the go', `reply ${reply.slice(0, 120)}; spawns after the plan ${spawnsAfter.length}`);
    }),
    settledAndCollected('plan.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    ...todoNegatives('plan-coupon', 'multi-phase-plan', { done: [1, 3, 4, 5, 6, 7], receipts: { 1: 'plan-three-prs', 3: 'plan-explored', 4: 'plan-written', 5: 'plan-prose', 6: 'plan-checked', 7: 'plan-handed-back' } }),
    { name: 'the plan lost its live verification', mutate: (sandbox) => editPlan(sandbox, (text) => text.replace(/\*\*Verify, live\.\*\*[\s\S]*?\*\*Verify, perf\.\*\*/, '**Verify, perf.**')), fails: ['plan.file-passes-the-validator', 'plan.every-pr-has-unit-live-perf-and-ten-lanes'] },
    { name: 'a PR has nine lanes', mutate: (sandbox) => editPlan(sandbox, (text) => text.replace(/- \[ \] Lane 10\..*\n/, '')), fails: ['plan.every-pr-has-unit-live-perf-and-ten-lanes'] },
    { name: 'no lane regresses against trunk', mutate: (sandbox) => editPlan(sandbox, (text) => text.replaceAll('Regression lane against trunk.', 'Lane about trunk.')), fails: ['plan.every-pr-has-unit-live-perf-and-ten-lanes'] },
    { name: 'the plan names an execution playbook that does not exist', mutate: (sandbox) => editPlan(sandbox, (text) => text.replace('autopilot-stack', 'autopilot-nope')), fails: ['plan.names-an-execution-playbook-that-exists'] },
    { name: 'the agent implemented the first PR', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['plan.is-plan-only-no-implementation'] },
    { name: 'the agent branched for the implementation', mutate: (sandbox) => patchGit(sandbox, (git) => (git['branches'] = ['main', 'pr-1'])), fails: ['plan.is-plan-only-no-implementation'] },
    { name: 'the plan uses a long dash', mutate: (sandbox) => editPlan(sandbox, (text) => text.replace('Bound the coupon percent', 'Bound the coupon percent \u2014')), fails: ['plan.prose-has-no-long-dashes'] },
    { name: 'the reply started execution without a go', mutate: (sandbox) => rewriteFinalReply(sandbox, 'explicit go', 'ok'), fails: ['plan.hands-back-and-waits-for-the-go'] },
  ],
};

function editPlan(sandbox: string, change: (text: string) => string): void {
  const dir = join(sandbox, 'repo/.pi/pstack/plans');
  const file = join(dir, readdirSync(dir)[0] as string);
  writeFileSync(file, change(read(file)));
}

// ---- eval

const FORBIDDEN = /\b(eval|test|tests|judge|experiment|rubric|score|compare|benchmark|candidate|arena)\b/i;
const shopHistory: Commit[] = [
  { message: 'feat: shop prices', files: { 'README.md': '# shop\n\nPrices for the corner shop.\n', 'src/prices.js': 'export const price = (item) => item.cents / 100;\n' } },
  { message: 'docs: house style', files: { 'docs/house-style.md': '# House style\n\nName helpers after what they return. Keep functions under ten lines.\n' } },
];
const ORGANIC = 'Add percent coupons to the shop: a function that takes an item and a percent and returns the price after the coupon, in src/prices.js.';
const EVAL_RUBRIC = ['the coupon function returns a price at or above 0 for any percent', 'the function name says what it returns', 'the existing price function is unchanged'];
const PRICES_A = "export const price = (item) => item.cents / 100;\nexport const priceAfterCoupon = (item, percent) => Math.max(0, price(item) * (1 - percent / 100));\n";
const PRICES_B = "export const price = (item) => item.cents / 100;\nexport const coupon = (item, percent) => price(item) * (1 - percent / 100);\n";

export const evalFamily: Family = {
  id: 'eval',
  title: 'Eval playbook: sanitized candidates that see no meta, a blinded cross-family judge, the chain verified from session files (spec 12.2)',
  spec: {
    family: 'eval',
    runId: 'shop-work',
    history: shopHistory,
    prompt: () => '/poteto-mode eval whether docs/house-style.md changes how an agent names a new coupon function in the shop project',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      const [plain, styled] = [ctx.commits[0] as string, ctx.commits[1] as string];
      const brief = (path: string) => `${ORGANIC}\nWork inside ${path}. Leave your result there and tell me what you did.`;
      parent.beginPlaybook('eval', 'Eval: house style');
      parent.readSkill('arena');
      const frame = join(parent.runDir, 'verification', 'artifacts', 'frame.md');
      parent.write(frame, `Variant under test: docs/house-style.md present. Success: the function name says what it returns.\nRubric:\n${EVAL_RUBRIC.map((criterion) => `- ${criterion}`).join('\n')}\n`);
      parent.proof({ id: 'eval-frame', target: 'step-1', command: `grep -c '^- ' ${frame} | grep -qx 3`, kind: 'review' });
      parent.done('eval', 1, 'eval-frame');
      parent.proof({ id: 'eval-envs', target: 'step-2', command: `git -C ${ctx.repo} diff --name-only ${plain} ${styled} | grep -qx docs/house-style.md`, kind: 'command' });
      parent.done('eval', 2, 'eval-envs');
      const stagedA = parent.stage('shop-a', { role: 'candidate', model: model('arena runners', 0), workspace: parent.worktree(styled) }, brief(worktreeOf(parent, 'shop-a')));
      const stagedB = parent.stage('shop-b', { role: 'candidate', model: model('arena runners', 1), workspace: parent.worktree(plain) }, brief(worktreeOf(parent, 'shop-b')));
      parent.proof({ id: 'eval-prompt', target: 'step-3', command: `test -s ${parent.workerDir('shop-a')}/brief.md && test -s ${parent.workerDir('shop-b')}/brief.md`, kind: 'review' });
      parent.done('eval', 3, 'eval-prompt');
      parent.fire(stagedA, stagedB).wait('shop-a').wait('shop-b').collect('shop-a', 'shop-b');
      workers['shop-a'] = new Worker().read(join(worktreeOf(parent, 'shop-a'), 'docs/house-style.md')).read(join(worktreeOf(parent, 'shop-a'), 'src/prices.js')).write(join(worktreeOf(parent, 'shop-a'), 'src/prices.js'), PRICES_A).text('Added priceAfterCoupon to src/prices.js.');
      workers['shop-b'] = new Worker().read(join(worktreeOf(parent, 'shop-b'), 'src/prices.js')).write(join(worktreeOf(parent, 'shop-b'), 'src/prices.js'), PRICES_B).text('Added coupon to src/prices.js.');
      parent.spawn('shop-reader', { role: 'judge', model: model('arena cross-judge pool', 1), workspace: parent.readonly() }, `Rubric:\n${EVAL_RUBRIC.map((criterion) => `- ${criterion}`).join('\n')}\n\nOutputs by label:\n- set-1: ${worktreeOf(parent, 'shop-a')}/src/prices.js\n- set-2: ${worktreeOf(parent, 'shop-b')}/src/prices.js\n\nScore both sets in one pass on one scale, and say which label is stronger.`);
      workers['shop-reader'] = new Worker().read(join(worktreeOf(parent, 'shop-a'), 'src/prices.js')).read(join(worktreeOf(parent, 'shop-b'), 'src/prices.js')).text('set-1 scores 3 of 3. set-2 scores 1 of 3. set-1 is stronger.');
      parent.wait('shop-reader').collect('shop-reader');
      for (const id of ['shop-a', 'shop-b']) parent.bash(`grep -o '"path":"[^"]*"' ${join(parent.workerDir(id), 'session')}/*.jsonl | sort -u`);
      parent.read(join(worktreeOf(parent, 'shop-a'), 'src/prices.js')).read(join(worktreeOf(parent, 'shop-b'), 'src/prices.js'));
      parent.proof({ id: 'eval-chain', target: 'step-6', command: `grep -c house-style ${join(parent.workerDir('shop-a'), 'session')}/*.jsonl`, kind: 'review' });
      parent.proof({ id: 'eval-read', target: 'step-7', command: `test -s ${worktreeOf(parent, 'shop-a')}/src/prices.js && test -s ${worktreeOf(parent, 'shop-b')}/src/prices.js`, kind: 'review' });
      parent.proof({ id: 'eval-spawned', target: 'step-4', command: `ls ${parent.workerDir('shop-a')}/assignment.json ${parent.workerDir('shop-b')}/assignment.json`, kind: 'command' });
      parent.proof({ id: 'eval-judged', target: 'step-5', command: `ls ${parent.workerDir('shop-reader')}/assignment.json`, kind: 'command' });
      parent.done('eval', 4, 'eval-spawned').done('eval', 5, 'eval-judged').done('eval', 6, 'eval-chain').done('eval', 7, 'eval-read');
      parent.text(`Variant under test: docs/house-style.md present.\nRubric:\n${EVAL_RUBRIC.map((criterion) => `- ${criterion}`).join('\n')}\nPer-candidate notes: set-1 (shop-a) opened docs/house-style.md and src/prices.js. set-2 (shop-b) opened src/prices.js.\nJudge's verdict: set-1 is stronger.\nSynthesis: the style file changed the name and the floor at zero.\nRecommendation: promote the variant.`);
      return scenario(parent, workers);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('eval', ['arena']),
    parentReads('eval.reads-arena', "the parent opens the arena skill whose Phases B and C the eval follows", src('poteto-mode/playbooks/eval.md', "per the **arena** skill's Phase B"), ['arena']),
    ...todoChecks({ playbook: 'eval' }),
    panelCheck('eval.candidates-on-different-models', 'step 4: candidates run on different model families, each in its own worktree', src('poteto-mode/playbooks/eval.md', 'Spawn N parallel candidates** on different models'), { role: 'candidate', line: 'arena runners', mode: 'worktree' }),
    check('eval.sanitized-names', 'step 2: the run id, worker ids and worktree paths a candidate sees carry none of the meta words', src('poteto-mode/playbooks/eval.md', 'Sanitize directory and slug names'), (view) => {
      const run = view.runs[0];
      const candidates = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'candidate');
      const paths = candidates.map((worker) => join(worker.dir, 'worktree').slice(view.repo.length));
      const hits = [run?.id ?? '', ...paths].filter((path) => FORBIDDEN.test(path));
      return when(candidates.length >= 2 && hits.length === 0, `paths seen: ${paths.join(', ')}`, `meta words in ${hits.join(', ')}`);
    }),
    check('eval.candidate-prompt-is-organic-and-identical', 'step 3: every candidate gets the same organic request, with no meta words, no cue to list skills or files, and no hint that others exist', src('poteto-mode/playbooks/eval.md', 'The candidate prompt looks like an organic user request'), (view) => {
      const candidates = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'candidate');
      const normal = candidates.map((worker) => (worker.brief ?? '').replaceAll(join(worker.dir, 'worktree'), '<own>'));
      const bad = candidates.filter((worker) => FORBIDDEN.test(worker.brief ?? '') || /which (skills|principles|files)|list the (skills|files)|other (agents|candidates|people|runs)/i.test(worker.brief ?? ''));
      return when(candidates.length >= 2 && new Set(normal).size === 1 && bad.length === 0, 'identical organic briefs with no meta', `distinct briefs ${new Set(normal).size}; meta in ${bad.map((worker) => worker.id).join(', ')}`);
    }),
    check('eval.candidate-sees-no-meta-anywhere', 'no file or directory in the candidate\'s starting tree, and no prompt it receives (the brief and its appended system prompt), contains a meta word', src('poteto-mode/playbooks/eval.md', 'No `eval`, `test`, `judge`, `experiment`, `rubric`'), (view) => {
      const candidates = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'candidate');
      const hits = candidates.flatMap((worker) => {
        const commit = String(assignmentOf(worker).workspace?.inputCommit);
        const tree = spawnSync('git', ['-C', view.repo, 'ls-tree', '-r', '--name-only', commit], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
        const contents = tree.map((file) => spawnSync('git', ['-C', view.repo, 'show', `${commit}:${file}`], { encoding: 'utf8' }).stdout);
        const roleDoc = read(join(PKG, 'generated', 'agents', `${assignmentOf(worker).role === 'candidate' ? 'general' : assignmentOf(worker).role}.md`));
        return [...tree.filter((file) => FORBIDDEN.test(file)).map((file) => `${worker.id} file ${file}`), ...contents.filter((text) => FORBIDDEN.test(text)).map(() => `${worker.id} file contents`), ...(FORBIDDEN.test(roleDoc) ? [`${worker.id} system prompt (${/\b(eval|test|judge|experiment|rubric|score|compare|benchmark|candidate|arena)\b/i.exec(roleDoc)?.[1]})`] : [])];
      });
      return when(candidates.length >= 2 && hits.length === 0, 'the candidates see no meta word', hits.join('; '));
    }),
    check('eval.rubric-held-back', 'step 1: the rubric has 3 to 6 criteria, reaches the judge, and never a candidate', src('poteto-mode/playbooks/eval.md', 'Write the rubric (3-6 concrete criteria) for the judge only'), (view) => {
      const judge = allWorkers(view).find((worker) => assignmentOf(worker).role === 'judge');
      const criteria = (judge?.brief ?? '').split('\n').filter((line) => /^- /.test(line) && !/^- set-/.test(line)).map((line) => line.slice(2));
      const leaked = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'candidate' && criteria.some((criterion) => (worker.brief ?? '').includes(criterion)));
      return when(criteria.length >= 3 && criteria.length <= 6 && leaked.length === 0, `${criteria.length} criteria, none in a candidate brief`, `criteria ${criteria.length}; leaked to ${leaked.map((worker) => worker.id).join(', ')}`);
    }),
    check('eval.variant-is-the-only-difference', 'the candidates\' environments differ only in the variant under test', src('poteto-mode/playbooks/eval.md', 'Per-candidate working dir with the variant in place'), (view) => {
      const trees = allWorkers(view).filter((worker) => assignmentOf(worker).role === 'candidate').map((worker) => spawnSync('git', ['-C', view.repo, 'ls-tree', '-r', '--name-only', String(assignmentOf(worker).workspace?.inputCommit)], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean));
      const [a = [], b = []] = trees;
      const diff = [...a.filter((file) => !b.includes(file)), ...b.filter((file) => !a.includes(file))];
      return when(trees.length === 2 && diff.join() === 'docs/house-style.md', `the trees differ only in ${diff.join(', ')}`, `trees differ in ${diff.join(', ')}`);
    }),
    check('eval.judge-is-blind-and-another-family', 'step 5: one readonly judge, not from the parent family, sees outputs by sanitized label and never a model name, and scores both sets in one pass', src('poteto-mode/playbooks/eval.md', 'The judge can know it\'s judging but sees outputs by sanitized label only'), (view) => {
      const judge = allWorkers(view).find((worker) => assignmentOf(worker).role === 'judge');
      const brief = judge?.brief ?? '';
      const family = (value: string) => value.slice(value.indexOf('/') + 1).split(/[-.]/)[0];
      const parentFamily = family(view.parent.models[0] ?? '');
      const names = /\b(claude|grok|deepseek|sim\/|gpt)\b/i.test(brief);
      return when(judge !== undefined && assignmentOf(judge).workspace?.mode === 'readonly' && family(String(assignmentOf(judge).model)) !== parentFamily && /set-1/.test(brief) && /set-2/.test(brief) && !names && /one pass on one scale/.test(brief), `judge ${String(assignmentOf(judge as never).model)} sees set-1 and set-2 with no model name`, `judge ${judge?.id}; names in brief ${names}`);
    }),
    check('eval.chain-verified-from-session-files', 'step 6: the parent read each candidate\'s own session file, never globbed across other sessions, and the files it reports each candidate opened match the real session', src('poteto-mode/playbooks/eval.md', 'Read each candidate\'s Pi session file under its worker directory'), (view) => {
      const reads = view.parent.toolCalls.filter((call) => call.name === 'bash' && /workers\/shop-[ab]\/session\//.test(String(call.args['command'])));
      const glob = view.parent.toolCalls.filter((call) => /\.pi\/agent\/sessions\/\*|sessions\/\*\//.test(JSON.stringify(call.args)) && ['bash', 'find', 'ls', 'grep', 'read'].includes(call.name));
      const reply = finalReply(view);
      const problems = ['shop-a', 'shop-b'].flatMap((id) => {
        const worker = allWorkers(view).find((entry) => entry.id === id);
        const opened = [...new Set((worker?.session?.toolCalls ?? []).filter((call) => call.name === 'read').map((call) => String(call.args['path']).replace(join(worker?.dir ?? '', 'worktree') + '/', '')))].sort();
        const note = new RegExp(`\\(${id}\\) opened (.+?)\\.(?: |\\n|$)`).exec(reply)?.[1] ?? '';
        const listed = note.split(/ and |, /).map((entry) => entry.trim()).filter(Boolean).sort();
        return JSON.stringify(opened) === JSON.stringify(listed) ? [] : [`${id}: session shows ${opened.join(', ')}, the reply says ${listed.join(', ')}`];
      });
      return when(reads.length >= 2 && glob.length === 0 && problems.length === 0, 'both session files read, no glob, the reported files match', `session reads ${reads.length}; globs ${glob.length}; ${problems.join('; ')}`);
    }),
    check('eval.parent-read-every-output', 'step 7: the parent read each candidate output itself', src('poteto-mode/playbooks/eval.md', 'Read every candidate output yourself'), (view) => {
      const missing = ['shop-a', 'shop-b'].filter((id) => openedAt(view.parent, `workers/${id}/worktree/src/prices.js`) === -1);
      return when(missing.length === 0, 'both outputs opened', `not opened: ${missing.join(', ')}`);
    }),
    check('eval.reply-has-the-seven-parts', 'the reply gives the variant under test, the rubric, per-candidate notes, the judge\'s verdict, a synthesis, and a recommendation', src('poteto-mode/playbooks/eval.md', '**Reply:** variant under test, rubric'), (view) => {
      const reply = finalReply(view);
      const missing = [/Variant under test:/, /Rubric:/, /Per-candidate notes:/, /Judge's verdict:/, /Synthesis:/, /Recommendation:/].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0, 'all parts present', `missing ${missing.join(', ')}`);
    }),
    settledAndCollected('eval.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    { name: 'a meta word is in a worktree path', mutate: (sandbox) => renameSync(join(sandbox, 'repo/.pi/pstack/runs/shop-work/workers/shop-a'), join(sandbox, 'repo/.pi/pstack/runs/shop-work/workers/candidate-a')), fails: ['eval.sanitized-names'] },
    { name: 'the rubric leaked into a candidate brief', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/shop-work/workers/shop-a/brief.md'), `${ORGANIC}\n${EVAL_RUBRIC[0]}`), fails: ['eval.rubric-held-back', 'eval.candidate-prompt-is-organic-and-identical'] },
    { name: 'the candidate prompt names the experiment', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/shop-work/workers/shop-a/brief.md'), `This is an experiment. ${ORGANIC}`), fails: ['eval.candidate-prompt-is-organic-and-identical'] },
    { name: 'the candidate is asked which files it used', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/shop-work/workers/shop-b/brief.md'), `${ORGANIC}\nTell me which files you used.`), fails: ['eval.candidate-prompt-is-organic-and-identical'] },
    { name: 'the judge saw a model name', mutate: (sandbox) => writeFileSync(join(sandbox, 'repo/.pi/pstack/runs/shop-work/workers/shop-reader/brief.md'), `Rubric:\n- a\n- b\n- c\n\n- set-1: from claude\n- set-2: from grok\nScore both sets in one pass on one scale.`), fails: ['eval.judge-is-blind-and-another-family'] },
    { name: 'the judge is the parent family', mutate: (sandbox) => patchAssignment(sandbox, 'shop-work', 'shop-reader', (assignment) => (assignment['model'] = 'sim/claude-sim')), fails: ['eval.judge-is-blind-and-another-family'] },
    { name: 'the chain was graded from the candidate\'s own claims', mutate: (sandbox) => rewriteFinalReply(sandbox, 'opened docs/house-style.md and src/prices.js', 'said it used the style guide'), fails: ['eval.chain-verified-from-session-files'] },
    { name: 'the parent globbed across every session', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: 'grep -l house-style ~/.pi/agent/sessions/*/*.jsonl' }), fails: ['eval.chain-verified-from-session-files'] },
    { name: 'the candidates differed in more than the variant', mutate: (sandbox) => patchAssignment(sandbox, 'shop-work', 'shop-b', (assignment) => (assignment['workspace'] = { mode: 'worktree', inputCommit: assignmentCommit(sandbox, 'shop-a') })), fails: ['eval.variant-is-the-only-difference'] },
    { name: 'both candidates ran on one family', mutate: (sandbox) => patchAssignment(sandbox, 'shop-work', 'shop-b', (assignment) => (assignment['model'] = model('arena runners', 0))), fails: ['eval.candidates-on-different-models'] },
  ],
};

function assignmentCommit(sandbox: string, workerId: string): string {
  const path = join(sandbox, 'repo/.pi/pstack/runs/shop-work/workers', workerId, 'assignment.json');
  return (JSON.parse(read(path)) as { workspace: { inputCommit: string } }).workspace.inputCommit;
}

void [dirname, resolve, mkdirSync, fail, skillFile, repoUntouched, primaryRun];

export const metaFamilies: Family[] = [authoringFamily, planFamily, evalFamily];
