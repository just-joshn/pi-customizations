// Families: session-pickup, pause-safely, autonomous-run, worktree-cleanup.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { BENCH_JS, cartHistory, DEDUPE_JS, perfHistory, SET_DEDUPE_JS } from '../fixtures/repos.ts';
import { check, fail, pass, src, when } from '../lib/check.ts';
import {
  allWorkers,
  assignmentOf,
  filesChanged,
  finalReply,
  noToolErrors,
  openedAt,
  playbookReads,
  primaryRun,
  promptHasSkill,
  promptRoutes,
  receiptsFor,
  runAtCommit,
  skillFile,
  todoChecks,
  workersCheck,
} from '../lib/checks.ts';
import type { Ctx } from '../lib/driver.ts';
import { appendToolCall, deleteReceipt, dirtyRepo, parentSession, patchAssignment, patchGit, rewriteFinalReply } from '../lib/mutate.ts';
import type { RunView } from '../lib/view.ts';
import { todoNegatives } from './shared.ts';
import type { Family } from './types.ts';

const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const git = (repo: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=wf', '-c', 'user.email=wf@example.com', '-C', repo, ...args], { encoding: 'utf8' }).trim();
const rewriteSession = (sandbox: string, from: string | RegExp, to: string) => {
  const file = parentSession(sandbox);
  writeFileSync(file, typeof from === 'string' ? read(file).replaceAll(from, to) : read(file).replace(from, to));
};
const taskLines = (run: { todoText: string | null } | undefined) => (run?.todoText?.split('## Task-specific work')[1] ?? '').split('\n').filter((line) => /^- \[.\] /.test(line));

// ---- session pickup

const PRIOR_BRANCH = 'pstack-run/prior-run/old-worker';
const PRIOR_REPORT = `# Report

Plan: 1. csvRow helper. 2. exportCsv header row. 3. exportCsv item rows.
Done: 1. csvRow helper. 2. exportCsv header row.
Pending: 3. exportCsv item rows.
Repro: node --test
`;

function priorSessionLines(ctx: Ctx): string {
  const entries = [
    { type: 'session', version: 3, id: '55555555-5555-4555-8555-555555555555', timestamp: '2026-11-10T10:00:00.000Z', cwd: ctx.repo },
    { type: 'message', id: 'p1', parentId: null, timestamp: '2026-11-10T10:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Brief: build exportCsv in three units.' }], timestamp: 1 } },
    { type: 'message', id: 'p2', parentId: 'p1', timestamp: '2026-11-10T10:05:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Units 1 and 2 are committed and green. Unit 3, the item rows, is not started.' }], provider: 'sim', model: 'claude-sim', stopReason: 'stop', timestamp: 2 } },
  ];
  return `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}

function preparePrior(ctx: Ctx): void {
  git(ctx.repo, 'checkout', '-q', '-b', PRIOR_BRANCH);
  const write = (path: string, content: string) => {
    mkdirSync(join(ctx.repo, path, '..'), { recursive: true });
    writeFileSync(join(ctx.repo, path), content);
  };
  write('src/csv.js', "export const csvRow = (cells) => cells.join(',');\n");
  write('test/csv.test.js', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { csvRow } from '../src/csv.js';\ntest('joins', () => assert.equal(csvRow(['a', 1]), 'a,1'));\n");
  git(ctx.repo, 'add', '-A');
  git(ctx.repo, 'commit', '-q', '-m', 'feat: csvRow helper');
  write('src/export.js', "import { csvRow } from './csv.js';\nexport const exportCsv = () => `${csvRow(['name', 'qty', 'price', 'line_total'])}\\n`;\n");
  write('test/export.test.js', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { exportCsv } from '../src/export.js';\ntest('header', () => assert.equal(exportCsv(), 'name,qty,price,line_total\\n'));\n");
  git(ctx.repo, 'add', '-A');
  git(ctx.repo, 'commit', '-q', '-m', 'feat: exportCsv header row');
  git(ctx.repo, 'checkout', '-q', 'main');
  const worker = join(ctx.repo, '.pi/pstack/runs/prior-run/workers/old-worker');
  mkdirSync(join(worker, 'session'), { recursive: true });
  writeFileSync(join(ctx.repo, '.pi/pstack/runs/prior-run/run.json'), JSON.stringify({ schemaVersion: 1, runId: 'prior-run', title: 'prior', playbook: 'feature', upstreamRevision: 'x', createdAt: '2026-11-10T10:00:00.000Z', parentSessionFile: null, inputCommit: ctx.base }));
  writeFileSync(join(worker, 'assignment.json'), JSON.stringify({ schemaVersion: 1, runId: 'prior-run', workerId: 'old-worker', kind: 'pi', role: 'poteto', brief: 'brief.md', model: 'sim/grok-sim', thinkingLevel: null, workspace: { mode: 'readonly', path: ctx.repo }, skills: [] }, null, 2));
  writeFileSync(join(worker, 'brief.md'), 'Build exportCsv in three units.\n');
  writeFileSync(join(worker, 'report.md'), PRIOR_REPORT);
  writeFileSync(join(worker, 'session', '2026-11-10T10-00-00-000Z_55555555-5555-4555-8555-555555555555.jsonl'), priorSessionLines(ctx));
}

const PICKUP_REPLY = (head: string) => `Where the prior agent stopped: units 1 and 2 are committed on the old worker's branch, unit 3 was never started.
Inherited versus redone: I inherited the csvRow helper and the header row, and redid nothing.
Resume point: unit 3, exportCsv item rows.
Verdict: continue the execution, routed to the Feature playbook.
Outcome: the inherited work passes node --test at ${head.slice(0, 12)}, so the claim of two green units holds.`;

export const pickupFamily: Family = {
  id: 'session-pickup',
  title: 'Session pickup playbook: read the prior trail inside this workspace, name the resume point, redo nothing, verify the inherited claim (spec 12.5)',
  spec: {
    family: 'session-pickup',
    runId: 'pickup-csv',
    history: cartHistory,
    prepare: preparePrior,
    prompt: () => '/poteto-mode pick up run prior-run, worker old-worker, and finish the CSV export it started',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const head = git(ctx.repo, 'rev-parse', PRIOR_BRANCH);
      const worker = join(ctx.repo, '.pi/pstack/runs/prior-run/workers/old-worker');
      const session = join(worker, 'session', '2026-11-10T10-00-00-000Z_55555555-5555-4555-8555-555555555555.jsonl');
      const artifacts = join(parent.runDir, 'verification', 'artifacts');
      parent.beginPlaybook('session-pickup', 'Session pickup: CSV export');
      for (const leaf of ['principle-guard-the-context-window', 'principle-prove-it-works']) parent.readSkill(leaf);
      parent.read(join(worker, 'report.md')).bash(`tail -n 3 ${session}`);
      parent.proof({ id: 'pick-trail', target: 'step-1', command: `grep -c 'Plan:' ${join(worker, 'report.md')}`, kind: 'review' });
      parent.done('session-pickup', 1, 'pick-trail');
      parent.bash(`git log --oneline main..${PRIOR_BRANCH}`).bash(`git diff --stat main...${PRIOR_BRANCH}`);
      parent.proof({ id: 'pick-state', target: 'step-2', command: `test $(git log --oneline main..${PRIOR_BRANCH} | wc -l) -eq 2`, kind: 'command' });
      parent.done('session-pickup', 2, 'pick-state');
      parent.task('Resume point: unit 3, exportCsv item rows. Units 1 and 2 are done and not to be redone.');
      parent.proof({ id: 'pick-resume', target: 'step-3', command: `grep -c 'Resume point' ${join(parent.runDir, 'TODO.md')}`, kind: 'review' });
      parent.done('session-pickup', 3, 'pick-resume');
      parent.readPlaybook('feature');
      parent.proof({ id: 'pick-route', target: 'step-4', command: `test -s ${ctx.playbook('feature')}`, kind: 'review' });
      parent.done('session-pickup', 4, 'pick-route');
      parent.bash(`mkdir -p ${artifacts}/prior-head && git -C ${ctx.repo} archive ${PRIOR_BRANCH} | tar -x -C ${artifacts}/prior-head`);
      parent.proof({ id: 'pick-verify', target: 'step-5', command: 'node --test', cwd: join(artifacts, 'prior-head'), kind: 'test', commit: head });
      parent.done('session-pickup', 5, 'pick-verify');
      parent.text(PICKUP_REPLY(head));
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('session-pickup'),
    ...todoChecks({ playbook: 'session-pickup' }),
    check('pickup.trail-read-inside-this-workspace', "the prior worker's report and session file are read, and nothing globs across other projects' sessions", src('poteto-mode/playbooks/session-pickup.md', 'Do not glob across `~/.pi/agent/sessions/*/`'), (view) => {
      const report = openedAt(view.parent, 'workers/old-worker/report.md');
      const session = view.parent.toolCalls.find((call) => call.name === 'bash' && /workers\/old-worker\/session\/.*\.jsonl/.test(String(call.args['command'])) && /(tail|head|cat|sed)/.test(String(call.args['command'])));
      const glob = view.parent.toolCalls.filter((call) => ['bash', 'find', 'ls', 'grep', 'read'].includes(call.name) && /sessions\/\*\/|\.pi\/agent\/sessions/.test(JSON.stringify(call.args)));
      return when(report !== -1 && session !== undefined && glob.length === 0, `report opened at ${report}, session tail read at ${session?.order}, no cross-workspace glob`, `report ${report}, session read ${session?.order}, globs ${glob.length}`);
    }),
    check('pickup.state-reconstructed-with-git', 'the branch and what landed are read with git log and git diff against the base', src('poteto-mode/playbooks/session-pickup.md', 'what already landed (`git log`, `git diff` against the base)'), (view) => {
      const commands = view.parent.toolCalls.filter((call) => call.name === 'bash').map((call) => String(call.args['command']));
      return when(commands.some((command) => /git log .*old-worker/.test(command)) && commands.some((command) => /git diff .*old-worker/.test(command)), 'git log and git diff on the prior branch', `commands: ${commands.join(' | ').slice(0, 200)}`);
    }),
    check('pickup.resume-point-is-the-first-unfinished-unit', "the reply names the first unit the prior plan left pending, derived from the prior report", src('poteto-mode/playbooks/session-pickup.md', 'name the resume point'), (view) => {
      const report = read(join(view.repo, '.pi/pstack/runs/prior-run/workers/old-worker/report.md'));
      const pending = /Pending: (\d+\. [^.]+)\./.exec(report)?.[1] ?? '';
      const resume = /Resume point: ([^\n]*)/.exec(finalReply(view))?.[1] ?? '';
      return when(pending !== '' && resume.includes(pending.replace(/^\d+\. /, '')), `pending "${pending}" is the resume point "${resume}"`, `pending "${pending}", reply resume point "${resume}"`);
    }),
    check('pickup.nothing-redone', 'completed work is not redone: no parent write into the files the prior commits made, no commit, and the prior repro command is not re-run before verification', src('poteto-mode/playbooks/session-pickup.md', 'do not re-run the prior repro or redo completed work'), (view) => {
      const rewrites = view.parent.toolCalls.filter((call) => (call.name === 'write' || call.name === 'edit') && /^(src|test)\//.test(String(call.args['path']).startsWith('/') ? relative(view.repo, String(call.args['path'])) : String(call.args['path'])));
      const rerun = view.parent.toolCalls.filter((call) => call.name === 'bash' && /node --test/.test(String(call.args['command'])) && !/pick-verify/.test(String(call.args['command'])));
      return when(rewrites.length === 0 && rerun.length === 0 && view.git.commitsSinceBase.length === 0 && view.git.dirty.length === 0, 'nothing in src or test was written, nothing committed, the repro ran only as the final verification', `rewrites ${rewrites.length}, extra repro runs ${rerun.length}, commits ${view.git.commitsSinceBase.length}`);
    }),
    check('pickup.verdict-and-route', 'the verdict is one of the four, and the playbook it routes to was opened', src('poteto-mode/playbooks/session-pickup.md', 'continue the execution, ship a finished recommendation, ratify or override a prior conclusion, or postmortem a failed run'), (view) => {
      const verdict = /Verdict: (continue the execution|ship a finished recommendation|ratify or override a prior conclusion|postmortem a failed run)/.exec(finalReply(view))?.[1];
      const routed = /routed to the (\w+) playbook/.exec(finalReply(view))?.[1]?.toLowerCase();
      return when(verdict !== undefined && routed !== undefined && openedAt(view.parent, `playbooks/${routed}.md`) !== -1, `verdict "${verdict}", routed to ${routed}`, `verdict ${verdict}, routed ${routed}`);
    }),
    check('pickup.inherited-claims-verified-on-the-real-artifact', 'the inherited claim is verified on the prior branch head: the receipt names that commit and the checker re-runs the tests there', src('poteto-mode/playbooks/session-pickup.md', 'Verify the inherited claims against the original goal on the real artifact'), (view) => {
      const run = primaryRun(view, 'session-pickup');
      const receipt = run?.receipts.find((entry) => entry.id === 'pick-verify');
      const head = git(view.repo, 'rev-parse', PRIOR_BRANCH);
      const rerun = runAtCommit(view, head, 'node --test');
      return when(receipt?.commit === head && receipt.exitCode === 0 && rerun.status === 0, `receipt at ${head.slice(0, 10)}, re-run exits ${rerun.status}`, `receipt commit ${String(receipt?.commit).slice(0, 10)} vs head ${head.slice(0, 10)}, exit ${String(receipt?.exitCode)}, re-run ${rerun.status}`);
    }),
    check('pickup.reply-has-the-four-parts', 'the reply says where the prior agent stopped, inherited versus redone, the resume point, and the outcome', src('poteto-mode/playbooks/session-pickup.md', '**Reply:** where the prior agent stopped'), (view) => {
      const reply = finalReply(view);
      const missing = [/Where the prior agent stopped/i, /Inherited versus redone/i, /Resume point/i, /Outcome/i].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0, 'four parts present', `missing ${missing.join(', ')}`);
    }),
    noToolErrors('pickup.no-tool-errors', src('poteto-mode/playbooks/session-pickup.md', '**You own the resume point.')),
  ],
  negatives: [
    ...todoNegatives('pickup-csv', 'session-pickup', { done: [1, 2, 3, 4, 5], receipts: { 1: 'pick-trail', 2: 'pick-state', 3: 'pick-resume', 4: 'pick-route', 5: 'pick-verify' } }),
    { name: 'the agent redid completed work', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'write', { path: `${sandbox}/repo/src/csv.js`, content: 'x' }), fails: ['pickup.nothing-redone'] },
    { name: 'the agent globbed across every project\'s sessions', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: 'ls ~/.pi/agent/sessions/*/ | head' }), fails: ['pickup.trail-read-inside-this-workspace'] },
    { name: 'the resume point is a unit that was already done', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Resume point: unit 3, exportCsv item rows.', 'Resume point: unit 1, csvRow helper.'), fails: ['pickup.resume-point-is-the-first-unfinished-unit'] },
    { name: 'the verdict is not one of the four', mutate: (sandbox) => rewriteFinalReply(sandbox, 'continue the execution', 'start over'), fails: ['pickup.verdict-and-route'] },
    { name: 'the inherited claim was verified on the wrong commit', mutate: (sandbox) => patchReceiptCommit(sandbox), fails: ['pickup.inherited-claims-verified-on-the-real-artifact'] },
    { name: 'the prior report was never read', mutate: (sandbox) => rewriteSession(sandbox, 'workers/old-worker/report.md', 'workers/old-worker/other.md'), fails: ['pickup.trail-read-inside-this-workspace'] },
    { name: 'the reply left out the outcome', mutate: (sandbox) => rewriteFinalReply(sandbox, 'Outcome:', 'Note:'), fails: ['pickup.reply-has-the-four-parts'] },
  ],
};

function patchReceiptCommit(sandbox: string): void {
  const path = join(sandbox, 'repo/.pi/pstack/runs/pickup-csv/verification/receipts/pick-verify.json');
  const recorded = JSON.parse(read(path)) as { receipt: Record<string, unknown> };
  recorded.receipt['commit'] = 'deadbeefdeadbeef';
  writeFileSync(path, JSON.stringify(recorded));
}

// ---- pause safely

const WATCH_RUN = 'watch-run';
const PAUSE_NOTE = (head: string) => `# Resume note

## Intent
Watch the repository while the cart comment is finished.

## Doing
A ten minute watcher was running and src/cart.js carried an unfinished comment.

## Progress and verified
The watcher was stopped. Nothing is verified beyond the commit below.

## Current state
Branch main, one wip commit ${head.slice(0, 12)}, the tree is clean.

## Next steps
1. Read src/cart.js and finish the comment.
2. Start a new watcher.

## Key files
src/cart.js, NOTES.md

## Gotchas
The unfinished comment in src/cart.js is half a sentence.
`;

export const pauseFamily: Family = {
  id: 'pause-safely',
  title: 'Pause safely playbook: cancel nested workers, one wip commit, no irreversible action, a resume note a cold start can use (spec 12.5)',
  spec: {
    family: 'pause-safely',
    runId: 'pause-cart',
    history: cartHistory,
    prompt: () => 'start a watcher that sleeps ten minutes, and add an unfinished comment to src/cart.js plus a NOTES.md; do not commit anything yet',
    followUps: () => ['/poteto-mode pause: I am stopping for the day, leave this resumable'],
    scenario: (ctx) => {
      const first = new Parent({ ...ctx, runId: WATCH_RUN });
      first
        .bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook autonomous-run --title "watch the repo" --run-id ${WATCH_RUN}`)
        .spawn('watcher-1', { kind: 'watch', role: 'watcher', model: 'inherit-parent', workspace: first.readonly(), watch: { argv: ['sleep', '600'], cwd: ctx.repo } }, '')
        .edit(join(ctx.repo, 'src/cart.js'), 'export function subtotal(items) {', '// unfinished: this comment is half a sen\nexport function subtotal(items) {')
        .write(join(ctx.repo, 'NOTES.md'), 'notes for the watcher\n')
        .text('The watcher is running and the comment and notes are in place, uncommitted.');
      const parent = new Parent(ctx);
      parent.steps.push(...first.steps);
      const note = join(ctx.sandbox, 'tmp', 'pause-cart-resume.md');
      const wip = (message: string) => `git -c user.name=wip -c user.email=w@example.com commit -q -m ${JSON.stringify(message)}`;
      parent.beginPlaybook('pause-safely', 'Pause: stop for the day');
      parent.call('pstack_worker', { action: 'abort', runId: WATCH_RUN, workerId: 'watcher-1' });
      parent.proof({ id: 'pause-stopped', target: 'step-1', command: `grep -c '"kind":"abort"' ${join(ctx.repo, '.pi/pstack/runs', WATCH_RUN, 'events.jsonl')}`, kind: 'command' });
      parent.done('pause-safely', 1, 'pause-stopped');
      parent.proof({ id: 'pause-nothing-irreversible', target: 'step-2', command: `test -z "$(git remote)" && ! git log --all --format=%s | grep -q pushed`, kind: 'command' });
      parent.done('pause-safely', 2, 'pause-nothing-irreversible');
      parent.bash(`cd ${ctx.repo} && git add -A -- . ':!.pi' && ${wip('wip: unfinished cart comment and notes, tree is not broken')}`);
      parent.proof({ id: 'pause-wip', target: 'step-3', command: `git log -1 --format=%s | grep -q '^wip:' && test -z "$(git status --porcelain -- . ':!.pi')"`, kind: 'command', gitDir: ctx.repo });
      parent.done('pause-safely', 3, 'pause-wip');
      parent.bash(`mkdir -p ${join(ctx.sandbox, 'tmp')} && cat > ${note} <<'NOTE'\n${PAUSE_NOTE('PLACEHOLDER')}NOTE\nperl -pi -e "s/PLACEHOLDER/$(git rev-parse --short=12 HEAD)/" ${note}`);
      parent.proof({ id: 'pause-note', target: 'step-4', command: `test -s ${note}`, kind: 'command' });
      parent.done('pause-safely', 4, 'pause-note');
      parent.text(`Where I am: paused between the watcher and the comment. On disk: the resume note at ${note} and one wip commit. In my head: nothing. Commits: one wip commit, the tree is clean. First action on resume: read src/cart.js and finish the comment. This is a pause, not a final report.`);
      return scenario(parent);
    },
  },
  checks: [
    check('slash.pause', 'the pause arrives as the second user turn routed to poteto-mode', src('poteto-mode/playbooks/pause-safely.md', 'This is explicit only'), (view) => when(userTurns2(view) === 2 && promptHasSkill(view.parent.messages.filter((message) => message.role === 'user')[1]?.text ?? '', 'poteto-mode') && /pause/.test(view.parent.messages.filter((message) => message.role === 'user')[1]?.text.split('</skill>').at(-1) ?? ''), 'turn 2 is the pause request', `user turns ${userTurns2(view)}`)),
    ...playbookReads('pause-safely'),
    ...todoChecks({ playbook: 'pause-safely' }),
    check('pause.nested-workers-cancelled', 'step 1: every live nested worker is aborted through pstack_worker and its host records the abort', src('poteto-mode/playbooks/pause-safely.md', 'cancel any nested subagents'), (view) => {
      // A pause owes an abort only for a nested worker that existed to be stopped.
      if (allWorkers(view).length === 0) return pass('no nested worker existed, so none was left to abort');
      const watch = view.runs.find((run) => run.id === WATCH_RUN);
      const abort = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'abort' && !call.isError);
      const event = watch?.events.find((entry) => entry['kind'] === 'abort');
      const state = watch?.workers[0]?.state?.['phase'];
      return when(abort !== undefined && event !== undefined && ['stopped', 'aborted', 'exited', 'idle'].includes(String(state)), `abort at ${abort?.order}, abort event logged, worker phase ${String(state)}`, `abort call ${abort?.order}, event ${JSON.stringify(event)}, phase ${String(state)}`);
    }),
    check('pause.one-wip-commit-and-clean-tree', 'step 3: all uncommitted edits, tracked and untracked, land in exactly one wip: commit on the current branch, and the tree ends clean', src('poteto-mode/playbooks/pause-safely.md', 'Commit uncommitted edits as one clear `wip:` commit on the current branch'), (view) => {
      const commits = view.git.commitsSinceBase;
      const message = commits[0] === undefined ? '' : spawnSync('git', ['-C', view.repo, 'log', '-1', '--format=%s', commits[0]], { encoding: 'utf8' }).stdout.trim();
      const files = commits[0] === undefined ? [] : filesChanged(view, commits[0]);
      return when(commits.length === 1 && /^wip:/.test(message) && files.includes('src/cart.js') && files.includes('NOTES.md') && view.git.dirty.length === 0, `one commit "${message}" with ${files.join(', ')}; tree clean`, `commits ${commits.length}, message "${message}", files ${files.join(', ')}, dirty ${view.git.dirty.join(', ') || 'none'}`);
    }),
    check('pause.no-irreversible-action', 'step 2: no push, no PR', src('poteto-mode/playbooks/pause-safely.md', 'No PR and no push unless you already had one out'), (view) => {
      const bad = view.parent.toolCalls.filter((call) => call.name === 'bash' && /\b(git push|gh pr|origin pr)\b/.test(String(call.args['command'])));
      return when(bad.length === 0, 'no push and no PR', bad.map((call) => String(call.args['command'])).join(' | '));
    }),
    check('pause.resume-note-is-cold-start-ready', 'step 4: the resume note covers intent, doing, progress, state, next steps, key files and gotchas, names the wip commit, and its key files exist', src('poteto-mode/playbooks/pause-safely.md', 'Write the resume note off-context'), (view) => {
      // The reply names the note in any words: "resume note at <path>", or a path in a code span near "resume note" or any .md file it names.
      const reply = finalReply(view);
      const named = /resume note[^`\n]{0,40}?`?((?:\/|\.\/)?[\w./-]+\.md)`?/i.exec(reply)?.[1] ?? /`((?:\/|\.\/)?[\w./-]+\.md)`/.exec(reply)?.[1] ?? '';
      const path = [named, join(view.repo, named), join(view.sandbox, named)].find((candidate) => named !== '' && existsSync(candidate)) ?? named;
      const text = read(path);
      const missing = ['Intent', 'Doing', 'Progress', 'state', 'Next steps', 'Key files', 'Gotchas'].filter((heading) => !new RegExp(`^## .*${heading}`, 'im').test(text));
      const head = spawnSync('git', ['-C', view.repo, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
      const files = /## Key files\n(.*)/.exec(text)?.[1]?.split(/,\s*/) ?? [];
      return when(path !== '' && missing.length === 0 && text.includes(head) && files.length > 0 && files.every((file) => existsSync(join(view.repo, file.trim()))), `note ${path} has every section, the wip commit ${head}, and real key files`, `note ${path}; missing ${missing.join(', ')}; names the commit ${text.includes(head)}`);
    }),
    check('pause.reply-is-a-pause-not-a-report', 'the reply gives where the work stands, what is on disk, the commits and clean tree, and the first action on resume, and says it is a pause', src('poteto-mode/playbooks/pause-safely.md', 'This is a pause, not a final report'), (view) => {
      const reply = finalReply(view);
      const missing = [/Where (I am|you are|things stand|the work stands)/i, /On disk/i, /Commits/i, /First action on resume/i, /This is a pause, not a final report/i].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0, 'all parts present', `missing ${missing.join(', ')}`);
    }),
  ],
  negatives: [
    ...todoNegatives('pause-cart', 'pause-safely', { done: [1, 2, 3, 4], receipts: { 1: 'pause-stopped', 2: 'pause-nothing-irreversible', 3: 'pause-wip', 4: 'pause-note' } }),
    { name: 'the reply names the resume note in a code span and says where the work stands in other words', mutate: (sandbox) => rewriteFinalReply(sandbox, /Where I am: paused between the watcher and the comment\. On disk: the resume note at (\S+) and one wip commit\./, (_m, note: string) => `Where things stand: paused between the watcher and the comment. On disk: \`${note}\` is the resume note, and there is one wip commit.`), fails: [], passes: ['pause.resume-note-is-cold-start-ready', 'pause.reply-is-a-pause-not-a-report'] },
    { name: 'no nested worker existed when the pause came', mutate: (sandbox) => rmSync(join(sandbox, 'repo/.pi/pstack/runs', 'watch-run', 'workers'), { recursive: true, force: true }), fails: [], passes: ['pause.nested-workers-cancelled'] },
    { name: 'the nested worker was never aborted', mutate: (sandbox) => rewriteSession(sandbox, '"action":"abort"', '"action":"inspect"'), fails: ['pause.nested-workers-cancelled'] },
    { name: 'the tree was left dirty', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: ['pause.one-wip-commit-and-clean-tree'] },
    { name: 'the work was never committed', mutate: (sandbox) => patchGit(sandbox, (g) => (g['commitsSinceBase'] = [])), fails: ['pause.one-wip-commit-and-clean-tree'] },
    { name: 'the work was pushed', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: 'git push origin main' }), fails: ['pause.no-irreversible-action'] },
    { name: 'the resume note lost its gotchas', mutate: (sandbox) => rewriteNote(sandbox, '## Gotchas', '## Misc'), fails: ['pause.resume-note-is-cold-start-ready'] },
    { name: 'the resume note names a key file that does not exist', mutate: (sandbox) => rewriteNote(sandbox, 'src/cart.js, NOTES.md', 'src/cart.js, src/missing.js'), fails: ['pause.resume-note-is-cold-start-ready'] },
    { name: 'the reply is a final report', mutate: (sandbox) => rewriteFinalReply(sandbox, 'This is a pause, not a final report.', 'Done.'), fails: ['pause.reply-is-a-pause-not-a-report'] },
  ],
};

const userTurns2 = (view: RunView): number => view.parent.messages.filter((message) => message.role === 'user').length;

function rewriteNote(sandbox: string, from: string, to: string): void {
  const path = join(sandbox, 'tmp', 'pause-cart-resume.md');
  writeFileSync(path, read(path).replace(from, to));
}

// ---- autonomous run

const PREDICATE = "test $(node bench/bench.js | sed -n 's/.*comparisons=//p') -le 1000 && node --test";
const AUTO_REPLY = `Exit condition: ${PREDICATE}
Iterations run: 2. Landed: one commit, a Set lookup in src/dedupe.js. Discarded: a comment-only tweak that did not move the predicate.
Final predicate state: met, comparisons are 400 and the tests pass.`;

export const autonomousFamily: Family = {
  id: 'autonomous-run',
  title: 'Autonomous run playbook: a checkable exit predicate, watch loops that re-arm after each wake, one row per iteration, stop when it holds (spec 11.3)',
  spec: {
    family: 'autonomous-run',
    runId: 'auto-dedupe',
    history: perfHistory,
    prompt: () => '/poteto-mode run until done: make dedupe() need at most 1000 comparisons on the benchmark with the tests green. Do not stop to ask me.',
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const log = join(parent.runDir, 'decisions.tsv');
      const watch = () => ({ kind: 'watch' as const, role: 'watcher', model: 'inherit-parent', workspace: parent.readonly(), watch: { argv: ['sleep', '1'], cwd: ctx.repo } });
      const dedupe = join(ctx.repo, 'src/dedupe.js');
      parent.beginPlaybook('autonomous-run', 'Autonomous run: dedupe comparisons');
      parent.readSkill('principle-sequence-verifiable-units').readSkill('show-me-your-work');
      parent.task(`Exit condition: ${PREDICATE}`);
      parent.proof({ id: 'auto-predicate', target: 'step-1', command: `grep -c 'Exit condition' ${join(parent.runDir, 'TODO.md')}`, kind: 'review' });
      parent.done('autonomous-run', 1, 'auto-predicate');
      parent.spawn('watch-1', watch(), '').wait('watch-1');
      parent.proof({ id: 'auto-wake', target: 'step-2', command: `ls ${parent.workerDir('watch-1')}/assignment.json`, kind: 'command' });
      parent.done('autonomous-run', 2, 'auto-wake');
      parent.bash(`cd ${ctx.repo} && ${PREDICATE}`);
      parent.edit(dedupe, 'const out = [];', 'const out = []; // tweak');
      parent.bash(`cd ${ctx.repo} && ${PREDICATE}`);
      parent.bash(`cd ${ctx.repo} && git checkout -- src/dedupe.js`);
      parent.decision('iteration', 'tried a comment-only tweak', 'the smallest change that might help', 'bench output unchanged', 'predicate not met, discarded', log);
      parent.spawn('watch-2', watch(), '').wait('watch-2');
      parent.write(dedupe, SET_DEDUPE_JS);
      parent.bash(`cd ${ctx.repo} && ${PREDICATE}`);
      parent.bash(`cd ${ctx.repo} && git add src/dedupe.js && git -c user.name=auto -c user.email=a@example.com commit -q -m "perf: Set lookup in dedupe"`);
      parent.decision('iteration', 'replaced the output scan with a Set lookup', 'it does the least work per value', 'comparisons=400', 'predicate met, committed', log);
      parent.proof({ id: 'auto-iterate', target: 'step-3', command: `test $(git log --oneline ${ctx.base}..HEAD | wc -l) -eq 1`, kind: 'command' });
      parent.done('autonomous-run', 3, 'auto-iterate');
      parent.skip('autonomous-run', 4, 'no mid-run discovery needed a side fix');
      parent.proof({ id: 'auto-checkpoints', target: 'step-5', command: `test $(grep -c iteration ${log}) -ge 2`, kind: 'command' });
      parent.done('autonomous-run', 5, 'auto-checkpoints');
      parent.proof({ id: 'auto-stop', target: 'step-6', command: PREDICATE, kind: 'test', gitDir: ctx.repo });
      parent.done('autonomous-run', 6, 'auto-stop');
      parent.text(AUTO_REPLY);
      return scenario(parent);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('autonomous-run'),
    ...todoChecks({ playbook: 'autonomous-run', skipReason: { 4: /.+/ } }),
    check('auto.exit-predicate-is-checkable-and-real', 'step 1: the exit condition is written before the first iteration as a command, it fails at the base commit, and it passes at the end', src('poteto-mode/playbooks/autonomous-run.md', 'State the exit condition as a checkable predicate before the first iteration'), (view) => {
      const line = taskLines(primaryRun(view, 'autonomous-run')).find((entry) => /Exit condition:/.test(entry));
      const command = /Exit condition: (.*)$/.exec(line ?? '')?.[1] ?? '';
      const firstEdit = view.parent.toolCalls.find((call) => (call.name === 'edit' || call.name === 'write') && /src\//.test(String(call.args['path'])))?.order ?? Number.POSITIVE_INFINITY;
      const stated = view.parent.toolCalls.find((call) => call.name === 'bash' && String(call.args['command']).includes('Exit condition'))?.order ?? Number.POSITIVE_INFINITY;
      const head = spawnSync('git', ['-C', view.repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
      const before = command === '' ? { status: 0, output: '' } : runAtCommit(view, view.base, command);
      const after = command === '' ? { status: 1, output: '' } : runAtCommit(view, head, command);
      return when(command !== '' && stated < firstEdit && before.status !== 0 && after.status === 0, `predicate stated before the first edit; base exit ${before.status}, end exit ${after.status}`, `predicate "${command}", stated ${stated} before first edit ${firstEdit}, base exit ${before.status}, end exit ${after.status}`);
    }),
    check('auto.predicate-never-relaxed', 'the command evaluated on every iteration and at the end is the one stated up front', src('poteto-mode/playbooks/autonomous-run.md', 'never relax the predicate to declare victory'), (view) => {
      const command = /Exit condition: (.*)$/.exec(taskLines(primaryRun(view, 'autonomous-run')).find((entry) => /Exit condition:/.test(entry)) ?? '')?.[1] ?? '';
      const runs = view.parent.toolCalls.filter((call) => call.name === 'bash' && /^cd /.test(String(call.args['command'])) && /bench\/bench\.js/.test(String(call.args['command'])) && /-le/.test(String(call.args['command'])));
      const off = runs.filter((call) => !String(call.args['command']).includes(command));
      const stop = primaryRun(view, 'autonomous-run')?.receipts.find((entry) => entry.id === 'auto-stop');
      return when(command !== '' && runs.length >= 3 && off.length === 0 && stop?.command?.[2] === command, `${runs.length} predicate runs and the final receipt all use the stated command`, `${runs.length} runs, ${off.length} off the stated command, final receipt command ${JSON.stringify(stop?.command?.[2])}`);
    }),
    check('auto.watch-loop-re-arms-after-each-wake', 'the wake mechanism is a watch worker (role watcher, sleep, absolute cwd); a fresh one is spawned after each wake until the predicate holds, and none after', src('poteto-mode/playbooks/autonomous-run.md', 'Pick the wake mechanism as a watch loop'), (view) => {
      const watchers = allWorkers(view).filter((worker) => assignmentOf(worker).kind === 'watch');
      const spawn = (id: string) => view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes(`/${id}/`))?.order ?? -1;
      const wake = (id: string) => view.parent.messages.find((message) => message.customType === 'pstack-worker' && message.details?.['workerId'] === id && message.details?.['phase'] === 'exited')?.order ?? -1;
      const final = view.parent.toolCalls.filter((call) => call.name === 'bash' && /bench\/bench\.js/.test(String(call.args['command'])) && /-le/.test(String(call.args['command']))).at(-1)?.order ?? -1;
      const shapes = watchers.every((worker) => assignmentOf(worker).role === 'watcher' && assignmentOf(worker).watch?.argv?.[0] === 'sleep' && String(assignmentOf(worker).watch?.cwd).startsWith('/'));
      const ordered = watchers.length >= 2 && watchers.every((worker, index) => index === 0 || spawn(worker.id) > wake((watchers[index - 1] as { id: string }).id)) && watchers.every((worker) => wake(worker.id) !== -1 && spawn(worker.id) < final);
      return when(shapes && ordered, `${watchers.length} watch workers, each re-armed after the previous wake, none after the predicate held`, `watchers ${watchers.map((worker) => worker.id).join(', ')}; shapes ${shapes}; ordered ${ordered}`);
    }),
    check('auto.one-row-per-iteration', 'each iteration leaves a decisions.tsv row naming what changed and whether the predicate moved', src('poteto-mode/playbooks/autonomous-run.md', 'Checkpoint every iteration via the **show-me-your-work** skill'), (view) => {
      const rows = (primaryRun(view, 'autonomous-run')?.decisions ?? []).slice(1).filter((row) => row[1] === 'iteration');
      return when(rows.length === 2 && rows.every((row) => row.length === 6 && /predicate/.test(row[5] ?? '')), `${rows.length} iteration rows`, `iteration rows ${rows.length}`);
    }),
    check('auto.discarded-change-is-gone-and-the-win-is-one-small-commit', 'a change that did not move the predicate is discarded in full, and the one that did is one commit touching only its file', src('poteto-mode/playbooks/autonomous-run.md', 'discards changes that didn\'t help'), (view) => {
      const commits = view.git.commitsSinceBase;
      const files = commits[0] === undefined ? [] : filesChanged(view, commits[0]);
      const tree = commits[0] === undefined ? '' : runAtCommit(view, commits[0], 'cat src/dedupe.js').output;
      return when(commits.length === 1 && files.join() === 'src/dedupe.js' && !tree.includes('// tweak') && view.git.dirty.length === 0, 'one commit on src/dedupe.js, the tweak is gone, the tree is clean', `commits ${commits.length}, files ${files.join()}, tweak left ${tree.includes('// tweak')}, dirty ${view.git.dirty.join(', ') || 'none'}`);
    }),
    check('auto.stops-when-met-and-does-not-ask', 'the reply gives the exit condition, iterations, what landed, what was discarded and the final state, and does not stop to ask the user a question', src('poteto-mode/playbooks/autonomous-run.md', '**Reply:** the exit condition, iterations run'), (view) => {
      const reply = finalReply(view);
      const missing = [/Exit condition:/, /Iterations run: \d+/, /Landed:/, /Discarded:/, /Final predicate state:/].filter((pattern) => !pattern.test(reply)).map(String);
      return when(missing.length === 0 && !reply.trim().endsWith('?'), 'all five parts present, no question', `missing ${missing.join(', ')}; ends with ?: ${reply.trim().endsWith('?')}`);
    }),
    noToolErrors('auto.no-unexpected-tool-errors', src('poteto-mode/playbooks/autonomous-run.md', '**You own the exit condition.'), [/bench\/bench\.js/, /comparisons=/]),
  ],
  negatives: [
    ...todoNegatives('auto-dedupe', 'autonomous-run', { done: [1, 2, 3, 5, 6], receipts: { 1: 'auto-predicate', 2: 'auto-wake', 3: 'auto-iterate', 5: 'auto-checkpoints', 6: 'auto-stop' } }),
    { name: 'the predicate was relaxed to declare victory', mutate: (sandbox) => relaxPredicate(sandbox), fails: ['auto.predicate-never-relaxed'] },
    { name: 'only one watch loop was armed', mutate: (sandbox, view) => { const worker = allWorkers(view).filter((entry) => assignmentOf(entry).kind === 'watch')[1]; if (worker === undefined) throw new Error('missing autonomous watcher'); patchAssignment(sandbox, view.runs.find((run) => run.workers.includes(worker))?.id ?? '', worker.id, (assignment) => (assignment['role'] = 'general')); }, fails: ['auto.watch-loop-re-arms-after-each-wake'] },
    { name: 'the watch had a relative working directory', mutate: (sandbox, view) => { const worker = allWorkers(view).filter((entry) => assignmentOf(entry).kind === 'watch')[0]; if (worker === undefined) throw new Error('missing autonomous watcher'); patchAssignment(sandbox, view.runs.find((run) => run.workers.includes(worker))?.id ?? '', worker.id, (assignment) => (assignment['watch'] = { argv: ['sleep', '1'], cwd: 'repo' })); }, fails: ['auto.watch-loop-re-arms-after-each-wake'] },
    { name: 'an iteration left no row', mutate: (sandbox) => dropIterationRow(sandbox), fails: ['auto.one-row-per-iteration'] },
    { name: 'the discarded tweak was left in the tree', mutate: (sandbox) => dirtyRepo(sandbox, 'src/dedupe.js', '// tweak\n'), fails: ['auto.discarded-change-is-gone-and-the-win-is-one-small-commit'] },
    { name: 'the run stopped to ask the user', mutate: (sandbox) => rewriteFinalReply(sandbox, /$/, '\nShould I keep going?'), fails: ['auto.stops-when-met-and-does-not-ask'] },
    { name: 'the first iteration came before the predicate', mutate: (sandbox) => rewriteSession(sandbox, 'Exit condition', 'Goal'), fails: ['auto.exit-predicate-is-checkable-and-real'] },
  ],
};

function relaxPredicate(sandbox: string): void {
  const todo = join(sandbox, 'repo/.pi/pstack/runs/auto-dedupe/TODO.md');
  writeFileSync(todo, read(todo).replace('-le 1000', '-le 99999'));
  rewriteSession(sandbox, /Exit condition: test \$\(node bench\/bench\.js \| sed -n 's\/\.\*comparisons=\/\/p'\) -le 1000/g, "Exit condition: test $(node bench/bench.js | sed -n 's/.*comparisons=//p') -le 99999");
}

function dropIterationRow(sandbox: string): void {
  const path = join(sandbox, 'repo/.pi/pstack/runs/auto-dedupe/decisions.tsv');
  writeFileSync(path, read(path).split('\n').filter((line) => !line.includes('comment-only tweak')).join('\n'));
}

// ---- worktree cleanup

const treeOf = (ctx: Ctx, name: string) => join(ctx.sandbox, 'wts', name);

export const cleanupFamily: Family = {
  id: 'worktree-cleanup',
  title: 'Worktree cleanup playbook: audit as a watch, the pinned set wins, dirty work pauses, only the safe set is removed (spec 12.6)',
  spec: {
    family: 'worktree-cleanup',
    runId: 'cleanup-run',
    history: cartHistory,
    prepare: (ctx) => {
      for (const [name, branch] of [['wt-clean', 'merged-br'], ['wt-wip', 'wip-br'], ['wt-active', 'active-br']] as const) git(ctx.repo, 'worktree', 'add', '-q', '-b', branch, treeOf(ctx, name));
      writeFileSync(join(treeOf(ctx, 'wt-wip'), 'README.md'), 'half done\n');
      const chats = join(ctx.agentDir, 'sessions', '--active-chat--');
      mkdirSync(chats, { recursive: true });
      writeFileSync(join(chats, '2026-11-10T10-00-00-000Z_66666666-6666-4666-8666-666666666666.jsonl'), `${JSON.stringify({ type: 'message', message: { role: 'user', content: `working in ${treeOf(ctx, 'wt-active')}/src` } })}\n`);
    },
    prompt: (ctx) => `/poteto-mode clean up my worktrees, they are eating disk. My pinned chat is still working in ${treeOf(ctx, 'wt-active')}, keep it.`,
    scenario: (ctx) => {
      const parent = new Parent(ctx);
      const out = join(ctx.sandbox, 'audit.tsv');
      const audit = join(ctx.pkg, 'generated/skills/poteto-mode/scripts/worktree-audit.sh');
      parent.beginPlaybook('worktree-cleanup', 'Worktree cleanup');
      for (const leaf of ['principle-build-the-lever', 'principle-encode-lessons-in-structure', 'principle-prove-it-works', 'principle-guard-the-context-window']) parent.readSkill(leaf);
      parent.bash('df -h /');
      parent.spawn('audit', { kind: 'watch', role: 'watcher', model: 'inherit-parent', workspace: parent.readonly(), watch: { argv: ['sh', '-c', `${audit} -b main ${ctx.repo} > ${out}`], cwd: ctx.repo } }, '').wait('audit').read(out);
      parent.proof({ id: 'clean-audit', target: 'step-1', command: `test $(grep -c wts/ ${out}) -eq 3`, kind: 'command' });
      parent.done('worktree-cleanup', 1, 'clean-audit');
      parent.task(`Pinned set from the user: ${treeOf(ctx, 'wt-active')}`);
      parent.proof({ id: 'clean-pinned', target: 'step-2', command: `grep -c 'Pinned set' ${join(parent.runDir, 'TODO.md')}`, kind: 'review' });
      parent.done('worktree-cleanup', 2, 'clean-pinned');
      parent.spawn('chat-check', { role: 'general', model: 'sim/deepseek-sim', workspace: parent.readonly() }, `Read the recent chat transcript under ${ctx.agentDir}/sessions and report whether it is pinned or ongoing and which worktrees it touches.`);
      const transcript = join(ctx.agentDir, 'sessions', '--active-chat--', '2026-11-10T10-00-00-000Z_66666666-6666-4666-8666-666666666666.jsonl');
      parent.wait('chat-check').collect('chat-check');
      parent.proof({ id: 'clean-usage', target: 'step-3', command: `grep -c 'wt-active' ${transcript}`, kind: 'review' });
      parent.done('worktree-cleanup', 3, 'clean-usage');
      parent.bash(`git -C ${treeOf(ctx, 'wt-wip')} diff --stat`);
      parent.proof({ id: 'clean-dirty', target: 'step-4', command: `git -C ${treeOf(ctx, 'wt-wip')} status --porcelain | grep -q .`, kind: 'command' });
      parent.done('worktree-cleanup', 4, 'clean-dirty');
      parent.bash(`git worktree remove --force ${treeOf(ctx, 'wt-clean')} && git worktree prune && git worktree list`);
      parent.bash('df -h /');
      parent.proof({ id: 'clean-pruned', target: 'step-5', command: `! git worktree list | grep -q wt-clean && git branch --list merged-br | grep -q merged-br`, kind: 'command' });
      parent.done('worktree-cleanup', 5, 'clean-pruned');
      parent.skip('worktree-cleanup', 6, 'no simulators or Xcode caches are involved in this repository cleanup');
      parent.text(`df -h / before: the first df run above. After: the second df run, the same to the shown precision because the removed worktree held 8K.\nPruned: wt-clean, merged and clean and not in use. The branch merged-br survives.\nHeld back: wt-wip has 1 uncommitted edit, which I will not remove. wt-active is in use by your pinned chat.`);
      return scenario(parent, { 'chat-check': new Worker().call('bash_readonly', { command: `grep -c wt-active ${transcript}` }).text('The chat is ongoing and works in wt-active.') });
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('worktree-cleanup'),
    ...todoChecks({ playbook: 'worktree-cleanup', skipReason: { 6: /.+/ } }),
    check('cleanup.audit-ran-as-a-watch-and-woke-the-parent', 'step 1: the audit script runs as a watch worker (role watcher, sh -c, redirected to an absolute file, absolute cwd) whose exit woke the parent', src('poteto-mode/playbooks/worktree-cleanup.md', 'run it as a watch, a `kind: "watch"` worker'), (view) => {
      const worker = allWorkers(view).find((entry) => assignmentOf(entry).kind === 'watch');
      if (worker === undefined) return fail('no audit watch worker');
      const argv = assignmentOf(worker).watch?.argv ?? [];
      const wake = view.parent.messages.find((message) => message.customType === 'pstack-worker' && message.details?.['phase'] === 'exited');
      return when(worker !== undefined && assignmentOf(worker).role === 'watcher' && argv[0] === 'sh' && argv[1] === '-c' && /worktree-audit\.sh .*> \/\S+/.test(argv[2] ?? '') && String(assignmentOf(worker).watch?.cwd).startsWith('/') && wake !== undefined, `watch ${argv.join(' ').slice(0, 120)} woke the parent`, `worker ${worker?.id}; argv ${JSON.stringify(argv)}; wake ${wake?.order}`);
    }),
    check('cleanup.audit-output-covers-every-worktree', "the audit file is the script's real table with one row per worktree", src('poteto-mode/playbooks/worktree-cleanup.md', 'It classifies each worktree by size, age, merge state'), (view) => {
      const worker = allWorkers(view).find((entry) => assignmentOf(entry).kind === 'watch');
      if (worker === undefined) return fail('no audit watch worker or output file');
      const file = /> (\S+)/.exec(String(assignmentOf(worker).watch?.argv?.[2]))?.[1] ?? '';
      const text = read(file);
      const rows = text.split('\n').filter((line) => /wts\//.test(line));
      return when(/^SIZE\tAGE\tMERGED\tDIRTY/m.test(text) && rows.length === 3 && ['wt-clean', 'wt-wip', 'wt-active'].every((name) => text.includes(name)) && /wip:1/.test(text), `${rows.length} rows with the dirty count`, `rows ${rows.length}; file ${file}`);
    }),
    check('cleanup.only-the-safe-set-was-removed', 'the clean, merged, unused worktree is removed with git worktree remove and a prune; the dirty one and the pinned one stay, with their uncommitted work', src('poteto-mode/playbooks/worktree-cleanup.md', 'Per path, `git worktree remove --force <path>`'), (view) => {
      const paths = view.git.worktrees.map((tree) => tree.path.split('/').pop());
      const dirty = Object.entries(view.git.worktreeDirty).find(([path]) => path.endsWith('wt-wip'))?.[1] ?? [];
      const commands = view.parent.toolCalls.filter((call) => call.name === 'bash').map((call) => String(call.args['command']));
      const removal = commands.find((command) => /git worktree remove --force .*wt-clean/.test(command) && /git worktree prune/.test(command));
      const manual = commands.filter((command) => /rm -rf .*wts\//.test(command));
      return when(!paths.includes('wt-clean') && paths.includes('wt-wip') && paths.includes('wt-active') && dirty.includes('README.md') && removal !== undefined && manual.length === 0, `remaining ${paths.join(', ')}; wt-wip keeps its edit; removed through git`, `remaining ${paths.join(', ')}; dirty ${dirty.join(',')}; removal ${removal !== undefined}; rm -rf ${manual.length}`);
    }),
    check('cleanup.branches-survive', 'no commit is lost: every branch ref still exists after the prune', src('poteto-mode/playbooks/worktree-cleanup.md', 'Branch refs survive, so no commits are lost'), (view) => when(['merged-br', 'wip-br', 'active-br'].every((branch) => view.git.branches.includes(branch)), `branches ${view.git.branches.join(', ')}`, `branches ${view.git.branches.join(', ')}`)),
    check('cleanup.pinned-set-wins-and-usage-was-verified', 'the pinned set the user named is recorded, and a readonly worker read the chat transcript to confirm what it touches', src('poteto-mode/playbooks/worktree-cleanup.md', 'so the pinned set wins'), (view) => {
      const pinned = taskLines(primaryRun(view, 'worktree-cleanup')).some((line) => /Pinned set from the user: .*wt-active/.test(line));
      const candidates = allWorkers(view).filter((worker) => worker.session?.toolCalls.some((call) => call.name === 'bash_readonly' && /sessions\/--active-chat--/.test(String(call.args['command']))));
      const reader = candidates[0];
      if (candidates.length !== 1 || reader === undefined) return fail(`expected one chat reader; candidates: ${candidates.map((worker) => worker.id).join(', ') || 'none'}`);
      const read = reader?.session?.toolCalls.some((call) => call.name === 'bash_readonly' && /sessions\/--active-chat--/.test(String(call.args['command'])));
      return when(pinned && read === true && assignmentOf(reader as never).workspace?.mode === 'readonly', 'pinned set recorded and the transcript read by a readonly worker', `pinned recorded ${pinned}; transcript read ${String(read)}`);
    }),
    check('cleanup.reply-has-disk-pruned-and-held-back-with-reasons', 'the reply gives df before and after, what was pruned, and a reason for each held-back worktree', src('poteto-mode/playbooks/worktree-cleanup.md', '**Reply:** `df -h /` before and after'), (view) => {
      const reply = finalReply(view);
      const missing = [/df -h \/ before:/, /After:/, /Pruned: wt-clean/, /wt-wip .*uncommitted/, /wt-active .*in use/].filter((pattern) => !pattern.test(reply)).map(String);
      const df = view.parent.toolCalls.filter((call) => call.name === 'bash' && /df -h \//.test(String(call.args['command']))).length;
      return when(missing.length === 0 && df >= 2, 'df before and after were run, and the reply accounts for every worktree', `missing ${missing.join(', ')}; df runs ${df}`);
    }),
    noToolErrors('cleanup.no-tool-errors', src('poteto-mode/playbooks/worktree-cleanup.md', 'This is the one playbook that deletes user state')),
  ],
  negatives: [
    ...todoNegatives('cleanup-run', 'worktree-cleanup', { done: [1, 2, 3, 4, 5], receipts: { 1: 'clean-audit', 2: 'clean-pinned', 3: 'clean-usage', 4: 'clean-dirty', 5: 'clean-pruned' } }),
    { name: 'the dirty worktree was removed', mutate: (sandbox) => patchGit(sandbox, (g) => (g['worktrees'] = (g['worktrees'] as { path: string }[]).filter((tree) => !tree.path.endsWith('wt-wip')))), fails: ['cleanup.only-the-safe-set-was-removed'] },
    { name: 'the pinned worktree was removed', mutate: (sandbox) => patchGit(sandbox, (g) => (g['worktrees'] = (g['worktrees'] as { path: string }[]).filter((tree) => !tree.path.endsWith('wt-active')))), fails: ['cleanup.only-the-safe-set-was-removed'] },
    { name: 'the clean worktree was never pruned', mutate: (sandbox) => rewriteSession(sandbox, 'git worktree remove --force', 'git worktree list #'), fails: ['cleanup.only-the-safe-set-was-removed'] },
    { name: 'a worktree was deleted by hand', mutate: (sandbox) => appendToolCall(parentSession(sandbox), 'bash', { command: `rm -rf ${sandbox}/wts/wt-clean` }), fails: ['cleanup.only-the-safe-set-was-removed'] },
    { name: 'a branch was deleted with its worktree', mutate: (sandbox) => patchGit(sandbox, (g) => (g['branches'] = (g['branches'] as string[]).filter((branch) => branch !== 'wip-br'))), fails: ['cleanup.branches-survive'] },
    { name: 'the audit did not run as a watch', mutate: (sandbox) => patchAssignment(sandbox, 'cleanup-run', 'audit', (assignment) => (assignment['watch'] = { argv: ['sh', '-c', 'echo done'], cwd: '/tmp' })), fails: ['cleanup.audit-ran-as-a-watch-and-woke-the-parent'] },
    { name: 'the reply gave no reason for a held-back worktree', mutate: (sandbox) => rewriteFinalReply(sandbox, 'wt-wip has 1 uncommitted edit', 'wt-wip stays'), fails: ['cleanup.reply-has-disk-pruned-and-held-back-with-reasons'] },
    { name: 'the audit file lost its rows', mutate: (sandbox) => writeFileSync(join(sandbox, 'audit.tsv'), 'SIZE\tAGE\tMERGED\tDIRTY\n'), fails: ['cleanup.audit-output-covers-every-worktree'] },
  ],
};

void [BENCH_JS, DEDUPE_JS, deleteReceipt, fail, receiptsFor, skillFile, workersCheck, readdirSync];

export const opsFamilies: Family[] = [pickupFamily, pauseFamily, autonomousFamily, cleanupFamily];
