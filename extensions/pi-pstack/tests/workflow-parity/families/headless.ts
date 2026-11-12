// MX-HEADLESS: a pstack playbook start in `pi -p` and `pi --mode json`, with no UI and no stdin.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, fail, pass, src, when } from '../lib/check.ts';
import { allWorkers, finalReply, settledAndCollected, todoChecks, workersCheck } from '../lib/checks.ts';
import { SCRIPTED_ROLES } from '../lib/driver.ts';
import { dropWakes } from '../lib/mutate.ts';
import type { Family } from './types.ts';

const ANSWER = 'The cart total is the rounded line sum with the coupon taken off.';
const ANSWER_MARK = 'headless explorer finished: total() rounds the lines';

interface OneShot {
  mode: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const oneShot = (sandbox: string): OneShot | null => {
  const path = join(sandbox, 'one-shot.json');
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as OneShot) : null;
};

const events = (shot: OneShot): Record<string, unknown>[] =>
  shot.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

function headless(mode: 'print' | 'json'): Family {
  const id = `headless-${mode}`;
  const runId = `headless-${mode}`;
  const waitForWake = (parent: Parent) => `until grep -q '"kind":"wake"' ${JSON.stringify(join(parent.runDir, 'events.jsonl'))} 2>/dev/null; do sleep 0.2; done; sleep 1`;
  return {
    id,
    title: `a pstack playbook start under pi ${mode === 'print' ? '-p' : '--mode json'}: TODO.md, a worker that settles, a delivered wake (MX-HEADLESS)`,
    spec: {
      family: id,
      mode,
      runId,
      timeoutMs: 100_000,
      history: cartHistory,
      prompt: () => '/poteto-mode How does checkout compute the total? Investigate only, change nothing.',
      scenario: (ctx) => {
        const parent = new Parent(ctx);
        parent.beginPlaybook('investigation', 'Investigation: headless checkout totals');
        parent.spawn('explorer', { role: 'explorer', model: String(SCRIPTED_ROLES['how explorer']), workspace: parent.readonly() }, 'Explain how total() in src/cart.js works.');
        parent.bash(waitForWake(parent)).wait('explorer').collect('explorer').text(`${ANSWER} (${mode})`);
        return scenario(parent, { explorer: new Worker().read(join(ctx.repo, 'src/cart.js')).text(ANSWER_MARK) });
      },
    },
    checks: [
      ...todoChecks({ playbook: 'investigation' }).filter((entry) => /run-from-playbook|steps-verbatim-in-order|initial-states-open/.test(entry.id)),
      workersCheck(`${id}.worker-spawned`, 'the worker was spawned as its own readonly Pi process under the one-shot parent', src('swarm/SKILL.md', 'Spawn all N workers one after another without waiting'), { role: 'explorer', min: 1, mode: 'readonly', rootPath: true, modelLine: 'how explorer' }),
      settledAndCollected(`${id}.worker-settled-and-woke-parent`, src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles')),
      check(`${id}.exits-without-a-dialog`, 'the process exits on its own with status 0 and no UI prompt left it waiting', src('poteto-mode/playbooks/autonomous-run.md', 'drive to it without stopping'), (view) => {
        const shot = oneShot(view.sandbox);
        if (shot === null) return fail('the driver recorded no one-shot result');
        return when(shot.exitCode === 0, `pi ${mode} exited 0 by itself, stderr ${shot.stderr.length} bytes`, `exit code ${String(shot.exitCode)}; stderr: ${shot.stderr.slice(0, 200)}`);
      }),
      check(`${id}.stdout-carries-the-final-answer`, mode === 'print' ? 'stdout is the final assistant text that follows the wake' : 'the JSON stream is valid JSONL: a session header, the wake as a message, the final answer, and agent_settled last', src('poteto-mode/playbooks/autonomous-run.md', 'drive to it without stopping'), (view) => {
        const shot = oneShot(view.sandbox);
        if (shot === null) return fail('no one-shot result');
        const answer = finalReply(view);
        if (answer === '' || !answer.includes(ANSWER)) return fail(`the parent session has no final answer: ${answer.slice(0, 100)}`);
        if (mode === 'print') return when(shot.stdout.includes(ANSWER) && !shot.stdout.includes('waiting for worker'), 'stdout holds the final answer, not the waiting turn', `stdout: ${shot.stdout.slice(0, 200)}`);
        let parsed: Record<string, unknown>[];
        try {
          parsed = events(shot);
        } catch (error) {
          return fail(`stdout is not JSONL: ${(error as Error).message}`);
        }
        const text = shot.stdout;
        const settledLast = parsed.at(-1)?.['type'] === 'agent_settled';
        return when(parsed[0]?.['type'] === 'session' && text.includes('"customType":"pstack-worker"') && text.includes(ANSWER) && settledLast, `${parsed.length} JSON records; header first, wake and answer present, agent_settled last`, `first ${String(parsed[0]?.['type'])}, wake ${text.includes('"customType":"pstack-worker"')}, answer ${text.includes(ANSWER)}, settled last ${settledLast}`);
      }),
      check(`${id}.no-state-lost`, 'every worker settle and wake is durable: state.json, events.jsonl and the parent session agree', src('poteto-mode/SKILL.md', 'A `pstack-worker` wake message reports each worker that settles'), (view) => {
        const run = view.runs[0];
        const wakes = (run?.events ?? []).filter((entry) => entry['kind'] === 'wake');
        const delivered = view.parent.messages.filter((message) => message.customType === 'pstack-worker');
        const worker = allWorkers(view)[0];
        if (worker === undefined || wakes.length === 0) return fail('no worker or no wake event');
        const lost = wakes.filter((wake) => !delivered.some((message) => message.details?.['transitionId'] === (wake['data'] as Record<string, unknown> | undefined)?.['transitionId']));
        return when(lost.length === 0 && (worker.report !== null || worker.finalText.includes(ANSWER_MARK)), `${wakes.length} wake event(s), each delivered into the session; worker final text on disk`, `wakes never delivered: ${lost.length}`);
      }),
      check(`${id}.parent-wrote-nothing-outside-the-run`, 'the headless run leaves the repository clean', src('poteto-mode/playbooks/investigation.md', 'Investigation requests are read-only'), (view) => when(view.git.dirty.length === 0 && view.git.commitsSinceBase.length === 0, 'clean checkout, HEAD at base', `dirty ${view.git.dirty.join(',')}`)),
    ],
    negatives: [
      { name: 'the wake was never delivered into the parent', mutate: (sandbox) => dropWakes(sandbox), fails: [`${id}.worker-settled-and-woke-parent`, `${id}.no-state-lost`] },
      { name: 'the process was killed instead of exiting', mutate: (sandbox) => rewriteShot(sandbox, (shot) => ({ ...shot, exitCode: 137 })), fails: [`${id}.exits-without-a-dialog`] },
      { name: 'stdout lost the final answer', mutate: (sandbox) => rewriteShot(sandbox, (shot) => ({ ...shot, stdout: shot.stdout.replaceAll(ANSWER, '(lost)') })), fails: [`${id}.stdout-carries-the-final-answer`] },
    ],
  };
}

function rewriteShot(sandbox: string, change: (shot: OneShot) => OneShot): void {
  const shot = oneShot(sandbox);
  if (shot !== null) writeFileSync(join(sandbox, 'one-shot.json'), JSON.stringify(change(shot)));
}

const AUTONOMOUS = src('poteto-mode/playbooks/autonomous-run.md', 'drive to it without stopping');

/** A pstack command that reports through the UI. With no UI it must neither hang nor drop its report. */
const dialogFamily: Family = {
  id: 'headless-command',
  title: 'a UI-reporting /pstack command under pi -p neither hangs nor drops its report (MX-HEADLESS)',
  spec: { family: 'headless-command', mode: 'print', runId: 'headless-command', timeoutMs: 60_000, history: cartHistory, prompt: () => '/pstack doctor', scenario: (ctx) => scenario(new Parent(ctx)) },
  checks: [
    check('headless-command.exits-without-hanging', 'pi -p /pstack doctor exits 0 by itself, so a UI call is never waited on', AUTONOMOUS, (view) => {
      const shot = oneShot(view.sandbox);
      return shot === null ? fail('no one-shot result') : when(shot.exitCode === 0, 'exit 0 with no stdin and no UI', `exit ${String(shot.exitCode)}; stderr ${shot.stderr.slice(0, 200)}`);
    }),
    check('headless-command.report-reaches-stdout', 'the doctor report reaches stdout, so no output is silently lost without a UI', AUTONOMOUS, (view) => {
      const shot = oneShot(view.sandbox);
      return shot !== null && /pstack doctor/.test(shot.stdout) ? pass('stdout carries the doctor report') : fail(`stdout is ${JSON.stringify((shot?.stdout ?? '').slice(0, 80))}: ctx.ui.notify has no effect outside the TUI`);
    }),
  ],
  negatives: [
    { name: 'the command hung until the driver killed it', mutate: (sandbox) => rewriteShot(sandbox, (shot) => ({ ...shot, exitCode: null })), fails: ['headless-command.exits-without-hanging'] },
  ],
};

export const headlessFamilies: Family[] = [headless('print'), headless('json'), dialogFamily];
