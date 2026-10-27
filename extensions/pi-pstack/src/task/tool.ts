import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import { getSupportedThinkingLevels, StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { childIdentity, childVariables } from '../child-env.ts';
import { rootStoreDir, subagentDir, worktreesDir } from '../paths.ts';
import { type AgentDefinition, findAgent } from './agents.ts';
import { renderTaskCard } from './card.ts';
import { backgroundText, bounded, foregroundText, worktreeLine, worktreePreface } from './format.ts';
import { type AvailableModel, type ModelSpec, resolveSubagentModel } from './models.ts';
import { type AgentRecord, acquireRunLock, type RunLock, readRecord, transcriptFor, writeRecord } from './records.ts';
import { type BackgroundNotice, createSubagentRegistry } from './registry.ts';
import { type ChildHandle, type ChildOutcome, childArgs, resolveAttachments, startChild, validateAgentId } from './runner.ts';
import { addWorktree, planWorktree, type Worktree } from './worktree.ts';

const TITLE_LIMIT = 200;

export const TaskParams = Type.Object({
  description: Type.String({ description: 'A short (3-5 word) title for the subagent, shown in the UI.' }),
  prompt: Type.String({ description: 'The task for the agent to perform. The subagent sees nothing of this conversation, so include every detail and say what to report back.' }),
  subagent_type: Type.Optional(Type.String({ description: 'Subagent type from the pstack_subagents section. Defaults to generalPurpose.' })),
  model: Type.Optional(
    Type.String({
      description:
        'Optional model for this agent, from the pstack_subagents section: inherit (default), a Cursor-style slug such as claude-opus-5-5-xhigh or claude-opus-5-5[effort=high], or a Pi model such as provider/model:high. An invalid value fails with the allowed list; pick a listed value or omit it. Ignored with resume.',
    }),
  ),
  resume: Type.Optional(Type.String({ description: 'Agent ID from an earlier Task call in this workspace. Sends this prompt as a follow-up with the agent context preserved. Fails while that agent is still running.' })),
  run_in_background: Type.Optional(
    Type.Boolean({ description: 'Return at once with the agent ID; the final response arrives as a notification after your turn ends. When false, block until the agent finishes. Defaults to the subagent type setting, else false.' }),
  ),
  readonly: Type.Optional(
    Type.Boolean({ description: 'Limit the agent to read, grep, find, ls, and a read-only shell that can neither write files nor reach the network, with no edits and no MCP tools. A readonly subagent type stays readonly.' }),
  ),
  file_attachments: Type.Optional(Type.Array(Type.String(), { description: 'Paths of files or images to attach to the agent first message.' })),
  environment: Type.Optional(
    StringEnum(['local', 'cloud'] as const, {
      description:
        'local (default) runs the agent in this working directory. cloud runs it on this machine in its own git worktree on a new branch pstack/<agent id>, created from cloud_base_branch or the current HEAD commit, so uncommitted changes do not reach it. The result names the worktree and branch; merge the branch to take its commits. Ignored with resume.',
    }),
  ),
  cloud_base_branch: Type.Optional(Type.String({ description: 'With environment cloud, the branch the worktree starts from: a local branch or ref, else origin/<branch>. Defaults to the current HEAD commit. Needs environment cloud.' })),
});
type TaskInput = Static<typeof TaskParams>;

export function taskPreflight(params: TaskInput, depth: number): undefined {
  if (params.cloud_base_branch !== undefined && params.environment !== 'cloud') throw new Error('cloud_base_branch needs environment "cloud": it names the branch the subagent\'s worktree starts from.');
  if (depth >= 2) throw new Error('A subagent launched by another subagent cannot launch further subagents.');
  return undefined;
}

/** Cursor's readonly agent files restrict a subagent; a call can add the restriction but never lift it. */
export function effectiveReadonly(agentReadonly: boolean, requested: boolean | undefined): boolean {
  return agentReadonly || requested === true;
}

interface Launch {
  agentId: string;
  agent: AgentDefinition;
  model: ModelSpec | undefined;
  readonly: boolean;
  /** The parent workspace: records, transcripts, and run locks live under its state folder. */
  workspace: string;
  /** Set for a cloud agent, which runs here instead of in the workspace. */
  worktree: Worktree | undefined;
  rootStore: string;
  /** 1 for a subagent of the main chat; an agent keeps its depth when resumed. */
  depth: number;
  trusted: boolean;
  attachments: string[];
  notes: string[];
}

/** The running pi script, so children match the parent's Pi version; falls back to `pi` on PATH. */
function piCommand(): string[] {
  const script = process.argv[1];
  if (script !== undefined && !script.startsWith('/$bunfs/') && existsSync(script)) return [process.execPath, script];
  return /^(node|bun)(\.exe)?$/.test(basename(process.execPath).toLowerCase()) ? ['pi'] : [process.execPath];
}

export function availableModels(ctx: ExtensionContext): AvailableModel[] {
  return ctx.modelRegistry.getAvailable().map((model) => ({ provider: model.provider, id: model.id, reasoning: model.reasoning, levels: getSupportedThinkingLevels(model) }));
}

export function parentModel(ctx: ExtensionContext): ModelSpec | undefined {
  if (ctx.model === undefined) return undefined;
  return ctx.thinkingLevel === undefined ? { provider: ctx.model.provider, id: ctx.model.id } : { provider: ctx.model.provider, id: ctx.model.id, thinking: ctx.thinkingLevel };
}

const rootStoreOf = (ctx: ExtensionContext) => rootStoreDir(ctx.cwd, ctx.sessionManager.getSessionId(), childIdentity.rootStore);

function planFresh(params: TaskInput, ctx: ExtensionContext, agents: readonly AgentDefinition[], depth: number): Launch {
  const agent = findAgent(agents, params.subagent_type);
  const model = resolveSubagentModel(params.model ?? agent.model, availableModels(ctx), parentModel(ctx));
  const attachments = resolveAttachments(params.file_attachments ?? [], ctx.cwd);
  const readonly = effectiveReadonly(agent.readonly, params.readonly);
  const agentId = randomUUID();
  const worktree = params.environment === 'cloud' ? planWorktree(ctx.cwd, worktreesDir(ctx.cwd), agentId, params.cloud_base_branch) : undefined;
  const notes = worktree === undefined ? [] : [worktreeLine(worktree)];
  return { agentId, agent, model, readonly, workspace: ctx.cwd, worktree, rootStore: rootStoreOf(ctx), depth: depth + 1, trusted: ctx.isProjectTrusted(), attachments, notes };
}

function recordedAgent(agents: readonly AgentDefinition[], agentId: string, type: string): AgentDefinition {
  const agent = agents.find((candidate) => candidate.type === type);
  if (agent === undefined) throw new Error(`Agent ${agentId} was a "${type}" subagent, a type this version no longer has. Start a new agent instead.`);
  return agent;
}

function planResume(params: TaskInput, ctx: ExtensionContext, agents: readonly AgentDefinition[], isRunning: (agentId: string) => boolean, depth: number): Launch {
  const agentId = validateAgentId(params.resume ?? '');
  if (isRunning(agentId)) throw new Error(`Agent ${agentId} is still running. Wait for its completion notification before resuming it.`);
  const dir = subagentDir(ctx.cwd);
  const record = readRecord(dir, agentId);
  if (record === undefined) throw new Error(`Unknown agent ID ${agentId}. Resume needs an agent ID returned by an earlier Task call in this workspace.`);
  // Two directories can share a workspace folder name (as they share Pi's session folder); trust and files belong to this one.
  if (record.cwd !== ctx.cwd) throw new Error(`Agent ${agentId} belongs to ${record.cwd}, not this workspace. Start a new agent instead.`);
  // Without its transcript, --session-id would start an empty session under the old ID.
  if (transcriptFor(dir, agentId) === undefined) throw new Error(`Agent ${agentId} has no transcript to resume, so its earlier context is gone. Start a new agent instead.`);
  const { worktree } = record;
  if (worktree !== undefined && !existsSync(worktree.cwd)) throw new Error(`Agent ${agentId} ran in the git worktree ${worktree.path}, which no longer exists. Start a new agent instead.`);
  const agent = recordedAgent(agents, agentId, record.type);
  const attachments = resolveAttachments(params.file_attachments ?? [], ctx.cwd);
  const notes = [
    ...(worktree === undefined ? [] : [worktreeLine(worktree)]),
    ...(params.model === undefined ? [] : [`Note: model "${params.model}" was ignored; a resumed agent keeps its earlier model.`]),
    ...(params.environment === undefined ? [] : [`Note: environment "${params.environment}" was ignored; a resumed agent runs where it first ran.`]),
  ];
  const readonly = effectiveReadonly(effectiveReadonly(record.readonly, agent.readonly), params.readonly);
  // An agent never runs shallower than it was created or than its caller allows: a grandchild resumed from the main chat
  // and a main-chat agent resumed from a subagent both run at depth 2. A call can add readonly but not lift it, and a
  // type that has since become readonly restricts an older writable record too.
  return { agentId, agent, model: record.model, readonly, workspace: record.cwd, worktree, rootStore: rootStoreOf(ctx), depth: Math.max(record.depth ?? 0, depth + 1), trusted: ctx.isProjectTrusted(), attachments, notes };
}

function launchChild(plan: Launch, prompt: string, signal: AbortSignal | undefined) {
  const env = { ...process.env, ...childVariables(plan.agent.type, plan.depth, plan.readonly, plan.rootStore) };
  const args = childArgs({ sessionDir: subagentDir(plan.workspace), agentId: plan.agentId, readonly: plan.readonly, trusted: plan.trusted, attachments: plan.attachments, ...(plan.model === undefined ? {} : { model: plan.model }) });
  return startChild({ command: piCommand(), args, prompt, cwd: plan.worktree?.cwd ?? plan.workspace, env, ...(signal === undefined ? {} : { signal }) });
}

function recordFresh(plan: Launch): void {
  const record: AgentRecord = {
    agentId: plan.agentId,
    type: plan.agent.type,
    readonly: plan.readonly,
    cwd: plan.workspace,
    createdAt: new Date().toISOString(),
    depth: plan.depth,
    ...(plan.model === undefined ? {} : { model: plan.model }),
    ...(plan.worktree === undefined ? {} : { worktree: plan.worktree }),
  };
  writeRecord(subagentDir(plan.workspace), record);
}

/**
 * Starts the child, then points the run lock at it. A child that never started (no pid) has no transcript, so a
 * fresh agent gets no record and its ID never becomes resumable.
 */
function start(plan: Launch, fresh: boolean, prompt: string, signal: AbortSignal | undefined, lock: RunLock): ChildHandle {
  let handle: ChildHandle | undefined;
  try {
    if (!fresh) {
      const dir = subagentDir(plan.workspace);
      const record = readRecord(dir, plan.agentId);
      if (record === undefined) throw new Error(`Unknown agent ID ${plan.agentId}. Resume needs an agent ID returned by an earlier Task call in this workspace.`);
      writeRecord(dir, { ...record, readonly: plan.readonly });
    }
    handle = launchChild(plan, fresh && plan.worktree !== undefined ? worktreePreface(plan.worktree, prompt) : prompt, signal);
    if (handle.pid !== undefined) {
      lock.holdFor(handle.pid);
      if (fresh) recordFresh(plan);
    }
    return handle;
  } catch (error) {
    handle?.kill();
    lock.release();
    throw error;
  }
}

/** The transcript file, or before Pi has created it, the pattern it will match. */
function transcriptOf(plan: Launch): string {
  return transcriptFor(subagentDir(plan.workspace), plan.agentId) ?? join(subagentDir(plan.workspace), `*_${plan.agentId}.jsonl`);
}

function details(plan: Launch, background: boolean, status: string, pid?: number) {
  return { agentId: plan.agentId, subagentType: plan.agent.type, model: plan.model ?? null, readonly: plan.readonly, background, status, transcript: transcriptOf(plan), pid: pid ?? null, worktree: plan.worktree ?? null };
}

function foregroundResult(plan: Launch, outcome: ChildOutcome) {
  const transcript = transcriptOf(plan);
  if (outcome.failure === undefined) return { content: [{ type: 'text' as const, text: foregroundText(plan.agentId, outcome.finalText, transcript, plan.notes) }], details: details(plan, false, 'success'), usage: outcome.usage };
  const partial = outcome.finalText === '' ? [] : ['', 'Partial output:', bounded(outcome.finalText, transcript)];
  const text = [`Subagent failed: ${outcome.failure}`, ...partial, '', `Agent ID: ${plan.agentId}`, ...plan.notes].join('\n');
  return { content: [{ type: 'text' as const, text }], details: details(plan, false, 'error'), usage: outcome.usage, isError: true };
}

function backgroundNotice(plan: Launch, prompt: string, ctx: ExtensionContext, toolCallId: string): BackgroundNotice {
  const flat = prompt.replace(/\s+/g, ' ').trim();
  return {
    title: flat.length > TITLE_LIMIT ? `${flat.slice(0, TITLE_LIMIT)}…` : flat,
    toolCallId,
    mode: ctx.mode,
    detailFor: (outcome) => {
      const transcript = transcriptOf(plan);
      if (outcome.failure === undefined) return { status: 'success', detail: bounded(outcome.finalText, transcript), usage: outcome.usage };
      return { status: 'error', detail: outcome.finalText === '' ? outcome.failure : `${outcome.failure}\n${bounded(outcome.finalText, transcript)}`, usage: outcome.usage };
    },
  };
}

/** Plans the launch and takes the agent's run lock; a resume is planned again under the lock, since the agent may have started in between. */
function prepare(params: TaskInput, ctx: ExtensionContext, options: TaskToolOptions, isRunning: (agentId: string) => boolean): { plan: Launch; lock: RunLock } {
  const fresh = params.resume === undefined;
  const initialPlan = fresh ? planFresh(params, ctx, options.agents, options.depth) : planResume(params, ctx, options.agents, isRunning, options.depth);
  const lock = acquireRunLock(subagentDir(initialPlan.workspace), initialPlan.agentId);
  try {
    return { plan: fresh ? initialPlan : planResume(params, ctx, options.agents, isRunning, options.depth), lock };
  } catch (error) {
    lock.release();
    throw error;
  }
}

/** Only a fresh cloud agent awaits here, so a resume keeps taking its lock and starting in one synchronous step. */
async function createWorktree(plan: Launch, lock: RunLock, signal: AbortSignal | undefined): Promise<void> {
  if (plan.worktree === undefined) return;
  try {
    await addWorktree(plan.workspace, plan.worktree, signal);
  } catch (error) {
    lock.release();
    throw error;
  }
}

const TASK_DESCRIPTION =
  'Launch a subagent: a separate Pi process with its own context that works autonomously and returns one final message. It sees nothing of this conversation, so give it a self-contained prompt and say what to report back. Put several Task calls in one message to run them in parallel. Subagent types and model values are listed in the pstack_subagents section of the system prompt.';

// Interactive Pi redraws the chat between a replaced session's shutdown and the next session's start, which erases a
// warning sent at shutdown. The next runtime shows it instead, so it rides on globalThis across the reload.
const STOPPED_NOTICE = Symbol.for('pi-pstack/stopped-subagents');
const carrier = globalThis as { [STOPPED_NOTICE]?: string };

/** Pi restores a resumed session's active tools, so an agent created at depth 1 and resumed at depth 2 would get Task back. */
function dropTask(pi: ExtensionAPI): void {
  const active = pi.getActiveTools();
  if (active.includes('Task')) pi.setActiveTools(active.filter((name) => name !== 'Task'));
}

export interface TaskToolOptions {
  agents: readonly AgentDefinition[];
  depth: number;
}

export function registerTask(pi: ExtensionAPI, options: TaskToolOptions): { hasBackgroundWork: () => boolean } {
  const registry = createSubagentRegistry(pi);
  pi.on('agent_before_settle', (event, ctx) => registry.beforeSettle(ctx, event.outcome));
  pi.on('session_shutdown', (event, ctx) => {
    const stopped = registry.shutdown();
    if (stopped === 0) return;
    const message = `Stopped ${stopped} background subagent${stopped === 1 ? '' : 's'} (session ${event.reason}). Resume one with its agent ID.`;
    if (event.reason === 'quit') {
      if (ctx.hasUI) ctx.ui.notify(message, 'warning');
    } else carrier[STOPPED_NOTICE] = message;
  });
  pi.on('session_start', (_event, ctx) => {
    if (options.depth >= 2) dropTask(pi);
    const message = carrier[STOPPED_NOTICE];
    delete carrier[STOPPED_NOTICE];
    if (message !== undefined && ctx.hasUI) ctx.ui.notify(message, 'warning');
  });

  pi.registerTool({
    name: 'Task',
    label: 'Task',
    description: TASK_DESCRIPTION,
    promptSnippet: 'Launch subagents (foreground, background with completion notifications, resume by agent ID)',
    parameters: TaskParams,
    // Cursor stops nesting at the subagent of a subagent, so that depth never sees the tool.
    defaultActive: options.depth < 2,
    renderResult: (result, renderOptions) => renderTaskCard(result, renderOptions),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      taskPreflight(params, options.depth);
      const fresh = params.resume === undefined;
      const { plan, lock } = prepare(params, ctx, options, registry.isRunning);
      if (fresh) await createWorktree(plan, lock, signal);
      const background = params.run_in_background ?? (fresh && plan.agent.background);
      const handle = start(plan, fresh, params.prompt, background ? undefined : signal, lock);
      if (background) {
        registry.track(plan.agentId, handle, lock.release, backgroundNotice(plan, params.prompt, ctx, toolCallId));
        return { content: [{ type: 'text', text: backgroundText(plan.agentId, transcriptOf(plan), plan.notes) }], details: details(plan, true, 'running', handle.pid) };
      }
      registry.track(plan.agentId, handle, lock.release);
      onUpdate?.({ content: [{ type: 'text', text: `Subagent ${plan.agent.type} is running (${plan.agentId}).` }], details: details(plan, false, 'running', handle.pid) });
      return foregroundResult(plan, await handle.done);
    },
  });

  return { hasBackgroundWork: registry.hasBackgroundWork };
}
