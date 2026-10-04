import { Type } from 'typebox';
import { CiToolSchema } from '../scripts/timer-ci.mjs';
import { RoutineSchema } from './routine-domain.ts';
import { TimerSchema } from './timer-schedules.ts';

const RootReceipt = {
  subscriptionId: Type.String(),
  runId: Type.String(),
  sessionFile: Type.String(),
  rpcDirectory: Type.String(),
};
const TimerReceipt = Type.Union([
  Type.Object({ ...TimerSchema.properties, ...RootReceipt, ...Type.Required(Type.Pick(TimerSchema, ['delaySeconds'])).properties, kind: Type.Optional(Type.Never()) }),
  Type.Object({ ...TimerSchema.properties, ...RootReceipt, ...Type.Required(Type.Pick(TimerSchema, ['cron'])).properties, kind: Type.Optional(Type.Never()) }),
]);
const CiReceipt = Type.Object({
  ...Type.Omit(CiToolSchema, ['pollSeconds', 'name', 'prompt']).properties,
  ...RootReceipt,
  kind: Type.Literal('ci'),
  forge: Type.Union([Type.Literal('github'), Type.Literal('origin')]),
  cwd: Type.String(),
  command: Type.Optional(Type.Array(Type.String())),
  ...Type.Required(Type.Pick(CiToolSchema, ['name', 'prompt'])).properties,
  delaySeconds: Type.Integer({ minimum: 1, maximum: 86400 }),
});
const Execution = Type.Object({ execution: Type.String() });
const SubscriptionReceipt = Type.Union([TimerReceipt, CiReceipt]);
export const TimerSubscriptionOutput = Type.Intersect([SubscriptionReceipt, Execution]);
export const CiSubscriptionOutput = TimerSubscriptionOutput;
const Observation = Type.Object({
  ci: Type.Optional(
    Type.Object({
      state: Type.Optional(Type.Union(['pending', 'success', 'failure', 'merged', 'closed'].map((state) => Type.Literal(state)))),
      head: Type.Optional(Type.String()),
      error: Type.Optional(Type.String()),
    }),
  ),
  status: Type.Optional(Type.Literal('needs_reconciliation')),
  error: Type.Optional(Type.String()),
});
export const SubscriptionListOutput = Type.Array(Type.Intersect([Type.Union([TimerReceipt, CiReceipt]), Observation]));
export const UnsubscribeOutput = Type.Object({ subscriptionId: Type.String(), stopped: Type.Literal(true) });

const Definition = {
  ...Type.Omit(RoutineSchema, ['port']).properties,
  port: Type.Integer({ minimum: 0, maximum: 65535 }),
  trigger: Type.Object({ type: Type.Literal('webhook') }),
  revision: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  directory: Type.String(),
};
export const RoutineReadyOutput = Type.Object({
  ...Definition,
  kind: Type.Literal('ready'),
  pid: Type.Integer(),
  url: Type.String(),
  rpcDirectory: Type.String(),
  runId: Type.String(),
  sessionFile: Type.String(),
});
const Disabled = Type.Object({ ...Definition, kind: Type.Literal('disabled'), pid: Type.Optional(Type.Integer()), pending: Type.Optional(Type.Integer()) });
export const RoutineInspectOutput = Type.Union([
  Disabled,
  RoutineReadyOutput,
  Type.Object({ ...Definition, kind: Type.Literal('starting'), pid: Type.Integer() }),
  Type.Object({ ...Definition, kind: Type.Literal('failed'), error: Type.String(), pid: Type.Optional(Type.Integer()) }),
]);
export const RoutinePrepareOutput = Type.Object({ ...Definition, kind: Type.Literal('disabled'), routineId: Type.String(), initializer: Type.String() });
export const RoutineEnableOutput = Type.Union([Type.Object({ enabled: Type.Literal(false), revision: Definition.revision }), RoutineReadyOutput]);
export const RoutineDisableOutput = Disabled;
