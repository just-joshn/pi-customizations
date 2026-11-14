import { readFileSync } from 'node:fs';

import type { ThemeToken } from '@earendil-works/pi-coding-agent';
import Type, { type Static, type TSchema } from 'typebox';
import Value from 'typebox/value';

export const roleNames = {
  accent: 'accent',
  border: 'border',
  borderAccent: 'borderAccent',
  borderMuted: 'borderMuted',
  success: 'success',
  error: 'error',
  warning: 'warning',
  muted: 'muted',
  dim: 'dim',
  text: 'text',
  thinkingText: 'thinkingText',
  scrollbarTrack: 'scrollbarTrack',
  scrollbarThumb: 'scrollbarThumb',
  selectedBg: 'selectedBg',
  searchMatchBg: 'searchMatchBg',
  searchMatchText: 'searchMatchText',
  userMessageBg: 'userMessageBg',
  userMessageText: 'userMessageText',
  customMessageBg: 'customMessageBg',
  customMessageText: 'customMessageText',
  customMessageLabel: 'customMessageLabel',
  toolPendingBg: 'toolPendingBg',
  toolSuccessBg: 'toolSuccessBg',
  toolErrorBg: 'toolErrorBg',
  toolTitle: 'toolTitle',
  toolOutput: 'toolOutput',
  mdHeading: 'mdHeading',
  mdLink: 'mdLink',
  mdLinkUrl: 'mdLinkUrl',
  mdCode: 'mdCode',
  mdCodeBlock: 'mdCodeBlock',
  mdCodeBlockBorder: 'mdCodeBlockBorder',
  mdQuote: 'mdQuote',
  mdQuoteBorder: 'mdQuoteBorder',
  mdHr: 'mdHr',
  mdListBullet: 'mdListBullet',
  toolDiffAdded: 'toolDiffAdded',
  toolDiffRemoved: 'toolDiffRemoved',
  toolDiffContext: 'toolDiffContext',
  syntaxComment: 'syntaxComment',
  syntaxKeyword: 'syntaxKeyword',
  syntaxFunction: 'syntaxFunction',
  syntaxVariable: 'syntaxVariable',
  syntaxString: 'syntaxString',
  syntaxNumber: 'syntaxNumber',
  syntaxType: 'syntaxType',
  syntaxOperator: 'syntaxOperator',
  syntaxPunctuation: 'syntaxPunctuation',
  thinkingOff: 'thinkingOff',
  thinkingMinimal: 'thinkingMinimal',
  thinkingLow: 'thinkingLow',
  thinkingMedium: 'thinkingMedium',
  thinkingHigh: 'thinkingHigh',
  thinkingXhigh: 'thinkingXhigh',
  thinkingMax: 'thinkingMax',
  bashMode: 'bashMode',
} satisfies Record<ThemeToken, ThemeToken>;
export const RoleSchema = Type.Enum(roleNames);
export const DirectionSchema = Type.Union([Type.Literal('fg'), Type.Literal('bg')]);
export const MappingClassSchema = Type.Union([Type.Literal('measured'), Type.Literal('renderer-required'), Type.Literal('unmappable'), Type.Literal('pi-only')]);
export const VerdictSchema = Type.Union([Type.Literal('PASS'), Type.Literal('FAIL'), Type.Literal('INCONCLUSIVE')]);
export const HexSchema = Type.TemplateLiteral('#${string}', { pattern: '^#[0-9a-f]{6}$' });
export const ColorValueSchema = Type.Union([HexSchema, Type.TemplateLiteral('ansi:${number}', { pattern: '^ansi:[0-9]+$' }), Type.Literal('default')]);
export const CoordinateSchema = Type.TemplateLiteral('${number}:${number}', { pattern: '^[0-9]+:[0-9]+$' });
export const PointerSchema = Type.TemplateLiteral('${string}@${number}:${number}', { pattern: '^[\\w-]+@[0-9]+:[0-9]+$' });
export type Direction = Static<typeof DirectionSchema>;
export type MappingClass = Static<typeof MappingClassSchema>;
export type Verdict = Static<typeof VerdictSchema>;
export type ColorValue = Static<typeof ColorValueSchema>;
export type Coordinate = Static<typeof CoordinateSchema>;
export type CapturePointer = Static<typeof PointerSchema>;
export const directions: Direction[] = ['fg', 'bg'];
export const verdicts: Verdict[] = ['PASS', 'FAIL', 'INCONCLUSIVE'];

export function parseValue<S extends TSchema>(value: unknown, schema: S): Static<S> {
  Value.Assert(schema, value);
  return value;
}
export function readJson<S extends TSchema>(path: string, schema: S): Static<S> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parseValue(value, schema);
  } catch (error) {
    throw new Error(`Invalid JSON file ${path}`, { cause: error });
  }
}
export const parseRole = (value: string): ThemeToken => parseValue(value, RoleSchema);
export const parseColorValue = (value: unknown): ColorValue => parseValue(value, ColorValueSchema);
export const isColorValue = (value: unknown): value is ColorValue => Value.Check(ColorValueSchema, value);
export function parsePointer(value: CapturePointer) {
  const separator = value.indexOf('@');
  const scene = value.slice(0, separator);
  const [row = 0, col = 0] = value
    .slice(separator + 1)
    .split(':')
    .map(Number);
  const at: Coordinate = `${row}:${col}`;
  return { scene, at, row, col };
}
export function parseCoordinate(value: Coordinate) {
  const [row = 0, col = 0] = value.split(':').map(Number);
  return { row, col };
}
export function roleEntries<T>(roles: Partial<Record<ThemeToken, T>>): [ThemeToken, T][] {
  return Object.keys(roles).flatMap((key): [ThemeToken, T][] => {
    const role = Object.values(roleNames).find((name) => name === key);
    if (role === undefined) return [];
    const value = roles[role];
    return value === undefined ? [] : [[role, value]];
  });
}

export const PaletteSchema = Type.Object({ foreground_rgb: HexSchema, background_rgb: HexSchema, ansi16_rgb: Type.Array(HexSchema, { minItems: 16, maxItems: 16 }) });
export type Palette = Static<typeof PaletteSchema>;
export const ProbeMapSchema = Type.Record(Type.String({ pattern: '^#[0-9a-f]{6}$' }), RoleSchema);
export const ObservationSchema = Type.Object({
  role: RoleSchema,
  direction: DirectionSchema,
  token: Type.String(),
  scene: Type.String(),
  piAt: CoordinateSchema,
  claudeAt: CoordinateSchema,
  claude: Type.String(),
  claudeAttrs: Type.String(),
});
export const ObservationsSchema = Type.Array(ObservationSchema);
export type Observation = Static<typeof ObservationSchema>;
const ContextSchema = Type.Object({
  at: Type.Optional(PointerSchema),
  evidence: Type.Optional(Type.Array(PointerSchema)),
  value: Type.String(),
  attrs: Type.Optional(Type.String()),
  direction: Type.Optional(DirectionSchema),
  surface: Type.Optional(Type.String()),
});
const reviewFields = {
  value: Type.Union([Type.String(), Type.Null()]),
  attrs: Type.Union([Type.String(), Type.Null()]),
  evidence: Type.Optional(Type.Array(PointerSchema)),
  contexts: Type.Optional(Type.Array(ContextSchema)),
  note: Type.Optional(Type.String()),
};
export const ReviewSchema = Type.Union([
  Type.Object({ class: Type.Literal('measured'), ...reviewFields }),
  Type.Object({ class: Type.Literal('renderer-required'), ...reviewFields }),
  Type.Object({ class: Type.Literal('unmappable'), ...reviewFields }),
  Type.Object({ class: Type.Literal('pi-only'), ...reviewFields }),
]);
export type Review = Static<typeof ReviewSchema>;
export const ReviewsSchema = Type.Object({
  roles: Type.Record(RoleSchema, ReviewSchema, { additionalProperties: false }),
  claudeOnly: Type.Optional(Type.Array(Type.Object({ scene: Type.String(), at: CoordinateSchema, value: Type.String(), attrs: Type.String(), surface: Type.String(), closestPi: Type.String(), direction: Type.Optional(DirectionSchema) }))),
});
export const RoleMappingSchema = Type.Union([
  Type.Object({
    class: MappingClassSchema,
    source: Type.Literal('capture'),
    value: ColorValueSchema,
    direction: DirectionSchema,
    evidence: Type.Array(PointerSchema, { minItems: 1 }),
    agreedBy: Type.Optional(Type.Array(Type.String())),
    otherContexts: Type.Optional(Type.Array(Type.String())),
    rationale: Type.Optional(Type.String()),
  }),
  Type.Object({ class: MappingClassSchema, source: Type.Literal('stock-pi'), direction: DirectionSchema }),
]);
export type RoleMapping = Static<typeof RoleMappingSchema>;
export const SurfacesSchema = Type.Object({
  $comment: Type.Optional(Type.String()),
  surfaces: Type.Array(
    Type.Object({
      role: RoleSchema,
      direction: DirectionSchema,
      claude: PointerSchema,
      pi: Type.Object({ scene: Type.String(), find: Type.String({ minLength: 1 }), char: Type.String({ minLength: 1 }), after: Type.Optional(Type.Integer({ minimum: 1 })) }),
      differentText: Type.Optional(Type.String({ minLength: 1 })),
      surface: Type.String(),
    }),
  ),
});
export const OverridesSchema = Type.Object({
  roles: Type.Partial(
    Type.Record(RoleSchema, Type.Object({ class: MappingClassSchema, value: ColorValueSchema, direction: DirectionSchema, evidence: Type.Array(PointerSchema, { minItems: 1 }), rationale: Type.String({ minLength: 1 }) }), {
      additionalProperties: false,
    }),
  ),
});
export const MappingSchema = Type.Object({ roles: Type.Record(RoleSchema, RoleMappingSchema, { additionalProperties: false }), disagreements: Type.Optional(Type.Array(Type.String())) });
export const ManualCheckSchema = Type.Object({ name: Type.String(), verdict: VerdictSchema, note: Type.String(), packageSha256: Type.String(), evidence: Type.Array(Type.Object({ file: Type.String(), sha256: Type.String() })) });
export const ManualChecksSchema = Type.Object({ checks: Type.Array(ManualCheckSchema) });
export type ManualCheck = Static<typeof ManualCheckSchema>;
export const ThemeSchema = Type.Object({
  colors: Type.Record(RoleSchema, Type.Union([Type.String(), Type.Number()]), { additionalProperties: false }),
  vars: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()]))),
});
export const CaptureRunSchema = Type.Object({
  scenes: Type.Record(Type.String(), Type.Union([Type.Literal('comparable'), Type.Literal('pi-only')])),
  failures: Type.Record(Type.String(), Type.Unknown()),
  nonLoopbackConnections: Type.Array(Type.String()),
  width: Type.Number(),
  refusedEgress: Type.Array(Type.String()),
  themeSha256: Type.Optional(Type.String()),
  packageSha256: Type.Optional(Type.String()),
});
export const InputsSchema = Type.Object({ package: Type.Optional(Type.String()), theme: Type.Optional(Type.String()), evidence: Type.Optional(Type.String()) });
export type Inputs = Static<typeof InputsSchema>;
export const TallySchema = Type.Object({ PASS: Type.Number(), FAIL: Type.Number(), INCONCLUSIVE: Type.Number() });
const gateFields = {
  gate: Type.String(),
  verdict: VerdictSchema,
  inputs: Type.Optional(InputsSchema),
  checks: Type.Optional(Type.Array(Type.Object({ name: Type.String(), verdict: VerdictSchema, evidence: Type.Unknown() }))),
  total: Type.Optional(TallySchema),
};
export const GateSchema = Type.Object(gateFields);
export const G4Schema = Type.Object({
  themed: Type.String(),
  ...gateFields,
  total: TallySchema,
  byRole: Type.Partial(Type.Record(RoleSchema, TallySchema)),
  results: Type.Array(
    Type.Object({
      role: RoleSchema,
      class: MappingClassSchema,
      scene: Type.String(),
      claudeAt: CoordinateSchema,
      piAt: Type.Optional(CoordinateSchema),
      direction: DirectionSchema,
      verdict: VerdictSchema,
      expected: Type.Optional(Type.String()),
      actual: Type.Optional(Type.String()),
      reason: Type.Optional(Type.String()),
    }),
  ),
});
const TestResultsSchema = Type.Object({
  G0: Type.Optional(VerdictSchema),
  G1: Type.Optional(VerdictSchema),
  G2: Type.Optional(VerdictSchema),
  G3: Type.Optional(VerdictSchema),
  G4: Type.Optional(VerdictSchema),
  G5: Type.Optional(VerdictSchema),
  G6: Type.Optional(VerdictSchema),
  G7: Type.Optional(VerdictSchema),
  G8: Type.Optional(VerdictSchema),
  G9: Type.Optional(VerdictSchema),
  G10: Type.Optional(VerdictSchema),
});
export type GateName = keyof Static<typeof TestResultsSchema>;
export const ReferenceLockSchema = Type.Object({
  $comment: Type.String(),
  target: Type.Object({ version: Type.String() }),
  host: Type.Object({ version: Type.String() }),
  terminal: Type.Object({ emulator: Type.String(), emulator_version: Type.String(), operating_system: Type.String(), width_columns: Type.Number(), height_rows: Type.Number(), TERM: Type.String(), COLORTERM: Type.String() }),
  inventory: Type.Object({ reference_covered_roles: Type.Number(), verified_comparable_surfaces: Type.Number() }),
  test_results: TestResultsSchema,
  release_decision: Type.String(),
  release_reason: Type.String(),
});
