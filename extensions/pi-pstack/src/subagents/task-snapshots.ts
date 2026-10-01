import type { TaskRecord } from '../worker-records.ts';

export type TaskStatus = 'running' | 'completed' | 'failed' | 'killed';
export type TaskSnapshot = Readonly<{
  id: string;
  name?: string;
  type: 'local_agent';
  agentType: string;
  status: TaskStatus;
  description: string;
  startTime?: number;
  model?: string;
  effort?: string;
  contextWindowSize?: number;
  tokenCount: number;
  cwd: string;
}>;
export type SnapshotSources = Readonly<{ liveTokens: (id: string) => number | undefined; contextWindow: (model: string) => number | undefined }>;

const statuses: Record<TaskRecord['status'], TaskStatus> = { running: 'running', settled: 'completed', failed: 'failed', interrupted: 'killed' };

function modelParts(reference: string | undefined): { model?: string; effort?: string } {
  const match = reference?.match(/^(.*?)(?::(off|minimal|low|medium|high|xhigh|max))?$/);
  return { ...(match?.[1] ? { model: match[1] } : {}), ...(match?.[2] ? { effort: match[2] } : {}) };
}

export function taskSnapshot(record: TaskRecord, sources: SnapshotSources): TaskSnapshot {
  const { model, effort } = modelParts(record.modelReference);
  const contextWindowSize = model === undefined ? undefined : sources.contextWindow(model);
  return {
    id: record.id,
    ...(record.agentName ? { name: record.agentName } : {}),
    type: 'local_agent',
    agentType: record.persona,
    status: statuses[record.status],
    description: record.description ?? record.persona,
    ...(record.startedAt !== undefined ? { startTime: record.startedAt } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(contextWindowSize !== undefined ? { contextWindowSize } : {}),
    tokenCount: sources.liveTokens(record.id) ?? record.usage?.totalTokens ?? 0,
    cwd: record.cwd,
  };
}

const icons: Record<TaskStatus, string> = { running: '●', completed: '✓', failed: '✗', killed: '■' };

export function panelLines(tasks: readonly TaskSnapshot[], decorations: Readonly<Record<string, string>>): string[] {
  return tasks.map((task) => {
    const decoration = decorations[task.id];
    return `${icons[task.status]} ${task.name ?? task.agentType}: ${task.description}${decoration ? ` · ${decoration}` : ''}`;
  });
}
