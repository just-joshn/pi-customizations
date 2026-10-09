import { Type } from 'typebox';

const SlackTrigger = Type.Object({
  type: Type.Literal('slack.top_level'),
  channelId: Type.String(),
});

const WebhookTrigger = Type.Object({
  type: Type.Literal('webhook'),
  fields: Type.Array(Type.String()),
  port: Type.Integer({ minimum: 0, maximum: 65535 }),
});

const Definition = {
  name: Type.String(),
  description: Type.String(),
  instructions: Type.String(),
  operationalPath: Type.Optional(Type.String()),
  trigger: Type.Union([SlackTrigger, WebhookTrigger]),
  tools: Type.Array(Type.String()),
  revision: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  directory: Type.String(),
  automationId: Type.String(),
};

const Disabled = Type.Object({ ...Definition, kind: Type.Literal('disabled') });
const Enabled = Type.Object({ ...Definition, kind: Type.Literal('enabled') });

export const AutomationPrepareOutput = Disabled;
export const AutomationInspectOutput = Type.Union([
  Disabled,
  Enabled,
  Type.Object({ ...Definition, kind: Type.Literal('failed'), error: Type.String() }),
]);
const EditorDefinition = Type.Object({
  name: Type.String(),
  description: Type.String(),
  instructions: Type.String(),
  operationalPath: Type.Optional(Type.String()),
  trigger: Type.Union([SlackTrigger, WebhookTrigger]),
  tools: Type.Array(Type.String()),
  revision: Type.String({ pattern: '^[a-f0-9]{64}$' }),
});

export const AutomationOpenEditorOutput = Type.Object({
  opened: Type.Boolean(),
  automationId: Type.String(),
  revision: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  kind: Type.Literal('disabled'),
  name: Type.String(),
  chrome: Type.Optional(Type.Literal('pi-automations-editor-v1')),
  definition: Type.Optional(EditorDefinition),
});
export const AutomationSaveOutput = Disabled;
export const AutomationDisableOutput = Disabled;
export const AutomationEnableOutput = Type.Union([
  Type.Object({
    enabled: Type.Literal(false),
    refused: Type.Literal(true),
    reason: Type.String(),
    revision: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  }),
  Type.Object({
    enabled: Type.Literal(false),
    refused: Type.Literal(false),
    revision: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  }),
  Type.Object({
    enabled: Type.Literal(true),
    refused: Type.Literal(false),
    revision: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    automationId: Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' }),
    kind: Type.Literal('enabled'),
  }),
]);

const SevenChecks = Type.Object({
  triageStoresThreadTsAndOneReply: Type.Literal(true),
  verdictContainsConfiguredMarker: Type.Literal(true),
  reproAcceptsMarkerFromTriageIdentity: Type.Literal(true),
  reproKeepsImmutableSourceCoordinates: Type.Literal(true),
  noSourceChannelRootMessage: Type.Literal(true),
  delegatedWorkerCannotSlackWrite: Type.Literal(true),
  missingCoordsOrFailedPreflightProducesNoPost: Type.Literal(true),
});

export const AutomationRecordThreadSafetyOutput = Type.Object({
  recorded: Type.Literal(true),
  revision: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  checks: SevenChecks,
});
