import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { plansDir } from './paths.ts';
import { createReadonlyBashTool, releaseReadonlySandbox } from './readonly-shell.ts';

export const PLAN_ENTRY = 'pstack/plan';
const STATUS_KEY = 'pstack-plan';

/**
 * Pi's `bash` cannot be swapped for the sandboxed shell by name without replacing it for the whole session, so plan
 * mode offers the sandboxed shell under its own name and makes it the only shell while plan mode is on.
 */
export const PLAN_BASH = 'bash_readonly';

/** The tool that saves a plan artifact, as Cursor's plan mode saves one under `~/.cursor/plans`. */
export const PLAN_SAVE = 'create_plan';

/** The tools plan mode keeps active. Names that are not registered are ignored by `setActiveTools`. */
export const PLAN_TOOLS = ['read', 'grep', 'find', 'ls', PLAN_BASH, PLAN_SAVE, 'AskQuestion', 'TodoWrite', 'agent_status', 'Task', 'stop_agent'] as const;
const ALLOWED = new Set<string>(PLAN_TOOLS);

export type PlanCommand = { kind: 'off' } | { kind: 'build' } | { kind: 'on'; task: string };

export function parsePlanArgs(args: string): PlanCommand {
  const trimmed = args.trim();
  if (trimmed === 'off') return { kind: 'off' };
  // `build` turns the saved plan into work, the way Cursor's "Yes, build locally" leaves plan mode.
  if (trimmed === 'build' || trimmed === 'execute') return { kind: 'build' };
  // Cursor's plan command enters plan mode with or without a task, so a bare /plan does the same.
  if (trimmed === 'on' || trimmed === '') return { kind: 'on', task: '' };
  return { kind: 'on', task: trimmed };
}

/** What a session entry stores: whether plan mode is on, the tools to restore, and the saved plan. */
export interface PlanState {
  enabled: boolean;
  toolsBefore?: string[];
  planFile?: string;
}

interface BranchEntry {
  type: string;
  customType?: string;
  data?: unknown;
}

/** A stored plan path is trusted only inside the plans folder, so a crafted session file cannot redirect the read. */
function storedPlanFile(value: unknown, dir: string): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const path = resolve(value);
  return path.startsWith(`${resolve(dir)}${sep}`) ? path : undefined;
}

/** The last plan entry on the branch; anything malformed counts as off. */
export function planFromBranch(entries: readonly BranchEntry[], plansDirectory = plansDir()): PlanState {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== 'custom' || entry.customType !== PLAN_ENTRY) continue;
    const data = entry.data as { enabled?: unknown; toolsBefore?: unknown; planFile?: unknown } | null;
    const planFile = storedPlanFile(data?.planFile, plansDirectory);
    if (data?.enabled !== true) return { enabled: false, ...(planFile === undefined ? {} : { planFile }) };
    const tools = data.toolsBefore;
    return {
      enabled: true,
      ...(Array.isArray(tools) && tools.every((name) => typeof name === 'string') ? { toolsBefore: tools as string[] } : {}),
      ...(planFile === undefined ? {} : { planFile }),
    };
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

export function planSection(planFile: string | undefined): string {
  return [
    'Plan mode is on until the user runs /plan off. Do not change files or state.',
    `Your tools are read-only: read, grep, find, ls, ${PLAN_BASH} (a shell in an OS sandbox that denies writes and network access), ${PLAN_SAVE} to save the plan to a file, AskQuestion, TodoWrite, agent_status, Task, whose subagents always run readonly: a fresh one runs in this checkout, never in a worktree, and a resume or fork stays where its agent ran, and stop_agent to stop one. write and edit are blocked.`,
    'Investigate the code and context the task needs. When a real decision belongs to the user (a product choice or a tradeoff you cannot settle from evidence), ask with AskQuestion; settle facts yourself.',
    `Finish with a plan: the goal; numbered steps, each with how to verify it; and the risks and open questions. Save it with ${PLAN_SAVE} so the user can review the file and build it, and also put it in your reply.`,
    planFile === undefined ? 'The user leaves plan mode with /plan off to execute the plan.' : `The saved plan is ${planFile}. /plan build leaves plan mode and starts the work; /plan shows the file.`,
  ].join('\n');
}

/** A plan file name in Cursor's shape: the sanitized title, its first 50 characters, then the id's first 8. */
export function planFileName(title: string, id: string): string {
  const clean = title
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .slice(0, 50);
  return `${clean === '' ? 'Plan' : clean}-${id.slice(0, 8)}.plan.md`;
}

/** Writes the plan under the agent's `plans` folder and returns its path. */
export function savePlan(title: string, content: string, dir = plansDir()): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const path = join(dir, planFileName(title, id));
  writeFileSync(path, `<!-- plan: ${id} -->\n\n${content.trim()}\n`, { mode: 0o600 });
  return path;
}

const PlanSaveParams = Type.Object({
  name: Type.Optional(Type.String({ description: 'Short plan title, used for the file name. Defaults to the first line of the plan.' })),
  content: Type.String({ description: 'The full plan in Markdown: the goal, numbered steps with how to verify each, and the risks and open questions.' }),
});

// Pi's read-only built-ins and the sandboxed shell are always on in plan mode. The other plan tools stay on only
// if they were on before: pstack turns Task off at the depth limit, and plan mode must not hand it back.
const ALWAYS = ['read', 'grep', 'find', 'ls', PLAN_BASH, PLAN_SAVE];

/** The tools plan mode activates, given the tools active before it. */
export function planTools(before: readonly string[]): string[] {
  return [...new Set([...ALWAYS, ...before.filter((name) => ALLOWED.has(name))])];
}

/** The message that starts a build from the saved plan, as Cursor's execute-plan action hands over the file and its content. */
export function buildRequest(planFile: string, content: string): string {
  return [`Build the plan saved at ${planFile}. Follow it.`, '', content.trim()].join('\n');
}

export function registerPlanMode(pi: ExtensionAPI): { section: () => string | undefined; enabled: () => boolean } {
  let state: PlanState = { enabled: false };

  // Inactive until plan mode turns it on.
  pi.registerTool({ ...createReadonlyBashTool(PLAN_BASH), defaultActive: false });
  pi.registerTool({
    name: PLAN_SAVE,
    label: 'Save plan',
    description: 'Save the plan to a file so the user can review it and build it. Available only in plan mode. Returns the file path.',
    promptSnippet: 'Save the plan to a file',
    parameters: PlanSaveParams,
    exposure: 'model-only',
    executionMode: 'sequential',
    defaultActive: false,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async execute(_id, params) {
      if (!state.enabled) throw new Error(`${PLAN_SAVE} is available only in plan mode. Enter it with /plan.`);
      const title = params.name ?? params.content.trim().split('\n')[0] ?? '';
      const planFile = savePlan(title.replace(/^#+\s*/, ''), params.content);
      state = { ...state, planFile };
      pi.appendEntry(PLAN_ENTRY, { ...state, planFile });
      return { content: [{ type: 'text' as const, text: `Plan saved to ${planFile}. /plan build starts the work.` }], details: { planFile } };
    },
  });
  pi.on('session_shutdown', releaseReadonlySandbox);

  const show = (ctx: ExtensionContext) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, state.enabled ? ctx.ui.theme.fg('warning', 'plan') : undefined);
  };

  const enable = (toolsBefore: string[]) => {
    state = { enabled: true, toolsBefore, ...(state.planFile === undefined ? {} : { planFile: state.planFile }) };
    pi.setActiveTools(planTools(toolsBefore));
  };
  const disable = () => {
    const before = state.toolsBefore ?? pi.getActiveTools();
    state = { enabled: false, ...(state.planFile === undefined ? {} : { planFile: state.planFile }) };
    pi.setActiveTools(before.filter((name) => name !== PLAN_BASH && name !== PLAN_SAVE));
  };

  const restore = (ctx: ExtensionContext) => {
    const stored = planFromBranch(ctx.sessionManager.getBranch());
    state = { ...stored };
    if (stored.enabled) enable(stored.toolsBefore ?? state.toolsBefore ?? pi.getActiveTools());
    else if (pi.getActiveTools().some((name) => name === PLAN_BASH || name === PLAN_SAVE)) pi.setActiveTools(pi.getActiveTools().filter((name) => name !== PLAN_BASH && name !== PLAN_SAVE));
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
    if (command.kind === 'build') {
      const planFile = state.planFile;
      if (planFile === undefined || !existsSync(planFile)) {
        ctx.ui.notify('No saved plan to build. Run /plan, then have the agent save the plan with create_plan. /plan off leaves plan mode.', 'error');
        return undefined;
      }
      const content = readFileSync(planFile, 'utf8').replace(/^<!-- plan: [^>]*-->\n\n/, '');
      if (state.enabled) disable();
      pi.appendEntry(PLAN_ENTRY, state);
      show(ctx);
      ctx.ui.notify(`Building ${planFile}.`, 'info');
      pi.sendUserMessage(buildRequest(planFile, content), { expandPromptTemplates: true, ...(ctx.isIdle() ? {} : { deliverAs: 'followUp' as const }) });
      return undefined;
    }
    if (command.kind === 'off') {
      if (state.enabled) disable();
    } else if (!state.enabled) enable(pi.getActiveTools());
    pi.appendEntry(PLAN_ENTRY, state);
    show(ctx);
    const saved = state.planFile === undefined ? '' : ` Saved plan: ${state.planFile}.`;
    ctx.ui.notify(state.enabled ? `Plan mode on: read-only tools only. /plan off exits.${saved}` : 'Plan mode off: tools restored.', 'info');
    if (command.kind === 'on' && command.task !== '') pi.sendUserMessage(command.task, { expandPromptTemplates: true, ...(ctx.isIdle() ? {} : { deliverAs: 'followUp' as const }) });
    return undefined;
  };

  pi.registerCommand('plan', {
    description: 'Plan mode: read-only tools, investigate and save a plan. /plan [task] turns it on; /plan build starts the saved plan; /plan off exits; the footer shows plan',
    getArgumentCompletions: (prefix) => ['off', 'build'].filter((name) => name.startsWith(prefix.trim())).map((name) => ({ value: name, label: name })),
    handler: async (args, ctx) => {
      handle(args, ctx);
    },
  });

  return { section: () => (state.enabled ? planSection(state.planFile) : undefined), enabled: () => state.enabled };
}
