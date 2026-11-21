import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { hostEnv } from '../host-env.ts';
import { type ConcurrencyGate, readDepthPolicy, SUBAGENT_DEPTH_ENV, SUBAGENT_MAX_DEPTH_ENV } from './admission.ts';
import { projectAgentsApproved, resolveAgent } from './agent-resolution.ts';
import { type AgentConfig, discoverAgents } from './agents.ts';
import { type NormalizedCall, normalizeCall } from './call.ts';
import { runChain } from './dispatch-chain.ts';
import { runParallel } from './dispatch-parallel.ts';
import { FORK_AGENT_NAME, forkRefusal, parentSessionOf } from './fork.ts';
import { formatResultText, getResultOutput, isFailedResult, makeDetails, progressResult, refusalResult, reportResult, runningText, type ToolResult, textResult } from './results.ts';
import { runSingleAgent } from './run-single.ts';
import type { ParsedSubagentParams, WorkItem } from './schema.ts';
import type { DispatchRun, OnUpdateCallback, Work } from './types.ts';

const listAgents = (agents: AgentConfig[]): string => agents.map((a) => `${a.name} (${a.source})`).join(', ') || 'none';

async function runSingle(run: DispatchRun, work: Work): Promise<ToolResult> {
  const result = await runSingleAgent(run, work, undefined, (current) => run.onUpdate?.(progressResult('single', [current], runningText(current))));
  const text = isFailedResult(result) ? `Agent ${result.stopReason || result.status}: ${getResultOutput(result)}` : getResultOutput(result);
  return reportResult('single', [result], formatResultText(result, text));
}

function dispatchMode({ mode }: NormalizedCall, run: DispatchRun, work: Work[]): Promise<ToolResult> {
  if (mode === 'chain') return runChain(run, work);
  if (mode === 'parallel') return runParallel(run, work);
  const [only] = work;
  if (!only) throw new Error('A single-agent call needs one agent and one task.');
  return runSingle(run, only);
}

/** Why a call's forks must not start. A fork continues the parent's session in the parent's checkout, so it cannot take a worktree. */
function forkRefusalFor(items: WorkItem[], env: NodeJS.ProcessEnv, ctx: ExtensionContext): string | undefined {
  const forks = items.filter((item) => item.agent === FORK_AGENT_NAME);
  if (forks.length === 0) return undefined;
  if (forks.some((item) => item.isolation === 'worktree')) return 'A fork cannot run in a worktree (isolation: "worktree"): it continues the parent session in the parent checkout. Use a named agent for worktree isolation.';
  return forkRefusal(env, ctx);
}

async function approvedAndDispatched(params: ParsedSubagentParams, call: NormalizedCall, run: DispatchRun, ctx: ExtensionContext): Promise<ToolResult> {
  const agentScope = params.agentScope ?? 'user';
  const discovery = discoverAgents(ctx.cwd, agentScope);
  const work = call.items.map((item): Work => ({ item, resolved: resolveAgent(ctx.cwd, agentScope, item.agent, item.cwd) }));
  const needsApproval = (agentScope === 'project' || agentScope === 'both') && (params.confirmProjectAgents ?? true) && ctx.hasUI;
  if (
    needsApproval &&
    !(await projectAgentsApproved(
      ctx,
      work.map((unit) => unit.resolved),
      discovery.projectAgentsDir,
    ))
  ) {
    return textResult('Canceled: project-local agents not approved.', makeDetails(call.mode, []));
  }
  return dispatchMode(call, run, work);
}

export async function executeSubagent(params: ParsedSubagentParams, signal: AbortSignal | undefined, onUpdate: OnUpdateCallback | undefined, ctx: ExtensionContext, gate: ConcurrencyGate, toolCallId?: string): Promise<ToolResult> {
  const call = normalizeCall(params);
  if (!call) {
    const text = `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${listAgents(discoverAgents(ctx.cwd, params.agentScope ?? 'user').agents)}`;
    return refusalResult('single', text);
  }

  const env = hostEnv();
  const policy = readDepthPolicy(env);
  if (!policy.canSpawn) {
    return refusalResult(call.mode, `Subagent nesting depth limit reached (depth ${policy.depth} >= max ${policy.maxDepth}). Do the work here, or raise ${SUBAGENT_MAX_DEPTH_ENV}.`);
  }
  const forkRefused = forkRefusalFor(call.items, env, ctx);
  if (forkRefused) return refusalResult(call.mode, forkRefused);

  const defaults = { model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined, thinkingLevel: ctx.thinkingLevel, extraEnv: { [SUBAGENT_DEPTH_ENV]: String(policy.nextDepth) }, parentSession: parentSessionOf(ctx, toolCallId) };
  return approvedAndDispatched(params, call, { defaults, signal, onUpdate, gate }, ctx);
}
