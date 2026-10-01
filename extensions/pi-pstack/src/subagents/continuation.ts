import { existsSync } from 'node:fs';

import type { TaskRecord } from '../worker-records.ts';
import { ResumeError, resumeMessages } from './resume-errors.ts';

export type ContinuationState = Readonly<{ inFlight: boolean; stopping: boolean; resumerStopping: boolean }>;

export function coordinatorMessage(message: string): string {
  return `The coordinator sent a message while you were working:\n${message}\n\nAddress this before completing your current task.`;
}

export function stoppedByUser(record: TaskRecord): boolean {
  return record.status === 'interrupted' && record.abort?.userInitiated === true;
}

export function checkContinuation(id: string, state: ContinuationState): void {
  if (state.inFlight) throw new ResumeError('busy', resumeMessages.busy(id));
  if (state.resumerStopping) throw new ResumeError('still_stopping', resumeMessages.resumerStopping);
  if (state.stopping) throw new ResumeError('still_stopping', resumeMessages.targetStopping(id));
}

export function checkRestart(record: TaskRecord, userInitiated: boolean): void {
  if (stoppedByUser(record) && !userInitiated) throw new ResumeError('user_stopped', resumeMessages.userStopped(record.id));
  if (!existsSync(record.sessionFile)) throw new ResumeError('state', resumeMessages.transcriptMissing(record.id));
}
