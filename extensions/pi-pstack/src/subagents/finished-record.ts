import type { Usage } from '@earendil-works/pi-ai';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { type TaskRecord, taskOutputLimit } from '../worker-records.ts';
import { type openWorkerSession, sumUsage } from '../worker-support.ts';
import { lastMeteredTokens } from './completion-notice.ts';
import { countToolStats } from './tool-stats.ts';

type End = Readonly<{ status: TaskRecord['status']; output: string; messages: AgentSession['messages']; startedAt: number; limited?: number }>;

/** The settled record for a local child, with usage added to whatever the record already carried. */
export function finishedRecord(worker: Awaited<ReturnType<typeof openWorkerSession>>, pendingUsage: Usage | undefined, abort: TaskRecord['abort'], end: End): TaskRecord {
  const { session, record, modelsUsed } = worker;
  const { totalToolUseCount: toolUseCount, toolStats } = countToolStats(end.messages);
  if (session.model) modelsUsed.record(`${session.model.provider}/${session.model.id}`);
  const totalTokens = lastMeteredTokens(end.messages);
  return {
    ...record,
    status: end.status,
    output: end.output.slice(0, taskOutputLimit),
    usage: sumUsage(end.messages, pendingUsage),
    toolUseCount,
    durationMs: Date.now() - end.startedAt,
    ...(session.model ? { modelReference: `${session.model.provider}/${session.model.id}:${session.thinkingLevel}` } : {}),
    modelsUsed: modelsUsed.snapshot(),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(end.limited ? { maxTurnsReached: end.limited } : {}),
    ...(abort ? { abort } : {}),
    ...(toolStats ? { toolStats } : {}),
  };
}
