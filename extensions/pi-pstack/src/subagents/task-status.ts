import type { TaskRecord } from '../worker-records.ts';

export type TaskStatus = 'running' | 'idle' | 'completed' | 'failed' | 'cancelled';
export type ExecutionMode = 'sync' | 'background';

const edges: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  running: ['idle', 'completed', 'failed', 'cancelled'],
  idle: ['running', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return edges[from].includes(to);
}

export function isTerminal(status: TaskStatus): boolean {
  return edges[status].length === 0;
}

type Projectable = Pick<TaskRecord, 'status' | 'copilot'>;

export function taskStatus(record: Projectable): TaskStatus {
  switch (record.status) {
    case 'running':
      return 'running';
    case 'failed':
      return 'failed';
    case 'interrupted':
      return 'cancelled';
    case 'settled':
      return record.copilot?.mode === 'background' && record.copilot.retired !== true ? 'idle' : 'completed';
    default: {
      const exhaustive: never = record.status;
      return exhaustive;
    }
  }
}

export function acceptsMessages(record: Projectable): boolean {
  const status = taskStatus(record);
  return record.copilot?.mode === 'background' && (status === 'running' || status === 'idle');
}

export type Transition = Readonly<{ id: string; from: TaskStatus | 'registered'; to: TaskStatus }>;

export function transitionBetween(id: string, before: Projectable | undefined, after: Projectable): Transition | undefined {
  const to = taskStatus(after);
  if (!before) return { id, from: 'registered', to };
  const from = taskStatus(before);
  return from === to ? undefined : { id, from, to };
}
