import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';
import { ExecutorSchema } from './remote-executors.ts';
import { ToolStatsSchema } from './subagents/tool-stats.ts';

export const taskEntryType = 'pstack-task';
export const taskOwnerEntryType = 'pstack-worker-owner';
export const taskCleanupUsageType = 'pstack-worker-cleanup-usage';
export const taskCleanupErrorType = 'pstack-worker-cleanup-error';
export const taskOutputLimit = 12000;
const TaskOwnerSchema = Type.Object({ id: Type.String({ minLength: 1 }) });

export function taskOwner(entries: ReadonlyArray<{ type: string; customType?: string; data?: unknown }>): string | undefined {
  return entries.flatMap((entry) => (entry.type === 'custom' && entry.customType === taskOwnerEntryType && Check(TaskOwnerSchema, entry.data) ? [entry.data.id] : [])).at(-1);
}
export const UsageSchema = Type.Object({
  input: Type.Number({ minimum: 0 }),
  output: Type.Number({ minimum: 0 }),
  cacheRead: Type.Number({ minimum: 0 }),
  cacheWrite: Type.Number({ minimum: 0 }),
  totalTokens: Type.Number({ minimum: 0 }),
  cost: Type.Object({ input: Type.Number({ minimum: 0 }), output: Type.Number({ minimum: 0 }), cacheRead: Type.Number({ minimum: 0 }), cacheWrite: Type.Number({ minimum: 0 }), total: Type.Number({ minimum: 0 }) }),
});
export const RemotePlacementSchema = Type.Object({
  executor: ExecutorSchema,
  machineId: Type.String({ minLength: 1 }),
  hostname: Type.String({ minLength: 1 }),
  virtualization: Type.String({ minLength: 1 }),
  bootId: Type.String({ minLength: 1 }),
  sha: Type.String({ pattern: '^[0-9a-f]{40,64}$' }),
  localCwd: Type.String({ minLength: 1 }),
});
export const TaskRecordSchema = Type.Object({
  id: Type.String(),
  persona: Type.String(),
  cwd: Type.String(),
  readonly: Type.Boolean(),
  sessionFile: Type.String(),
  outputFile: Type.String(),
  modelReference: Type.Optional(Type.String()),
  modelsUsed: Type.Optional(Type.Array(Type.String())),
  toolStats: Type.Optional(ToolStatsSchema),
  abort: Type.Optional(Type.Object({ reason: Type.String(), telemetry: Type.String(), userInitiated: Type.Boolean(), cutoffNote: Type.Optional(Type.String()) })),
  status: Type.Union([Type.Literal('running'), Type.Literal('settled'), Type.Literal('failed'), Type.Literal('interrupted')]),
  output: Type.String(),
  usage: Type.Optional(UsageSchema),
  agentName: Type.Optional(Type.String()),
  spawnedWithWorktree: Type.Optional(Type.Boolean()),
  worktreeCleanlyRemoved: Type.Optional(Type.Boolean()),
  worktreePath: Type.Optional(Type.String()),
  worktreeBranch: Type.Optional(Type.String()),
  worktreeRepoRoot: Type.Optional(Type.String()),
  worktreeBaseCommit: Type.Optional(Type.String()),
  worktreeHookBased: Type.Optional(Type.Boolean()),
  worktreeCleanupWarning: Type.Optional(Type.String()),
  requestedIsolation: Type.Optional(Type.Union([Type.Literal('worktree'), Type.Literal('remote')])),
  parentAgentId: Type.Optional(Type.String()),
  destination: Type.Optional(
    Type.Object({
      kind: Type.Union([Type.Literal('remote'), Type.Literal('teammate')]),
      sessionUrl: Type.String(),
      sessionId: Type.String(),
      planMode: Type.Optional(Type.Boolean()),
      pane: Type.Optional(Type.String()),
      team: Type.Optional(Type.String()),
    }),
  ),
  inheritedWorktreePath: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  depth: Type.Optional(Type.Integer({ minimum: 1 })),
  toolUseCount: Type.Optional(Type.Integer({ minimum: 0 })),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })),
  startedAt: Type.Optional(Type.Number({ minimum: 0 })),
  toolUseId: Type.Optional(Type.String()),
  requestShape: Type.Optional(Type.Union([Type.Literal('foreground'), Type.Literal('background')])),
  totalTokens: Type.Optional(Type.Number({ minimum: 0 })),
  maxTurnsReached: Type.Optional(Type.Integer({ minimum: 1 })),
  handback: Type.Optional(
    Type.Object({
      recipient: Type.String(),
      delivered: Type.Boolean(),
      flagged: Type.Boolean(),
      bounces: Type.Integer({ minimum: 0 }),
      waitingOnBackground: Type.Boolean(),
      report: Type.Optional(Type.Object({ text: Type.String(), warning: Type.Optional(Type.String()) })),
    }),
  ),
  detached: Type.Optional(
    Type.Object({ directory: Type.String({ minLength: 1 }), invocation: Type.String({ minLength: 1 }), entryCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]), remote: Type.Optional(RemotePlacementSchema) }),
  ),
});
export type TaskRecord = Static<typeof TaskRecordSchema>;
export const TaskParameters = Type.Object({
  prompt: Type.String(),
  subagent_type: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
  environment: Type.Optional(Type.String({ enum: ['local', 'cloud'] })),
  cloud_base_branch: Type.Optional(Type.String({ minLength: 1 })),
  remote_executor: Type.Optional(Type.String({ minLength: 1 })),
  readonly: Type.Optional(Type.Boolean()),
  run_in_background: Type.Optional(Type.Boolean()),
  resume: Type.Optional(Type.String()),
});
export type TaskParameters = Static<typeof TaskParameters>;

export function restoreTaskRecords(entries: ReadonlyArray<{ type: string; customType?: string; data?: unknown }>): Map<string, TaskRecord> {
  const parsed = entries.flatMap((entry) => {
    if (entry.type !== 'custom' || entry.customType !== taskEntryType || !Check(TaskRecordSchema, entry.data)) return [];
    const record = structuredClone(entry.data);
    const restored: TaskRecord = record.status === 'running' && !record.detached ? { ...record, status: 'interrupted', output: 'Parent session ended before completion. Resume this task to continue.' } : record;
    return [[record.id, restored] satisfies [string, TaskRecord]];
  });
  return new Map(parsed);
}

export function taskSummary(record: TaskRecord): string {
  const remote = record.detached?.remote;
  return JSON.stringify({
    task_id: record.id,
    status: record.status,
    output: record.output.slice(0, taskOutputLimit),
    output_file: record.outputFile,
    transcript: record.sessionFile,
    ...(remote ? { placement: { executor: remote.executor.id, machineId: remote.machineId, hostname: remote.hostname, virtualization: remote.virtualization, bootId: remote.bootId, sha: remote.sha, cwd: record.cwd } } : {}),
  });
}
