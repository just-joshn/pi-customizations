import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
import type { ContextTier, EffortLevel, ModelPolicy, WorkflowLimits } from '../settings.ts';

export type RunStatus = 'pending' | 'running' | 'completed' | 'halted' | 'paused' | 'cancelled' | 'error';
export type WorkflowAgentOptions = Readonly<{ model?: string; modelPolicy?: ModelPolicy; effortLevel?: EffortLevel; contextTier?: ContextTier; schema?: TSchema }>;
export type WorkflowFailure = Readonly<{ type: 'workflow_limit_reached' | 'interrupted' | 'error'; message: string }>;
export type RunRecord = Readonly<{
  id: string;
  name: string;
  attempt: number;
  status: RunStatus;
  arguments: unknown;
  ownerEpoch: number;
  declaredLimits: WorkflowLimits;
  effectiveLimits: WorkflowLimits;
  consumption: Readonly<{ subagents: number; credits: number; startedAt: number; elapsedSeconds: number }>;
  logs: readonly string[];
  phases: readonly string[];
  checkpoint?: string;
  failure?: WorkflowFailure;
  result?: unknown;
  createdAt: number;
  updatedAt: number;
}>;
export type Journal = Readonly<Record<string, unknown>>;
export type AgentOutcome = Readonly<{ text: string; value: unknown }>;
export type AgentSink = (prompt: string, options: WorkflowAgentOptions) => Promise<AgentOutcome>;
export type WorkflowContext = Readonly<{
  resumed: boolean;
  phase: (name: string) => void;
  log: (message: string) => void;
  step: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  agent: (prompt: string, options?: WorkflowAgentOptions) => Promise<unknown>;
  parallel: <T>(jobs: readonly (() => Promise<T>)[]) => Promise<readonly T[]>;
  pause: (key: string) => never;
}>;
export type WorkflowDeclaration<TArguments = unknown, TResult = unknown> = Readonly<{
  name: string;
  description: string;
  arguments?: TSchema;
  limits?: WorkflowLimits;
  run: (ctx: WorkflowContext, args: TArguments) => Promise<TResult>;
}>;
export type ExecutionContext = Readonly<{ ctx: ExtensionContext; token: Readonly<{ runId: string; epoch: number }>; journal: Journal; agent: AgentSink }>;

export class WorkflowPause extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Workflow paused at ${key}.`);
    this.key = key;
  }
}

export function defineWorkflow<TArguments, TResult>(declaration: WorkflowDeclaration<TArguments, TResult>): WorkflowDeclaration<TArguments, TResult> {
  const { name, description, run } = declaration;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error(`Invalid workflow name '${name}'. Use lowercase letters, digits and hyphens.`);
  if (!description.trim()) throw new Error(`Workflow '${name}' needs a description.`);
  if (typeof run !== 'function') throw new Error(`Workflow '${name}' needs a run function.`);
  return declaration;
}

export const workflowLimitMessage = 'The workflow reached one of its limits';
