import type { ChildProcessWithoutNullStreams } from 'node:child_process';

export function rpcProcess(
  child: ChildProcessWithoutNullStreams,
  policy?: { requestDeadlineMs: number; shutdownDeadlineMs: number },
): {
  send(command: Record<string, unknown>): Promise<unknown>;
  readonly stderr: string;
  finish(): Promise<number | null>;
  close(): Promise<void>;
};
