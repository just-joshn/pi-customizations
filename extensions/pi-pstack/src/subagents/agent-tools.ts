import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { launchSignal } from '../worker-control.ts';
import type { AgentNode } from './agent-node.ts';
import { viewOf } from './agent-records.ts';
import { subagentNamespace, toolHeader } from './delegation-guidance.ts';
import type { SubagentFactory } from './factory.ts';
import type { SubagentScheduler } from './scheduler.ts';
import {
  backgroundStartedText,
  boundedForModel,
  listAgentsText,
  listAgentsTooManyText,
  maxListedAgents,
  movedToBackgroundText,
  promptDetail,
  readAgentText,
  readWaitDefaultSeconds,
  readWaitMaxSeconds,
  syncResultText,
  writeAgentSentText,
} from './tool-results.ts';

const Tier = Type.Union([Type.Literal('inherit'), Type.Literal('default'), Type.Literal('long_context')], { description: 'Context window tier for the agent. Leave unset unless the user asks for one.' });

export const TaskSchema = Type.Object(
  {
    agent_type: Type.String({ description: 'The type of agent to launch. Use one of the available agent types listed in this tool description.' }),
    name: Type.String({ minLength: 1, description: 'A short name for the agent, shown in the task list and in notifications.' }),
    description: Type.String({ description: 'A short (3-5 word) description of the task' }),
    prompt: Type.String({ description: 'The complete task for the agent. It starts with no knowledge of your conversation, so include every detail it needs.' }),
    mode: Type.Optional(Type.Union([Type.Literal('sync'), Type.Literal('background')], { description: 'sync (default) waits for the result. background returns an agent_id at once and notifies you when the agent finishes.' })),
    model: Type.Optional(Type.String({ description: 'Optional model override. Leave unset unless the user or persistent instructions require an explicit model.' })),
    context_tier: Type.Optional(Tier),
  },
  { additionalProperties: false },
);
export const ReadAgentSchema = Type.Object(
  {
    agent_id: Type.String({ description: 'The agent_id returned when the agent was started.' }),
    wait: Type.Optional(Type.Boolean({ description: 'Wait for a running agent to finish its turn before returning. Default false.' })),
    timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: readWaitMaxSeconds, description: `Seconds to wait when wait is true. Default ${readWaitDefaultSeconds}, maximum ${readWaitMaxSeconds}.` })),
    since_turn: Type.Optional(Type.Integer({ minimum: 0, description: 'Return only the responses from this turn onward (inclusive).' })),
  },
  { additionalProperties: false },
);
export const WriteAgentSchema = Type.Object(
  { agent_id: Type.String({ description: 'The agent_id of a background agent that is running or idle.' }), message: Type.String({ description: 'The follow-up message for the same task.' }) },
  { additionalProperties: false },
);
export const ListAgentsSchema = Type.Object(
  {
    scope: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('all')], { description: 'active (default) lists running and idle agents. all includes finished ones.' })),
    agent_ids: Type.Optional(Type.Array(Type.String(), { description: 'List exactly these agents instead of a scope.' })),
  },
  { additionalProperties: false },
);

const AgentDetailsSchema = Type.Object({ agent_id: Type.String(), agent_type: Type.String(), status: Type.String(), mode: Type.String(), detailedContent: Type.Optional(Type.String()) });
const AgentListSchema = Type.Object({ agents: Type.Array(AgentDetailsSchema) });
type AgentDetails = Static<typeof AgentDetailsSchema>;

/** `structuredContent` repeats `details` because `outputSchema` promises it. */
function wrap<T extends AgentDetails | Static<typeof AgentListSchema>>(text: string, details: T, usage?: AgentNode['usage']): AgentToolResult<T> {
  return { content: [{ type: 'text', text }], details, structuredContent: details, ...(usage ? { usage } : {}) };
}

function detailsOf(node: AgentNode, detailedContent?: string): AgentDetails {
  return { agent_id: node.id, agent_type: node.agentType, status: node.status, mode: node.mode, ...(detailedContent !== undefined ? { detailedContent } : {}) };
}

export function taskTool(factory: SubagentFactory, scheduler: SubagentScheduler, description: string): ToolDefinition<typeof TaskSchema, AgentDetails> {
  return {
    name: 'task',
    label: 'Task',
    description,
    promptSnippet: toolHeader,
    parameters: TaskSchema,
    outputSchema: AgentDetailsSchema,
    exposure: 'model-only',
    namespace: subagentNamespace,
    executionMode: 'sequential',
    annotations: { openWorldHint: true },
    execute: async (id, call, signal, _onUpdate, ctx) => {
      launchSignal(signal, call.mode === 'background');
      const { launched, node } = await factory.create(call, id, signal, ctx);
      if (call.mode === 'background') return wrap(backgroundStartedText(node.id), detailsOf(node, promptDetail(node.agentType, node.id, call.prompt)));
      const outcome = await Promise.race([launched.settled.then((settled) => ({ settled })), launched.promoted.then(() => ({ settled: undefined }))]);
      if (outcome.settled === undefined) return wrap(movedToBackgroundText(node.id), detailsOf(scheduler.get(node.id)));
      return syncResult(outcome.settled);
    },
  };
}

function syncResult(node: AgentNode): AgentToolResult<AgentDetails> {
  if (node.status === 'failed') throw new Error(node.error ?? 'The agent failed.');
  if (node.status === 'cancelled') return wrap('Agent was cancelled.', detailsOf(node), node.usage);
  const reply = node.turns.at(-1) ?? '';
  return wrap(boundedForModel(syncResultText(reply), node.sessionFile), detailsOf(node, reply), node.usage);
}

export function readAgentTool(scheduler: SubagentScheduler): ToolDefinition<typeof ReadAgentSchema, AgentDetails> {
  return {
    name: 'read_agent',
    label: 'Read agent',
    description: 'Read the status and responses of a background agent. Use wait to block until its current turn ends. Use since_turn to read only new responses.',
    promptSnippet: 'Read a background agent',
    parameters: ReadAgentSchema,
    outputSchema: AgentDetailsSchema,
    exposure: 'direct',
    namespace: subagentNamespace,
    executionMode: 'sequential',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    execute: async (_id, input, signal) => {
      const node = await scheduler.read(input.agent_id, { wait: input.wait ?? false, timeoutSeconds: input.timeout ?? readWaitDefaultSeconds }, signal);
      return wrap(boundedForModel(readAgentText(viewOf(node, Date.now()), input.since_turn ?? 0), node.sessionFile), detailsOf(node));
    },
  };
}

export function writeAgentTool(scheduler: SubagentScheduler): ToolDefinition<typeof WriteAgentSchema, AgentDetails> {
  return {
    name: 'write_agent',
    label: 'Write agent',
    description: 'Send a follow-up message to a background agent that is running or idle. Use it only for follow-ups on the same task.',
    promptSnippet: 'Send a follow-up to a background agent',
    parameters: WriteAgentSchema,
    outputSchema: AgentDetailsSchema,
    exposure: 'direct',
    namespace: subagentNamespace,
    executionMode: 'sequential',
    annotations: { openWorldHint: false },
    execute: async (_id, input, _signal, _update, ctx) => {
      const before = scheduler.get(input.agent_id);
      const node = await scheduler.write(input.agent_id, input.message, ctx);
      return wrap(writeAgentSentText({ id: node.id, status: before.status }), detailsOf(node));
    },
  };
}

export function listAgentsTool(scheduler: SubagentScheduler): ToolDefinition<typeof ListAgentsSchema, Static<typeof AgentListSchema>> {
  return {
    name: 'list_agents',
    label: 'List agents',
    description: 'List the agents started in this session with their status. Pass agent_ids for an explicit list.',
    promptSnippet: 'List started agents',
    parameters: ListAgentsSchema,
    outputSchema: AgentListSchema,
    exposure: 'direct',
    namespace: subagentNamespace,
    executionMode: 'parallel',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    execute: async (_id, input) => {
      const all = scheduler.list();
      const chosen = input.agent_ids ? all.filter((node) => input.agent_ids?.includes(node.id)) : all.filter((node) => input.scope === 'all' || node.status === 'running' || node.status === 'idle');
      if (!input.agent_ids && chosen.length > maxListedAgents) throw new Error(listAgentsTooManyText(chosen.length));
      return wrap(listAgentsText(chosen.map((node) => viewOf(node, Date.now()))), { agents: chosen.map((node) => detailsOf(node)) });
    },
  };
}
