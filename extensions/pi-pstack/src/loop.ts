import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { isOneShot } from './modes.ts';

const DAY_MS = 86_400_000;
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: DAY_MS };
const DURATION = /^(?:\d+[smhd])+$/;
// setTimeout fires at once for delays past 2^31-1 ms (about 24.8 days), which would turn a long loop into a runaway.
const MAX_DELAY_MS = 24 * DAY_MS;
const TOO_LONG = 'Loop intervals can be at most 24d.';

/** Milliseconds for a duration such as 30s, 5m, 1h30m; undefined when the text is not a duration. */
export function parseDuration(text: string): number | undefined {
  if (!DURATION.test(text)) return undefined;
  const total = [...text.matchAll(/(\d+)([smhd])/g)].reduce((sum, [, count, unit]) => sum + Number(count) * (UNIT_MS[unit ?? 's'] ?? 0), 0);
  return total > 0 ? total : undefined;
}

function delayOf(text: string): number {
  const ms = parseDuration(text);
  if (ms === undefined) throw new Error(`"${text}" is not a duration such as 30s, 10m, or 1h.`);
  if (ms > MAX_DELAY_MS) throw new Error(TOO_LONG);
  return ms;
}

export type LoopCommand = { kind: 'status' } | { kind: 'stop' } | { kind: 'start'; prompt: string; intervalMs?: number } | { kind: 'error'; message: string };

export function parseLoopArgs(args: string): LoopCommand {
  const trimmed = args.trim();
  if (trimmed === '') return { kind: 'status' };
  if (trimmed === 'stop' || trimmed === 'off') return { kind: 'stop' };
  const [, first = '', rest = ''] = /^(\S+)\s*([\s\S]*)$/.exec(trimmed) ?? [];
  const intervalMs = parseDuration(first);
  if (intervalMs === undefined) return { kind: 'start', prompt: trimmed };
  if (intervalMs > MAX_DELAY_MS) return { kind: 'error', message: TOO_LONG };
  return rest.trim() === '' ? { kind: 'error', message: '/loop needs a prompt: /loop [interval] <prompt>' } : { kind: 'start', prompt: rest.trim(), intervalMs };
}

interface Loop {
  prompt: string;
  intervalMs?: number;
  iteration: number;
  nextWakeMs?: number;
  timer?: ReturnType<typeof setTimeout>;
}

const formatMs = (ms: number) => (ms % 86_400_000 === 0 ? `${ms / 86_400_000}d` : ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : ms % 60_000 === 0 ? `${ms / 60_000}m` : `${Math.round(ms / 1_000)}s`);

/** Loop state rides in the system prompt, so the prompt itself stays verbatim and a template prompt keeps it too. */
function loopSection(loop: Loop): string {
  if (loop.intervalMs !== undefined) {
    return `A /loop is running: iteration ${loop.iteration}, every ${formatMs(loop.intervalMs)}. The user ends it with /loop stop; call the Loop tool with stop: true once the goal is met.`;
  }
  return `A /loop is running: iteration ${loop.iteration}, agent-paced. Call the Loop tool with wake_in (like 10m) to schedule the next run, or stop: true to end it. Without a wake_in call the loop ends after this turn.`;
}

export interface LoopOptions {
  /** True while this session waits on work that will wake the agent, such as background subagents. */
  hasPendingWork: () => boolean;
}

function createLoopController(pi: ExtensionAPI, options: LoopOptions) {
  let loop: Loop | undefined;
  let lastCtx: ExtensionContext | undefined;

  const notify = (ctx: ExtensionContext | undefined, message: string) => {
    if (ctx?.hasUI) ctx.ui.notify(message, 'info');
  };
  const clear = () => {
    if (loop?.timer !== undefined) clearTimeout(loop.timer);
    loop = undefined;
  };
  const stop = (ctx: ExtensionContext | undefined, reason: string) => {
    clear();
    notify(ctx, `Loop stopped: ${reason}`);
  };
  const fire = () => {
    if (loop === undefined) return;
    const { timer: _timer, nextWakeMs: _wake, ...rest } = loop;
    loop = { ...rest, iteration: rest.iteration + 1 };
    // Expansion lets a loop run a skill or template each time.
    pi.sendUserMessage(loop.prompt, { expandPromptTemplates: true, ...(lastCtx === undefined || lastCtx.isIdle() ? {} : { deliverAs: 'followUp' as const }) });
  };
  const settled = (ctx: ExtensionContext, aborted: boolean) => {
    lastCtx = ctx;
    if (loop === undefined || loop.timer !== undefined) return;
    if (aborted) return stop(ctx, 'the run was aborted.');
    const delay = loop.intervalMs ?? loop.nextWakeMs;
    if (delay !== undefined) loop = { ...loop, timer: setTimeout(fire, delay) };
    else if (!options.hasPendingWork()) stop(ctx, 'the agent scheduled no next wake.');
  };
  const start = (ctx: ExtensionContext, prompt: string, intervalMs: number | undefined) => {
    if (loop !== undefined) stop(ctx, 'replaced by a new /loop.');
    lastCtx = ctx;
    loop = { prompt, iteration: 0, ...(intervalMs === undefined ? {} : { intervalMs }) };
    fire();
  };
  /** An agent arms a loop mid-turn, so its first run waits for this turn to settle and then for the first delay. */
  const arm = (ctx: ExtensionContext, prompt: string, schedule: { intervalMs: number } | { firstWakeMs: number }) => {
    if (loop !== undefined) stop(ctx, 'replaced by a new loop.');
    loop = 'intervalMs' in schedule ? { prompt, iteration: 0, intervalMs: schedule.intervalMs } : { prompt, iteration: 0, nextWakeMs: schedule.firstWakeMs };
  };
  const status = () => (loop === undefined ? 'No loop is running.' : `Loop: "${loop.prompt}" (iteration ${loop.iteration}${loop.intervalMs === undefined ? ', agent-paced' : `, every ${formatMs(loop.intervalMs)}`})`);
  const wake = (delayMs: number) => {
    if (loop === undefined) throw new Error('No loop is running. Start one with prompt plus interval or wake_in, or ask the user to run /loop.');
    if (loop.intervalMs !== undefined) throw new Error(`This loop runs every ${formatMs(loop.intervalMs)}; only the user can change its interval. Pass stop: true to end it.`);
    // A wake already scheduled is replaced, so the new delay counts from the end of this turn.
    if (loop.timer !== undefined) clearTimeout(loop.timer);
    const { timer: _timer, ...rest } = loop;
    loop = { ...rest, nextWakeMs: delayMs };
  };
  const section = () => (loop === undefined ? undefined : loopSection(loop));
  return { notify, stop, settled, start, arm, status, wake, clear, section, active: () => loop !== undefined };
}

type LoopController = ReturnType<typeof createLoopController>;

const ONE_SHOT = '/loop needs an interactive or RPC session; print and JSON runs exit when the agent settles.';

function handleLoopCommand(controller: LoopController, args: string, ctx: ExtensionCommandContext): void {
  const command = parseLoopArgs(args);
  if (command.kind === 'status') controller.notify(ctx, controller.status());
  else if (command.kind === 'stop') controller.stop(ctx, 'stopped by /loop stop.');
  else if (command.kind === 'error') controller.notify(ctx, command.message);
  else if (isOneShot(ctx.mode)) process.stderr.write(`${ONE_SHOT}\n`);
  else controller.start(ctx, command.prompt, command.intervalMs);
}

const LoopParams = Type.Object({
  prompt: Type.Optional(Type.String({ description: 'Start (or replace) a loop that sends this prompt each run. It may be a skill or template command such as /poteto-mode <task>.' })),
  interval: Type.Optional(Type.String({ description: 'With prompt: a fixed cadence such as 30m or 1h; the first run starts that long after this turn ends.' })),
  wake_in: Type.Optional(Type.String({ description: 'With prompt: the first run of an agent-paced loop. Alone: the next run of the running agent-paced loop. A duration such as 10m, at most 24d.' })),
  stop: Type.Optional(Type.Boolean({ description: 'End the loop once its goal is met.' })),
});

function loopToolText(controller: LoopController, params: { prompt?: string; interval?: string; wake_in?: string; stop?: boolean }, ctx: ExtensionContext): string {
  if (isOneShot(ctx.mode)) throw new Error(`${ONE_SHOT} Do the work now instead of scheduling it.`);
  if (params.stop === true) {
    if (!controller.active()) throw new Error('No loop is running.');
    controller.stop(ctx, 'the agent ended it.');
    return 'Loop stopped.';
  }
  if (params.prompt !== undefined) {
    if (params.interval !== undefined) {
      const intervalMs = delayOf(params.interval);
      controller.arm(ctx, params.prompt, { intervalMs });
      return `Loop armed: "${params.prompt}" every ${formatMs(intervalMs)}; the first run starts ${formatMs(intervalMs)} after this turn ends.`;
    }
    if (params.wake_in === undefined) throw new Error('To start a loop, pass interval for a fixed cadence or wake_in for the first run of an agent-paced loop.');
    const firstWakeMs = delayOf(params.wake_in);
    controller.arm(ctx, params.prompt, { firstWakeMs });
    return `Loop armed: "${params.prompt}", agent-paced; the first run starts ${formatMs(firstWakeMs)} after this turn ends.`;
  }
  if (params.interval !== undefined) throw new Error('interval applies only when starting a loop with prompt.');
  if (params.wake_in === undefined) throw new Error('Pass prompt with interval or wake_in to start a loop, wake_in to schedule the next run, or stop: true.');
  const delay = delayOf(params.wake_in);
  controller.wake(delay);
  return `Next loop run in ${formatMs(delay)}, after this turn ends.`;
}

function registerLoopTool(pi: ExtensionAPI, controller: LoopController): void {
  pi.registerTool({
    name: 'Loop',
    label: 'Loop',
    description:
      "/loop for you: start a loop that re-sends a prompt at a fixed interval or at wakes you pick, schedule the next wake of an agent-paced loop, or stop the loop once its goal is met. Use it when a playbook says to arm /loop.",
    promptSnippet: 'Start a /loop, schedule its next wake, or stop it',
    parameters: LoopParams,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return { content: [{ type: 'text', text: loopToolText(controller, params, ctx) }], details: undefined };
    },
  });
}

/** /loop: run a prompt at a fixed interval, or at wakes the agent picks, until stopped. */
export function registerLoop(pi: ExtensionAPI, options: LoopOptions): { section: () => string | undefined } {
  const controller = createLoopController(pi, options);
  pi.on('session_start', (_event, ctx) => {
    if (isOneShot(ctx.mode)) pi.setActiveTools(pi.getActiveTools().filter((name) => name !== 'Loop'));
  });
  pi.on('agent_settled', (event, ctx) => controller.settled(ctx, event.aborted));
  pi.on('session_shutdown', () => controller.clear());
  pi.registerCommand('loop', {
    description: 'Run a prompt repeatedly: /loop [interval] <prompt> (interval like 30s, 5m, 1h, at most 24d); /loop stop',
    handler: async (args, ctx) => handleLoopCommand(controller, args, ctx),
  });
  registerLoopTool(pi, controller);
  return { section: controller.section };
}
