import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { canAsk } from './modes.ts';
import { plansDir } from './paths.ts';
import { createReadonlyBashTool, releaseReadonlySandbox } from './readonly-shell.ts';

export const PLAN_ENTRY = 'pstack/plan';
const STATUS_KEY = 'pstack-plan';

/**
 * Pi's `bash` cannot be swapped for the sandboxed shell by name without replacing it for the whole session, so plan
 * mode offers the sandboxed shell under its own name and makes it the only shell while plan mode is on.
 */
export const PLAN_BASH = 'bash_readonly';

/** Cursor's plan tool: it writes the plan file the user reviews and builds. */
export const PLAN_SAVE = 'CreatePlan';

/** Cursor's tool for moving between agent and plan mode with the user's consent. */
export const SWITCH_MODE = 'SwitchMode';

/** The tools plan mode keeps active. Names that are not registered are ignored by `setActiveTools`. */
export const PLAN_TOOLS = ['read', 'grep', 'find', 'ls', 'edit', 'write', PLAN_BASH, PLAN_SAVE, SWITCH_MODE, 'AskQuestion', 'TodoWrite', 'agent_status', 'Task', 'stop_agent'] as const;
const ALLOWED = new Set<string>(PLAN_TOOLS);

/** Cursor's plan-mode guardrail: only markdown files are edited while planning. */
const MARKDOWN = /\.(?:md|markdown|mdc)$/i;

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
export function planBlockReason(toolName: string, input: Record<string, unknown> = {}): string | undefined {
  if (toolName === 'write' || toolName === 'edit') {
    const path = input['path'];
    if (typeof path === 'string' && MARKDOWN.test(path)) return undefined;
    return `Plan mode is on: ${toolName} may change only markdown files while planning. Put the change in the plan. If the user asked you to build it now, switch to agent mode with ${SWITCH_MODE} first.`;
  }
  if (ALLOWED.has(toolName)) return undefined;
  if (toolName === 'bash') return `Plan mode is on: use ${PLAN_BASH}, the read-only sandboxed shell, instead of bash.`;
  return `Plan mode is on: ${toolName} is not available. Plan mode allows only ${PLAN_TOOLS.join(', ')}.`;
}

/** Cursor's plan-mode instructions, with Pi's tool names. */
export function planSection(planFile: string | undefined): string {
  return [
    'Plan mode is on. The user does not want you to execute yet. Do not edit files other than markdown files, do not run tools that change anything (no config changes, no commits), and do not otherwise change the system. This overrides any other instruction to make edits. Instead:',
    "1. Answer the user's request by researching it.",
    '2. If you do not have enough information to make an accurate plan, ask the user. If an instruction is ambiguous, ask the user to clarify it.',
    '3. If the request is too broad, ask questions that narrow the scope of the plan, one or two critical questions at a time.',
    '4. If several valid implementations would each change the plan significantly, ask the user which one to use.',
    '5. Ask your questions right away, at the start. Read first only when five files or fewer will likely answer them.',
    `6. When your research is done, present the plan by calling ${PLAN_SAVE}, which asks the user to confirm it. Make no changes until the user confirms.`,
    '7. Keep the plan concise, specific, and actionable. Cite file paths and the essential code, and link each file you mention as a markdown link, such as [src/foo.ts](src/foo.ts).',
    '8. Keep the plan proportional to the request. Do not over-engineer a simple task.',
    '9. Do not use emojis in the plan.',
    '10. To speed up research, launch parallel explore subagents with Task to cover different parts of the codebase or different angles at once.',
    '11. When the plan explains architecture, data flows, or other relationships, consider a mermaid diagram. In mermaid, use no spaces in node IDs (camelCase, PascalCase, or underscores); quote edge labels and node labels that contain parentheses, brackets, commas, or colons, such as A["Process (main)"] and A -->|"O(1) lookup"| B; do not use end, subgraph, graph, or flowchart as node IDs; give each subgraph an ID and a bracketed label, such as subgraph auth [Authentication Flow]; keep angle brackets and HTML entities out of labels; set no colors or styles; and do not use click.',
    '12. Ask every question with the AskQuestion tool.',
    `Guardrails: edit only markdown files in plan mode. While the user is refining the plan, stay in plan mode and keep your edits in markdown. If the user explicitly asks you to build, implement, or write the code now, call ${SWITCH_MODE} with target_mode_id agent before you make any other edit.`,
    `Your tools here: read, grep, find, ls, ${PLAN_BASH} (a shell in an OS sandbox that denies file writes and network access), edit and write for markdown files only, ${PLAN_SAVE}, ${SWITCH_MODE}, AskQuestion, TodoWrite, agent_status, Task (its subagents run readonly in this checkout), and stop_agent.`,
    planFile === undefined
      ? 'The user leaves plan mode with /plan off.'
      : `The plan is saved at ${planFile}. To change it, edit that file; do not call ${PLAN_SAVE} again. The user builds it with /plan build, or leaves plan mode with /plan off.`,
  ].join('\n');
}

export interface PlanTodo {
  id: string;
  content: string;
}

/** The plan's title as Cursor finds it: the first level-1 heading, else the first line of text. */
export function planTitle(plan: string): string {
  const heading = /^#\s+(.+)$/m.exec(plan)?.[1];
  if (heading !== undefined) return heading.trim().slice(0, 50);
  const line = plan.split('\n').find((candidate) => candidate.trim() !== '' && !candidate.trim().startsWith('#'));
  return line === undefined ? 'Plan' : line.trim().slice(0, 50);
}

/** A plan file name in Cursor's shape: the sanitized name, its first 50 characters, then 8 hex characters of the chat. */
export function planFileName(name: string, chatKey: string): string {
  const clean = name
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .slice(0, 50);
  return `${clean === '' ? 'Plan' : clean}-${chatKey.slice(0, 8)}.plan.md`;
}

const yamlString = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;

/** The plan file as Cursor writes it: the chat id in a comment, the todos as front matter, then the plan. */
export function planFileContent(sessionId: string, plan: string, todos: readonly PlanTodo[]): string {
  const lines = [`<!-- ${sessionId} -->`];
  if (todos.length > 0) {
    lines.push('---', 'todos:');
    for (const todo of todos) lines.push(`  - id: ${yamlString(todo.id)}`, `    content: ${yamlString(todo.content)}`, '    status: pending');
    lines.push('isProject: false', '---');
  }
  lines.push(plan);
  return lines.join('\n');
}

/**
 * Writes the plan under the plans folder and returns its path. A chat keeps one file per plan name, as Cursor keys the
 * name by its conversation; Pi's session ids start with a timestamp, so the 8 characters come from a hash of the id.
 */
export function savePlan(sessionId: string, plan: string, name: string | undefined, todos: readonly PlanTodo[], dir = plansDir()): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const chatKey = createHash('sha256').update(sessionId).digest('hex');
  const path = join(dir, planFileName(name === undefined || name.trim() === '' ? planTitle(plan) : name, chatKey));
  writeFileSync(path, planFileContent(sessionId, plan, todos), { mode: 0o600 });
  return path;
}

/** The plan text the build turn carries: the file without Cursor's chat comment and todo front matter. */
export function planBody(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/^<!-- [^\n]*-->\n/, '')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .trim();
}

const CreatePlanParams = Type.Object({
  plan: Type.String({ description: "A detailed, concrete plan for accomplishing the user's request" }),
  name: Type.Optional(Type.String({ description: 'A short 3-4 word name for the plan. Give it only on the first CreatePlan call, so the plan file name stays stable.' })),
  overview: Type.Optional(Type.String({ description: 'A 1-2 sentence high-level description of what the plan accomplishes' })),
  todos: Type.Optional(
    Type.Array(Type.Object({ id: Type.String({ description: 'Unique identifier for the todo' }), content: Type.String({ description: 'Description of the todo task' }) }), { description: 'Array of implementation todos' }),
  ),
});

// Cursor's CreatePlan rules: a glanceable markdown plan with a title, todos, no tables, and edits in the file afterwards.
const CREATE_PLAN_DESCRIPTION = [
  "Create a concise plan for the user's request. Call it at the end of the planning phase to finalize and store the plan; the user is then asked to confirm it.",
  '',
  'Write the plan in markdown with sections and headers. Keep it concise and actionable: the minimum detail the user needs to understand and act on it. Name the few most important files you will change and the existing code you will reuse, and cite file paths and essential snippets. Do not use markdown tables in the plan; use bullet lists. The first line must be a level-1 markdown heading with the plan title.',
  '',
  'Organize implementation work as todos: each a clear, specific, actionable task with a unique id (such as "setup-auth") and descriptive content. A simple plan needs a few high-level todos or none.',
  '',
  'Each call creates a new plan file and returns its path. To update an existing plan, read and edit that file with your file tools; do not call this tool again. Ask clarifying questions with AskQuestion before you call it, not inside the plan. Focus on the meaningful decisions rather than low-level detail. A good plan is glanceable, not a wall of text.',
].join('\n');

const SwitchModeParams = Type.Object({
  target_mode_id: Type.Enum(['plan', 'agent'] as const, { type: 'string', description: "The mode to switch to: 'plan' or 'agent'." }),
  explanation: Type.Optional(Type.String({ description: 'Why the switch helps, shown to the user who approves it.' })),
});

// Cursor's SwitchMode rules: switch proactively when the work changes shape, rarely otherwise, and only with consent.
const SWITCH_MODE_DESCRIPTION = [
  'Switch the interaction mode to match the task. Agent mode is the default, with every tool for making changes. Plan mode is read-only collaborative planning before any code: research, questions, and a plan the user confirms.',
  '',
  'Switch to plan mode proactively when the task has several valid approaches with significant tradeoffs, needs an architectural decision, touches many files or systems, has unclear requirements you must explore first, or would otherwise need several clarifying questions. Switch to agent mode once the plan is settled, or when the user asks you to build it now.',
  '',
  'Do not switch for a simple, clear task, in the middle of implementation that is going well, for a minor clarifying question, or when the current mode is working. Explain briefly in explanation why you switch. The user must approve every switch.',
].join('\n');

/** The plan review choices Cursor offers after a plan; building in the cloud appears only in a git repository. */
export const BUILD_LOCALLY = 'Yes, build locally';
export const BUILD_IN_WORKER = 'Yes, build in cloud';
export const PROPOSE_CHANGES = 'No, propose changes';

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

const isGitRepository = (cwd: string): boolean => {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

export interface PlanModeOptions {
  /** Starts the build in an isolated worktree worker, Pi's counterpart to Cursor's "build in cloud". Returns the agent ID. */
  buildInWorker?: (planFile: string, request: string) => Promise<string>;
}

export function registerPlanMode(pi: ExtensionAPI, options: PlanModeOptions = {}): { section: () => string | undefined; enabled: () => boolean } {
  let state: PlanState = { enabled: false };
  // A plan saved during the current run, which the user reviews once the run settles.
  let review: string | undefined;

  // Inactive until plan mode turns it on.
  pi.registerTool({ ...createReadonlyBashTool(PLAN_BASH), defaultActive: false });
  pi.registerTool({
    name: PLAN_SAVE,
    label: 'Create plan',
    description: CREATE_PLAN_DESCRIPTION,
    promptSnippet: 'Save the plan to a file the user reviews and builds',
    parameters: CreatePlanParams,
    exposure: 'model-only',
    executionMode: 'sequential',
    defaultActive: false,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!state.enabled) throw new Error(`${PLAN_SAVE} is available only in plan mode. Enter it with /plan.`);
      const planFile = savePlan(ctx.sessionManager.getSessionId(), params.plan, params.name, params.todos ?? []);
      state = { ...state, planFile };
      review = planFile;
      pi.appendEntry(PLAN_ENTRY, state);
      const overview = params.overview === undefined || params.overview.trim() === '' ? '' : `\n${params.overview.trim()}`;
      return { content: [{ type: 'text' as const, text: `Created the plan file ${planFile}.${overview}\nTo change the plan, edit that file; do not call ${PLAN_SAVE} again.` }], details: { planFile } };
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
    review = undefined;
    if (stored.enabled) enable(stored.toolsBefore ?? state.toolsBefore ?? pi.getActiveTools());
    else if (pi.getActiveTools().some((name) => name === PLAN_BASH || name === PLAN_SAVE)) pi.setActiveTools(pi.getActiveTools().filter((name) => name !== PLAN_BASH && name !== PLAN_SAVE));
    // SwitchMode needs someone to approve the switch, so a run nobody watches does not get it.
    if (!canAsk(ctx) && pi.getActiveTools().includes(SWITCH_MODE)) pi.setActiveTools(pi.getActiveTools().filter((name) => name !== SWITCH_MODE));
    show(ctx);
  };
  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));

  // Active tools decide what the model is offered; this decides what may run, including names the model
  // invents. Task runs: it reads `enabled` and makes each launch readonly and local without changing its input,
  // so the restriction never reaches an agent's record.
  pi.on('tool_call', (event) => {
    if (!state.enabled) return undefined;
    const reason = planBlockReason(event.toolName, event.input as Record<string, unknown>);
    return reason === undefined ? undefined : { block: true, reason };
  });

  const build = (ctx: ExtensionContext, planFile: string) => {
    if (state.enabled) disable();
    pi.appendEntry(PLAN_ENTRY, state);
    show(ctx);
    ctx.ui.notify(`Building ${planFile}.`, 'info');
    pi.sendUserMessage(buildRequest(planFile, planBody(planFile)), { expandPromptTemplates: true, ...(ctx.isIdle() ? {} : { deliverAs: 'followUp' as const }) });
  };

  const reviewPlan = async (ctx: ExtensionContext, planFile: string) => {
    const worker = options.buildInWorker !== undefined && isGitRepository(ctx.cwd);
    const choice = await ctx.ui.select(`Plan saved at ${planFile}. Build it?`, worker ? [BUILD_LOCALLY, BUILD_IN_WORKER, PROPOSE_CHANGES] : [BUILD_LOCALLY, PROPOSE_CHANGES]);
    if (!state.enabled || state.planFile !== planFile) return;
    if (choice === BUILD_LOCALLY) build(ctx, planFile);
    else if (choice === BUILD_IN_WORKER && options.buildInWorker !== undefined) {
      disable();
      pi.appendEntry(PLAN_ENTRY, state);
      show(ctx);
      const agentId = await options.buildInWorker(planFile, buildRequest(planFile, planBody(planFile)));
      ctx.ui.notify(`Building ${planFile} in an isolated worker (agent ${agentId}). Its result arrives as a Task notification.`, 'info');
    }
  };

  // After a run that saved a plan, the user picks what happens next, as Cursor's plan card asks. The dialog runs on
  // its own so that other settle handlers, such as a loop's next tick, do not wait for the user's answer.
  pi.on('agent_settled', (event, ctx) => {
    const planFile = review;
    review = undefined;
    if (event.aborted || planFile === undefined || !state.enabled || !canAsk(ctx) || !existsSync(planFile)) return;
    reviewPlan(ctx, planFile).catch((error: Error) => ctx.ui.notify(`Could not start the plan build: ${error.message}`, 'error'));
  });

  pi.registerTool({
    name: SWITCH_MODE,
    label: 'Switch mode',
    description: SWITCH_MODE_DESCRIPTION,
    promptSnippet: 'Switch between agent mode and plan mode, with the user approving',
    parameters: SwitchModeParams,
    exposure: 'model-only',
    executionMode: 'sequential',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const current = state.enabled ? 'plan' : 'agent';
      if (params.target_mode_id === current) return { content: [{ type: 'text' as const, text: `Already in ${current} mode.` }], details: { mode: current, switched: false } };
      if (!canAsk(ctx)) throw new Error('A mode switch needs the user to approve it, and nobody can approve one in this run.');
      const label = params.target_mode_id === 'plan' ? 'Plan' : 'Agent';
      const approved = await ctx.ui.confirm(`Switch to ${label} mode?`, params.explanation?.trim() ?? '');
      if (!approved) return { content: [{ type: 'text' as const, text: `The user declined the switch to ${params.target_mode_id} mode. Stay in ${current} mode.` }], details: { mode: current, switched: false } };
      if (params.target_mode_id === 'plan') enable(pi.getActiveTools());
      else disable();
      pi.appendEntry(PLAN_ENTRY, state);
      show(ctx);
      const text =
        params.target_mode_id === 'plan' ? `Switched to plan mode. Follow these instructions from now on:\n${planSection(state.planFile)}` : 'Switched to agent mode. Plan mode restrictions no longer apply, and every tool is back.';
      return { content: [{ type: 'text' as const, text }], details: { mode: params.target_mode_id, switched: true } };
    },
  });

  const handle = (args: string, ctx: ExtensionCommandContext) => {
    const command = parsePlanArgs(args);
    if (command.kind === 'build') {
      const planFile = state.planFile;
      if (planFile === undefined || !existsSync(planFile)) {
        ctx.ui.notify(`No saved plan to build. Run /plan, then have the agent save the plan with ${PLAN_SAVE}. /plan off leaves plan mode.`, 'error');
        return undefined;
      }
      build(ctx, planFile);
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
    description: 'Plan mode: read-only research, then a plan to review. /plan [task] turns it on; /plan build starts the saved plan; /plan off exits; the footer shows plan',
    getArgumentCompletions: (prefix) => ['off', 'build'].filter((name) => name.startsWith(prefix.trim())).map((name) => ({ value: name, label: name })),
    handler: async (args, ctx) => {
      handle(args, ctx);
    },
  });

  return { section: () => (state.enabled ? planSection(state.planFile) : undefined), enabled: () => state.enabled };
}
