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
 * With wake, a call returns a job id at once and wakes the session with the report; stop aborts such a job.
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import * as path from 'node:path';

import { CONFIG_DIR_NAME, type ExtensionAPI, getAgentDir } from '@earendil-works/pi-coding-agent';
import { executeSubagent } from './dispatch.ts';
import { renderSubagentCall } from './render-call.ts';
import { renderSubagentResult } from './render-result.ts';
import { makeDetails, type ToolResult, textResult } from './results.ts';
import { type ParsedSubagentParams, SubagentParams, SubagentParamsSchema } from './schema.ts';
import type { SubagentDetails } from './types.ts';
import { createWakeJobs, WAKE_MESSAGE_TYPE } from './wake-jobs.ts';

const toolDescription = (): string =>
  [
    'Delegate tasks to specialized subagents with isolated context.',
    'Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).',
    `Default agent scope is "user" (from ${path.join(getAgentDir(), 'agents')}).`,
    `To enable project-local agents in ${CONFIG_DIR_NAME}/agents, set agentScope: "both" (or "project").`,
    'The call blocks until every worker finishes. With wake set, it returns a job id at once and wakes you with that message and the report instead, so you can keep working. stop: "<job id>" aborts such a job.',
  ].join(' ');

const interactive = (ctx: { mode?: string }): boolean => ctx.mode === 'tui' || ctx.mode === 'rpc';
const noDetails = makeDetails('single')([]);

function registerWakeLifecycle(pi: ExtensionAPI, wakeJobs: ReturnType<typeof createWakeJobs>): void {
  pi.on('session_shutdown', async () => wakeJobs.stopAll());
  // A print-mode Pi would exit while its wake jobs still run, so it waits for them and continues with their reports.
  pi.on('agent_before_settle', async (event, ctx) => {
    if (interactive(ctx)) return;
    const reports = await wakeJobs.settle();
    if (reports.length === 0) return;
    const entries = reports.map((content) => ({ type: 'custom_message' as const, customType: WAKE_MESSAGE_TYPE, content, display: true }));
    return { entries: [...event.entries, ...entries], continue: true };
  });
}

export default function subagentExtension(pi: ExtensionAPI): void {
  const wakeJobs = createWakeJobs(pi);
  registerWakeLifecycle(pi, wakeJobs);

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
    execute: (_toolCallId, params, signal, onUpdate, ctx): Promise<ToolResult> => {
      SubagentParamsSchema.parse(params);
      const parsed = params as ParsedSubagentParams;
      if (parsed.stop !== undefined) {
        const text = wakeJobs.stop(parsed.stop) ? `Stopped subagent job ${parsed.stop}.` : `No running subagent job ${parsed.stop}.`;
        return Promise.resolve(textResult(text, noDetails));
      }
      if (parsed.wake === undefined) return executeSubagent(parsed, signal, onUpdate, ctx);
      const id = wakeJobs.start(parsed.wake, ctx, (jobSignal) => executeSubagent(parsed, jobSignal, undefined, ctx));
      const text = `Started subagent job ${id}. It wakes you with its report when every worker finishes. Stop it with stop: "${id}".`;
      return Promise.resolve(textResult(text, noDetails));
    },
    renderCall: (args, theme) => renderSubagentCall(args, theme),
    renderResult: (result, { expanded }, theme) => renderSubagentResult(result, expanded, theme),
  });
}
