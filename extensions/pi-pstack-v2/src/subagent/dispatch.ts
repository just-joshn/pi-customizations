import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { projectAgentsApproved, resolveAgent } from './agent-resolution.ts';
import { type AgentConfig, discoverAgents } from './agents.ts';
import { runChain } from './dispatch-chain.ts';
import { runParallel } from './dispatch-parallel.ts';
import { getFinalOutput, getResultOutput, isFailedResult, makeDetails, type ToolResult, textResult, truncateModelOutput } from './results.ts';
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
  return params.agent && params.task ? [{ agent: params.agent, task: params.task, cwd: params.cwd, model: params.model, thinking: params.thinking }] : [];
}

async function runSingle(run: DispatchRun, item: WorkItem, resolved: ResolvedAgent): Promise<ToolResult> {
  const result = await runSingleAgent(run.defaults, resolved, item.agent, item.task, undefined, run.signal, run.onUpdate, makeDetails('single'));
  const text = isFailedResult(result) ? `Agent ${result.stopReason || result.status}: ${getResultOutput(result)}` : getFinalOutput(result.messages) || '(no output)';
  return textResult(truncateModelOutput(text), makeDetails('single')([result]));
}

function dispatchMode(mode: SubagentMode, run: DispatchRun, items: WorkItem[], resolved: ResolvedAgent[]): Promise<ToolResult> {
  if (mode === 'chain') return runChain(run, items, resolved);
  if (mode === 'parallel') return runParallel(run, items, resolved);
  return runSingle(run, items[0] as WorkItem, resolved[0] as ResolvedAgent);
}

export async function executeSubagent(params: ParsedSubagentParams, signal: AbortSignal | undefined, onUpdate: OnUpdateCallback | undefined, ctx: ExtensionContext): Promise<ToolResult> {
  const agentScope = params.agentScope ?? 'user';
  const discovery = discoverAgents(ctx.cwd, agentScope);
  const modes = detectModes(params);
  const [mode] = modes;
  if (!mode || modes.length !== 1) {
    const text = `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${listAgents(discovery.agents)}`;
    return textResult(text, makeDetails('single', true)([]));
  }

  const items = workItems(params, mode);
  const resolved = items.map((item) => ({ ...resolveAgent(ctx.cwd, agentScope, item.agent, item.cwd), call: { model: item.model, thinking: item.thinking } }));
  const needsApproval = (agentScope === 'project' || agentScope === 'both') && (params.confirmProjectAgents ?? true) && ctx.hasUI;
  if (needsApproval && !(await projectAgentsApproved(ctx, resolved, discovery.projectAgentsDir))) {
    return textResult('Canceled: project-local agents not approved.', makeDetails(mode)([]));
  }

  const defaults = { model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined, thinkingLevel: ctx.thinkingLevel };
  return dispatchMode(mode, { defaults, signal, onUpdate }, items, resolved);
}
