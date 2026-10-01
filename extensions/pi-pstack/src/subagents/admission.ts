import { normalizeDescription, validateName } from './limits.ts';
import type { AdmissionSnapshot, AgentSummary, Decision, Refusal, SpawnRequest } from './types.ts';

const generalPurpose = 'general-purpose';

export function normalizeAgentType(type: string): string {
  return type.normalize('NFKC').toLowerCase().replace(/[\p{White_Space}\p{Pd}_]+/gu, '');
}

function dispatchable(snapshot: AdmissionSnapshot): readonly AgentSummary[] {
  const allowed = snapshot.allowedAgentTypes;
  return allowed ? snapshot.agents.filter((agent) => allowed.includes(agent.agentType)) : snapshot.agents;
}

function availableNames(snapshot: AdmissionSnapshot, pool: readonly AgentSummary[]): string {
  const names = pool.map((agent) => agent.agentType).toSorted();
  if (snapshot.forkAvailable) names.unshift('fork');
  return names.length ? names.join(', ') : 'none';
}

function ambiguity(requested: string, matches: readonly AgentSummary[], available: ReadonlySet<string>, availableList: string): Refusal {
  const listed = matches.map((agent) => (available.has(agent.agentType) ? agent.agentType : `${agent.agentType} (unavailable)`)).join(', ');
  const exact = matches.map((agent) => agent.agentType).filter((type) => available.has(type));
  const remedy = exact.length > 0 ? `Use the exact name: ${exact.join(' or ')}` : `None of these are available. Available agents: ${availableList}`;
  return { code: 'subagent_type_ambiguous', message: `Agent type '${requested}' is ambiguous \u2014 matches ${listed}. ${remedy}` };
}

export function resolveAgentType(snapshot: AdmissionSnapshot, requested: string | undefined): { type: string } | { refusal: Refusal } {
  const pool = dispatchable(snapshot);
  if (requested === undefined) {
    if (pool.some((agent) => agent.agentType === generalPurpose)) return { type: generalPurpose };
    const defaults = pool.filter((agent) => normalizeAgentType(agent.agentType) === normalizeAgentType(generalPurpose));
    if (defaults.length === 1 && defaults[0]) return { type: defaults[0].agentType };
    return { refusal: { code: 'subagent_type_missing', message: `subagent_type is required: the ${generalPurpose} agent is not available in this session. Available agents: ${availableNames(snapshot, pool)}` } };
  }
  if (requested === 'fork' && snapshot.forkAvailable) return { type: 'fork' };
  const exact = pool.find((agent) => agent.agentType === requested);
  if (exact) return { type: exact.agentType };
  const normalized = normalizeAgentType(requested);
  const matches = normalized ? snapshot.agents.filter((agent) => normalizeAgentType(agent.agentType) === normalized) : [];
  const available = new Set(pool.map((agent) => agent.agentType));
  if (matches.length > 1) return { refusal: ambiguity(requested, matches, available, availableNames(snapshot, pool)) };
  const single = matches[0];
  if (single && available.has(single.agentType)) return { type: single.agentType };
  return { refusal: { code: 'subagent_type_not_found', message: `Agent type '${requested}' not found. Available agents: ${availableNames(snapshot, pool)}` } };
}

export function depthMessage(depth: number, cap: number): string {
  return `Subagent nesting limit reached (depth ${depth} of ${cap}). Complete this task directly using your tools instead of spawning another agent. If the user explicitly requested deeper nesting, ask them to raise CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH.`;
}

export function concurrencyMessage(cap: number): string {
  return `Concurrent subagent limit reached. You can run ${cap} subagents at once. Do not retry. If the user wants more concurrent subagents, ask them to increase CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS.`;
}

function budgetMessage(spent: number, max: number): string {
  return `Budget limit reached ($${spent.toFixed(2)} spent of the $${max} maximum). New agents cannot be started. Complete the remaining work directly with your tools, or wrap up with the results you already have.`;
}

export function decideAdmission(snapshot: AdmissionSnapshot, request: SpawnRequest): Decision {
  if (request.name !== undefined) {
    const invalid = validateName(request.name);
    if (invalid) return { ok: false, refusal: invalid };
  }
  if (!snapshot.hasProject) return { ok: false, refusal: { code: 'subagent_no_directory_in_cwd_scope', message: 'A subagent cannot be started from here in this session. Do the task without a subagent.' } };
  if (snapshot.depth >= snapshot.depthCap) return { ok: false, counter: 'depth_limit', refusal: { code: 'subagent_depth_cap', message: depthMessage(snapshot.depth, snapshot.depthCap) } };
  if (snapshot.stopPending) return { ok: false, refusal: { code: 'subagent_stop_pending', message: 'This agent has been stopped and its stop is still completing; it cannot launch new agents.' } };
  const resolved = resolveAgentType(snapshot, request.subagentType);
  if ('refusal' in resolved) return { ok: false, refusal: resolved.refusal };
  if (snapshot.maxBudgetUsd !== undefined && snapshot.spentUsd >= snapshot.maxBudgetUsd) {
    return { ok: false, counter: 'budget', refusal: { code: 'subagent_budget_exhausted', message: budgetMessage(snapshot.spentUsd, snapshot.maxBudgetUsd) } };
  }
  if (snapshot.sessionSpawnCap !== undefined && snapshot.spawnedThisSession >= snapshot.sessionSpawnCap) {
    return { ok: false, counter: 'budget', refusal: { code: 'subagent_session_cap', message: `Session subagent limit reached (${snapshot.sessionSpawnCap}). Complete the remaining work directly with your tools.` } };
  }
  if (!snapshot.concurrencyBypass && snapshot.running >= snapshot.concurrencyCap) {
    return { ok: false, counter: 'concurrency_limit', refusal: { code: 'subagent_concurrency_limit', message: concurrencyMessage(snapshot.concurrencyCap) } };
  }
  if (request.cwd !== undefined && request.isolation === 'worktree') {
    return { ok: false, refusal: { code: 'subagent_isolation_conflict', message: 'cwd and isolation: "worktree" are mutually exclusive.' } };
  }
  return {
    ok: true,
    plan: {
      agentType: resolved.type,
      description: normalizeDescription(request.description),
      prompt: request.prompt,
      background: request.runInBackground !== false,
      depth: snapshot.depth + 1,
      ...(request.model !== undefined ? { model: request.model } : {}),
      ...(request.isolation !== undefined ? { isolation: request.isolation } : {}),
      ...(request.name !== undefined ? { name: request.name } : {}),
      ...(request.cwd !== undefined ? { cwd: request.cwd } : {}),
    },
  };
}
