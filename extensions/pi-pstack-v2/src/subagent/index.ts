/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation in its own
 * tmux session, giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import * as path from 'node:path';

import { CONFIG_DIR_NAME, type ExtensionAPI, getAgentDir } from '@earendil-works/pi-coding-agent';
import { executeSubagent } from './dispatch.ts';
import { renderSubagentCall } from './render-call.ts';
import { renderSubagentResult } from './render-result.ts';
import { SubagentParams, SubagentParamsSchema } from './schema.ts';
import type { SubagentDetails } from './types.ts';

const toolDescription = (): string =>
  [
    'Delegate tasks to specialized subagents with isolated context.',
    'Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).',
    `Default agent scope is "user" (from ${path.join(getAgentDir(), 'agents')}).`,
    `To enable project-local agents in ${CONFIG_DIR_NAME}/agents, set agentScope: "both" (or "project").`,
  ].join(' ');

export default function subagentExtension(pi: ExtensionAPI): void {
  // Tool execute results cannot set runtime error state directly, so patch it through the result hook.
  pi.on('tool_result', (event) => {
    if (event.toolName !== 'subagent') return;
    const details = event.details as SubagentDetails | undefined;
    return details?.isError ? { isError: true } : undefined;
  });

  pi.registerTool({
    name: 'subagent',
    label: 'Subagent',
    description: toolDescription(),
    parameters: SubagentParams,
    execute: (_toolCallId, params, signal, onUpdate, ctx) => {
      const parsed = SubagentParamsSchema.parse(params);
      return executeSubagent(parsed, signal, onUpdate, ctx);
    },
    renderCall: (args, theme) => renderSubagentCall(args, theme),
    renderResult: (result, { expanded }, theme) => renderSubagentResult(result, expanded, theme),
  });
}
