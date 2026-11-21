import type { z } from 'zod';

/** Parses `input` with `schema`, or logs the failure and throws `message` with the validation error as its cause. */
export function parseOrThrow<Schema extends z.ZodType>(schema: Schema, input: unknown, message: string): z.output<Schema> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  console.error(message, result.error);
  throw new Error(message, { cause: result.error });
}
