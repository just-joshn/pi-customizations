import type { TaskRecord } from '../worker-records.ts';

export type Settled<T> = Readonly<{ settled: true; value: T }> | Readonly<{ settled: false }>;

export async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(resolve, ms, { settled: false });
  });
  try {
    return await Promise.race([promise.then((value): Settled<T> => ({ settled: true, value })), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function stillStoppingMessage(id: string): string {
  return `Task ${id} is still stopping: its loop never settled after kill. The record is retained as its stop handle; TaskStop re-fires, session restart is the final recovery.`;
}

export function stopPendingDetails(record: TaskRecord) {
  return { status: 'stop_pending' as const, task_id: record.id, task_type: 'local_agent' as const, command: record.description ?? record.persona, message: stillStoppingMessage(record.id) };
}
