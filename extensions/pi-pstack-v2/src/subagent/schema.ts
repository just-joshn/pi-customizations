import { StringEnum } from '@earendil-works/pi-ai';
import { type Static, Type } from 'typebox';
import { passthroughObject } from '../object-schema.ts';
import type { AgentScope } from './agents.ts';

const TaskItem = Type.Object({
  agent: Type.String({ description: 'Name of the agent to invoke' }),
  task: Type.String({ description: 'Task to delegate to the agent' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process' })),
});

const ChainItem = Type.Object({
  agent: Type.String({ description: 'Name of the agent to invoke' }),
  task: Type.String({ description: 'Task with optional {previous} placeholder for prior output' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process' })),
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
});

export type SubagentParamsType = Static<typeof SubagentParams>;
export type ParsedSubagentParams = Omit<SubagentParamsType, 'agentScope'> & { agentScope?: AgentScope | undefined };

/**
 * Pi checks SubagentParams before the tool runs, and the original code read what it was given. This accepts any object and
 * returns it untouched, so a chain step without a task, a null optional, an unknown scope, or an extra key reach the
 * dispatcher as they did.
 */
export const SubagentParamsSchema = passthroughObject<ParsedSubagentParams>();

export const toAgentScope = (value: unknown): AgentScope => (value === 'project' || value === 'both' ? value : 'user');

export interface WorkItem {
  agent: string;
  task: string;
  cwd?: string | undefined;
}
