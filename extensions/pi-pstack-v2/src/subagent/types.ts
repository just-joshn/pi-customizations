import type { AgentToolResult, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { AgentConfig } from './agents.ts';

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
  agentSource: 'user' | 'project' | 'unknown';
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

export interface ResolvedAgent {
  agent: AgentConfig | undefined;
  available: AgentConfig[];
  cwd: string;
}

export type DisplayItem = { type: 'text'; text: string } | { type: 'toolCall'; name: string; args: Record<string, unknown> };
