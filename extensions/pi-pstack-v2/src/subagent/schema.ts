import { StringEnum } from '@earendil-works/pi-ai';
import { type Static, Type } from 'typebox';
import { z } from 'zod';
import type { AgentScope } from './agents.ts';

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
type ThinkingLevelName = (typeof THINKING_LEVELS)[number];
const ModelParam = Type.Optional(Type.String({ description: 'Model as provider/id. Overrides the agent and session model.' }));
const ThinkingParam = Type.Optional(StringEnum(THINKING_LEVELS, { description: 'Thinking level. Defaults to the session level unless a model is named.' }));

const TaskItem = Type.Object({
  agent: Type.String({ description: 'Name of the agent to invoke' }),
  task: Type.String({ description: 'Task to delegate to the agent' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process' })),
  model: ModelParam,
  thinking: ThinkingParam,
});

const ChainItem = Type.Object({
  agent: Type.String({ description: 'Name of the agent to invoke' }),
  task: Type.String({ description: 'Task with optional {previous} placeholder for prior output' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process' })),
  model: ModelParam,
  thinking: ThinkingParam,
});

const AgentScopeSchema = StringEnum(['user', 'project', 'both'] as const, {
  description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
  default: 'user',
});

export const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: 'Name of the agent to invoke (for single mode)' })),
  task: Type.Optional(Type.String({ description: 'Task to delegate (for single mode)' })),
  tasks: Type.Optional(Type.Array(TaskItem, { description: 'Array of {agent, task} for parallel execution' })),
  chain: Type.Optional(Type.Array(ChainItem, { description: 'Array of {agent, task} for sequential execution' })),
  agentScope: Type.Optional(AgentScopeSchema),
  confirmProjectAgents: Type.Optional(Type.Boolean({ description: 'Prompt before running project-local agents. Default: true.', default: true })),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process (single mode)' })),
  model: ModelParam,
  thinking: ThinkingParam,
});

export type SubagentParamsType = Static<typeof SubagentParams>;
// StringEnum types its fields as unknown, so the parsed shape names them.
export type ParsedSubagentParams = Omit<SubagentParamsType, 'agentScope' | 'thinking' | 'tasks' | 'chain'> & {
  agentScope?: AgentScope | undefined;
  thinking?: ThinkingLevelName | undefined;
  tasks?: WorkItem[] | undefined;
  chain?: WorkItem[] | undefined;
};

const ThinkingSchema = z.enum(THINKING_LEVELS).optional();
const WorkItemSchema = z.looseObject({ agent: z.string(), task: z.string(), cwd: z.string().optional(), model: z.string().optional(), thinking: ThinkingSchema });

/**
 * Mirrors SubagentParams, which Pi checks before the tool runs, so it accepts exactly the calls that reach the tool. The
 * tool validates with it and passes Pi's own params object on, so every key and its order reach the dispatcher unchanged.
 */
export const SubagentParamsSchema = z.looseObject({
  agent: z.string().optional(),
  task: z.string().optional(),
  tasks: z.array(WorkItemSchema).optional(),
  chain: z.array(WorkItemSchema).optional(),
  agentScope: z.enum(['user', 'project', 'both']).optional(),
  confirmProjectAgents: z.boolean().optional(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  thinking: ThinkingSchema,
});

export const toAgentScope = (value: unknown): AgentScope => (value === 'project' || value === 'both' ? value : 'user');

export interface WorkItem {
  agent: string;
  task: string;
  cwd?: string | undefined;
  model?: string | undefined;
  thinking?: ThinkingLevelName | undefined;
}
