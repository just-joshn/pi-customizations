import type { AgentToolResult, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { AgentConfig, AgentSource } from './agents.ts';

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
}

export interface DispatchRun {
  defaults: DispatchDefaults;
  signal: AbortSignal | undefined;
  onUpdate: OnUpdateCallback | undefined;
}

/** The model and thinking level one call names for one item, ahead of the agent's and the session's. */
export interface CallModel {
  model?: string | undefined;
  thinking?: ThinkingLevel | undefined;
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
