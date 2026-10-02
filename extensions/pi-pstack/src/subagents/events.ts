import { randomUUID } from 'node:crypto';

import { type ModelSelectionSource, sameModel, type TaskModelSource } from './model-selection.ts';
import type { ExecutionMode } from './task-status.ts';

export const eventChannel = 'reference-assistant:event';
export const eventEntryType = 'reference-assistant-event';

export type EventEnvelope<Type extends string = string, Data = unknown> = Readonly<{
  id: string;
  timestamp: string;
  parentId: string | null;
  type: Type;
  data: Data;
  agentId?: string;
  ephemeral?: true;
}>;

export type StartedData = Readonly<{
  toolCallId: string;
  agentName: string;
  agentDisplayName: string;
  agentDescription: string;
  model: string;
  taskModelSource: TaskModelSource;
  modelSelectionSource: ModelSelectionSource;
  resumable: false;
  agentType: string;
  executionMode: ExecutionMode;
  parentId?: string;
  workflowRunId?: string;
  factoryRunId?: string;
}>;

export type ConfiguredData = Readonly<{ model: string; reasoningEffort?: string; contextTier: string; multiTurn: true }>;
export type SelectedData = Readonly<{ agentName: string; agentDisplayName: string; tools: readonly string[] }>;
export type Provenance = Readonly<{
  model: string;
  firstDispatchedModel: string;
  configuredModelPreference?: string;
  modelSelectionSource: ModelSelectionSource;
  configuredModelMatchesActual: boolean;
  explicitModelOverride?: string;
  explicitModelMatchesPreference?: boolean;
  modelOverrideReason?: string;
}>;
export type FinishedData = Provenance & Readonly<{ toolCallId: string; agentName: string; agentDisplayName: string; totalToolCalls: number; totalTokens: number; durationMs: number }>;
export type CompletedData = FinishedData & Readonly<{ cancelled?: true }>;
export type FailedData = FinishedData & Readonly<{ error: string }>;
export type NotificationKind = 'agent_completed' | 'agent_idle' | 'new_inbox_message' | 'workflow_completed';
export type NotificationData = Readonly<{ kind: NotificationKind; agentId?: string; summary: string; [field: string]: unknown }>;
export type WorkflowEventData = Readonly<{ runId: string; status: string; consumption?: Readonly<{ subagents: number; credits: number; elapsedSeconds: number }> }>;

export type SubagentEvent =
  | EventEnvelope<'subagent.started', StartedData>
  | EventEnvelope<'subagent.configured', ConfiguredData>
  | EventEnvelope<'subagent.selected', SelectedData>
  | EventEnvelope<'subagent.completed', CompletedData>
  | EventEnvelope<'subagent.failed', FailedData>
  | EventEnvelope<'subagent.deselected', Record<string, never>>
  | EventEnvelope<'session.background_tasks_changed', Record<string, never>>
  | EventEnvelope<'system.notification', NotificationData>
  | EventEnvelope<'workflow.run_started' | 'workflow.run_settled' | 'workflow.run_updated', WorkflowEventData>;

export type EventSink = Readonly<{ emit: (envelope: EventEnvelope) => void; persist: (envelope: EventEnvelope) => void }>;
type Options = Readonly<{ agentId?: string; ephemeral?: boolean }>;

export class EventLog {
  private last: string | null = null;

  constructor(
    private readonly sink: EventSink,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  emit<Type extends string, Data>(type: Type, data: Data, options: Options = {}): EventEnvelope<Type, Data> {
    const envelope: EventEnvelope<Type, Data> = {
      id: randomUUID(),
      timestamp: this.clock().toISOString(),
      parentId: this.last,
      type,
      data,
      ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
      ...(options.ephemeral ? { ephemeral: true as const } : {}),
    };
    if (!options.ephemeral) this.last = envelope.id;
    this.sink.emit(envelope);
    if (!options.ephemeral) this.sink.persist(envelope);
    return envelope;
  }
}

export function provenanceOf(input: { model: string; firstDispatched: string; source: ModelSelectionSource; configured?: string; requested?: string; overrideReason?: string }): Provenance {
  const matchesConfigured = input.configured === undefined || sameModel(input.configured, input.model);
  return {
    model: input.model,
    firstDispatchedModel: input.firstDispatched,
    ...(input.configured !== undefined ? { configuredModelPreference: input.configured } : {}),
    modelSelectionSource: input.source,
    configuredModelMatchesActual: matchesConfigured,
    ...(input.requested !== undefined ? { explicitModelOverride: input.requested } : {}),
    ...(input.requested !== undefined && input.configured !== undefined ? { explicitModelMatchesPreference: sameModel(input.requested, input.configured) } : {}),
    ...(input.overrideReason !== undefined ? { modelOverrideReason: input.overrideReason } : {}),
  };
}

export const eventsLogIncludesSubagents = (env: NodeJS.ProcessEnv): boolean => env.COPILOT_EVENTS_LOG_INCLUDE_SUBAGENTS === 'true';
