import { createHash } from 'node:crypto';

import { Type } from 'typebox';
import { Check } from 'typebox/value';
export const RoutineSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    prompt: Type.String({ minLength: 1, maxLength: 16000 }),
    fields: Type.Array(Type.String({ pattern: '^[a-zA-Z][a-zA-Z0-9_]{0,63}$' }), { minItems: 1, maxItems: 16, uniqueItems: true }),
    port: Type.Optional(Type.Integer({ minimum: 0, maximum: 65535 })),
  },
  { additionalProperties: false },
);
export function parseRoutine(input) {
  if (!Check(RoutineSchema, input) || !input.name.trim() || !input.prompt.trim()) throw new Error('Invalid routine definition.');
  const definition = { name: input.name, prompt: input.prompt, fields: [...input.fields].sort(), port: input.port ?? 0, trigger: { type: 'webhook' } };
  return { ...definition, revision: createHash('sha256').update(JSON.stringify(definition)).digest('hex') };
}
export function webhookBody(body, fields) {
  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Webhook body must be a JSON object.');
  if (Object.keys(parsed).some((key) => !fields.includes(key))) throw new Error('Webhook body contains an undeclared field.');
  return parsed;
}
