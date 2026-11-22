import type { AgentToolUpdateCallback } from '@earendil-works/pi-agent-core';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { resolveSubagentDefinition } from './discovery.ts';
import { awaitBackgroundSubagent, type RunnerCallbacks, runSubagentTask } from './runner.ts';
import { type AwaitSubagentDetails, AwaitSubagentInputSchema, DEFAULT_AWAIT_TIMEOUT_MS, type NestedScope, SUBAGENT_TOOL_NAMES, type SubagentDefinition, type TaskToolDetails, TaskToolInputSchema } from './types.ts';
import { renderTaskCall, renderTaskResult } from './ui-renderers.ts';

export interface SubagentToolCallbacks extends RunnerCallbacks {
  readonly getDefinitions: (cwd: string) => readonly SubagentDefinition[];
  /** Present only for nested child sessions; limits await/resume to runs this scope launched. */
  readonly scope?: NestedScope;
}

const TaskToolParams = Type.Object({
  description: Type.String({ description: 'A short (3-5 word) description of the task' }),
  prompt: Type.Optional(Type.String({ description: 'The task for the subagent to perform' })),
  subagent_type: Type.Optional(Type.String({ description: 'Subagent type to use (general-purpose, explore, shell, debug, or a custom agent name)' })),
  model: Type.Optional(Type.String({ description: 'Optional model override ("inherit", "fast", or explicit model id)' })),
  readonly: Type.Optional(Type.Boolean({ description: 'Run subagent in read-only mode, restricting file writes, deletes, mutating shell commands, and MCP tools' })),
  resume: Type.Optional(Type.String({ description: 'Optional subagent agent_id to resume from a previous invocation' })),
  run_in_background: Type.Optional(Type.Boolean({ description: 'Run the subagent asynchronously in the background and return immediately with agent_id' })),
});

const AwaitSubagentParams = Type.Object({
  agent_id: Type.String({ description: 'The background subagent agent_id to wait on' }),
  timeout_ms: Type.Optional(Type.Number({ description: 'Maximum time in milliseconds to wait before returning still_running' })),
});

function formatTaskResultText(details: TaskToolDetails): string {
  if (details.isBackground && details.status === 'running') {
    const transcriptLine = details.transcriptPath ? `\ntranscript_path: ${details.transcriptPath}` : '';
    return `Subagent launched in background.\nagent_id: ${details.agentId}\nsubagent_type: ${details.subagentType}${transcriptLine}\nYou will be notified when it finishes, or call await_subagent with agent_id="${details.agentId}".`;
  }
  if (details.status === 'error' || details.status === 'cancelled') {
    return `Subagent ${details.status} (agent_id: ${details.agentId}): ${details.error || 'Unknown error'}`;
  }
  const output = details.finalMessage?.trim() || '(no output)';
  return `${output}\n\n[subagent metadata] agent_id: ${details.agentId} | subagent_type: ${details.subagentType} | tool_calls: ${details.toolCallCount}`;
}

function formatAwaitResultText(details: AwaitSubagentDetails): string {
  if (details.outcome === 'complete') {
    const body = details.finalMessage?.trim() || '(no output)';
    return `Background subagent ${details.agentId} completed.\n\n${body}`;
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

function registerTaskTool(pi: ExtensionAPI, callbacks: SubagentToolCallbacks): void {
  pi.registerTool<typeof TaskToolParams, TaskToolDetails>({
    name: SUBAGENT_TOOL_NAMES.task,
    label: 'Task',
    description:
      'Launch a new isolated subagent (or resume an existing one) to handle complex, multi-step, or independent tasks. Supports built-in types (general-purpose, explore, shell, debug), custom agents, read-only enforcement, and background execution.',
    promptSnippet: 'Delegate isolated tasks to specialized subagents (foreground or background, with resume support)',
    parameters: TaskToolParams,
    async execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      const parsed = TaskToolInputSchema.parse(params);
      const definitions = callbacks.getDefinitions(ctx.cwd);
      const definition = resolveSubagentDefinition(definitions, parsed.subagent_type);
      if (!definition) {
        const available = definitions.map((d) => d.name).join(', ');
        throw new Error(`Unknown subagent_type "${parsed.subagent_type ?? ''}". Available subagents: ${available}`);
      }
      const resumeId = parsed.resume?.trim();
      if (callbacks.scope && resumeId && !callbacks.scope.agentIds.has(resumeId)) {
        throw new Error(`Cannot resume subagent ${resumeId}: it was not launched by this agent.`);
      }
      const forwardUpdate = createUpdateForwarder(onUpdate);
      const runOpts = {
        toolCallId,
        input: parsed,
        definition,
        ctx,
        createNestedExtension: (scope: NestedScope) => (child: ExtensionAPI) => {
          registerSubagentTools(child, { ...callbacks, store: { ...callbacks.store, enqueueWakeup: () => false }, scope });
        },
        ...(signal ? { signal } : {}),
        ...(callbacks.scope ? { scope: callbacks.scope } : {}),
        ...(forwardUpdate ? { onUpdate: forwardUpdate } : {}),
      };
      const details = await runSubagentTask(runOpts, callbacks);
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

function registerAwaitTool(pi: ExtensionAPI, callbacks: SubagentToolCallbacks): void {
  pi.registerTool<typeof AwaitSubagentParams, AwaitSubagentDetails>({
    name: SUBAGENT_TOOL_NAMES.awaitSubagent,
    label: 'Await Subagent',
    description: 'Wait for a background subagent to complete (up to timeout_ms) and retrieve its final output.',
    promptSnippet: 'Wait for a background subagent by agent_id and retrieve its result',
    parameters: AwaitSubagentParams,
    async execute(_toolCallId, params, signal) {
      const parsed = AwaitSubagentInputSchema.parse(params);
      const timeoutMs = parsed.timeout_ms ?? DEFAULT_AWAIT_TIMEOUT_MS;
      const result: Awaited<ReturnType<typeof awaitBackgroundSubagent>> =
        callbacks.scope && !callbacks.scope.agentIds.has(parsed.agent_id)
          ? { outcome: 'not_found', error: `No background subagent found for id: ${parsed.agent_id}` }
          : await awaitBackgroundSubagent(parsed.agent_id, callbacks.store, timeoutMs, signal);
      const details: AwaitSubagentDetails = {
        agentId: parsed.agent_id,
        outcome: result.outcome,
        ...(result.record ? { toolCallCount: result.record.toolCallCount } : {}),
        ...(result.record?.lastMessage ? { finalMessage: result.record.lastMessage } : {}),
        ...(result.record?.transcriptPath ? { transcriptPath: result.record.transcriptPath } : {}),
        ...(result.error ? { error: result.error } : {}),
      };
      return { content: [{ type: 'text', text: formatAwaitResultText(details) }], details };
    },
  });
}

export function registerSubagentTools(pi: ExtensionAPI, callbacks: SubagentToolCallbacks): void {
  registerTaskTool(pi, callbacks);
  registerAwaitTool(pi, callbacks);
}
