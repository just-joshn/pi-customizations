import { randomUUID } from 'node:crypto';

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { isOneShot } from './modes.ts';

const DAY_MS = 86_400_000;
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: DAY_MS };
const DURATION = /^(?:\d+[smhd])+$/;
const WORD_UNITS: Record<string, string> = { second: 's', seconds: 's', sec: 's', secs: 's', minute: 'm', minutes: 'm', min: 'm', mins: 'm', hour: 'h', hours: 'h', hr: 'h', hrs: 'h', day: 'd', days: 'd' };
// setTimeout fires at once for delays past 2^31-1 ms (about 24.8 days), which would turn a long loop into a runaway.
const MAX_DELAY_MS = 24 * DAY_MS;
const TOO_LONG = 'Loop intervals can be at most 24d.';

/** Milliseconds for a duration such as 30s, 5m, 1h30m, 10 minutes, or 1 hour 30 minutes; undefined when the text is not a duration. */
export function parseDuration(text: string): number | undefined {
  const compact = text
    .trim()
    .toLowerCase()
    .replace(/^every\s+/, '')
    .replace(/(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\b/g, (_match, count: string, word: string) => `${count}${WORD_UNITS[word] ?? ''}`)
    .replace(/\s+/g, '');
  if (!DURATION.test(compact)) return undefined;
  const total = [...compact.matchAll(/(\d+)([smhd])/g)].reduce((sum, [, count, unit]) => sum + Number(count) * (UNIT_MS[unit ?? 's'] ?? 0), 0);
  return total > 0 ? total : undefined;
}

function delayOf(text: string): number {
  const ms = parseDuration(text);
  if (ms === undefined) throw new Error(`"${text}" is not a duration such as 30s, 10m, or 1h.`);
  if (ms > MAX_DELAY_MS) throw new Error(TOO_LONG);
  return ms;
}

export type LoopCommand = { kind: 'status' } | { kind: 'stop'; loopId?: string } | { kind: 'start'; prompt: string; intervalMs?: number } | { kind: 'error'; message: string };

function edgeInterval(text: string, edge: 'leading' | 'trailing'): { prompt: string; intervalMs: number } | undefined {
  const tokens = [...text.matchAll(/\S+/g)];
  for (let take = tokens.length; take >= 1; take -= 1) {
    const start = edge === 'leading' ? 0 : (tokens[tokens.length - take]?.index ?? 0);
    const end = edge === 'trailing' ? text.length : (tokens[take - 1]?.index ?? 0) + (tokens[take - 1]?.[0].length ?? 0);
    const intervalMs = parseDuration(text.slice(start, end));
    if (intervalMs === undefined) continue;
    const prompt = (edge === 'leading' ? text.slice(end) : text.slice(0, start).replace(/\s+every\s*$/i, '')).trim();
    return { prompt, intervalMs };
  }
  return undefined;
}

export function parseLoopArgs(args: string): LoopCommand {
  const trimmed = args.trim();
  if (trimmed === '') return { kind: 'status' };
  const stop = /^(?:stop|off)(?:\s+(\S+))?$/.exec(trimmed);
  if (stop !== null) return { kind: 'stop', ...(stop[1] === undefined ? {} : { loopId: stop[1] }) };
  const interval = edgeInterval(trimmed, 'leading') ?? edgeInterval(trimmed, 'trailing');
  if (interval !== undefined) {
    if (interval.intervalMs > MAX_DELAY_MS) return { kind: 'error', message: TOO_LONG };
    if (interval.prompt === '') return { kind: 'error', message: '/loop needs a prompt: /loop [interval] <prompt>' };
    return { kind: 'start', ...interval };
  }
  return { kind: 'start', prompt: trimmed };
}

interface Loop {
  prompt: string;
  intervalMs?: number;
  iteration: number;
  nextWakeMs?: number;
  timer?: ReturnType<typeof setTimeout>;
  /** A wake came due while a run was going; it fires once when that run settles. */
  due?: boolean;
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
  const run = () => {
    if (loop === undefined) return;
    loop = { ...loop, iteration: loop.iteration + 1, due: false };
    // Expansion lets a loop run a skill or template each time.
    pi.sendUserMessage(loop.prompt, { expandPromptTemplates: true, deliverAs: 'followUp' });
  };
  /**
   * A timer fired. A fixed loop keeps its wall-clock cadence, like Cursor's sleep-and-echo shell loop, so a long run
   * does not push the next tick out. A wake that lands while a run is going is delivered once that run settles, as
   * Cursor's monitored shell output notifies after the turn, and several such wakes fire once, not once each.
   */
  const tick = () => {
    if (loop === undefined) return;
    const { timer: _spent, nextWakeMs: _wake, ...rest } = loop;
    loop = rest.intervalMs === undefined ? rest : { ...rest, timer: setTimeout(tick, rest.intervalMs) };
    if (lastCtx !== undefined && !lastCtx.isIdle()) loop = { ...loop, due: true };
    else run();
  };
  /**
   * A run settled. An aborted run is no stop: Cursor's loop is a background shell that a turn interrupt leaves
   * running, so the user or the agent stops a loop explicitly.
   */
  const settled = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    if (loop === undefined) return;
    if (loop.due === true) return run();
    if (loop.timer !== undefined) return;
    if (loop.intervalMs !== undefined) {
      // An armed fixed loop has no timer yet; its first tick waits for this turn to end.
      loop = { ...loop, timer: setTimeout(tick, loop.intervalMs) };
      return;
    }
    const delay = loop.nextWakeMs;
    if (delay !== undefined) loop = { ...loop, timer: setTimeout(tick, delay) };
    else if (!options.hasPendingWork()) stop(ctx, 'the agent scheduled no next wake.');
  };
  const start = (ctx: ExtensionContext, prompt: string, intervalMs: number | undefined) => {
    if (loop !== undefined) stop(ctx, 'replaced by a new /loop.');
    lastCtx = ctx;
    loop = { prompt, iteration: 0, ...(intervalMs === undefined ? {} : { intervalMs }) };
    run();
    if (loop.intervalMs !== undefined) loop = { ...loop, timer: setTimeout(tick, loop.intervalMs) };
  };
  /** An agent arms a loop mid-turn, so its first run waits for this turn to settle and then for the first delay. */
  const arm = (ctx: ExtensionContext, prompt: string, schedule: { intervalMs: number } | { firstWakeMs: number }) => {
    if (loop !== undefined) stop(ctx, 'replaced by a new loop.');
    loop = 'intervalMs' in schedule ? { prompt, iteration: 0, intervalMs: schedule.intervalMs } : { prompt, iteration: 0, nextWakeMs: schedule.firstWakeMs };
  };
  const status = () =>
    loop === undefined
      ? 'No loop is running. Usage: /loop [interval] <prompt>, with the interval at either end; /loop stop ends one.'
      : `Loop: "${loop.prompt}" (iteration ${loop.iteration}${loop.intervalMs === undefined ? ', agent-paced' : `, every ${formatMs(loop.intervalMs)}`})`;
  const wake = (delayMs: number) => {
    if (loop === undefined) throw new Error('No loop is running. Start one with prompt plus interval or wake_in, or ask the user to run /loop.');
    if (loop.intervalMs !== undefined) throw new Error(`This loop runs every ${formatMs(loop.intervalMs)}; only the user can change its interval. Pass stop: true to end it.`);
    // A wake already scheduled is replaced, so the new delay counts from the end of this turn.
    if (loop.timer !== undefined) clearTimeout(loop.timer);
    const { timer: _timer, ...rest } = loop;
    loop = { ...rest, nextWakeMs: delayMs };
  };
  const section = () => (loop === undefined ? undefined : loopSection(loop));
  return { stop, settled, start, arm, status, wake, clear, section, prompt: () => loop?.prompt, active: () => loop !== undefined };
}

function createLoopRegistry(pi: ExtensionAPI, options: LoopOptions) {
  const controllers = new Map<string, ReturnType<typeof createLoopController>>();
  const entries = () => {
    for (const [id, controller] of controllers) if (!controller.active()) controllers.delete(id);
    return [...controllers];
  };
  const choose = (loopId?: string, prompt?: string) => {
    const active = entries();
    const existing = active.find(([id, controller]) => (loopId !== undefined ? id === loopId : prompt !== undefined ? controller.prompt() === prompt : active.length === 1));
    if (existing !== undefined) return { loopId: existing[0], controller: existing[1] };
    if (loopId !== undefined) throw new Error(`No running loop has id "${loopId}". /loop lists running loops.`);
    if (prompt !== undefined) {
      const id = randomUUID();
      const controller = createLoopController(pi, options);
      controllers.set(id, controller);
      return { loopId: id, controller };
    }
    if (active.length === 0) throw new Error('No loop is running.');
    throw new Error(`Several loops are running. Pass loop_id to choose one, or use /loop stop <id>. Running loops:\n${active.map(([id, controller]) => `${id} ${controller.status()}`).join('\n')}`);
  };
  const status = () => {
    const active = entries();
    if (active.length === 0) return 'No loop is running. Usage: /loop [interval] <prompt>, with the interval at either end; /loop stop ends one.';
    return active.map(([id, controller]) => (active.length === 1 ? controller.status() : `${id} ${controller.status()}`)).join('\n');
  };
  const section = () => {
    const active = entries();
    if (active.length === 0) return undefined;
    if (active.length === 1) return active[0]?.[1].section();
    return [...active.map(([id, controller]) => `Loop ${id} runs ${JSON.stringify(controller.prompt())}.\n${controller.section()}`), 'Several loops are running. Pass loop_id with wake_in or stop so only the intended loop changes.'].join(
      '\n\n',
    );
  };
  return { choose, entries, status, section };
}

type LoopController = ReturnType<typeof createLoopController>;
type LoopRegistry = ReturnType<typeof createLoopRegistry>;

const ONE_SHOT = '/loop needs an interactive or RPC session; print and JSON runs exit when the agent settles.';

function handleLoopCommand(registry: LoopRegistry, args: string, ctx: ExtensionCommandContext): void {
  const command = parseLoopArgs(args);
  try {
    if (command.kind === 'status') ctx.ui.notify(registry.status(), 'info');
    else if (command.kind === 'stop') registry.choose(command.loopId).controller.stop(ctx, 'stopped by /loop stop.');
    else if (command.kind === 'error') ctx.ui.notify(command.message, 'error');
    else if (isOneShot(ctx.mode)) process.stderr.write(`${ONE_SHOT}\n`);
    else registry.choose(undefined, command.prompt).controller.start(ctx, command.prompt, command.intervalMs);
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
  }
}

const LoopParams = Type.Object({
  loop_id: Type.Optional(Type.String({ description: 'Loop ID from an earlier Loop result. Required to wake, stop, or replace one loop when several are running. Omit with a new prompt to start an independent loop.' })),
  prompt: Type.Optional(
    Type.String({
      description:
        'Start a loop that sends this prompt each run. A different prompt starts an independent loop; the same prompt or an explicit loop_id replaces its earlier schedule. It may be a skill or template command such as /poteto-mode <task>.',
    }),
  ),
  interval: Type.Optional(Type.String({ description: 'With prompt: a fixed cadence such as 30m or 1h; the first run starts that long after this turn ends.' })),
  wake_in: Type.Optional(Type.String({ description: 'With prompt: the first run of an agent-paced loop. Alone: the next run of the running agent-paced loop. A duration such as 10m, at most 24d.' })),
  stop: Type.Optional(Type.Boolean({ description: 'End the loop once its goal is met.' })),
});

function loopToolText(controller: LoopController, params: Static<typeof LoopParams>, ctx: ExtensionContext): string {
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

function registerLoopTool(pi: ExtensionAPI, registry: LoopRegistry): void {
  pi.registerTool({
    name: 'Loop',
    label: 'Loop',
    description:
      '/loop for you: start an independent loop that re-sends a prompt at a fixed interval or at wakes you pick, schedule its next wake, or stop it once its goal is met. Use it when a playbook says to arm /loop. Run the prompt once yourself in the turn that arms the loop; the first scheduled run comes after the interval or wake_in. Then confirm the interval, that the prompt already ran once, and when the first run comes. Each result names the loop ID. With several loops running, pass loop_id to wake or stop the intended loop.',
    promptSnippet: 'Start a /loop, schedule its next wake, or stop it',
    parameters: LoopParams,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (isOneShot(ctx.mode)) throw new Error(`${ONE_SHOT} Do the work now instead of scheduling it.`);
      const { loopId, controller } = registry.choose(params.loop_id, params.prompt);
      return { content: [{ type: 'text', text: `${loopToolText(controller, params, ctx)}\nLoop ID: ${loopId}` }], details: { loopId } };
    },
  });
}

/** /loop: run a prompt at a fixed interval, or at wakes the agent picks, until stopped. */
export function registerLoop(pi: ExtensionAPI, options: LoopOptions): { section: () => string | undefined } {
  const registry = createLoopRegistry(pi, options);
  pi.on('session_start', (_event, ctx) => {
    if (isOneShot(ctx.mode)) pi.setActiveTools(pi.getActiveTools().filter((name) => name !== 'Loop'));
  });
  pi.on('agent_settled', (_event, ctx) => {
    for (const [, controller] of registry.entries()) controller.settled(ctx);
  });
  pi.on('session_shutdown', () => {
    for (const [, controller] of registry.entries()) controller.clear();
  });
  pi.registerCommand('loop', {
    description: 'Run independent prompts repeatedly: /loop [interval] <prompt>, interval either end and like 30s, 5m, 1h, every 10 minutes (at most 24d); /loop lists them; /loop stop [id] stops one',
    handler: async (args, ctx) => handleLoopCommand(registry, args, ctx),
  });
  registerLoopTool(pi, registry);
  return { section: registry.section };
}
