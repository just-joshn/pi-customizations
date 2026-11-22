import type { AgentToolUpdateCallback } from '@earendil-works/pi-agent-core';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { resolveSubagentDefinition, selectSubagentType } from './discovery.ts';
import { SubagentRunError } from './failures.ts';
import { awaitBackgroundSubagent, type RunnerCallbacks, runSubagentTask } from './runner.ts';
import {
  type AwaitSubagentDetails,
  AwaitSubagentInputSchema,
  DEFAULT_AWAIT_TIMEOUT_MS,
  type NestedScope,
  ONE,
  SUBAGENT_TOOL_NAMES,
  type SubagentDefinition,
  type SubagentSessionRecord,
  type TaskToolDetails,
  TaskToolInputSchema,
  ZERO,
} from './types.ts';
import { renderTaskCall, renderTaskResult } from './ui-renderers.ts';

export interface SubagentToolCallbacks extends RunnerCallbacks {
  readonly getDefinitions: (ctx: ExtensionContext) => readonly SubagentDefinition[];
  readonly scope?: NestedScope;
}

const TaskToolParams = Type.Object({
  description: Type.String({ description: 'A short (3-5 word) description of the task, also used to pick a subagent when subagent_type is omitted' }),
  prompt: Type.Optional(Type.String({ description: 'The task for the subagent to perform' })),
  subagent_type: Type.Optional(Type.String({ description: 'Subagent name from the available list. Omit to let the harness pick from the task description.' })),
  model: Type.Optional(Type.String({ description: 'Optional model override ("inherit", "fast", or an explicit provider/model id)' })),
  thinking: Type.Optional(Type.String({ description: 'Optional thinking level: off, minimal, low, medium, high, xhigh, or max' })),
  readonly: Type.Optional(Type.Boolean({ description: 'Run the subagent read-only, blocking writes, deletes, mutating shell commands, and MCP tools' })),
  resume: Type.Optional(Type.String({ description: 'Resume a previous subagent by agent_id' })),
  run_in_background: Type.Optional(Type.Boolean({ description: 'Run asynchronously and return immediately with agent_id' })),
  max_attempts: Type.Optional(Type.Number({ description: 'Total attempts before giving up (1-10). Retries run the same prompt in a fresh session.' })),
  worktree: Type.Optional(Type.Boolean({ description: 'Run in an isolated git worktree on its own branch so concurrent edits do not collide' })),
});

const AwaitSubagentParams = Type.Object({
  agent_id: Type.String({ description: 'The background subagent agent_id to wait on' }),
  timeout_ms: Type.Optional(Type.Number({ description: 'Maximum time in milliseconds to wait before returning still_running' })),
});

function formatWorktreeLines(details: TaskToolDetails): string {
  if (details.worktreePath === undefined) {
    return '';
  }
  const summary = details.worktreeSummary && details.worktreeSummary.trim().length > ZERO ? `\n\n${details.worktreeSummary}` : '';
  return `\nworktree_path: ${details.worktreePath}\nbranch: ${details.branch ?? '(unknown)'}${summary}`;
}

function formatAttemptsLine(details: TaskToolDetails): string {
  return details.attempts > ONE ? ` | attempts: ${details.attempts}/${details.maxAttempts}` : '';
}

export function formatTaskResultText(details: TaskToolDetails): string {
  if (details.isBackground && details.status === 'running') {
    const transcriptLine = details.transcriptPath ? `\ntranscript_path: ${details.transcriptPath}` : '';
    const worktreeLine = details.worktreePath ? `\nworktree_path: ${details.worktreePath}\nbranch: ${details.branch ?? '(unknown)'}` : '';
    return `Subagent launched in background.\nagent_id: ${details.agentId}\nsubagent_type: ${details.subagentType}${transcriptLine}${worktreeLine}\nYou will be notified when it finishes, or call await_subagent with agent_id="${details.agentId}".`;
  }
  if (details.status === 'error' || details.status === 'cancelled') {
    const idPart = details.failureId ? ` | failure_id: ${details.failureId}` : '';
    const codePart = details.errorCode ? ` | code: ${details.errorCode}` : '';
    return `Subagent ${details.status} (agent_id: ${details.agentId}${idPart}${codePart}): ${details.error || 'Unknown error'}${formatAttemptsLine(details)}${formatWorktreeLines(details)}`;
  }
  const output = details.finalMessage?.trim() || '(no output)';
  const checkpointPart = details.checkpoints > ZERO ? ` | checkpoints: ${details.checkpoints}` : '';
  return `${output}\n\n[subagent metadata] agent_id: ${details.agentId} | subagent_type: ${details.subagentType} | tool_calls: ${details.toolCallCount}${checkpointPart}${formatAttemptsLine(details)}${formatWorktreeLines(details)}`;
}

export function formatAwaitResultText(details: AwaitSubagentDetails): string {
  if (details.outcome === 'complete') {
    const body = details.finalMessage?.trim() ?? '';
    const shownBody = body.length > ZERO ? body : details.error === undefined ? '(no output)' : '';
    const errorLine = details.error ? `${shownBody.length > ZERO ? '\n' : ''}${details.error}` : '';
    const failure = details.failureId ? `\nfailure_id: ${details.failureId}` : '';
    const summary = details.worktreeSummary && details.worktreeSummary.trim().length > ZERO ? `\n\n${details.worktreeSummary}` : '';
    const worktree = details.worktreePath === undefined ? '' : `\nworktree_path: ${details.worktreePath}\nbranch: ${details.branch ?? '(unknown)'}${summary}`;
    return `Background subagent ${details.agentId} finished with status ${details.status ?? 'success'}.\n\n${shownBody}${errorLine}${failure}${worktree}`;
  }
  if (details.outcome === 'still_running') {
    const transcript = details.transcriptPath ? ` (transcript: ${details.transcriptPath})` : '';
    return `Background subagent ${details.agentId} is still running${transcript}.`;
  }
  return details.error || `Subagent await returned ${details.outcome} for ${details.agentId}.`;
}

function createUpdateForwarder(onUpdate: AgentToolUpdateCallback<TaskToolDetails> | undefined): ((partial: TaskToolDetails) => void) | undefined {
  if (!onUpdate) {
    return undefined;
  }
  return (partial) => {
    onUpdate({ content: [{ type: 'text', text: partial.streamingText || partial.currentStep || 'Working…' }], details: partial });
  };
}

function resolveDefinitionOrThrow(definitions: readonly SubagentDefinition[], params: { readonly subagent_type?: string | undefined; readonly description: string; readonly prompt: string | undefined }): SubagentDefinition {
  const selected = selectSubagentType(definitions, { subagentType: params.subagent_type, description: params.description, prompt: params.prompt ?? '' });
  const definition = resolveSubagentDefinition(definitions, selected);
  if (!definition) {
    const available = definitions.map((candidate) => candidate.name).join(', ');
    throw new SubagentRunError('type-unknown', `"${selected}". Available subagents: ${available}`);
  }
  return definition;
}

function registerTaskTool(pi: ExtensionAPI, callbacks: SubagentToolCallbacks): void {
  pi.registerTool<typeof TaskToolParams, TaskToolDetails>({
    name: SUBAGENT_TOOL_NAMES.task,
    label: 'Task',
    description:
      'Launch a new isolated subagent, or resume one, to handle complex, multi-step, or independent work. Omit subagent_type to let the harness pick from the task description. Supports built-in types (general-purpose, explore, shell, debug, browser), custom agents, read-only enforcement, git worktree isolation, retries, and background execution.',
    promptSnippet: 'Delegate isolated tasks to specialized subagents (foreground or background, with resume, retry, and worktree support)',
    promptGuidelines: [
      'Use task with run_in_background: true for independent work that should not block the current turn, then await_subagent with its agent_id.',
      'Use task with worktree: true when two subagents may edit the same repository at once.',
      'Use task with resume to continue a subagent, and max_attempts above 1 to retry a failing subagent.',
      'Omit task subagent_type when the task description already names the work, so the harness can pick the matching subagent.',
    ],
    parameters: TaskToolParams,
    async execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      const parsed = TaskToolInputSchema.parse(params);
      const definitions = callbacks.getDefinitions(ctx);
      const definition = resolveDefinitionOrThrow(definitions, parsed);
      const resumeId = parsed.resume?.trim();
      if (callbacks.scope && resumeId && !callbacks.scope.agentIds.has(resumeId)) {
        throw new SubagentRunError('resume-not-owned', resumeId);
      }
      const forwardUpdate = createUpdateForwarder(onUpdate);
      const runOptions = {
        toolCallId,
        input: parsed,
        definition,
        ctx,
        createNestedExtension: (scope: NestedScope) => (child: ExtensionAPI) => {
          registerSubagentTools(child, { ...callbacks, store: { ...callbacks.store, enqueueWakeup: () => false }, scope, getParentActiveTools: () => child.getActiveTools?.() ?? [] });
        },
        ...(signal ? { signal } : {}),
        ...(callbacks.scope ? { scope: callbacks.scope } : {}),
        ...(forwardUpdate ? { onUpdate: forwardUpdate } : {}),
      };
      const details = await runSubagentTask(runOptions, callbacks);
      return { content: [{ type: 'text', text: formatTaskResultText(details) }], details };
    },
    renderCall(args, theme) {
      return renderTaskCall(args, theme);
    },
    renderResult(result, options, theme) {
      return renderTaskResult(result, options, theme);
    },
  });
}

function toAwaitDetails(agentId: string, result: Awaited<ReturnType<typeof awaitBackgroundSubagent>>): AwaitSubagentDetails {
  const record: SubagentSessionRecord | undefined = result.record;
  const error = result.error ?? record?.error;
  return {
    agentId,
    outcome: result.outcome,
    ...(record ? { toolCallCount: record.toolCallCount, status: record.status } : {}),
    ...(record?.lastMessage ? { finalMessage: record.lastMessage } : {}),
    ...(record?.transcriptPath ? { transcriptPath: record.transcriptPath } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(record?.failureId ? { failureId: record.failureId } : {}),
    ...(record?.worktree ? { worktreePath: record.worktree.path, branch: record.worktree.branch } : {}),
    ...(record?.worktreeSummary !== undefined ? { worktreeSummary: record.worktreeSummary } : {}),
  };
}

function registerAwaitTool(pi: ExtensionAPI, callbacks: SubagentToolCallbacks): void {
  pi.registerTool<typeof AwaitSubagentParams, AwaitSubagentDetails>({
    name: SUBAGENT_TOOL_NAMES.awaitSubagent,
    label: 'Await Subagent',
    description: 'Wait for a background subagent to finish (up to timeout_ms) and retrieve its final output and status.',
    promptSnippet: 'Wait for a background subagent by agent_id and retrieve its result',
    parameters: AwaitSubagentParams,
    async execute(_toolCallId, params, signal) {
      const parsed = AwaitSubagentInputSchema.parse(params);
      const timeoutMs = parsed.timeout_ms ?? DEFAULT_AWAIT_TIMEOUT_MS;
      const result =
        callbacks.scope && !callbacks.scope.agentIds.has(parsed.agent_id)
          ? { outcome: 'not_found' as const, error: `No background subagent found for id: ${parsed.agent_id}` }
          : await awaitBackgroundSubagent(parsed.agent_id, callbacks.store, timeoutMs, signal);
      const details = toAwaitDetails(parsed.agent_id, result);
      return { content: [{ type: 'text', text: formatAwaitResultText(details) }], details };
    },
  });
}

export function registerSubagentTools(pi: ExtensionAPI, callbacks: SubagentToolCallbacks): void {
  registerTaskTool(pi, callbacks);
  registerAwaitTool(pi, callbacks);
}
