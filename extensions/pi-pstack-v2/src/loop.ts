import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { createJobSpec, type Job, launch, list, shellQuote } from './jobs.ts';
import { type LoopCommand, parseLoopArgs, sentinelFor } from './loop-parse.ts';
import { type JobWatch, jobsRoot, stopRuns } from './watcher.ts';

const LOOP_PREFIX = 'loop-';
const LOOP_DEBOUNCE_SECONDS = 5;
const SUMMARY_CHARS = 80;
const USAGE = 'Usage: /loop [interval] <prompt> (or /loop list, /loop stop [id|all])';
const NO_LOOPS = 'No active loops in this session.';
const BASE_COMPLETIONS: readonly string[] = ['30s ', '1m ', '5m ', '15m ', '1h ', 'list', 'stop '];
const STOP_PREFIX = 'stop ';
const LOOP_DESCRIPTION = 'Run a prompt or skill on a recurring or self-paced interval (e.g. /loop 5m check deploy).';

type FixedLoop = Extract<LoopCommand, { kind: 'fixed' }>;
type DynamicLoop = Extract<LoopCommand, { kind: 'dynamic' }>;

const summarize = (prompt: string): string => (prompt.length > SUMMARY_CHARS ? `${prompt.slice(0, SUMMARY_CHARS)}...` : prompt);
const isLoop = (job: Job): boolean => job.spec.source === 'loop';
const runningLoops = (owner: string): Job[] => list(jobsRoot(), owner).filter((job) => isLoop(job) && job.status.state === 'running');

function notify(ctx: ExtensionCommandContext, message: string): void {
  if (ctx.hasUI) ctx.ui.notify(message, 'info');
}

/** The shell loop that is a loop's timer. Its first line comes after the first sleep, so arming it never doubles the immediate run. */
function timerCommand(loop: FixedLoop, sentinel: string): string {
  const payload = JSON.stringify({ prompt: loop.prompt, purpose: loop.purpose, interval: loop.intervalLabel });
  return `while true; do sleep ${loop.intervalSeconds}; printf '%s %s\\n' '${sentinel}' ${shellQuote(payload)}; done`;
}

function armTimer(loop: FixedLoop, owner: string, cwd: string, sentinel: string): Job {
  const spec = createJobSpec({
    name: `${LOOP_PREFIX}${loop.purpose}`,
    cwd,
    shellCommand: timerCommand(loop, sentinel),
    owner,
    notifyOnOutput: { pattern: `^${sentinel}\\b.*$`, reason: `Loop every ${loop.intervalLabel}: ${summarize(loop.prompt)}`, debounceSeconds: LOOP_DEBOUNCE_SECONDS, notificationLimit: null },
    source: 'loop',
  });
  return launch(jobsRoot(), spec);
}

function fixedMessage(loop: FixedLoop, job: Job, sentinel: string): string {
  return [
    `Run this now, once: ${loop.prompt}`,
    '',
    `A loop is armed to repeat it every ${loop.intervalLabel}. Job id: ${job.spec.id}. Each tick wakes you with a line starting ${sentinel}; when it arrives, run the prompt again and report briefly.`,
    `Stop it with /loop stop ${job.spec.id}, or with tmux_jobs stop.`,
  ].join('\n');
}

function startFixed(pi: ExtensionAPI, ctx: ExtensionCommandContext, owner: string, loop: FixedLoop): void {
  const name = `${LOOP_PREFIX}${loop.purpose}`;
  const existing = runningLoops(owner).find((job) => job.spec.name === name);
  if (existing) {
    notify(ctx, `Loop ${name} is already running (${existing.spec.id}). Stop it first with /loop stop ${existing.spec.id}.`);
    return;
  }
  const sentinel = sentinelFor('TICK', loop.purpose);
  const job = armTimer(loop, owner, ctx.cwd, sentinel);
  notify(ctx, `Loop armed every ${loop.intervalLabel} (${job.spec.id}).`);
  void pi.sendUserMessage(fixedMessage(loop, job, sentinel), { deliverAs: 'followUp' });
}

function dynamicMessage(loop: DynamicLoop): string {
  const wake = sentinelFor('WAKE', loop.purpose);
  return [
    `Start a self-paced loop for: ${loop.prompt}`,
    '',
    'Read the `loop` skill and follow its Dynamic Schedule flow: run the prompt now, then arm what wakes you next.',
    `- If an event can be watched, start a tmux_run watcher with notify_on_output whose pattern matches lines starting ${wake}.`,
    '- Arm a one-shot fallback heartbeat with tmux_run (a sleep plus a wake message) so the loop continues even if no event arrives.',
    '- Each time you wake, run the prompt again, choose the next delay yourself, and arm the next heartbeat. Stop with tmux_jobs stop when the work is done.',
    '- Confirm in one line how the loop paces itself.',
  ].join('\n');
}

function describeLoop(job: Job): string {
  return `${job.spec.id}  ${job.spec.notifyOnOutput?.reason ?? job.spec.name}`;
}

async function stopLoops(watch: JobWatch, ctx: ExtensionCommandContext, owner: string, target: string): Promise<void> {
  const matched = runningLoops(owner).filter((job) => target === 'all' || job.spec.id === target || job.spec.name === target || job.spec.name === `${LOOP_PREFIX}${target}`);
  if (matched.length === 0) {
    notify(ctx, `No running loop matches ${target}.`);
    return;
  }
  const stopped = await stopRuns(watch, owner, matched);
  notify(ctx, `Stopped ${stopped.length} loop job(s): ${stopped.map((job) => job.spec.id).join(', ')}.`);
}

function completionsFor(prefix: string, owner: string | undefined): { value: string; label: string }[] | null {
  const stops = prefix.startsWith(STOP_PREFIX) ? ['all', ...(owner ? runningLoops(owner).flatMap((job) => [job.spec.id, job.spec.name]) : [])].map((target) => `${STOP_PREFIX}${target}`) : [];
  const matches = [...BASE_COMPLETIONS, ...stops].filter((value) => value.startsWith(prefix));
  return matches.length === 0 ? null : matches.map((value) => ({ value, label: value.trim() }));
}

async function dispatchLoop(pi: ExtensionAPI, watch: JobWatch, ctx: ExtensionCommandContext, owner: string, command: LoopCommand): Promise<void> {
  switch (command.kind) {
    case 'usage':
      notify(ctx, USAGE);
      return;
    case 'list':
      notify(ctx, runningLoops(owner).map(describeLoop).join('\n') || NO_LOOPS);
      return;
    case 'stop':
      await stopLoops(watch, ctx, owner, command.target);
      return;
    case 'fixed':
      startFixed(pi, ctx, owner, command);
      return;
    case 'dynamic':
      void pi.sendUserMessage(dynamicMessage(command), { deliverAs: 'followUp' });
      return;
  }
}

export function registerLoop(pi: ExtensionAPI, watch: JobWatch): void {
  let sessionOwner: string | undefined;
  pi.on('session_start', async (_event, ctx) => {
    sessionOwner = ctx.sessionManager.getSessionId();
  });
  pi.registerCommand('loop', {
    description: LOOP_DESCRIPTION,
    getArgumentCompletions: (prefix) => completionsFor(prefix, sessionOwner),
    handler: async (args, ctx) => {
      const command = parseLoopArgs(z.string().parse(args));
      const owner = ctx.sessionManager.getSessionId();
      sessionOwner = owner;
      await dispatchLoop(pi, watch, ctx, owner, command);
    },
  });
}
