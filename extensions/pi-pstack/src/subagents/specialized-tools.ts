import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { resolveModel } from '../models.ts';
import type { ChildLimits } from './context-builder.ts';
import { subagentNamespace } from './delegation-guidance.ts';
import type { SubagentFactory } from './factory.ts';
import { featureEnabled } from './feature-flags.ts';
import { boundedForModel, syncResultText } from './tool-results.ts';

export type Specialized = Readonly<{ tool: 'execution_subagent' | 'search_subagent'; agentType: 'task' | 'explore'; flag: string; modelFlag: string; modelVariable: string; turnsVariable: string; defaultTurns: number; description: string }>;

export const executionSubagent: Specialized = {
  tool: 'execution_subagent',
  agentType: 'task',
  flag: 'copilot_cli_execution_subagent',
  modelFlag: 'copilot_cli_execution_subagent_model',
  modelVariable: 'EXECUTION_SUBAGENT_MODEL',
  turnsVariable: 'EXECUTION_SUBAGENT_MAX_TURNS',
  defaultTurns: 30,
  description: 'Run commands such as builds, tests and linters in a separate context and get back a brief result, or the full output on failure.',
};
export const searchSubagent: Specialized = {
  tool: 'search_subagent',
  agentType: 'explore',
  flag: 'copilot_cli_search_subagent_model',
  modelFlag: 'copilot_cli_search_subagent_model',
  modelVariable: 'SEARCH_SUBAGENT_MODEL',
  turnsVariable: 'SEARCH_SUBAGENT_MAX_TURNS',
  defaultTurns: 20,
  description: 'Search the codebase in a separate context and get back the matching files and a short explanation.',
};

const Input = Type.Object({ description: Type.String({ description: 'A short (3-5 word) description of the request' }), prompt: Type.String({ description: 'The complete request for the agent' }) }, { additionalProperties: false });
const Details = Type.Object({ agent_id: Type.String(), status: Type.String() });

export function specializedTurns(env: NodeJS.ProcessEnv, spec: Specialized): number {
  const raw = env[spec.turnsVariable];
  const parsed = raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : spec.defaultTurns;
}

export function specializedEnabled(env: NodeJS.ProcessEnv, spec: Specialized): boolean {
  return featureEnabled(env, spec.flag);
}

export function specializedTool(spec: Specialized, factory: SubagentFactory, env: NodeJS.ProcessEnv): ToolDefinition<typeof Input, Static<typeof Details>> {
  return {
    name: spec.tool,
    label: spec.tool,
    description: spec.description,
    promptSnippet: spec.description,
    parameters: Input,
    outputSchema: Details,
    exposure: 'model-only',
    namespace: subagentNamespace,
    executionMode: 'sequential',
    annotations: { openWorldHint: true },
    execute: async (id, params, signal, _update, ctx): Promise<AgentToolResult<Static<typeof Details>>> => {
      const model = featureEnabled(env, spec.modelFlag) ? env[spec.modelVariable]?.trim() : undefined;
      if (model) resolveModel(model, ctx);
      const limits: ChildLimits = { maxAgentTurns: specializedTurns(env, spec) };
      const call = { agent_type: spec.agentType, name: spec.tool, description: params.description, prompt: params.prompt, mode: 'sync' as const, ...(model ? { model } : {}) };
      const { launched, node } = await factory.create(call, id, signal, ctx, { limits });
      const settled = await launched.settled;
      if (settled.status === 'failed') throw new Error(settled.error ?? 'The agent failed.');
      const details = { agent_id: node.id, status: settled.status };
      return { content: [{ type: 'text', text: boundedForModel(syncResultText(settled.turns.at(-1) ?? ''), settled.sessionFile) }], details, structuredContent: details, ...(settled.usage ? { usage: settled.usage } : {}) };
    },
  };
}
