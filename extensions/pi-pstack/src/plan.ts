import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createReadonlyBashTool, releaseReadonlySandbox } from './readonly-shell.ts';

export const PLAN_ENTRY = 'pstack/plan';
const STATUS_KEY = 'pstack-plan';

/**
 * Pi's `bash` cannot be swapped for the sandboxed shell by name without replacing it for the whole session, so plan
 * mode offers the sandboxed shell under its own name and makes it the only shell while plan mode is on.
 */
export const PLAN_BASH = 'bash_readonly';

/** The tools plan mode keeps active. Names that are not registered are ignored by `setActiveTools`. */
export const PLAN_TOOLS = ['read', 'grep', 'find', 'ls', PLAN_BASH, 'AskQuestion', 'TodoWrite', 'agent_status', 'Task'] as const;
const ALLOWED = new Set<string>(PLAN_TOOLS);

export type PlanCommand = { kind: 'status' } | { kind: 'off' } | { kind: 'on'; task: string };

export function parsePlanArgs(args: string): PlanCommand {
  const trimmed = args.trim();
  if (trimmed === '') return { kind: 'status' };
  if (trimmed === 'off') return { kind: 'off' };
  if (trimmed === 'on') return { kind: 'on', task: '' };
  return { kind: 'on', task: trimmed };
}

/** What a session entry stores: whether plan mode is on, and the tools to restore when it ends. */
export interface PlanState {
  enabled: boolean;
  toolsBefore?: string[];
}

interface BranchEntry {
  type: string;
  customType?: string;
  data?: unknown;
}

/** The last plan entry on the branch; anything malformed counts as off. */
export function planFromBranch(entries: readonly BranchEntry[]): PlanState {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== 'custom' || entry.customType !== PLAN_ENTRY) continue;
    const data = entry.data as { enabled?: unknown; toolsBefore?: unknown } | null;
    if (data?.enabled !== true) return { enabled: false };
    const tools = data.toolsBefore;
    return Array.isArray(tools) && tools.every((name) => typeof name === 'string') ? { enabled: true, toolsBefore: tools as string[] } : { enabled: true };
  }
  return { enabled: false };
}

/** Why a call is refused in plan mode, or undefined when it may run. */
export function planBlockReason(toolName: string): string | undefined {
  if (ALLOWED.has(toolName)) return undefined;
  if (toolName === 'write' || toolName === 'edit') return `Plan mode is on: ${toolName} is blocked, since plan mode changes no files. Put the change in the plan; the user runs /plan off to execute it.`;
  if (toolName === 'bash') return `Plan mode is on: use ${PLAN_BASH}, the read-only sandboxed shell, instead of bash.`;
  return `Plan mode is on: ${toolName} is not available. Plan mode allows only ${PLAN_TOOLS.join(', ')}.`;
}

export function planSection(): string {
  return [
    'Plan mode is on until the user runs /plan off. Do not change files or state.',
    `Your tools are read-only: read, grep, find, ls, ${PLAN_BASH} (a shell in an OS sandbox that denies writes and network access), AskQuestion, TodoWrite, agent_status, and Task, whose subagents always run readonly and in this checkout, never in a worktree. write and edit are blocked.`,
    'Investigate the code and context the task needs. When a real decision belongs to the user (a product choice or a tradeoff you cannot settle from evidence), ask with AskQuestion; settle facts yourself.',
    'Finish with a plan: the goal; numbered steps, each with how to verify it; and the risks and open questions.',
    'The user leaves plan mode with /plan off to execute the plan.',
  ].join('\n');
}

// Pi's read-only built-ins and the sandboxed shell are always on in plan mode. The other plan tools stay on only
// if they were on before: pstack turns Task off at the depth limit, and plan mode must not hand it back.
const ALWAYS = ['read', 'grep', 'find', 'ls', PLAN_BASH];

/** The tools plan mode activates, given the tools active before it. */
export function planTools(before: readonly string[]): string[] {
  return [...new Set([...ALWAYS, ...before.filter((name) => ALLOWED.has(name))])];
}

export function registerPlanMode(pi: ExtensionAPI): { section: () => string | undefined; enabled: () => boolean } {
  let state: PlanState = { enabled: false };

  // Inactive until plan mode turns it on.
  pi.registerTool({ ...createReadonlyBashTool(PLAN_BASH), defaultActive: false });
  pi.on('session_shutdown', releaseReadonlySandbox);

  const show = (ctx: ExtensionContext) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, state.enabled ? ctx.ui.theme.fg('warning', 'plan') : undefined);
  };

  const enable = (toolsBefore: string[]) => {
    state = { enabled: true, toolsBefore };
    pi.setActiveTools(planTools(toolsBefore));
  };
  const disable = () => {
    const before = state.toolsBefore ?? pi.getActiveTools();
    state = { enabled: false };
    pi.setActiveTools(before.filter((name) => name !== PLAN_BASH));
  };

  const restore = (ctx: ExtensionContext) => {
    const stored = planFromBranch(ctx.sessionManager.getBranch());
    if (stored.enabled) enable(stored.toolsBefore ?? state.toolsBefore ?? pi.getActiveTools());
    else if (state.enabled) disable();
    else if (pi.getActiveTools().includes(PLAN_BASH)) pi.setActiveTools(pi.getActiveTools().filter((name) => name !== PLAN_BASH));
    show(ctx);
  };
  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));

  // Active tools decide what the model is offered; this decides what may run, including names the model
  // invents. Task runs: it reads `enabled` and makes each launch readonly and local without changing its input,
  // so the restriction never reaches an agent's record.
  pi.on('tool_call', (event) => {
    if (!state.enabled) return undefined;
    const reason = planBlockReason(event.toolName);
    return reason === undefined ? undefined : { block: true, reason };
  });

  const handle = (args: string, ctx: ExtensionCommandContext) => {
    const command = parsePlanArgs(args);
    if (command.kind === 'status') return ctx.ui.notify(state.enabled ? 'Plan mode is on. /plan off exits.' : 'Plan mode is off. /plan [task] turns it on.', 'info');
    if (command.kind === 'off') {
      if (state.enabled) disable();
    } else if (!state.enabled) enable(pi.getActiveTools());
    pi.appendEntry(PLAN_ENTRY, state);
    show(ctx);
    ctx.ui.notify(state.enabled ? 'Plan mode on: read-only tools only. /plan off exits.' : 'Plan mode off: tools restored.', 'info');
    if (command.kind === 'on' && command.task !== '') pi.sendUserMessage(command.task, { expandPromptTemplates: true, ...(ctx.isIdle() ? {} : { deliverAs: 'followUp' as const }) });
    return undefined;
  };

  pi.registerCommand('plan', {
    description: 'Plan mode: read-only tools, investigate and produce a plan. /plan [task], /plan off, /plan',
    getArgumentCompletions: (prefix) => ['off'].filter((name) => name.startsWith(prefix.trim())).map((name) => ({ value: name, label: name })),
    handler: async (args, ctx) => {
      handle(args, ctx);
    },
  });

  return { section: () => (state.enabled ? planSection() : undefined), enabled: () => state.enabled };
}
