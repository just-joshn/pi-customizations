import { StringEnum } from '@earendil-works/pi-ai';
import { type Static, Type } from 'typebox';
import { z } from 'zod';
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

const WorkItemSchema = z.object({ agent: z.string(), task: z.string(), cwd: z.string().optional() });

/** Mirrors SubagentParams field for field, so it accepts exactly what Pi's TypeBox validation accepted. */
export const SubagentParamsSchema = z.object({
  agent: z.string().optional(),
  task: z.string().optional(),
  tasks: z.array(WorkItemSchema).optional(),
  chain: z.array(WorkItemSchema).optional(),
  agentScope: z.enum(['user', 'project', 'both']).optional(),
  confirmProjectAgents: z.boolean().optional(),
  cwd: z.string().optional(),
});

export const toAgentScope = (value: unknown): AgentScope => (value === 'project' || value === 'both' ? value : 'user');

export type SubagentParamsType = Static<typeof SubagentParams>;
export type ParsedSubagentParams = z.infer<typeof SubagentParamsSchema>;

export interface WorkItem {
  agent: string;
  task: string;
  cwd?: string | undefined;
}
