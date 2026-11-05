import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { BUILD_PLAN_ENV, childIdentity, childVariables } from '../child-env.ts';
import { rootStoreDir, subagentDir, workspaceStateDir, worktreesDir } from '../paths.ts';
import { piCommand } from '../pi-command.ts';
import { type AgentDefinition, findAgent, normalizedType } from './agents.ts';
import { renderTaskCard, renderTaskNotification } from './card.ts';
import { backgroundText, bounded, foregroundText, notificationTitle, worktreeLine, worktreePreface } from './format.ts';
import { type AvailableModel, fastVariant, type ModelSpec, resolveSubagentModel } from './models.ts';
import { createProgress } from './progress.ts';
import { type AgentRecord, AgentRunningError, acquireRunLock, forkTranscript, type RunLock, readonlyLaunchRestores, readRecord, transcriptFor, writeRecord } from './records.ts';
import { type BackgroundNotice, createSubagentRegistry, NOTIFICATION_TYPE } from './registry.ts';
import { type ChildHandle, type ChildInput, type ChildOutcome, childArgs, resolveAttachments, startChild, validateAgentId, withAttachments } from './runner.ts';
import { registerStopAgent } from './stop.ts';
import { addWorktree, planWorktree, type Worktree } from './worktree.ts';

// Cursor's Task schema text, with the catalogs in the pstack_subagents section instead of a user-info message.
export const TaskParams = Type.Object({
  description: Type.String({
    description:
      "A short, user-friendly title for the subagent. This appears in the UI as the subagent's name. Make it concrete and distinct, consider recent titles to avoid reuse. For resumed subagents which you are prompting to work on a separate task, give an updated description based on the latest work the subagent is performing. (Do not rename if the subagent is continuing work on the same high-level task.)",
  }),
  prompt: Type.String({ description: 'The task for the agent to perform' }),
  subagent_type: Type.Optional(Type.String({ description: 'Subagent type to use for this task. Available types are listed in <pstack_subagents> in the system prompt.' })),
  model: Type.Optional(
    Type.String({
      description:
        'Optional model slug for this agent. If provided, it must resolve to one of the available model slugs. The available model slugs are listed in <pstack_subagents> in the system prompt. An invalid slug fails the call with the allowed list — pick a listed slug or omit this parameter; never retry an invalid slug unchanged. If omitted, the subagent uses the same model as the parent agent. Do not pass if resume field is set (prior model will be used). Use "inherit" unless the user explicitly requested another listed model.',
    }),
  ),
  resume: Type.Optional(
    Type.String({
      description: 'Optional agent ID to resume from. If provided, sends a follow-up message to the agent after it has completed. Requests to a currently running asynchronous agent fail; wait for completion before resuming.',
    }),
  ),
  fork: Type.Optional(
    Type.String({
      description:
        'Agent ID from an earlier Task call in this workspace. Starts a new agent (new ID) whose context begins as a copy of that agent transcript and that runs in the same directory (its git worktree when it had one), so it sees that checkout and its uncommitted changes. The prompt is the new task. subagent_type, model, and readonly default to the source agent; readonly can be added, never lifted. Fails while the source is running. Cannot be combined with resume, environment, or cloud_base_branch.',
    }),
  ),
  fork_turns: Type.Optional(Type.Integer({ minimum: 1, description: 'With fork: copy only the first N user turns of the source agent, so the fork starts from that point in its conversation. Defaults to the whole transcript.' })),
  run_in_background: Type.Optional(
    Type.Boolean({
      description: 'Run the agent in the background (returns output_file path to check later). If this is false, you will be blocked until the agent completes. When true, the background subagent will send a notification when it completes.',
    }),
  ),
  readonly: Type.Optional(
    Type.Boolean({ description: 'Limit the agent to read, grep, find, ls, and a read-only shell that can neither write files nor reach the network, with no edits and no MCP tools. A readonly subagent type stays readonly.' }),
  ),
  file_attachments: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Optional array of file paths to images or videos to attach to the subagent. Files are read and attached to the subagent's context. Use to forward relevant media to any subagent (e.g. pass a user-attached image's saved file path so the subagent sees the actual image rather than a prose description). A video path is named for the agent but not sent as video, because Pi models have no video input.",
    }),
  ),
  environment: Type.Optional(
    Type.Enum(['local', 'cloud'] as const, {
      type: 'string',
      description:
        'local (default) runs the agent in this working directory. cloud runs it on this machine in its own git worktree on a new branch pstack/<agent id>, created from cloud_base_branch or the current HEAD commit, so uncommitted changes do not reach it. The result names the worktree and branch; merge the branch to take its commits. Ignored with resume; not allowed with fork.',
    }),
  ),
  cloud_base_branch: Type.Optional(
    Type.String({
      description: 'With environment cloud, the branch the worktree starts from: origin/<branch> when that remote-tracking ref exists, else a local branch or any other ref. Defaults to the current HEAD commit. Needs environment cloud.',
    }),
  ),
});
type TaskInput = Static<typeof TaskParams>;

export function taskPreflight(params: TaskInput, depth: number): undefined {
  if (params.prompt.trim() === '') throw new Error('prompt is required');
  if (params.fork !== undefined) {
    if (params.resume !== undefined) throw new Error('fork and resume cannot be combined: resume continues an agent, fork starts a new agent from a copy of one.');
    if (params.environment !== undefined || params.cloud_base_branch !== undefined) throw new Error('fork runs where the source agent ran, so it takes no environment or cloud_base_branch.');
  }
  if (params.fork_turns !== undefined && params.fork === undefined) throw new Error('fork_turns needs fork: it says how many user turns of the source agent to copy.');
  if (params.cloud_base_branch !== undefined && params.environment !== 'cloud') throw new Error('cloud_base_branch needs environment "cloud": it names the branch the subagent\'s worktree starts from.');
  if (depth >= 2) throw new Error('A subagent launched by another subagent cannot launch further subagents.');
  return undefined;
}

/** A readonly agent type restricts its subagents; a call can add the restriction but never lift it. */
export function effectiveReadonly(agentReadonly: boolean, requested: boolean | undefined): boolean {
  return agentReadonly || requested === true;
}

export interface Launch {
  /** fresh: a new agent; resume: an earlier agent continued; fork: a new agent started from a copy of `forkedFrom`. */
  kind: 'fresh' | 'resume' | 'fork';
  agentId: string;
  forkedFrom?: string;
  agent: AgentDefinition;
  model: ModelSpec | undefined;
  /** What the agent's record keeps. */
  readonly: boolean;
  /** Plan mode runs this launch readonly and here, without touching the record. */
  planMode: boolean;
  /** The workspace that owns records, transcripts, and run locks; its state folder holds them. */
  workspace: string;
  /** Where the child process runs: the recorded worktree or directory, separate from where its record lives. */
  executionCwd: string;
  /** The main chat's working directory, which authorizes every record in the shared workspace. */
  rootWorkspace: string;
  /** Set for a cloud agent, which runs here instead of in the workspace. */
  worktree: Worktree | undefined;
  rootStore: string;
  /** 1 for a subagent of the main chat; an agent keeps its depth when resumed. */
  depth: number;
  trusted: boolean;
  attachments: string[];
  notes: string[];
  description: string;
  buildPlan?: string;
}

const runsReadonly = (plan: Launch) => plan.readonly || plan.planMode;

export function availableModels(ctx: ExtensionContext): AvailableModel[] {
  return ctx.modelRegistry.getAvailable().map((model) => ({ provider: model.provider, id: model.id, reasoning: model.reasoning, levels: getSupportedThinkingLevels(model) }));
}

export function parentModel(ctx: ExtensionContext): ModelSpec | undefined {
  if (ctx.model === undefined) return undefined;
  return ctx.thinkingLevel === undefined ? { provider: ctx.model.provider, id: ctx.model.id } : { provider: ctx.model.provider, id: ctx.model.id, thinking: ctx.thinkingLevel };
}

const rootStoreOf = (ctx: ExtensionContext) => rootStoreDir(ctx.cwd, ctx.sessionManager.getSessionId(), childIdentity.rootStore);
const rootWorkspaceOf = (ctx: ExtensionContext) => childIdentity.rootWorkspace ?? ctx.cwd;

const isUnder = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

/**
 * Whether this workspace owns the record. The shared workspace state already scopes discovery; a descendant of a
 * cloud worker records the worktree it ran in, while the root that must resume it records the workspace root.
 * Older records have no workspaceRoot, so a worktree under this workspace's state folder stands in for it.
 */
export function recordBelongsToWorkspace(record: Pick<AgentRecord, 'cwd' | 'workspaceRoot'>, cwd: string): boolean {
  if (record.workspaceRoot !== undefined) return record.workspaceRoot === cwd;
  return record.cwd === cwd || isUnder(worktreesDir(cwd), record.cwd);
}

/** A launch trusts this checkout and the worktrees derived from it, never an unrelated recorded directory. */
const trustFor = (executionCwd: string, ctx: ExtensionContext): boolean => ctx.isProjectTrusted() && (executionCwd === ctx.cwd || isUnder(worktreesDir(ctx.cwd), executionCwd));

function planFresh(params: TaskInput, ctx: ExtensionContext, agents: readonly AgentDefinition[], depth: number, planMode: boolean): Launch {
  const agent = findAgent(agents, params.subagent_type);
  const available = availableModels(ctx);
  const parent = parentModel(ctx);
  const model = resolveSubagentModel(params.model, available, agent.defaultsToFastModel === true ? fastVariant(available, parent) : parent, parent);
  const attachments = resolveAttachments(params.file_attachments ?? [], ctx.cwd);
  const readonly = effectiveReadonly(agent.readonly, params.readonly);
  const agentId = randomUUID();
  const cloud = params.environment === 'cloud';
  const worktree = cloud && !planMode ? planWorktree(ctx.cwd, worktreesDir(ctx.cwd), agentId, params.cloud_base_branch) : undefined;
  const notes = worktree === undefined ? (cloud ? ['Note: environment "cloud" was ignored; plan mode runs subagents here, readonly.'] : []) : [worktreeLine(worktree)];
  return {
    kind: 'fresh',
    agentId,
    agent,
    model,
    readonly,
    planMode,
    workspace: ctx.cwd,
    executionCwd: worktree?.cwd ?? ctx.cwd,
    rootWorkspace: rootWorkspaceOf(ctx),
    worktree,
    rootStore: rootStoreOf(ctx),
    depth: depth + 1,
    trusted: ctx.isProjectTrusted(),
    attachments,
    notes,
    description: params.description,
  };
}

function recordedAgent(agents: readonly AgentDefinition[], agentId: string, type: string): AgentDefinition {
  const agent = agents.find((candidate) => candidate.type === type);
  if (agent === undefined) throw new Error(`Agent ${agentId} was a "${type}" subagent, a type this version no longer has. Start a new agent instead.`);
  return agent;
}

function planResume(params: TaskInput, ctx: ExtensionContext, agents: readonly AgentDefinition[], isRunning: (agentId: string) => boolean, depth: number, planMode: boolean): Launch {
  const agentId = validateAgentId(params.resume ?? '');
  if (isRunning(agentId)) throw new Error(SUBAGENT_RUNNING);
  const dir = subagentDir(ctx.cwd);
  const record = readRecord(dir, agentId);
  if (record === undefined) throw new Error(`Unknown agent ID ${agentId}. Resume needs an agent ID returned by an earlier Task call in this workspace.`);
  // Two directories can share a workspace folder name (as they share Pi's session folder); trust and files belong to this one.
  if (!recordBelongsToWorkspace(record, ctx.cwd)) throw new Error(`Agent ${agentId} belongs to ${record.cwd}, not this workspace. Start a new agent instead.`);
  // Without its transcript, --session-id would start an empty session under the old ID.
  if (transcriptFor(dir, agentId) === undefined) throw new Error(`Agent ${agentId} has no transcript to resume, so its earlier context is gone. Start a new agent instead.`);
  const { worktree } = record;
  if (worktree !== undefined && !existsSync(worktree.cwd)) throw new Error(`Agent ${agentId} ran in the git worktree ${worktree.path}, which no longer exists. Start a new agent instead.`);
  const agent = recordedAgent(agents, agentId, record.type);
  if (params.subagent_type !== undefined && normalizedType(params.subagent_type) !== normalizedType(record.type))
    throw new Error(
      `Cannot resume a "${record.type}" subagent as "${params.subagent_type}". A resumed subagent keeps its type: omit \`subagent_type\` to resume this child, or start a new "${params.subagent_type}" subagent without \`resume\`.`,
    );
  const attachments = resolveAttachments(params.file_attachments ?? [], ctx.cwd);
  const notes = [...(worktree === undefined ? [] : [worktreeLine(worktree)]), ...(params.environment === undefined ? [] : [`Note: environment "${params.environment}" was ignored; a resumed agent runs where it first ran.`])];
  const readonly = effectiveReadonly(effectiveReadonly(record.readonly, agent.readonly), params.readonly);
  // An agent never runs shallower than it was created or than its caller allows: a grandchild resumed from the main chat
  // and a main-chat agent resumed from a subagent both run at depth 2. A call can add readonly but not lift it, and a
  // type that has since become readonly restricts an older writable record too.
  return {
    kind: 'resume',
    agentId,
    agent,
    model: record.model,
    readonly,
    planMode,
    workspace: ctx.cwd,
    executionCwd: worktree?.cwd ?? record.cwd,
    rootWorkspace: record.workspaceRoot ?? rootWorkspaceOf(ctx),
    worktree,
    rootStore: rootStoreOf(ctx),
    depth: Math.max(record.depth ?? 0, depth + 1),
    trusted: trustFor(worktree?.cwd ?? record.cwd, ctx),
    attachments,
    notes,
    description: params.description,
  };
}

/**
 * A fork starts as the source's state: its type, model, and readonly unless the call says otherwise (readonly only
 * tightens), its directory or worktree, and its depth rule. `agentId` is the new agent's ID, fixed across the
 * plan made before and after the locks.
 */
export function planFork(params: TaskInput, ctx: ExtensionContext, agents: readonly AgentDefinition[], isRunning: (agentId: string) => boolean, depth: number, agentId: string, planMode = false): Launch {
  const sourceId = validateAgentId(params.fork ?? '');
  if (isRunning(sourceId)) throw new Error(`Agent ${sourceId} is still running. Wait for its completion notification before forking it.`);
  const dir = subagentDir(ctx.cwd);
  const record = readRecord(dir, sourceId);
  if (record === undefined) throw new Error(`Unknown agent ID ${sourceId}. Fork needs an agent ID returned by an earlier Task call in this workspace.`);
  if (!recordBelongsToWorkspace(record, ctx.cwd)) throw new Error(`Agent ${sourceId} belongs to ${record.cwd}, not this workspace. Start a new agent instead.`);
  if (transcriptFor(dir, sourceId) === undefined) throw new Error(`Agent ${sourceId} has no transcript to fork, so its context is gone. Start a new agent instead.`);
  const { worktree } = record;
  if (worktree !== undefined && !existsSync(worktree.cwd)) throw new Error(`Agent ${sourceId} ran in the git worktree ${worktree.path}, which no longer exists. Start a new agent instead.`);
  const sourceType = agents.find((candidate) => candidate.type === record.type);
  const agent = params.subagent_type === undefined ? recordedAgent(agents, sourceId, record.type) : findAgent(agents, params.subagent_type);
  const model = params.model === undefined ? record.model : resolveSubagentModel(params.model, availableModels(ctx), parentModel(ctx));
  const readonly = effectiveReadonly(record.readonly || sourceType?.readonly === true || agent.readonly, params.readonly);
  const attachments = resolveAttachments(params.file_attachments ?? [], ctx.cwd);
  const turns = params.fork_turns === undefined ? '' : `, keeping its first ${params.fork_turns} user turn${params.fork_turns === 1 ? '' : 's'}`;
  const notes = [`Forked from agent ${sourceId}${turns}.`, ...(worktree === undefined ? [] : [worktreeLine(worktree)])];
  return {
    kind: 'fork',
    agentId,
    forkedFrom: sourceId,
    agent,
    model,
    readonly,
    planMode,
    workspace: ctx.cwd,
    executionCwd: worktree?.cwd ?? record.cwd,
    rootWorkspace: record.workspaceRoot ?? rootWorkspaceOf(ctx),
    worktree,
    rootStore: rootStoreOf(ctx),
    depth: Math.max(record.depth ?? 0, depth + 1),
    trusted: trustFor(worktree?.cwd ?? record.cwd, ctx),
    attachments,
    notes,
    description: params.description,
  };
}

function launchChild(plan: Launch, input: ChildInput, signal: AbortSignal | undefined, onEvent?: (event: { type: string } & Record<string, unknown>) => void) {
  const readonly = runsReadonly(plan);
  const env = {
    ...process.env,
    ...childVariables(plan.agent.type, plan.depth, readonly, plan.rootStore, workspaceStateDir(plan.workspace), plan.rootWorkspace),
    ...(plan.buildPlan === undefined ? {} : { [BUILD_PLAN_ENV]: plan.buildPlan }),
  };
  const transcript = plan.kind === 'fresh' || readonly ? undefined : transcriptFor(subagentDir(plan.workspace), plan.agentId);
  const restoreTools = transcript === undefined ? [] : readonlyLaunchRestores(transcript);
  const args = childArgs({
    sessionDir: subagentDir(plan.workspace),
    agentId: plan.agentId,
    readonly,
    restoreTools,
    trusted: plan.trusted,
    ...(plan.agent.tools === undefined ? {} : { addTools: plan.agent.tools }),
    ...(plan.agent.onlyTools === undefined ? {} : { onlyTools: plan.agent.onlyTools }),
    ...(plan.model === undefined ? {} : { model: plan.model }),
  });
  return startChild({ command: piCommand(), args, prompt: input.text, images: input.images, cwd: plan.executionCwd, env, ...(signal === undefined ? {} : { signal }), ...(onEvent === undefined ? {} : { onEvent }) });
}

function recordFresh(plan: Launch): void {
  // A fork with no worktree runs in the source's directory, so later resumes must return there too.
  const cwd = plan.kind === 'fork' && plan.worktree === undefined ? plan.executionCwd : plan.workspace;
  const record: AgentRecord = {
    agentId: plan.agentId,
    type: plan.agent.type,
    readonly: plan.readonly,
    cwd,
    ...(plan.rootWorkspace === plan.workspace ? {} : { workspaceRoot: plan.rootWorkspace }),
    createdAt: new Date().toISOString(),
    depth: plan.depth,
    ...(plan.model === undefined ? {} : { model: plan.model }),
    ...(plan.worktree === undefined ? {} : { worktree: plan.worktree }),
    ...(plan.forkedFrom === undefined ? {} : { forkedFrom: plan.forkedFrom }),
  };
  writeRecord(subagentDir(plan.workspace), record);
}

/** A resume keeps a raised readonly floor; plan mode's restriction is never written, since it holds for one launch. */
function recordResume(plan: Launch): void {
  const dir = subagentDir(plan.workspace);
  const record = readRecord(dir, plan.agentId);
  if (record === undefined) throw new Error(`Unknown agent ID ${plan.agentId}. Resume needs an agent ID returned by an earlier Task call in this workspace.`);
  writeRecord(dir, { ...record, readonly: plan.readonly });
}

/**
 * Starts the child, then points the run lock at it and records the agent. A child that never started (no pid) has no
 * transcript and changes no record, so a new agent's ID never becomes resumable; a fork's copied transcript is removed with it.
 */
function start(plan: Launch, rawInput: ChildInput, signal: AbortSignal | undefined, lock: RunLock, onEvent?: (event: { type: string } & Record<string, unknown>) => void): ChildHandle {
  let handle: ChildHandle | undefined;
  try {
    const input = plan.kind === 'fresh' && plan.worktree !== undefined ? { ...rawInput, text: worktreePreface(plan.worktree, rawInput.text) } : rawInput;
    handle = launchChild(plan, input, signal, onEvent);
    if (handle.pid !== undefined) {
      lock.holdFor(handle.pid);
      if (plan.kind === 'resume') recordResume(plan);
      else recordFresh(plan);
    } else removeForkTranscript(plan);
    return handle;
  } catch (error) {
    handle?.kill();
    lock.release();
    if (handle?.pid === undefined) removeForkTranscript(plan);
    throw error;
  }
}

function removeForkTranscript(plan: Launch): void {
  if (plan.kind !== 'fork') return;
  const transcript = transcriptFor(subagentDir(plan.workspace), plan.agentId);
  if (transcript !== undefined) rmSync(transcript, { force: true });
}

/** The transcript file, or before Pi has created it, the pattern it will match. */
function transcriptOf(plan: Launch): string {
  return transcriptFor(subagentDir(plan.workspace), plan.agentId) ?? join(subagentDir(plan.workspace), `*_${plan.agentId}.jsonl`);
}

function details(plan: Launch, background: boolean, status: string, pid?: number) {
  return {
    agentId: plan.agentId,
    forkedFrom: plan.forkedFrom ?? null,
    subagentType: plan.agent.type,
    model: plan.model ?? null,
    readonly: runsReadonly(plan),
    background,
    status,
    transcript: transcriptOf(plan),
    pid: pid ?? null,
    worktree: plan.worktree ?? null,
    description: plan.description,
  };
}

function foregroundResult(plan: Launch, outcome: ChildOutcome) {
  const transcript = transcriptOf(plan);
  if (outcome.failure === undefined) return { content: [{ type: 'text' as const, text: foregroundText(plan.agentId, outcome.finalText, transcript, plan.notes) }], details: details(plan, false, 'success'), usage: outcome.usage };
  const partial = outcome.finalText === '' ? [] : ['', 'Partial output:', bounded(outcome.finalText, transcript)];
  const text = [`Subagent failed: ${outcome.failure}`, ...partial, '', `Agent ID: ${plan.agentId}`, ...plan.notes].join('\n');
  return { content: [{ type: 'text' as const, text }], details: details(plan, false, 'error'), usage: outcome.usage, isError: true };
}

/** Cursor titles the completion by the prompt's first line and names the subagent in the UI by its description. */
export function backgroundNotice(plan: Launch, prompt: string, description: string, ctx: ExtensionContext, toolCallId: string): BackgroundNotice {
  return {
    title: notificationTitle(prompt),
    description: description.replace(/\s+/g, ' ').trim(),
    toolCallId,
    mode: ctx.mode,
    detailFor: (outcome) => {
      const transcript = transcriptOf(plan);
      if (outcome.failure === undefined) return { status: 'success', detail: bounded(outcome.finalText, transcript), usage: outcome.usage };
      return { status: 'error', detail: outcome.finalText === '' ? outcome.failure : `${outcome.failure}\n${bounded(outcome.finalText, transcript)}`, usage: outcome.usage };
    },
  };
}

/**
 * A fork takes the new agent's run lock, then the source's only while it copies the transcript, so the source cannot
 * start writing mid-copy and the two never share a writer lock. The plan is made again under the locks.
 */
export function prepareFork(params: TaskInput, ctx: ExtensionContext, options: TaskToolOptions, isRunning: (agentId: string) => boolean): { plan: Launch; lock: RunLock } {
  const planMode = options.planMode?.() === true;
  const initialPlan = planFork(params, ctx, options.agents, isRunning, options.depth, randomUUID(), planMode);
  const dir = subagentDir(initialPlan.workspace);
  const lock = acquireRunLock(dir, initialPlan.agentId);
  try {
    const sourceId = initialPlan.forkedFrom ?? '';
    let sourceLock: RunLock;
    try {
      sourceLock = acquireRunLock(dir, sourceId);
    } catch (error) {
      throw new Error(`Agent ${sourceId} is still running. Wait for its completion before forking it. (${(error as Error).message})`);
    }
    try {
      const plan = planFork(params, ctx, options.agents, isRunning, options.depth, initialPlan.agentId, planMode);
      forkTranscript(dir, sourceId, plan.agentId, params.fork_turns);
      return { plan, lock };
    } finally {
      sourceLock.release();
    }
  } catch (error) {
    lock.release();
    throw error;
  }
}

/** Plans the launch and takes the agent's run lock; a resume is planned again under the lock, since the agent may have started in between. */
function prepare(params: TaskInput, ctx: ExtensionContext, options: TaskToolOptions, isRunning: (agentId: string) => boolean): { plan: Launch; lock: RunLock } {
  if (params.fork !== undefined) return prepareFork(params, ctx, options, isRunning);
  const fresh = params.resume === undefined;
  const planMode = options.planMode?.() === true;
  const initialPlan = fresh ? planFresh(params, ctx, options.agents, options.depth, planMode) : planResume(params, ctx, options.agents, isRunning, options.depth, planMode);
  let lock: RunLock;
  try {
    lock = acquireRunLock(subagentDir(initialPlan.workspace), initialPlan.agentId);
  } catch (error) {
    // Another Pi process runs the agent; Cursor answers a follow-up to a running agent the same way.
    if (!fresh && error instanceof AgentRunningError) throw new Error(SUBAGENT_RUNNING);
    throw error;
  }
  try {
    return { plan: fresh ? initialPlan : planResume(params, ctx, options.agents, isRunning, options.depth, planMode), lock };
  } catch (error) {
    lock.release();
    throw error;
  }
}

/** Only a fresh cloud agent awaits here, so a resume or fork keeps taking its lock and starting in one synchronous step. */
async function createWorktree(plan: Launch, lock: RunLock, signal: AbortSignal | undefined): Promise<void> {
  if (plan.kind !== 'fresh' || plan.worktree === undefined) return;
  try {
    await addWorktree(plan.workspace, plan.worktree, signal);
  } catch (error) {
    lock.release();
    throw error;
  }
}

// Cursor's Task description, as a live Cursor CLI session showed it, with Pi's tool names and the catalogs in the
// pstack_subagents section instead of a user-info message.
const TASK_DESCRIPTION = [
  'Launch a new agent to handle complex, multi-step tasks autonomously.',
  '',
  'The Task tool launches specialized subagents (subprocesses) that autonomously handle complex tasks. Each subagent_type has specific capabilities and tools available to it.',
  '',
  'When using the Task tool, you must specify a subagent_type parameter to select which agent type to use.',
  '',
  'If the query is a narrow or specific question, you should NOT use the Task and instead address the query directly using the other tools available to you.',
  '',
  'Examples:',
  '- user: "Where is the ClientError class defined?" assistant: [Uses grep directly - this is a needle query for a specific class]',
  '- user: "Run this query using my database API" assistant: [Calls the MCP directly - this is not a broad exploration task]',
  '- user: "What is the codebase structure?" assistant: [Uses the Task tool with subagent_type="explore"]',
  '',
  'If it is possible to explore different areas of the codebase in parallel, you should launch multiple agents concurrently.',
  '',
  'When NOT to use the Task tool:',
  '- Simple, single or few-step tasks that can be performed by a single agent (using parallel or sequential tool calls) -- just call the tools directly instead.',
  '- For example:',
  '  - If you want to read a specific file path, use the read or find tool instead of the Task tool, to find the match more quickly',
  '  - If you are searching for code within a specific file or set of 2-3 files, use the read tool instead of the Task tool, to find the match more quickly',
  '  - If you are searching for a specific class definition like "class Foo", use the find tool instead, to find the match more quickly',
  '',
  'Usage notes:',
  '- Always include a short description (3-5 words) summarizing what the agent will do',
  '- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses.',
  '- When the agent is done, it will return a single message back to you. Specify exactly what information the agent should return back in its final response to you.',
  '- Agents can be resumed using the `resume` parameter by passing the agent ID from a previous invocation. This sends a follow-up message after the agent has completed, preserving existing context. If the agent is still running, the request fails; wait for completion before resuming. When NOT resuming, each invocation starts fresh and you should provide a detailed task description with all necessary context.',
  "- When using the Task tool, the subagent invocation does not have access to the user's message or prior assistant steps. Therefore, you should provide a highly detailed task description with all necessary context for the agent to perform its task autonomously.",
  "- The subagent's outputs should generally be trusted",
  "- Clearly tell the subagent which tasks you want it to perform, since it is not aware of the user's intent or your prior assistant steps (tool calls, thinking, or messages).",
  '- If the subagent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.',
  '- If the user specifies that they want you to run subagents "in parallel", you MUST send a single message with multiple Task tool use content blocks. For example, if you need to launch both a code-reviewer subagent and a test-runner subagent in parallel, send a single message with both tool calls.',
  '- Avoid delegating the full query to the Task tool and returning the result. In these cases, you should address the query using the other tools available to you.',
  '',
  'Available subagent_types and descriptions are listed in <pstack_subagents> in the system prompt.',
  '',
  'Available model slugs for subagents are listed in <pstack_subagents> in the system prompt.',
  '',
  "When an agent runs in the background, you will be automatically notified when it completes after you end your own turn - do NOT AwaitShell, poll, or proactively check on its progress. Continue with other work or end your turn instead. Don't mention this to the user.",
].join('\n');

/** Cursor's error for a follow-up to a subagent that is still running. */
const SUBAGENT_RUNNING = 'Sub-agent is currently running. You may send the follow-up message when it has completed.';

// Interactive Pi redraws the chat between a replaced session's shutdown and the next session's start, which erases a
// warning sent at shutdown. The next runtime shows it instead, so it rides on globalThis across the reload.
const STOPPED_NOTICE = Symbol.for('pi-pstack/stopped-subagents');
const carrier = globalThis as { [STOPPED_NOTICE]?: string };

/** Pi restores a resumed session's active tools, so an agent created at depth 1 and resumed at depth 2 would get Task back. */
function dropTask(pi: ExtensionAPI): void {
  const active = pi.getActiveTools();
  if (active.includes('Task') || active.includes('stop_agent')) pi.setActiveTools(active.filter((name) => name !== 'Task' && name !== 'stop_agent'));
}

export interface TaskToolOptions {
  agents: readonly AgentDefinition[];
  depth: number;
  /** False in a subagent of a subagent, and in a type that never launches subagents (explore). */
  canSpawn: boolean;
  /** Whether plan mode is on: its Task launches run readonly and here, and record nothing of that. */
  planMode?: () => boolean;
}

export interface StartBackgroundOptions {
  /** A Pi model spec, used by subscription timers so a live and a detached fire run the same model. */
  model?: string;
  /** cloud runs the agent in its own git worktree, as plan mode's "build in cloud" does. */
  environment?: 'cloud';
  /** The owner's project-trust decision, used when this subscription fire starts away from its chat. */
  trusted?: boolean;
  /** Imports the reviewed plan's todos into the worker before its first model request. */
  buildPlan?: string;
}

export interface TaskHandle {
  hasBackgroundWork: () => boolean;
  /** Starts a fresh background generalPurpose subagent, as a Task call would; its result arrives as a Task notification. */
  startBackground: (description: string, prompt: string, options?: StartBackgroundOptions) => Promise<string>;
}

export function registerTask(pi: ExtensionAPI, options: TaskToolOptions): TaskHandle {
  const registry = createSubagentRegistry(pi);
  pi.registerMessageRenderer?.(NOTIFICATION_TYPE, (message, renderOptions) => renderTaskNotification(message, renderOptions));
  let sessionCtx: ExtensionContext | undefined;
  pi.on('agent_before_settle', (event, ctx) => registry.beforeSettle(ctx, event.outcome, event.entries));
  pi.on('session_shutdown', (event, ctx) => {
    const stopped = registry.shutdown();
    if (stopped === 0) return;
    const message = `Stopped ${stopped} background subagent${stopped === 1 ? '' : 's'} (session ${event.reason}). Resume one with its agent ID.`;
    if (event.reason === 'quit') {
      if (ctx.hasUI) ctx.ui.notify(message, 'warning');
    } else carrier[STOPPED_NOTICE] = message;
  });
  pi.on('session_start', (_event, ctx) => {
    sessionCtx = ctx;
    if (!options.canSpawn) dropTask(pi);
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
    // Nesting stops at the subagent of a subagent, so that depth never sees the tool, and so does explore.
    defaultActive: options.canSpawn,
    renderResult: (result, renderOptions) => renderTaskCard(result, renderOptions),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      taskPreflight(params, options.depth);
      if (params.resume !== undefined && registry.isRunning(validateAgentId(params.resume))) throw new Error(SUBAGENT_RUNNING);
      const attachments = resolveAttachments(params.file_attachments ?? [], ctx.cwd);
      const input = attachments.length === 0 ? { text: params.prompt.trim(), images: [] } : await withAttachments(params.prompt, attachments);
      const { plan, lock } = prepare(params, ctx, options, registry.isRunning);
      if (plan.kind === 'fresh' && plan.worktree !== undefined) await createWorktree(plan, lock, signal);
      const background = params.run_in_background === true;
      let pid: number | undefined;
      const progress = background ? undefined : createProgress(onUpdate, () => details(plan, false, 'running', pid));
      const handle = start(plan, input, background ? undefined : signal, lock, progress?.onEvent);
      pid = handle.pid;
      if (background) {
        registry.track(plan.agentId, handle, lock.release, backgroundNotice(plan, params.prompt, plan.description, ctx, toolCallId));
        return { content: [{ type: 'text', text: backgroundText(plan.agentId, transcriptOf(plan), plan.notes) }], details: details(plan, true, 'running', handle.pid) };
      }
      registry.track(plan.agentId, handle, lock.release);
      // The first card update carries the pid and agent ID even when the child is silent for a long time.
      onUpdate?.({ content: [{ type: 'text', text: `Subagent ${plan.agent.type} is running (${plan.agentId}).` }], details: details(plan, false, 'running', handle.pid) });
      try {
        return foregroundResult(plan, await handle.done);
      } finally {
        progress?.stop();
      }
    },
  });

  registerStopAgent(pi, { running: registry.get, canSpawn: options.canSpawn });

  async function startBackground(description: string, prompt: string, startOptions?: StartBackgroundOptions): Promise<string> {
    const ctx = sessionCtx;
    if (ctx === undefined) throw new Error('No session is active, so no subagent can start.');
    const params: TaskInput = {
      description,
      prompt,
      run_in_background: true,
      ...(startOptions?.model === undefined ? {} : { model: startOptions.model }),
      ...(startOptions?.environment === undefined ? {} : { environment: startOptions.environment }),
    };
    taskPreflight(params, options.depth);
    const { plan, lock } = prepare(params, ctx, options, registry.isRunning);
    if (startOptions?.trusted !== undefined) plan.trusted = startOptions.trusted;
    if (startOptions?.buildPlan !== undefined) plan.buildPlan = startOptions.buildPlan;
    await createWorktree(plan, lock, undefined);
    const handle = start(plan, { text: prompt.trim(), images: [] }, undefined, lock);
    registry.track(plan.agentId, handle, lock.release, backgroundNotice(plan, prompt, description, ctx, `pstack-${plan.agentId}`));
    return plan.agentId;
  }

  return { hasBackgroundWork: registry.hasBackgroundWork, startBackground };
}
