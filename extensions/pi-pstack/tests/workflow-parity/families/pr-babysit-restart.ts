// A parent that restarts mid-babysit (spec 13.2, worker lifecycle): the watcher outlives the first Pi, the restarted parent
// adopts it instead of arming a second one, and its one exit is delivered to the restarted parent exactly once.
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Actor, Parent, scenario } from '../fixtures/dsl.ts';
import { forgeEnv, type ForgeHandle, settleChecks, setupForge, WATCH_PR } from '../fixtures/forge.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, src, when } from '../lib/check.ts';
import { allWorkers, noToolErrors, playbookReads, promptRoutes } from '../lib/checks.ts';
import type { Meta } from '../lib/driver.ts';
import { sleep } from '../lib/driver.ts';
import { persistedWorkers } from '../lib/live-workers.ts';
import { parentSession, rewriteFinalReply } from '../lib/mutate.ts';
import type { RunView } from '../lib/view.ts';
import { exitCodeOf, forgeResolvedOnce, neverMerges, REPO_FLAGS, replyMentions, watchers } from './pr-shared.ts';
import type { Family } from './types.ts';

const BS = (anchor: string) => src('poteto-mode/playbooks/babysit.md', anchor);

const STORE: { handle?: ForgeHandle } = {};
const PROMPT = '/poteto-mode babysit PR 71 until it is merge-ready';
const PROMPT_AFTER_RESTART = '/poteto-mode babysit PR 71 until it is merge-ready (you were restarted, carry on)';
const ARGS = ['--owner', 'acme', '--repo', 'widgets', '--pr', '71', '--interval', '0.3'];

const poll = async <T>(read: () => T | undefined, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
};

const sessionText = (sessionsDir: string): string =>
  readdirSync(sessionsDir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => readFileSync(join(sessionsDir, name), 'utf8'))
    .join('\n');

const LIVE_PHASES = new Set(['starting', 'running']);

export const watcherHasOutput = (output: string): boolean => /"kind"\s*:|\b(?:WAITING|READY|COMPLETE|BLOCKED):/.test(output);

const metaOf = (sandbox: string): Meta => JSON.parse(readFileSync(join(sandbox, 'meta.json'), 'utf8')) as Meta;

const alive = (pid: number | undefined): boolean => {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const wakesOf = (view: { parent: { messages: { order: number; customType?: string; text: string; details?: Record<string, unknown> }[] } }, runId: string, workerId: string) => view.parent.messages.filter((message) => message.customType === 'pstack-worker' && message.details?.['runId'] === runId && message.details?.['workerId'] === workerId);

const restartWatcher = (view: RunView) => {
  const candidates = view.runs.flatMap((run) => run.workers.map((worker) => ({ ...worker, runId: run.id }))).filter((worker) => (worker.state?.['kind'] ?? worker.assignment['kind']) === 'watch');
  const selected = candidates[0];
  if (candidates.length !== 1 || selected === undefined) throw new Error(`expected exactly one watcher; candidates: ${candidates.map((worker) => `${worker.runId}/${worker.id}`).join(', ') || 'none'}`);
  return selected;
};

export const babysitRestartFamily: Family = {
  id: 'babysit-restart',
  title: 'babysit across a parent restart: the live watcher is adopted through pstack_worker inspect, no second watcher is armed, and its one wake reaches the restarted parent once (spec 13.2)',
  spec: {
    family: 'babysit-restart',
    holdWatchers: /.*/,
    runId: 'babysit-restart-71',
    history: cartHistory,
    timeoutMs: 240_000,
    prepare: (ctx) => {
      STORE.handle = setupForge(ctx, {
        owner: 'acme',
        name: 'widgets',
        branches: [{ name: 'feat-restart', from: 'main', files: { 'src/restart.js': 'export const restart = 1;\n' }, message: 'feat: restart' }],
        prs: [{ number: 71, title: 'feat: restart', head: 'feat-restart', base: 'main', author: 'owner-71', waves: [[{ name: 'build', workflow: 'CI', runId: 9171, state: 'PENDING', pendingReads: 100_000, then: 'SUCCESS' }]] }],
      });
    },
    env: (ctx, driver) => forgeEnv(ctx, STORE.handle as ForgeHandle, { scripted: driver === 'scripted' }),
    prompt: () => PROMPT,
    scenario: (ctx) => {
      const WATCHER = 'watch-restart';
      const first = new Parent(ctx);
      const pr = REPO_FLAGS;
      first.beginPlaybook('babysit', 'Babysit PR 71');
      first.task('Mode: drive (babysit PR 71 until it is merge-ready)');
      first.bash('command -v origin || echo "no origin CLI: staying on gh"');
      first.task('Forge: gh (origin CLI absent, fallback recorded)');
      first.bash(`gh pr view 71 ${pr} --json number,state,baseRefName,headRefName`);
      first.bash(`grep -rl watch-pr ${ctx.repo}/.pi/pstack/runs/*/workers/*/assignment.json 2>/dev/null || echo "no other babysitter on PR 71"`);
      first.spawn(WATCHER, { kind: 'watch', role: 'watcher', model: 'inherit-parent', workspace: first.readonly(), watch: { argv: [WATCH_PR, ...ARGS], cwd: ctx.repo } }, '');
      first.text('Armed the one watcher for PR 71 (watch-restart). Its exit wakes me.');
      const second = new Actor();
      second.bash(`grep -rl watch-pr ${ctx.repo}/.pi/pstack/runs/*/workers/*/assignment.json 2>/dev/null`);
      second.call('pstack_worker', { action: 'inspect', runId: ctx.runId, workerId: WATCHER });
      second.text(`The watcher ${WATCHER} for PR 71 is still running in run ${ctx.runId}, so I adopted it and armed no second one. Waiting for its exit.`);
      second.wait(WATCHER);
      second.call('pstack_worker', { action: 'collect', runId: ctx.runId, workerId: WATCHER });
      second.bash(`gh pr view 71 ${pr} --json state`);
      second.text('Mode: drive. PR 71 is merge-ready: the adopted watcher reached READY after the restart, and its exit woke me once. I armed no second watcher. Not merged: that is Shipping, on your request.');
      const built = scenario(first);
      built.actors['parent-2'] = second.steps;
      return built;
    },
    drive: async (api) => {
      const { ctx } = api;
      const watcher = await poll(() => {
        const candidates = persistedWorkers(ctx.repo).filter((worker) => (worker.state['kind'] ?? worker.assignment['kind']) === 'watch');
        if (candidates.length > 1) throw new Error(`ambiguous watchers: ${candidates.map((worker) => `${worker.runId}/${worker.id}`).join(', ')}`);
        return candidates.find((worker) => LIVE_PHASES.has(String(worker.state['phase'])) && watcherHasOutput(String(worker.state['output'] ?? '')));
      }, 'a live watcher with printed output in state.json');
      await api.restart();
      const beforeInspect = sessionText(ctx.sessionsDir).length;
      await api.prompt(PROMPT_AFTER_RESTART);
      await poll(() => (sessionText(ctx.sessionsDir).slice(beforeInspect).includes(`Worker ${watcher.id}: running`) ? true : undefined), 'the restarted parent to inspect the live watcher');
      settleChecks(ctx.sandbox, 71);
    },
  },
  checks: [
    promptRoutes('poteto-mode'),
    ...playbookReads('babysit'),
    forgeResolvedOnce('babysit.restart.forge-resolved-once-gh-fallback-recorded', BS('GitHub CLI (`gh`) is the default'), 'gh'),
    check('babysit.restart.the-parent-pi-was-stopped-and-a-new-one-resumed-the-session', 'one parent Pi process was stopped, a different one started in the same repo on the same session, and the session holds both babysit requests', BS('Before starting, check nothing else is already on it'), (view) => {
      const restarts = metaOf(view.sandbox).restarts ?? [];
      const users = view.parent.messages.filter((message) => message.role === 'user').map((message) => message.text);
      const stopped = restarts[0]?.stoppedPid;
      return when(restarts.length === 1 && stopped !== undefined && restarts[0]?.startedPid !== undefined && stopped !== restarts[0]?.startedPid && !alive(stopped) && users.length === 2 && /babysit PR 71/.test(users[1] ?? ''), `Pi ${stopped} stopped, Pi ${restarts[0]?.startedPid} resumed the session; ${users.length} requests`, `restarts ${JSON.stringify(restarts)}; stopped alive ${alive(stopped)}; user messages ${users.length}`);
    }),
    check('babysit.restart.the-live-watcher-was-adopted-and-no-second-one-armed', 'the restarted parent inspected the watcher the first parent armed and found it running with its output, spawned nothing, and the run has exactly one watcher with one claim', BS('One babysitter per stack'), (view) => {
      const second = view.parent.messages.filter((message) => message.role === 'user')[1]?.order ?? Number.POSITIVE_INFINITY;
      const spawns = view.parent.toolCalls.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn');
      const inspect = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'inspect' && call.order > second);
      const all = allWorkers(view);
      const watcher = restartWatcher(view);
      const claims = view.claims.filter((claim) => claim.workerId === watcher.id && claim.runId === watcher.runId);
      const armed = (view.runs[0]?.events ?? []).filter((event) => event['kind'] === 'spawn' || event['kind'] === 'claimed').length;
      return when(
        spawns.length === 1 && (spawns[0]?.order ?? Number.POSITIVE_INFINITY) < second && watcher !== undefined && watcher.state !== null && inspect !== undefined && inspect.args['workerId'] === watcher.id && inspect.args['runId'] === watcher.runId && !inspect.isError && /running/.test(inspect.resultText) && watcherHasOutput(inspect.resultText) && watchers(view).length === 1 && all.length === 1 && claims.length === 1,
        `one spawn before the restart (${spawns[0]?.order}), the restarted parent's inspect at ${inspect?.order} read the running watcher's output, one watcher, one claim (host events ${armed})`,
        `spawns ${spawns.length}; inspect ${inspect?.resultText.slice(0, 100)}; workers ${all.map((worker) => worker.id).join(', ')}; claims ${claims.length}`,
      );
    }),
    check('babysit.restart.the-watcher-exit-woke-the-restarted-parent-once', 'the watcher exited READY (0) after the restart, and the restarted parent got exactly one pstack-worker wake for it, the host transition 1 of that instance, carrying the READY verdict', BS('**One babysitter per stack.**'), (view) => {
      const second = view.parent.messages.filter((message) => message.role === 'user')[1]?.order ?? Number.POSITIVE_INFINITY;
      const watcher = restartWatcher(view);
      const watcherId = watcher?.id ?? '';
      const wakes = wakesOf(view, watcher.runId, watcherId);
      const instance = String(watcher?.state?.['instance']);
      const settles = (watcher?.state?.['settles'] as unknown[] | undefined) ?? [];
      const collect = view.parent.toolCalls.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect' && call.args['workerId'] === watcherId && call.args['runId'] === watcher.runId);
      const wake = wakes[0];
      const collected = collect[0];
      return when(
        watchers(view).length === 1 && exitCodeOf(watcher) === 0 && settles.length === 1 && wakes.length === 1 && wake !== undefined && wake.order > second && wake.details?.['transitionId'] === `${watcherId}:${instance}:1` && wake.details?.['phase'] === 'exited' && /READY/.test(wake.text) && collect.length === 1 && collected !== undefined && collected.order > wake.order,
        `one wake ${String(wakes[0]?.details?.['transitionId'])} at ${wakes[0]?.order}, after the restart (${second}), with the READY output; collected once after it`,
        `exit ${watcher === undefined ? 'none' : exitCodeOf(watcher)}; settles ${settles.length}; wakes ${wakes.length} ${JSON.stringify(wakes.map((wake) => [wake.order, wake.details?.['transitionId']]))}; collects ${collect.length}`,
      );
    }),
    neverMerges('babysit.restart.never-merges', 'nothing merged, queued or auto-merged', BS('Babysitting never authorizes merging')),
    replyMentions('babysit.restart.reply-says-merge-ready-from-the-adopted-watcher', 'the reply reports merge-ready and leaves landing to Shipping', BS('Babysitting never authorizes merging'), [{ name: 'merge-ready', pattern: /merge.ready/i }, { name: 'Shipping', pattern: /Shipping/i }], [{ name: 'a second watcher', pattern: /armed a second watcher/i }]),
    noToolErrors('babysit.restart.no-tool-errors', BS('Trust the active forge')),
  ],
  negatives: [
    { name: 'the restarted parent armed a second watcher', mutate: (sandbox) => appendSpawn(sandbox), fails: ['babysit.restart.the-live-watcher-was-adopted-and-no-second-one-armed'] },
    { name: 'the restarted parent never looked at the watcher', mutate: (sandbox) => rewriteSession(sandbox, '"action":"inspect"', '"action":"collect"'), fails: ['babysit.restart.the-live-watcher-was-adopted-and-no-second-one-armed'] },
    { name: 'the exit wake was delivered twice', mutate: (sandbox, view) => { const watcher = restartWatcher(view); duplicateWake(sandbox, watcher.runId, watcher.id); }, fails: ['babysit.restart.the-watcher-exit-woke-the-restarted-parent-once'] },
    { name: 'the exit wake carried no verdict', mutate: (sandbox) => rewriteSession(sandbox, 'READY', 'DONE'), fails: ['babysit.restart.the-watcher-exit-woke-the-restarted-parent-once'] },
    { name: 'the first parent was never stopped', mutate: (sandbox) => writeMeta(sandbox, (meta) => (meta.restarts = [])), fails: ['babysit.restart.the-parent-pi-was-stopped-and-a-new-one-resumed-the-session'] },
    { name: 'the replaced Pi was still running', mutate: (sandbox) => writeMeta(sandbox, (meta) => (meta.restarts = [{ stoppedPid: process.pid, startedPid: 1 }])), fails: ['babysit.restart.the-parent-pi-was-stopped-and-a-new-one-resumed-the-session'] },
    { name: 'the reply claims a second watcher', mutate: (sandbox) => rewriteFinalReply(sandbox, 'armed no second watcher', 'armed a second watcher'), fails: ['babysit.restart.reply-says-merge-ready-from-the-adopted-watcher'] },
  ],
};

function rewriteSession(sandbox: string, from: string, to: string): void {
  const file = parentSession(sandbox);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll(from, to));
}

function writeMeta(sandbox: string, change: (meta: Meta) => void): void {
  const meta = metaOf(sandbox);
  change(meta);
  writeFileSync(join(sandbox, 'meta.json'), JSON.stringify(meta, null, 2));
}

function appendSpawn(sandbox: string): void {
  const file = parentSession(sandbox);
  const id = `forged-${Math.random().toString(36).slice(2, 8)}`;
  const stamp = new Date().toISOString();
  const lines = [
    { type: 'message', id: `${id}a`, parentId: null, timestamp: stamp, message: { role: 'assistant', content: [{ type: 'toolCall', id, name: 'pstack_worker', arguments: { action: 'spawn', runId: 'extra-run', assignmentPath: '/x/extra/assignment.json' } }], provider: 'sim', model: 'forged', stopReason: 'toolUse', timestamp: Date.now() } },
    { type: 'message', id: `${id}b`, parentId: `${id}a`, timestamp: stamp, message: { role: 'toolResult', toolCallId: id, toolName: 'pstack_worker', content: [{ type: 'text', text: 'Spawned' }], isError: false, timestamp: Date.now() } },
  ];
  appendFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

function duplicateWake(sandbox: string, runId: string, workerId: string): void {
  const file = parentSession(sandbox);
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const wake = lines.find((line) => {
    const entry = JSON.parse(line) as { customType?: string; details?: { runId?: string; workerId?: string } };
    return entry.customType === 'pstack-worker' && entry.details?.runId === runId && entry.details.workerId === workerId;
  });
  if (wake === undefined) throw new Error('no wake to duplicate');
  appendFileSync(file, `${wake.replace(/"id":"[^"]+"/, '"id":"dup00001"')}\n`);
}

export const babysitRestartFamilies: Family[] = [babysitRestartFamily];
