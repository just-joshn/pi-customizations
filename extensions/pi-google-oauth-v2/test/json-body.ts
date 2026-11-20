import { z } from 'zod';

const JSON_OBJECT = z.looseObject({});

/** Parses a request body the code under test sent, which every test here expects to be a JSON object. */
export function parseJsonBody(body: unknown): Record<string, unknown> {
  return JSON_OBJECT.parse(JSON.parse(String(body)));
}
