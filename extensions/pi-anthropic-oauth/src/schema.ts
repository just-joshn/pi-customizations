import type { TSchema } from 'typebox';
import { Errors } from 'typebox/value';

export function invalidFields(schema: TSchema, value: unknown): ReadonlySet<string> {
  const fields = new Set<string>();
  for (const error of Errors(schema, value)) {
    if (error.keyword === 'required') for (const name of error.params.requiredProperties) fields.add(name);
    else fields.add(error.instancePath.split('/').at(-1) ?? '');
  }
  return fields;
}
