import { createHash } from 'node:crypto';

import { Type } from 'typebox';
import { Check } from 'typebox/value';

const SlackTrigger = Type.Object(
  {
    type: Type.Literal('slack.top_level'),
    channelId: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

const WebhookTrigger = Type.Object(
  {
    type: Type.Literal('webhook'),
    fields: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 16, uniqueItems: true }),
    port: Type.Integer({ minimum: 0, maximum: 65535 }),
  },
  { additionalProperties: false },
);

export const AutomationSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    description: Type.String({ maxLength: 500 }),
    instructions: Type.String({ minLength: 1, maxLength: 16000 }),
    operationalPath: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    trigger: Type.Union([SlackTrigger, WebhookTrigger]),
    tools: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32, uniqueItems: true }),
  },
  { additionalProperties: false },
);

function canonicalBody(input) {
  const trigger =
    input.trigger.type === 'webhook'
      ? { type: 'webhook', fields: [...input.trigger.fields].sort(), port: input.trigger.port }
      : { type: 'slack.top_level', channelId: input.trigger.channelId };
  const body = {
    name: input.name.trim(),
    description: input.description,
    instructions: input.instructions.trim(),
    trigger,
    tools: [...input.tools].sort(),
  };
  if (input.operationalPath !== undefined) body.operationalPath = input.operationalPath;
  return body;
}

export function parseAutomation(input) {
  if (!Check(AutomationSchema, input) || !input.name.trim() || !input.instructions.trim()) {
    throw new Error('Invalid automation definition.');
  }
  if (input.trigger.type === 'slack.top_level' && !input.trigger.channelId.trim()) {
    throw new Error('Invalid automation definition.');
  }
  const definition = canonicalBody(input);
  return { ...definition, revision: createHash('sha256').update(JSON.stringify(definition)).digest('hex') };
}
