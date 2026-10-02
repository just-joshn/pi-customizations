import type { AgentSessionEvent, AgentSessionEventListener, AgentToolUpdateCallback } from '@earendil-works/pi-coding-agent';
import type { TaskRecord } from '../worker-records.ts';

type SafeToolName = string & { readonly __brand: 'SafeToolName' };
type TaskActivity =
  | Readonly<{ kind: 'tool-started'; tool: SafeToolName }>
  | Readonly<{ kind: 'tool-finished'; tool: SafeToolName; failed: boolean }>
  | Readonly<{ kind: 'retry-started'; attempt: number; maxAttempts: number }>
  | Readonly<{ kind: 'retry-finished'; attempt: number; recovered: boolean }>;
export type TaskProgressSnapshot = Readonly<{
  kind: 'progress';
  task_id: TaskRecord['id'];
  status: 'running';
  active_tools: readonly SafeToolName[];
  latest: TaskActivity;
}>;
export type TaskToolDetails = TaskRecord | TaskProgressSnapshot;
export type TaskUpdate = AgentToolUpdateCallback<TaskToolDetails>;
type ProgressTransition = Readonly<{ activeCalls: ReadonlyMap<string, SafeToolName>; latest: TaskActivity }>;
const toolNamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/;

function safeToolName(name: string): SafeToolName {
  return (toolNamePattern.test(name) ? name : 'extension tool') as SafeToolName;
}

function projectProgressEvent(activeCalls: ReadonlyMap<string, SafeToolName>, event: AgentSessionEvent): ProgressTransition | undefined {
  if ((event.type === 'tool_execution_start' || event.type === 'tool_execution_end') && event.parentToolCallId !== undefined) return undefined;
  switch (event.type) {
    case 'tool_execution_start': {
      const tool = safeToolName(event.toolName);
      const next = new Map(activeCalls);
      next.set(event.toolCallId, tool);
      return { activeCalls: next, latest: Object.freeze({ kind: 'tool-started', tool }) };
    }
    case 'tool_execution_end': {
      const tool = activeCalls.get(event.toolCallId) ?? safeToolName(event.toolName);
      const next = new Map(activeCalls);
      next.delete(event.toolCallId);
      return { activeCalls: next, latest: Object.freeze({ kind: 'tool-finished', tool, failed: event.isError }) };
    }
    case 'auto_retry_start':
      return { activeCalls, latest: Object.freeze({ kind: 'retry-started', attempt: event.attempt, maxAttempts: event.maxAttempts }) };
    case 'auto_retry_end':
      return { activeCalls, latest: Object.freeze({ kind: 'retry-finished', attempt: event.attempt, recovered: event.success }) };
    default:
      return undefined;
  }
}

function progressText(snapshot: TaskProgressSnapshot): string {
  const active = snapshot.active_tools.length ? snapshot.active_tools.join(', ') : 'none';
  const latest = snapshot.latest;
  const description =
    latest.kind === 'tool-started'
      ? `${latest.tool} started`
      : latest.kind === 'tool-finished'
        ? `${latest.tool} ${latest.failed ? 'failed' : 'finished'}`
        : latest.kind === 'retry-started'
          ? `retry ${latest.attempt}/${latest.maxAttempts} started`
          : `retry ${latest.attempt} ${latest.recovered ? 'recovered' : 'failed'}`;
  return `Task ${snapshot.task_id} running. Active tools: ${active}. Latest: ${description}.`;
}

export function progressObserver(taskId: TaskRecord['id'], isCurrent: () => boolean, onUpdate: TaskUpdate): AgentSessionEventListener {
  let activeCalls: ReadonlyMap<string, SafeToolName> = new Map();
  return (event) => {
    if (!isCurrent()) return;
    const transition = projectProgressEvent(activeCalls, event);
    if (!transition) return;
    activeCalls = transition.activeCalls;
    const snapshot: TaskProgressSnapshot = Object.freeze({
      kind: 'progress',
      task_id: taskId,
      status: 'running',
      active_tools: Object.freeze([...activeCalls.values()]),
      latest: transition.latest,
    });
    onUpdate({ content: [{ type: 'text', text: progressText(snapshot) }], details: snapshot });
  };
}
