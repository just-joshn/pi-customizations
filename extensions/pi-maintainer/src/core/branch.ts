import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';
import { BRANDING } from '../branding.ts';
import { EDIT_FORMAT_NAMES } from '../feature.ts';

const strings = Type.Array(Type.String());
const frame = {
  userEntries: strings,
  reflectionsSent: Type.Integer({ minimum: 0 }),
  preparedTargets: strings,
  writtenPaths: strings,
};
const lifecycle = Type.Union([
  Type.Object({ kind: Type.Literal('idle') }),
  Type.Object({ kind: Type.Literal('active'), ...frame, waitingFor: Type.Union([Type.String(), Type.Null()]) }),
  Type.Object({ kind: Type.Literal('interrupted'), ...frame, reason: Type.String() }),
]);

export const snapshotSchema = Type.Object({
  schema: Type.Literal(1),
  kind: Type.Literal('snapshot'),
  root: Type.String(),
  mode: Type.Enum(EDIT_FORMAT_NAMES),
  files: Type.Object({ editable: strings, readOnly: strings }),
  ignoredMentions: strings,
  neverAsk: strings,
  lastUserEntry: Type.Union([Type.String(), Type.Null()]),
  historyThrough: Type.Union([Type.String(), Type.Null()]),
  physicalModel: Type.Union([Type.Object({ provider: Type.String(), id: Type.String() }), Type.Null()]),
  lifecycle,
});
type Immutable<T> = T extends readonly unknown[] ? ReadonlyArray<Immutable<T[number]>> : T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export type Snapshot = Immutable<Static<typeof snapshotSchema>>;

const operationSchema = Type.Object({
  schema: Type.Literal(1),
  kind: Type.Literal('operation-intent'),
  reply: Type.String(),
  ordinal: Type.Integer({ minimum: 0 }),
  operation: Type.Union([Type.Literal('write'), Type.Literal('touch'), Type.Literal('remove')]),
  path: Type.String(),
});
export type OperationIntent = Readonly<Static<typeof operationSchema>>;
const observationSchema = Type.Object({
  schema: Type.Literal(1),
  kind: Type.Literal('operation-observed'),
  reply: Type.String(),
  ordinal: Type.Integer({ minimum: 0 }),
  outcome: Type.Union([Type.Literal('succeeded'), Type.Literal('failed')]),
  error: Type.Union([Type.String(), Type.Null()]),
});
const replySchema = Type.Object({ schema: Type.Literal(1), kind: Type.Literal('reply-finished'), reply: Type.String() });
const noticeSchema = Type.Object({ schema: Type.Literal(1), kind: Type.Literal('notice'), level: Type.Enum(['info', 'warning', 'error']), text: Type.String() });
const settledSchema = Type.Object({ schema: Type.Literal(1), kind: Type.Literal('settled'), outcome: Type.Enum(['idle', 'interrupted']) });

export interface Restored {
  readonly snapshot: Snapshot | null;
  readonly finishedReplies: ReadonlySet<string>;
  readonly pendingOperations: readonly OperationIntent[];
  readonly invalidRecords: readonly string[];
}

const operationKey = (record: { reply: string; ordinal: number }): string => JSON.stringify([record.reply, record.ordinal]);

export function restore(branch: readonly SessionEntry[]): Restored {
  let snapshot: Snapshot | null = null;
  const intents = new Map<string, OperationIntent>();
  const observed = new Set<string>();
  const finished = new Set<string>();
  const invalid: string[] = [];
  for (const entry of branch) {
    if (entry.type !== 'custom' || entry.customType !== BRANDING.stateEntry) continue;
    const data: unknown = entry.data;
    if (Value.Check(snapshotSchema, data)) snapshot = Value.Parse(snapshotSchema, data);
    else if (Value.Check(operationSchema, data)) {
      const key = operationKey(data);
      if (intents.has(key)) invalid.push(entry.id);
      intents.set(key, data);
    } else if (Value.Check(observationSchema, data)) {
      const key = operationKey(data);
      if (!intents.has(key) || observed.has(key)) invalid.push(entry.id);
      observed.add(key);
    } else if (Value.Check(replySchema, data)) finished.add(data.reply);
    else if (!Value.Check(noticeSchema, data) && !Value.Check(settledSchema, data)) invalid.push(entry.id);
  }
  return { snapshot, finishedReplies: finished, pendingOperations: [...intents].filter(([key]) => !observed.has(key)).map(([, intent]) => intent), invalidRecords: invalid };
}

export const chatFilesOf = (snapshot: Snapshot) => ({ editable: new Set(snapshot.files.editable), readOnly: new Set(snapshot.files.readOnly) });
