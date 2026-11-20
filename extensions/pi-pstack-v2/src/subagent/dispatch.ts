import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { hostEnv } from '../host-env.ts';
import { type ConcurrencyGate, readConcurrencyLimit, readDepthPolicy, SUBAGENT_DEPTH_ENV, SUBAGENT_MAX_CONCURRENT_ENV, SUBAGENT_MAX_DEPTH_ENV } from './admission.ts';
import { projectAgentsApproved, resolveAgent } from './agent-resolution.ts';
import { type AgentConfig, discoverAgents } from './agents.ts';
import { runChain } from './dispatch-chain.ts';
import { runParallel } from './dispatch-parallel.ts';
import { FORK_AGENT_NAME, forkRefusal, parentSessionOf } from './fork.ts';
import { frameSubagentReport } from './framing.ts';
import { getResultOutput, isFailedResult, makeDetails, type ToolResult, textResult, truncateModelOutput, withWorktreeNote } from './results.ts';
import { runSingleAgent } from './run-single.ts';
import type { ParsedSubagentParams, WorkItem } from './schema.ts';
import type { DispatchRun, OnUpdateCallback, ResolvedAgent, SubagentMode } from './types.ts';

const listAgents = (agents: AgentConfig[]): string => agents.map((a) => `${a.name} (${a.source})`).join(', ') || 'none';

function detectModes(params: ParsedSubagentParams): SubagentMode[] {
  const candidates: [SubagentMode, boolean][] = [
    ['chain', (params.chain?.length ?? 0) > 0],
    ['parallel', (params.tasks?.length ?? 0) > 0],
    ['single', Boolean(params.agent && params.task)],
  ];
  return candidates.filter(([, present]) => present).map(([mode]) => mode);
}

function workItems(params: ParsedSubagentParams, mode: SubagentMode): WorkItem[] {
  if (mode === 'chain') return params.chain ?? [];
  if (mode === 'parallel') return params.tasks ?? [];
  return params.agent && params.task ? [{ agent: params.agent, task: params.task, cwd: params.cwd, model: params.model, thinking: params.thinking, isolation: params.isolation }] : [];
}

async function runSingle(run: DispatchRun, item: WorkItem, resolved: ResolvedAgent): Promise<ToolResult> {
  const result = await runSingleAgent(run.defaults, resolved, item.agent, item.task, undefined, run.signal, run.onUpdate, makeDetails('single'));
  const text = isFailedResult(result) ? `Agent ${result.stopReason || result.status}: ${getResultOutput(result)}` : getResultOutput(result);
  return textResult(frameSubagentReport(withWorktreeNote(result, truncateModelOutput(text)), result.usage), makeDetails('single')([result]));
}

function dispatchMode(mode: SubagentMode, run: DispatchRun, items: WorkItem[], resolved: ResolvedAgent[]): Promise<ToolResult> {
  if (mode === 'chain') return runChain(run, items, resolved);
  if (mode === 'parallel') return runParallel(run, items, resolved);
  const [item] = items;
  const [agent] = resolved;
  if (!item || !agent) throw new Error('A single-agent call needs one agent and one task.');
  return runSingle(run, item, agent);
}

/** Why a call's forks must not start. A fork continues the parent's session in the parent's checkout, so it cannot take a worktree. */
function forkRefusalFor(items: WorkItem[], env: NodeJS.ProcessEnv, ctx: ExtensionContext): string | undefined {
  const forks = items.filter((item) => item.agent === FORK_AGENT_NAME);
  if (forks.length === 0) return undefined;
  if (forks.some((item) => item.isolation === 'worktree')) return 'A fork cannot run in a worktree (isolation: "worktree"): it continues the parent session in the parent checkout. Use a named agent for worktree isolation.';
  return forkRefusal(env, ctx);
}

const refusal = (text: string, mode: SubagentMode): ToolResult => textResult(text, makeDetails(mode, true)([]));

async function approvedAndDispatched(params: ParsedSubagentParams, mode: SubagentMode, run: DispatchRun, ctx: ExtensionContext): Promise<ToolResult> {
  const agentScope = params.agentScope ?? 'user';
  const discovery = discoverAgents(ctx.cwd, agentScope);
  const items = workItems(params, mode);
  const resolved = items.map((item) => ({ ...resolveAgent(ctx.cwd, agentScope, item.agent, item.cwd), call: { model: item.model, thinking: item.thinking, isolation: item.isolation } }));
  const needsApproval = (agentScope === 'project' || agentScope === 'both') && (params.confirmProjectAgents ?? true) && ctx.hasUI;
  if (needsApproval && !(await projectAgentsApproved(ctx, resolved, discovery.projectAgentsDir))) {
    return textResult('Canceled: project-local agents not approved.', makeDetails(mode)([]));
  }
  return dispatchMode(mode, run, items, resolved);
}

export async function executeSubagent(params: ParsedSubagentParams, signal: AbortSignal | undefined, onUpdate: OnUpdateCallback | undefined, ctx: ExtensionContext, gate: ConcurrencyGate, toolCallId?: string): Promise<ToolResult> {
  const agentScope = params.agentScope ?? 'user';
  const modes = detectModes(params);
  const [mode] = modes;
  if (!mode || modes.length !== 1) {
    const text = `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${listAgents(discoverAgents(ctx.cwd, agentScope).agents)}`;
    return refusal(text, 'single');
  }

  const env = hostEnv();
  const policy = readDepthPolicy(env);
  if (!policy.canSpawn) {
    return refusal(`Subagent nesting depth limit reached (depth ${policy.depth} >= max ${policy.maxDepth}). Do the work here, or raise ${SUBAGENT_MAX_DEPTH_ENV}.`, mode);
  }
  const forkRefused = forkRefusalFor(workItems(params, mode), env, ctx);
  if (forkRefused) return refusal(forkRefused, mode);
  const slots = gate.tryAcquire(workItems(params, mode).length);
  if (!slots) {
    return refusal(`Subagent concurrency cap reached (max ${readConcurrencyLimit(env)} workers at once). Wait for running workers to finish, or raise ${SUBAGENT_MAX_CONCURRENT_ENV}.`, mode);
  }

  const defaults = { model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined, thinkingLevel: ctx.thinkingLevel, extraEnv: { [SUBAGENT_DEPTH_ENV]: String(policy.nextDepth) }, parentSession: parentSessionOf(ctx, toolCallId) };
  try {
    return await approvedAndDispatched(params, mode, { defaults, signal, onUpdate }, ctx);
  } finally {
    slots.release();
  }
}
