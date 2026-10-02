import { Check } from 'typebox/value';
import { type TaskRecord, TaskRecordSchema, taskEntryType } from '../worker-records.ts';

export const orphanLimit = 20;
export const resumeWindowMs = 172_800_000;

type Entry = Readonly<{ type: string; customType?: string; data?: unknown }>;
export type Orphan = Readonly<{ record: TaskRecord; redispatched: boolean }>;
export type OrphanProbe = Readonly<{ mtimeMs: number | null; hasMeta: boolean }>;
export type Settlement = Readonly<{ record: TaskRecord; status: 'stopped' | 'failed'; redispatched: boolean; transcriptSaved: boolean }>;
export type RecoveryPlan = Readonly<{ resume: readonly TaskRecord[]; settle: readonly Settlement[]; overflow: boolean }>;
export type PlanOptions = Readonly<{ now: number; canResume: boolean }>;

/** Background tasks whose latest persisted record is still running. A task with several running records was re-dispatched. */
export function findOrphans(branch: readonly Entry[]): Orphan[] {
  const records = branch.flatMap((entry) => (entry.type === 'custom' && entry.customType === taskEntryType && Check(TaskRecordSchema, entry.data) ? [entry.data] : []));
  const latest = new Map(records.map((record) => [record.id, record]));
  return [...latest.values()]
    .filter((record) => record.status === 'running' && record.requestShape === 'background')
    .map((record) => ({ record, redispatched: records.filter((other) => other.id === record.id && other.status === 'running').length > 1 }));
}

function resumable(orphan: Orphan, probe: OrphanProbe, options: PlanOptions): boolean {
  return options.canResume && !orphan.redispatched && probe.hasMeta && probe.mtimeMs !== null && options.now - probe.mtimeMs < resumeWindowMs;
}

function settlement(orphan: Orphan, probe: OrphanProbe): Settlement {
  const transcriptSaved = probe.mtimeMs !== null;
  return { record: orphan.record, redispatched: orphan.redispatched, transcriptSaved, status: orphan.redispatched || transcriptSaved ? 'stopped' : 'failed' };
}

export function planRecovery(orphans: readonly Orphan[], probes: ReadonlyMap<string, OrphanProbe>, options: PlanOptions): RecoveryPlan {
  const probeOf = (orphan: Orphan): OrphanProbe => probes.get(orphan.record.id) ?? { mtimeMs: null, hasMeta: false };
  if (orphans.length > orphanLimit) return { resume: [], overflow: true, settle: orphans.map((orphan) => ({ record: orphan.record, redispatched: orphan.redispatched, transcriptSaved: false, status: 'failed' as const })) };
  const resume = orphans.filter((orphan) => resumable(orphan, probeOf(orphan), options));
  const settle = orphans.filter((orphan) => !resume.includes(orphan)).map((orphan) => settlement(orphan, probeOf(orphan)));
  return { resume: resume.map((orphan) => orphan.record), settle, overflow: false };
}
