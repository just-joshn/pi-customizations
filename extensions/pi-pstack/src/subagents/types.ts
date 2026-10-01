export type AgentId = string & { readonly __brand: 'AgentId' };

export type AgentSummary = Readonly<{ agentType: string; whenToUse: string }>;

export type SpawnRequest = Readonly<{
  description: string;
  prompt: string;
  subagentType?: string;
  model?: string;
  runInBackground?: boolean;
  name?: string;
  isolation?: 'worktree' | 'remote';
  cwd?: string;
}>;

export type AgentTypeErrorCode = 'subagent_type_not_found' | 'subagent_type_ambiguous' | 'subagent_type_missing' | 'subagent_type_denied';

export type RefusalCode =
  | AgentTypeErrorCode
  | 'subagent_depth_cap'
  | 'subagent_concurrency_limit'
  | 'subagent_budget_exhausted'
  | 'subagent_session_cap'
  | 'subagent_no_directory_in_cwd_scope'
  | 'subagent_stop_pending'
  | 'subagent_name_invalid'
  | 'subagent_isolation_conflict'
  | 'subagent_fork_remote_isolation'
  | 'subagent_recursive_fork'
  | 'subagent_nested_teammate'
  | 'subagent_teammate_background_denied';

export type Refusal = Readonly<{ code: RefusalCode; message: string }>;

export type RefusalCounter = 'depth_limit' | 'concurrency_limit' | 'budget';

export type LaunchPlan = Readonly<{
  agentType: string;
  description: string;
  prompt: string;
  model?: string;
  background: boolean;
  isolation?: 'worktree' | 'remote';
  name?: string;
  cwd?: string;
  depth: number;
}>;

export type Decision = Readonly<{ ok: true; plan: LaunchPlan }> | Readonly<{ ok: false; refusal: Refusal; counter?: RefusalCounter }>;

export type AdmissionSnapshot = Readonly<{
  agents: readonly AgentSummary[];
  allowedAgentTypes?: readonly string[];
  forkAvailable: boolean;
  forkDenial?: Readonly<{ rule: string; source: string }>;
  insideFork?: boolean;
  depth: number;
  depthCap: number;
  running: number;
  concurrencyCap: number;
  concurrencyBypass: boolean;
  sessionSpawnCap?: number;
  spawnedThisSession: number;
  maxBudgetUsd?: number;
  spentUsd: number;
  hasProject: boolean;
  stopPending: boolean;
}>;
