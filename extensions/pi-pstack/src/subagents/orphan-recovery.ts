import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type TaskRecord, taskEntryType } from '../worker-records.ts';
import { agentMetaPath } from './agent-storage.ts';
import { groupNotice, type OrphanNotice, orphanSummary, overflowNotice, restartedNotice, restartFailedNotice, settledNotice, singleNote, unreportedNotice, workerRestartReason } from './orphan-notices.ts';
import { findOrphans, type Orphan, type OrphanProbe, planRecovery, type Settlement } from './orphan-plan.ts';
import { notificationBody } from './task-frames.ts';
import type { SdkEvents } from './sdk-events.ts';

type Entry = Readonly<{ type: string; customType?: string; data?: unknown }>;
export type ResumeHandler = (record: TaskRecord, ctx: ExtensionContext) => Promise<Readonly<{ alreadyCompleted?: true }>>;
export type RecoveryDeps = Readonly<{ pi: ExtensionAPI; frames: SdkEvents; ctx: ExtensionContext; branch: readonly Entry[]; resume: ResumeHandler | undefined; canRead: boolean; now?: number }>;
export type Reconciled = Readonly<{ records: ReadonlyMap<string, TaskRecord>; restart: () => Promise<void> }>;

const nothing: Reconciled = { records: new Map(), restart: async () => {} };

function probe(record: TaskRecord): OrphanProbe {
  try {
    return { mtimeMs: statSync(record.sessionFile).mtimeMs, hasMeta: existsSync(agentMetaPath(dirname(record.sessionFile), record.id)) };
  } catch {
    return { mtimeMs: null, hasMeta: false };
  }
}

function send(pi: ExtensionAPI, notice: OrphanNotice): void {
  const details = {
    task_id: notice.taskIds[0],
    ...(notice.taskIds.length > 1 ? { task_ids: notice.taskIds } : {}),
    ...(notice.status ? { status: notice.status } : {}),
    summary: notice.summary,
    task_type: 'local_agent',
    ...(notice.status === 'stopped' || notice.status === 'failed' ? { reason: workerRestartReason } : {}),
  };
  pi.sendMessage({ customType: 'task_notification', content: notice.content, display: true, details }, { triggerTurn: false });
}

function emitRestartFrame(frames: SdkEvents, record: TaskRecord, summary: string): void {
  frames.emit(
    notificationBody({
      task_id: record.id,
      ...(record.toolUseId ? { tool_use_id: record.toolUseId } : {}),
      status: 'stopped',
      reason: workerRestartReason,
      output_file: record.sessionFile,
      summary,
    }),
  );
}

function settledRecord(item: Settlement, canRead: boolean): TaskRecord {
  const output = singleNote(item, canRead);
  const { abort: _abort, ...rest } = item.record;
  return { ...rest, status: item.status === 'failed' ? 'failed' : 'interrupted', output };
}

function noticesFor(settle: readonly Settlement[], overflow: boolean, canRead: boolean): OrphanNotice[] {
  if (overflow) return [overflowNotice(settle, canRead)];
  const single = settle.filter((item) => item.redispatched);
  const grouped = (['stopped', 'failed'] as const).map((status) => settle.filter((item) => !item.redispatched && item.status === status));
  const merged = grouped.flatMap((items) => (items.length > 1 ? [groupNotice(items[0]?.status ?? 'stopped', items, canRead)] : items.map((item) => settledNotice(item, canRead))));
  return [...single.map((item) => settledNotice(item, canRead)), ...merged];
}

async function restartOne(deps: RecoveryDeps, record: TaskRecord): Promise<void> {
  const { pi, ctx, resume, canRead } = deps;
  try {
    const outcome = await resume?.(record, ctx);
    send(pi, outcome?.alreadyCompleted ? unreportedNotice(record, canRead) : restartedNotice(record, canRead));
  } catch (error) {
    pi.appendEntry(taskEntryType, structuredClone(record));
    send(pi, restartFailedNotice(record, error instanceof Error ? error.message : String(error), canRead));
  }
}

/**
 * Settles background tasks whose process is gone. Recent, disk-resumable work is handed to `restart`, which the
 * caller runs once the runtime accepts launches.
 */
export function reconcileOrphans(deps: RecoveryDeps): Reconciled {
  const { pi, frames, branch, resume, canRead } = deps;
  const orphans: Orphan[] = findOrphans(branch);
  if (!orphans.length) return nothing;
  const probes = new Map(orphans.map(({ record }) => [record.id, probe(record)]));
  const plan = planRecovery(orphans, probes, { now: deps.now ?? Date.now(), canResume: resume !== undefined });
  const settled = new Map(plan.settle.map((item) => [item.record.id, settledRecord(item, canRead)]));
  for (const record of settled.values()) pi.appendEntry(taskEntryType, structuredClone(record));
  for (const item of plan.settle) emitRestartFrame(frames, item.record, orphanSummary(item.record, plan.overflow));
  for (const notice of noticesFor(plan.settle, plan.overflow, canRead)) send(pi, notice);
  const restarting = plan.resume.map((record): TaskRecord => ({ ...record, status: 'interrupted' }));
  const restart = async () => {
    for (const record of restarting) await restartOne(deps, record);
  };
  return { records: new Map([...settled, ...restarting.map((record): [string, TaskRecord] => [record.id, record])]), restart };
}
