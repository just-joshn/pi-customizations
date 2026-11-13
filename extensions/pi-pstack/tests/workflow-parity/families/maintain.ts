// maintain-verification-skill and maintain-formal-verification-skill (spec 12.4): the upkeep loops for verification skills.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, fail, src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, collectOrder, finalReply, PINNED_REVISION, repoUntouched, settledAndCollected, spawnedTogether, spawnOrder, workersCheck } from '../lib/checks.ts';
import { PKG, SCRIPTED_ROLES, type Commit } from '../lib/driver.ts';
import { appendToolCall, dirtyRepo, overwrite, parentSession, rewriteFinalReply, rewriteSession, workerSessionFile } from '../lib/mutate.ts';
import { tlcAvailable } from '../lib/tlc.ts';
import type { RunView } from '../lib/view.ts';
import type { Family } from './types.ts';

void [PINNED_REVISION, PKG, fail, repoUntouched, spawnOrder, assignmentOf];
const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
const model = (line: string) => String(SCRIPTED_ROLES[line]);
const bashes = (view: RunView) => view.parent.toolCalls.filter((call) => call.name === 'bash');
const changedFiles = (view: RunView, branch: string): string[] => git(view.repo, 'diff', '--name-only', `${view.base}..${branch}`).split('\n').filter(Boolean);

// ---- maintain-verification-skill

const MV_RUN = 'maintain-verify';
const SKILL_DIR = '.pi/skills/verify-cart';
const FEATURES = ['totals', 'coupons', 'checkout'];
const FEATURE_FILES: Record<string, string> = {
  totals: '# Totals\n\ntotal() adds the lines and rounds the result to whole dollars.\n',
  coupons: '# Coupons\n\nA coupon percent above 100 is capped at 100, so a coupon never pays the customer.\n',
  checkout: '# Checkout\n\ncheckout() returns the amount and a label such as $9.00.\n',
};
const featureReaders = (view: RunView, name: string) => allWorkers(view).filter((worker) => worker.session?.toolCalls.some((call) => call.name === 'read' && !call.isError && [join(view.repo, SKILL_DIR, `features/${name}.md`), `${SKILL_DIR}/features/${name}.md`].includes(String(call.args['path']))));
const README_BEFORE = '# Features\n\n- [totals](totals.md)\n- [coupons](coupons.md)\n- [shipping](shipping.md)\n';
const README_AFTER = '# Features\n\n- [totals](totals.md)\n- [coupons](coupons.md)\n- [checkout](checkout.md)\n';
const DRIVES: Record<string, string> = {
  totals: "import('./src/cart.js').then((m)=>console.log('total='+m.total([{price:2.5,qty:2},{price:1.25,qty:4}])))",
  coupons: "import('./src/cart.js').then((m)=>console.log('total='+m.total([{price:10,qty:1}],150)))",
  checkout: "import('./src/checkout.js').then((m)=>console.log(JSON.stringify(m.checkout([{price:10,qty:1}],10))))",
};

const mvHistory: Commit[] = [
  ...cartHistory,
  {
    message: 'docs: verify-cart skill with a feature map',
    files: {
      [`${SKILL_DIR}/SKILL.md`]: '---\nname: verify-cart\ndescription: "Verify the cart features by driving the library. Use for verify the cart."\n---\n\n# Verify cart\n\n## Launch\n\nShort-lived library calls: one fresh isolated session per drive. Run `scripts/doctor.sh` first in every session, drive with `scripts/drive.sh <feature>`, and finish with `scripts/teardown.sh`. Evidence is written to `$EVIDENCE_DIR` and is never removed by teardown.\n\n## Drive\n\nOne command per feature, listed in `features/`.\n\n## Features\n\nSee `features/README.md`.\n',
      [`${SKILL_DIR}/features/README.md`]: README_BEFORE,
      ...Object.fromEntries(Object.entries(FEATURE_FILES).map(([name, text]) => [`${SKILL_DIR}/features/${name}.md`, text])),
      [`${SKILL_DIR}/scripts/doctor.sh`]: 'node --version > /dev/null && echo doctor-ok\n',
      [`${SKILL_DIR}/scripts/drive.sh`]: `feature="$1"\nmkdir -p "$EVIDENCE_DIR"\ncase "$feature" in\n${Object.entries(DRIVES).map(([name, code]) => `  ${name}) node --input-type=module -e "${code.replaceAll('"', '\\"')}" | tee "$EVIDENCE_DIR/$feature.txt" ;;`).join('\n')}\nesac\n`,
      [`${SKILL_DIR}/scripts/teardown.sh`]: 'rm -rf "$SESSION_DIR"\necho torn-down\n',
    },
  },
];

const mvReader = (name: string) => `Feature: ${name}\nSource entry points: src/cart.js, src/checkout.js\nLikely drift: ${name === 'totals' ? 'the map says whole dollars but round() works in cents' : name === 'coupons' ? 'none in the doc; total() has no cap above 100' : 'none'}\nRecipe: sh scripts/drive.sh ${name}`;

export const maintainVerificationFamily: Family = {
  id: 'maintain-verification-skill',
  title: 'maintain-verification-skill: locate, index hygiene, concurrent readonly source wave, a live pass that doctors first and tears down last, doc drift fixed in scope, a product gap reported not papered over (spec 12.4)',
  spec: {
    family: 'maintain-verification-skill',
    runId: MV_RUN,
    history: mvHistory,
    prompt: () => '/maintain-verification-skill audit the verify skill',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const workers: Record<string, Worker> = {};
      const evidence = join(ctx.sandbox, 'evidence');
      const skill = join(ctx.repo, SKILL_DIR);
      const drive = (feature: string) => `cd ${ctx.repo} && SESSION_DIR=$(mktemp -d) EVIDENCE_DIR=${evidence} sh ${SKILL_DIR}/scripts/doctor.sh && SESSION_DIR=$(mktemp -d) EVIDENCE_DIR=${evidence} sh ${SKILL_DIR}/scripts/drive.sh ${feature}`;
      parent.readSkill('maintain-verification-skill').bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook feature --title "maintain the verify skill" --run-id ${ctx.runId}`).bash('ls -d .pi/skills/verify-*/ && grep -l "Launch" .pi/skills/verify-*/SKILL.md').read(join(skill, 'SKILL.md')).read(join(skill, 'features/README.md')).bash(`ls ${SKILL_DIR}/features`);
      parent.edit(join(skill, 'features/README.md'), '- [shipping](shipping.md)\n', '- [checkout](checkout.md)\n');
      const staged = FEATURES.map((name) => parent.stage(`reader-${name}`, { role: 'general', model: model('swarm workers'), workspace: parent.readonly() }, `How does the ${name} feature work from source? Read ${SKILL_DIR}/features/${name}.md and the source it describes. Flag likely doc drift with citations and return one live recipe. Never drive the app and never edit files.`));
      parent.fire(...staged);
      for (const name of FEATURES) workers[`reader-${name}`] = new Worker().read(join(skill, `features/${name}.md`)).read(join(ctx.repo, 'src/cart.js')).text(mvReader(name));
      for (const name of FEATURES) parent.wait(`reader-${name}`);
      parent.collect(...FEATURES.map((name) => `reader-${name}`));
      for (const name of FEATURES) parent.bash(drive(name));
      parent.bash(`cd ${ctx.repo} && SESSION_DIR=$(mktemp -d) sh ${SKILL_DIR}/scripts/teardown.sh && ls ${evidence}`);
      parent.edit(join(skill, 'features/totals.md'), 'rounds the result to whole dollars', 'rounds the result to cents');
      parent.bash(`mkdir -p ${join(ctx.sandbox, 'notes')} && printf '%s\\n' 'product gap: total([{price:10,qty:1}],150) returns -5, the coupons map promises a cap at 100' > ${join(ctx.sandbox, 'notes/verify-notes.md')}`);
      parent.bash(`cd ${ctx.repo} && git switch -q -c ${MV_RUN} && git add ${SKILL_DIR} && git -c user.name=p -c user.email=p@example.com commit -q -m "docs: fix the verify-cart map"`);
      parent.text('Outcome: changed. One commit on branch maintain-verify fixes two map errors: the index listed a missing shipping file and omitted checkout, and totals said whole dollars while the code rounds to cents. Every feature was driven live after a doctor run, and evidence survived teardown. Product gap, not fixed here: a coupon of 150 percent gives a total of -5, so the cap the coupons map promises is gone. Run notes stay out of the repo.');
      return scenario(parent, workers);
    },
  },
  checks: [
    check('maintain-verification-skill.locates-the-target-first', 'the parent found the one project-local verification skill by its launch section before anything else', src('maintain-verification-skill/SKILL.md', '0. **Locate the target.**'), (view) => {
      const find = bashes(view).find((call) => /verify-\*/.test(String(call.args['command'])));
      const first = view.parent.toolCalls.find((call) => call.name === 'pstack_worker')?.order ?? Number.POSITIVE_INFINITY;
      return when(find !== undefined && find.order < first && (find.resultText.match(/verify-/g) ?? []).length >= 1, `found ${find?.resultText.split('\n')[0]}`, 'no search for the verification skill before the first spawn');
    }),
    check('maintain-verification-skill.index-matches-the-files', 'after the pass the feature map index lists exactly the feature files that exist: the dead entry is gone and the missing one is added', src('maintain-verification-skill/SKILL.md', '1. **Index hygiene.**'), (view) => {
      const readme = git(view.repo, 'show', `${MV_RUN}:${SKILL_DIR}/features/README.md`);
      const listed = [...readme.matchAll(/\]\((\w+)\.md\)/g)].map((match) => match[1]).sort();
      const files = git(view.repo, 'ls-tree', '--name-only', `${MV_RUN}:${SKILL_DIR}/features/`).split('\n').filter((name) => name.endsWith('.md') && name !== 'README.md').map((name) => name.replace('.md', '')).sort();
      return when(JSON.stringify(listed) === JSON.stringify(files), `index lists ${listed.join(', ')}`, `index ${listed.join(',')} vs files ${files.join(',')}`);
    }),
    check('maintain-verification-skill.one-reader-per-feature-file', 'one readonly reader per feature file', src('maintain-verification-skill/SKILL.md', '2. **Source wave.** One read-only subagent per feature file'), (view) => {
      const readers = FEATURES.map((name) => featureReaders(view, name));
      if (readers.some((workers) => workers.length !== 1) || new Set(readers.flat()).size !== FEATURES.length) return fail(FEATURES.map((name, i) => `${name}: ${readers[i]!.map((worker) => worker.id).join(', ') || 'none'}`).join('; '));
      return workersCheck('', '', [], { role: 'general', min: 3, max: 3, mode: 'readonly', rootPath: true }).run({ ...view, runs: view.runs.map((run) => ({ ...run, workers: run.workers.filter((worker) => readers.flat().includes(worker)) })) });
    }),
    spawnedTogether('maintain-verification-skill.readers-concurrent', src('maintain-verification-skill/SKILL.md', 'launched concurrently'), ['general']),
    check('maintain-verification-skill.children-never-drive-or-edit', 'no reader ran a drive command or called a write tool', src('maintain-verification-skill/SKILL.md', 'Children never drive the app and never edit files.'), (view) => {
      const bad = allWorkers(view).flatMap((worker) => (worker.session?.toolCalls ?? []).filter((call) => !['read', 'grep', 'find', 'ls', 'bash_readonly'].includes(call.name) && !call.isError).map((call) => `${worker.id}:${call.name}`));
      return when(bad.length === 0, 'readers only read', bad.join(', '));
    }),
    check('maintain-verification-skill.live-pass-doctors-first-and-tears-down-last', 'every feature was driven live after the source wave, each drive preceded by a doctor run in its fresh session, teardown after the last drive, and the evidence still on disk', src('maintain-verification-skill/SKILL.md', '4. **Live pass.** Required even when source looks clean.'), (view) => {
      const readers = FEATURES.map((name) => featureReaders(view, name));
      if (readers.some((workers) => workers.length !== 1) || new Set(readers.flat()).size !== FEATURES.length) return fail(`source readers ambiguous or missing: ${readers.map((workers) => workers.map((worker) => worker.id).join(', ') || 'none').join('; ')}`);
      const collected = readers.flat().map((worker) => collectOrder(view, worker.id));
      if (collected.some((order) => order < 0)) return fail('source readers were not collected');
      const wave = Math.max(...collected);
      const drives = FEATURES.map((name) => bashes(view).find((call) => new RegExp(`doctor\\.sh && .*drive\\.sh ${name}`).test(String(call.args['command']))));
      const teardown = bashes(view).find((call) => /teardown\.sh/.test(String(call.args['command'])));
      const evidence = FEATURES.every((name) => existsSync(join(view.sandbox, 'evidence', `${name}.txt`)));
      const ok = drives.every((call) => call !== undefined && call.order > wave && !call.isError && /doctor-ok/.test(call.resultText)) && teardown !== undefined && teardown.order > Math.max(...drives.map((call) => call?.order ?? 0));
      return when(ok && evidence && /torn-down/.test(teardown?.resultText ?? ''), `3 doctored drives after the wave, teardown at ${teardown?.order}, evidence ${FEATURES.join(', ')} on disk`, `drives ${drives.map((call) => call?.order).join(',')}, wave ${wave}, teardown ${teardown?.order}, evidence ${evidence}`);
    }),
    check('maintain-verification-skill.edit-scope-is-the-skill-directory', 'one commit on a branch changed only files under the verification skill; product code is untouched', src('maintain-verification-skill/SKILL.md', 'Only edit the verification skill\'s own directory'), (view) => {
      const files = changedFiles(view, MV_RUN);
      const commits = git(view.repo, 'rev-list', '--count', `${view.base}..${MV_RUN}`).trim();
      return when(files.length > 0 && files.every((file) => file.startsWith(`${SKILL_DIR}/`)) && commits === '1' && view.git.dirty.length === 0, `1 commit, ${files.join(', ')}`, `${commits} commits; changed ${files.join(', ')}`);
    }),
    check('maintain-verification-skill.drift-fixed-product-gap-reported', 'the wrong rounding description is fixed, and the promise the app broke stays in the map while the reply reports it as a product gap with the value the live drive showed', src('maintain-verification-skill/SKILL.md', 'App behavior that\'s actually broken → product gap; record it for the user, keep it out of this PR.'), (view) => {
      const totals = git(view.repo, 'show', `${MV_RUN}:${SKILL_DIR}/features/totals.md`);
      const coupons = git(view.repo, 'show', `${MV_RUN}:${SKILL_DIR}/features/coupons.md`);
      const live = readFileSync(join(view.sandbox, 'evidence/coupons.txt'), 'utf8').trim();
      const reply = finalReply(view);
      return when(/cents/.test(totals) && /capped at 100/.test(coupons) && live === 'total=-5' && /Product gap/.test(reply) && /-5/.test(reply), 'totals fixed, coupons promise kept, the reply reports total -5', `totals ${totals.trim()}; coupons ${coupons.trim()}; live ${live}; reply gap ${/Product gap/.test(reply)}`);
    }),
    check('maintain-verification-skill.outcome-and-notes', 'the reply names the outcome, and the run notes were written outside the repository and not committed', src('maintain-verification-skill/SKILL.md', 'Keep concise run notes (features covered, unreachable prerequisites, confirmed drift, outcome) in a scratch location; don\'t commit them.'), (view) => when(/^Outcome: (clean|changed|blocked)/m.test(finalReply(view)) && existsSync(join(view.sandbox, 'notes/verify-notes.md')) && !changedFiles(view, MV_RUN).some((file) => /notes/.test(file)), 'outcome stated, notes outside the repo', 'no outcome line, or the notes are missing or committed')),
    settledAndCollected('maintain-verification-skill.settled-and-collected', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
  ],
  negatives: [
    { name: 'product code was edited during the run', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['maintain-verification-skill.edit-scope-is-the-skill-directory'] },
    { name: 'the index still lists the dead entry', mutate: (sandbox) => execFileSync('git', ['-C', join(sandbox, 'repo'), 'update-ref', `refs/heads/${MV_RUN}`, execFileSync('git', ['-C', join(sandbox, 'repo'), 'rev-parse', 'main'], { encoding: 'utf8' }).trim()]), fails: ['maintain-verification-skill.index-matches-the-files'] },
    { name: 'a feature was never driven live', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'drive.sh checkout', 'drive.sh nothing'), fails: ['maintain-verification-skill.live-pass-doctors-first-and-tears-down-last'] },
    { name: 'the drive ran with no doctor first', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'doctor.sh &&', 'true &&'), fails: ['maintain-verification-skill.live-pass-doctors-first-and-tears-down-last'] },
    { name: 'a reader wrote a file', mutate: (sandbox) => appendToolCall(workerSessionFile(sandbox, MV_RUN, 'reader-totals'), 'write', { path: '/x', content: 'x' }), fails: ['maintain-verification-skill.children-never-drive-or-edit'] },
    { name: 'the product gap was papered over in the reply', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Product gap', 'Doc note'), fails: ['maintain-verification-skill.drift-fixed-product-gap-reported'] },
    { name: 'no outcome was named', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Outcome: changed', 'Done'), fails: ['maintain-verification-skill.outcome-and-notes'] },
  ],
};

// ---- maintain-formal-verification-skill

const MF_RUN = 'maintain-formal';
const VDIR = '.pi/skills/verify-pay';
const STATECHART = join(PKG, 'generated/skills/statechart/scripts/statechart');
const CHECK = `cd ${VDIR}/model && rm -rf out && ${STATECHART} Pay.tla --config Pay.cfg --view view.mjs --out out`;
const PAY_JS = `export const start = () => ({ phase: 'idle', captured: false });

export function authorize(p) {
  if (p.phase !== 'idle') throw new Error('authorize needs idle');
  return { ...p, phase: 'authorized' };
}

export function capture(p) {
  if (p.phase !== 'authorized') throw new Error('capture needs authorized');
  return { phase: 'paid', captured: true };
}

export function refund(p) {
  if (p.phase !== 'paid') throw new Error('refund only after capture');
  return { ...p, phase: 'refunded' };
}
`;
const PAY_JS_CANCEL = `${PAY_JS}
export function cancel(p) {
  if (p.phase !== 'authorized') throw new Error('cancel needs authorized');
  return { ...p, phase: 'refunded' };
}
`;
const TLA = (cancel: boolean) => `---- MODULE Pay ----
EXTENDS Naturals
VARIABLES phase, captured
vars == <<phase, captured>>
Init == phase = "idle" /\\ captured = FALSE
Authorize == phase = "idle" /\\ phase' = "authorized" /\\ UNCHANGED captured
Capture == phase = "authorized" /\\ phase' = "paid" /\\ captured' = TRUE
Refund == phase = "paid" /\\ phase' = "refunded" /\\ UNCHANGED captured
${cancel ? `Cancel == phase = "authorized" /\\ phase' = "refunded" /\\ UNCHANGED captured\n` : ''}Done == phase \\in {"paid", "refunded"} /\\ UNCHANGED vars
Next == Authorize \\/ Capture \\/ Refund \\/ ${cancel ? 'Cancel \\/ ' : ''}Done
Spec == Init /\\ [][Next]_vars
RefundOnlyAfterCapture == phase = "refunded" => captured
====
`;
const VIEW = "export const title = 'Payment';\nexport const state = (v) => v.phase;\nexport const step = (action) => action;\n";
const VERIFY_SKILL = `---\nname: verify-pay\ndescription: "Model check the payment lifecycle in src/pay.js. Use for verify the payment model."\n---\n\n# Verify the payment model\n\nCovers: src/pay.js (authorize, capture, refund).\nProperty: RefundOnlyAfterCapture, a payment is refunded only if it was captured.\nBounds: none, the model is finite.\nAssumptions: one payment at a time.\nCommand: \`${CHECK}\`\nSync commit: none recorded\n`;

const mfHistory: Commit[] = [
  ...cartHistory,
  { message: 'feat: payment lifecycle', files: { 'src/pay.js': PAY_JS } },
  { message: 'verify: model the payment lifecycle', files: { [`${VDIR}/SKILL.md`]: VERIFY_SKILL, [`${VDIR}/model/Pay.tla`]: TLA(false), [`${VDIR}/model/Pay.cfg`]: 'SPECIFICATION Spec\nINVARIANT RefundOnlyAfterCapture\n', [`${VDIR}/model/view.mjs`]: VIEW } },
  { message: 'feat: let a merchant cancel before capture', files: { 'src/pay.js': PAY_JS_CANCEL } },
  { message: 'style: tidy pay.js spacing', files: { 'src/pay.js': `${PAY_JS_CANCEL}\n` } },
];

const toolsRan = (view: RunView, pattern: RegExp) => bashes(view).filter((call) => pattern.test(String(call.args['command'])));

export const maintainFormalFamily: Family = {
  id: 'maintain-formal-verification-skill',
  title: 'maintain-formal-verification-skill: run as it is, read the changes, update the model from the code, rerun with the real model checker, replay the counterexample and call it a bug, never weaken the property (spec 12.4)',
  requires: 'tlc',
  spec: {
    family: 'maintain-formal-verification-skill',
    runId: MF_RUN,
    history: mfHistory,
    prompt: () => '/maintain-formal-verification-skill is the payment model still true to the code',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const verifySha = (ctx.commits[mfHistory.findIndex((commit) => commit.message.startsWith('verify:'))] as string).slice(0, 10);
      const cancelSha = (ctx.commits[mfHistory.findIndex((commit) => commit.message.includes('let a merchant cancel'))] as string).slice(0, 10);
      const tla = join(ctx.repo, VDIR, 'model/Pay.tla');
      const stamp = `h=$(git rev-parse HEAD) && node -e "const fs=require('fs');const f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/Sync commit: .*/,'Sync commit: '+process.argv[2]))" ${VDIR}/SKILL.md $h`;
      parent.readSkill('maintain-formal-verification-skill').bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook feature --title "maintain the payment model" --run-id ${ctx.runId}`);
      parent.bash(`grep -l -i "model" .pi/skills/*/SKILL.md`).read(join(ctx.repo, VDIR, 'SKILL.md')).bash(`git log --format='%h %s' -- ${VDIR}`);
      parent.bash(CHECK);
      parent.bash(`git log --format='%h %s' ${verifySha}..HEAD -- src/pay.js`).bash(`git diff ${verifySha}..HEAD -- src/pay.js`);
      parent.edit(tla, 'Done == ', `Cancel == phase = "authorized" /\\ phase' = "refunded" /\\ UNCHANGED captured\nDone == `).edit(tla, 'Next == Authorize \\/ Capture \\/ Refund \\/ Done', 'Next == Authorize \\/ Capture \\/ Refund \\/ Cancel \\/ Done');
      parent.bash(CHECK);
      parent.bash(`node --input-type=module -e "import('./src/pay.js').then((m)=>{let p=m.authorize(m.start());p=m.cancel(p);console.log(JSON.stringify(p))})"`);
      parent.bash(stamp).bash(CHECK);
      parent.bash(`git switch -q -c ${MF_RUN} && git add ${VDIR} && git -c user.name=p -c user.email=p@example.com commit -q -m "verify: describe cancel in the payment model"`);
      parent.text(`Outcome: updated and bug. I used the last commit that changed the verification, ${verifySha}, as the sync commit because none was recorded.
Commits read: ${cancelSha} added cancel, and a spacing commit changed nothing the model describes.
Updated: cancel was a new path to the guarded state, so the model gained a Cancel step. The property is unchanged.
Before the update the check passed on a stale description. After it, RefundOnlyAfterCapture fails.
Bug: authorize then cancel leaves the payment refunded with captured false, replayed against src/pay.js. A customer is refunded money the store never took. It came in with commit ${cancelSha}, which is a bug in the code, not drift in the model.
Not covered: partial refunds and expiry. The verification update is its own commit on branch ${MF_RUN} and no product code changed.`);
      return scenario(parent);
    },
  },
  checks: [
    check('maintain-formal.runs-the-check-as-it-is-first', 'the first real run of the model checker came before any edit and passed, which the skill treats as proof only of the old description', src('maintain-formal-verification-skill/SKILL.md', '2. **Run it as it is.**'), (view) => {
      const first = toolsRan(view, /statechart/)[0];
      const edit = view.parent.toolCalls.find((call) => call.name === 'edit');
      return when(first !== undefined && !first.isError && /Rules that hold/.test(first.resultText) && !/breaks/.test(first.resultText) && first.order < (edit?.order ?? Number.POSITIVE_INFINITY), 'the unchanged model passes before the first edit', `first run: ${first?.resultText.slice(0, 120)}`);
    }),
    check('maintain-formal.reads-every-change-to-covered-code', 'before editing, the parent listed and diffed the covered file from the sync commit to HEAD', src('maintain-formal-verification-skill/SKILL.md', '3. **Read every change to covered code.**'), (view) => {
      const log = toolsRan(view, /git log .*src\/pay\.js/)[0];
      const diff = toolsRan(view, /git diff .*src\/pay\.js/)[0];
      const edit = view.parent.toolCalls.find((call) => call.name === 'edit');
      return when(log !== undefined && diff !== undefined && /cancel/.test(diff.resultText) && Math.max(log.order, diff.order) < (edit?.order ?? 0), 'log and diff of src/pay.js, both before the first edit, and the diff shows cancel', `log ${log?.order}, diff ${diff?.order}, edit ${edit?.order}`);
    }),
    check('maintain-formal.update-mirrors-the-code-and-keeps-the-property', 'the model gained a step for the new code path, and the property is exactly what it was', src('maintain-formal-verification-skill/SKILL.md', '4. **Update from the code, not from the result.**'), (view) => {
      const tla = readFileSync(join(view.repo, VDIR, 'model/Pay.tla'), 'utf8');
      const cfg = readFileSync(join(view.repo, VDIR, 'model/Pay.cfg'), 'utf8');
      return when(/^Cancel == phase = "authorized"/m.test(tla) && /Refund \\\/ Cancel/.test(tla) && /^RefundOnlyAfterCapture == phase = "refunded" => captured$/m.test(tla) && /INVARIANT RefundOnlyAfterCapture/.test(cfg), 'Cancel is a new action in Next; the invariant text and config are unchanged', `model: ${tla.slice(0, 300)}`);
    }),
    check('maintain-formal.rerun-fails-and-the-counterexample-is-replayed', 'the rerun on the updated model failed with the property, and the parent replayed authorize then cancel against the real code and saw a refund with no capture', src('maintain-formal-verification-skill/SKILL.md', 'replay the counterexample against the real code, step by step'), (view) => {
      const runs = toolsRan(view, /statechart/);
      const replay = toolsRan(view, /m\.cancel\(p\)/)[0];
      return when(runs.length >= 3 && runs[1] !== undefined && /RefundOnlyAfterCapture breaks/.test(runs[1].resultText) && runs[1].isError && replay !== undefined && /"phase":"refunded","captured":false/.test(replay.resultText) && replay.order > runs[1].order, 'second run violates the invariant (exit 1), the replay shows refunded with captured false', `runs ${runs.length}; second: ${runs[1]?.resultText.slice(0, 100)}; replay ${replay?.resultText}`);
    }),
    check('maintain-formal.bug-named-with-its-commit-not-drift', 'the report calls the failure a bug in the code, names the commit that introduced it, tells the steps and the harm, says the old pass was stale, and lists what is not covered', src('maintain-formal-verification-skill/SKILL.md', 'Say outright which failures were drift in the verification and which were bugs in the code.'), (view) => {
      const reply = finalReply(view);
      const cancel = git(view.repo, 'log', '--format=%H', '-1', '--grep=let a merchant cancel', 'main').trim().slice(0, 10);
      return when(/Outcome: updated and bug/.test(reply) && reply.includes(cancel) && /not drift/.test(reply) && /authorize then cancel/.test(reply) && /stale description/.test(reply) && /Not covered/.test(reply), `reply names ${cancel} and the outcome`, `reply: ${reply.slice(0, 200)}; commit ${cancel}`);
    }),
    check('maintain-formal.edit-scope-and-sync-commit', 'only verification files changed, in their own commit, the sync commit moved to the checked commit, and the verify skill was run once as the next agent would', src('maintain-formal-verification-skill/SKILL.md', '6. **Update the verify skill.**'), (view) => {
      const files = changedFiles(view, MF_RUN);
      const commits = git(view.repo, 'rev-list', '--count', `${view.base}..${MF_RUN}`).trim();
      const skill = git(view.repo, 'show', `${MF_RUN}:${VDIR}/SKILL.md`);
      const head = git(view.repo, 'rev-parse', 'main').trim();
      const runs = toolsRan(view, /statechart/);
      return when(files.length > 0 && files.every((file) => file.startsWith(`${VDIR}/`)) && commits === '1' && skill.includes(`Sync commit: ${head}`) && runs.length >= 3 && runs.at(-1)!.order > (toolsRan(view, /Sync commit/)[0]?.order ?? Number.POSITIVE_INFINITY), `1 commit touching ${files.join(', ')}; sync commit ${head.slice(0, 10)}; the skill was run again after the update`, `${commits} commits; files ${files.join(',')}; skill says ${/Sync commit: .*/.exec(skill)?.[0]}; runs ${runs.length}`);
    }),
    check('maintain-formal.no-product-fix-no-weakening', 'src/pay.js is as the last code commit left it, so the bug was reported and not patched', src('maintain-formal-verification-skill/SKILL.md', 'Never edit product code during a run'), (view) => when(git(view.repo, 'diff', 'main', MF_RUN, '--', 'src').trim() === '' && view.git.dirty.length === 0, 'src is identical on main and the branch', 'src differs between main and the verification branch')),
  ],
  negatives: [
    { name: 'the property was weakened to make the check pass', mutate: (sandbox) => overwrite(join(sandbox, 'repo', VDIR, 'model/Pay.tla'), (text) => text.replace('=> captured', '=> TRUE')), fails: ['maintain-formal.update-mirrors-the-code-and-keeps-the-property'] },
    { name: 'product code was edited', mutate: (sandbox) => dirtyRepo(sandbox, 'src/pay.js'), fails: ['maintain-formal.no-product-fix-no-weakening'] },
    { name: 'the failure was called drift', mutate: (sandbox) => rewriteFinalReply(sandbox, 'not drift', 'which is drift'), fails: ['maintain-formal.bug-named-with-its-commit-not-drift'] },
    { name: 'no counterexample replay', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'm.cancel(p)', 'm.nothing(p)'), fails: ['maintain-formal.rerun-fails-and-the-counterexample-is-replayed'] },
    { name: 'the model was edited before the first run', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'Rules that hold', 'Rules that fail'), fails: ['maintain-formal.runs-the-check-as-it-is-first'] },
    { name: 'the covered file was never read', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'git diff', 'git status'), fails: ['maintain-formal.reads-every-change-to-covered-code'] },
  ],
};

export const maintainFamilies: Family[] = [maintainVerificationFamily, maintainFormalFamily];
void [tlcAvailable, model, FEATURE_FILES, README_AFTER];
