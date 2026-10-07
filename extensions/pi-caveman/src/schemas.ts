import { Type } from 'typebox';

const Count = Type.Number();
const OptionalCount = Type.Optional(Count);

export const ConfigFile = Type.Object({ defaultMode: Type.Optional(Type.String()) });

export const StoredModeData = Type.Object({ mode: Type.String(), returnTo: Type.Optional(Type.Union([Type.String(), Type.Null()])) });

export const ModeCustomEntry = Type.Object({ type: Type.Literal('custom'), customType: Type.String(), data: Type.Unknown(), timestamp: Type.String() });

export const AssistantEntry = Type.Object({
  type: Type.Literal('message'),
  message: Type.Object({
    role: Type.Literal('assistant'),
    model: Type.Optional(Type.String()),
    timestamp: Type.Optional(Count),
    usage: Type.Optional(Type.Object({ output: Type.Optional(Type.Unknown()), cacheRead: Type.Optional(Type.Unknown()) })),
  }),
});

export const HistoryRow = Type.Object({
  ts: Type.Optional(Count),
  session_id: Type.Optional(Type.String()),
  output_tokens: Type.Optional(Type.Unknown()),
  output_tokens_availability: Type.Optional(Type.Unknown()),
});

const CrewCost = Type.Object({ input: OptionalCount, output: OptionalCount, cacheRead: OptionalCount, cacheWrite: OptionalCount, total: OptionalCount });

export const CrewMessageEnd = Type.Object({
  type: Type.Literal('message_end'),
  message: Type.Object({
    role: Type.Literal('assistant'),
    content: Type.Optional(Type.Array(Type.Unknown())),
    usage: Type.Optional(Type.Object({ input: OptionalCount, output: OptionalCount, cacheRead: OptionalCount, cacheWrite: OptionalCount, totalTokens: OptionalCount, cost: Type.Optional(CrewCost) })),
  }),
});

export const TextPart = Type.Object({ type: Type.Literal('text'), text: Type.String() });
