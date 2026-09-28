import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';

export const taskEntryType = 'pstack-task';
export const taskOutputLimit = 12000;
const UsageSchema = Type.Object({
  input: Type.Number({ minimum: 0 }), output: Type.Number({ minimum: 0 }),
  cacheRead: Type.Number({ minimum: 0 }), cacheWrite: Type.Number({ minimum: 0 }), totalTokens: Type.Number({ minimum: 0 }),
  cost: Type.Object({ input: Type.Number({ minimum: 0 }), output: Type.Number({ minimum: 0 }),
    cacheRead: Type.Number({ minimum: 0 }), cacheWrite: Type.Number({ minimum: 0 }), total: Type.Number({ minimum: 0 }) }),
});
const TaskRecordSchema = Type.Object({
  id: Type.String(), persona: Type.String(), cwd: Type.String(), readonly: Type.Boolean(),
  sessionFile: Type.String(), outputFile: Type.String(), modelReference: Type.Optional(Type.String()),
  status: Type.Union([Type.Literal('running'), Type.Literal('settled'), Type.Literal('failed'), Type.Literal('interrupted')]),
  output: Type.String(), usage: Type.Optional(UsageSchema),
});
export type TaskRecord = Static<typeof TaskRecordSchema>;
export const TaskParameters = Type.Object({
  prompt: Type.String(), subagent_type: Type.Optional(Type.String()), model: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()), environment: Type.Optional(Type.String({ enum: ['local', 'cloud'] })),
  readonly: Type.Optional(Type.Boolean()), run_in_background: Type.Optional(Type.Boolean()), resume: Type.Optional(Type.String()),
});
export type TaskParameters = Static<typeof TaskParameters>;

export function restoreTaskRecords(entries: ReadonlyArray<{ type: string; customType?: string; data?: unknown }>): Map<string, TaskRecord> {
  const parsed = entries.flatMap(entry => {
    if (entry.type !== 'custom' || entry.customType !== taskEntryType || !Check(TaskRecordSchema, entry.data)) return [];
    const record = structuredClone(entry.data);
    const restored: TaskRecord = record.status === 'running'
      ? { ...record, status: 'interrupted', output: 'Parent session ended before completion. Resume this task to continue.' } : record;
    return [[record.id, restored] satisfies [string, TaskRecord]];
  });
  return new Map(parsed);
}

export function taskSummary(record: TaskRecord): string {
  return JSON.stringify({ task_id: record.id, status: record.status, output: record.output.slice(0, taskOutputLimit), output_file: record.outputFile, transcript: record.sessionFile });
}
