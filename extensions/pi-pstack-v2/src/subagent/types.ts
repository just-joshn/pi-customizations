import type { AgentToolResult, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { AgentConfig, AgentSource } from './agents.ts';
import type { ParentSession } from './fork.ts';

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export type ChildStatus = 'pending' | 'running' | 'completed' | 'failed' | 'aborted';

export interface SingleResult {
  agent: string;
  agentSource: AgentSource | 'unknown';
  task: string;
  status: ChildStatus;
  exitCode: number | null;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string | undefined;
  stopReason?: string | undefined;
  errorMessage?: string | undefined;
  terminationSignal?: NodeJS.Signals | undefined;
  step?: number | undefined;
  /** Says where the worker's changes live, when it ran in a worktree that was kept. */
  worktreeNote?: string | undefined;
}

export type SubagentMode = 'single' | 'parallel' | 'chain';

export interface SubagentDetails {
  mode: SubagentMode;
  results: SingleResult[];
  isError: boolean;
}

export type MakeDetails = (results: SingleResult[]) => SubagentDetails;

export type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

export interface DispatchDefaults {
  model?: string | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  /** Environment variables the child gets on top of this process's own. */
  extraEnv?: Readonly<Record<string, string>> | undefined;
  /** The session that made the call, which a fork continues from. */
  parentSession?: ParentSession | undefined;
}

export interface DispatchRun {
  defaults: DispatchDefaults;
  signal: AbortSignal | undefined;
  onUpdate: OnUpdateCallback | undefined;
}

/** The model, thinking level and isolation one call names for one item, ahead of the agent's and the session's. */
export interface CallModel {
  model?: string | undefined;
  thinking?: ThinkingLevel | undefined;
  isolation?: 'worktree' | undefined;
}

export interface ResolvedAgent {
  agent: AgentConfig | undefined;
  available: AgentConfig[];
  cwd: string;
  call?: CallModel | undefined;
}

export type DisplayItem = { type: 'text'; text: string } | { type: 'toolCall'; name: string; args: Record<string, unknown> };

/** Pi hands tool details back as unknown, so the details this extension made are told apart by their shape. */
export const isSubagentDetails = (value: unknown): value is SubagentDetails =>
  typeof value === 'object' && value !== null && 'mode' in value && 'results' in value && Array.isArray(value.results) && 'isError' in value && typeof value.isError === 'boolean';
