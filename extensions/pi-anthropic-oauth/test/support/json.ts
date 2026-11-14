import { type Static, type TSchema, Type } from 'typebox';
import { Check, Errors } from 'typebox/value';

export function parseJson<T extends TSchema>(schema: T, text: string): Static<T> {
  const value: unknown = JSON.parse(text);
  if (!Check(schema, value)) throw new Error(`JSON does not match its schema: ${JSON.stringify(Errors(schema, value)[0])}`);
  return value;
}

export const StringFields = Type.Record(Type.String(), Type.String());
