import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { TaskRecord } from '../worker-records.ts';
import type { WorkerRuntime } from '../worker-runtime.ts';
import type { AgentLaunch } from '../worker-support.ts';
import { checkContinuation, checkRestart, coordinatorMessage } from './continuation.ts';
import { completedAnswer } from './interrupted-turn.ts';
import { ResumeError, resumeMessages } from './resume-errors.ts';

export type ContinueRequest = Readonly<{ callId: string; record: TaskRecord; message: string | undefined; userInitiated: boolean; signal: AbortSignal | undefined }>;
export type ContinueOutcome = Readonly<{ success: true; message: string; alreadyCompleted?: true }>;
type Deps = Readonly<{
  runtime: WorkerRuntime;
  reserve: (ctx: ExtensionContext) => () => void;
  launchFor: (record: TaskRecord, ctx: ExtensionContext) => AgentLaunch | undefined;
}>;

function continueInterrupted(runtime: WorkerRuntime, record: TaskRecord): ContinueOutcome {
  const answer = record.status === 'interrupted' ? completedAnswer(record.sessionFile) : undefined;
  if (answer === undefined) throw new ResumeError('state', `Agent ${record.id} has no interrupted turn to continue. Send a message to resume it.`);
  runtime.settleCompleted(record.id, answer);
  return { success: true, message: `Agent ${record.id} had already completed its interrupted turn`, alreadyCompleted: true };
}

function resumedLaunch(deps: Deps, record: TaskRecord, ctx: ExtensionContext): AgentLaunch | undefined {
  const launch = deps.launchFor(record, ctx);
  if (!launch && record.description !== undefined) throw new ResumeError('state', resumeMessages.notOffered(record.persona));
  return launch;
}

export async function continueAgent(deps: Deps, request: ContinueRequest, ctx: ExtensionContext): Promise<ContinueOutcome> {
  const { runtime, reserve } = deps;
  const { record, message } = request;
  checkContinuation(record.id, runtime.continuationState(record.id));
  if (record.status === 'running') {
    if (message === undefined) throw new ResumeError('busy', resumeMessages.busy(record.id));
    await runtime.message(record.id, coordinatorMessage(message), 'steer');
    return { success: true, message: `Message queued for ${record.id}` };
  }
  checkRestart(record, request.userInitiated);
  if (message === undefined) return continueInterrupted(runtime, record);
  const launch = resumedLaunch(deps, record, ctx);
  const release = reserve(ctx);
  try {
    await runtime.start(request.callId, { prompt: message, resume: record.id }, request.signal, ctx, undefined, launch && { ...launch, onStarted: release });
  } finally {
    release();
  }
  return { success: true, message: `Agent ${record.id} resumed in the background` };
}
