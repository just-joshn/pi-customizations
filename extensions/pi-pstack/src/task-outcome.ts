import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';
import { UsageSchema } from './worker-records.ts';
import { sumUsage } from './worker-support.ts';

const Text = Type.Object({ type: Type.Literal('text'), text: Type.String() });
const Assistant = Type.Object({
  role: Type.Literal('assistant'),
  content: Type.Array(Type.Union([Text, Type.Object({ type: Type.String({ not: Type.Literal('text') }) })])),
  stopReason: Type.Union(['stop', 'length', 'toolUse', 'error', 'aborted'].map((reason) => Type.Literal(reason))),
  errorMessage: Type.Optional(Type.String()),
  usage: Type.Optional(UsageSchema),
});
const Message = Type.Union([Assistant, Type.Object({ role: Type.String({ not: Type.Literal('assistant') }), usage: Type.Optional(UsageSchema) })]);
const Entries = Type.Array(Type.Object({ id: Type.String({ minLength: 1 }), parentId: Type.Union([Type.String(), Type.Null()]), type: Type.String(), message: Type.Optional(Message), usage: Type.Optional(UsageSchema) }));

export function taskOutcome(input: unknown, leafId: string | null) {
  if (!Check(Entries, input)) throw new Error('Invalid task entries.');
  const byId = new Map(input.map((entry) => [entry.id, entry]));
  if (byId.size !== input.length) throw new Error('Invalid task entries: duplicate IDs.');
  const billed = input.flatMap((entry) => {
    const message = entry.type === 'message' ? entry.message : undefined;
    if (message && ['assistant', 'toolResult'].includes(message.role) && message.usage) return [{ role: 'toolResult', usage: message.usage }];
    if (['usage', 'compaction', 'branch_summary'].includes(entry.type) && entry.usage) return [{ role: 'toolResult', usage: entry.usage }];
    return [];
  });
  const usage = sumUsage(billed);
  let last: Static<typeof Assistant> | undefined;
  let reference = leafId;
  let hops = 0;
  while (reference && byId.has(reference)) {
    if (hops++ >= input.length) throw new Error('Invalid task entries: ancestry cycle.');
    const entry = byId.get(reference);
    if (!entry) break;
    if (!last && entry.type === 'message' && Check(Assistant, entry.message)) last = entry.message;
    reference = entry.parentId;
  }
  const text =
    last?.content
      .filter((block) => Check(Text, block))
      .map((block) => block.text)
      .join('')
      .trim() ?? '';
  if (last?.stopReason === 'error' || last?.stopReason === 'aborted') return { status: last.stopReason === 'error' ? ('failed' as const) : ('interrupted' as const), output: last.errorMessage ?? text, usage };
  return { status: 'settled' as const, output: text, usage };
}
