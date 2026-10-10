import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';

const oracleDir = join(import.meta.dirname, '..', 'oracle');

export type OracleOutcome = { readonly result: unknown } | { readonly error: { readonly type: string; readonly message: string } };

export interface OracleCase<A> {
  readonly id: string;
  readonly args: A;
  readonly expected: OracleOutcome;
}

interface RawCase {
  readonly id: string;
  readonly op: string;
  readonly args: unknown;
}

/**
 * The cases for one oracle operation, each paired with the outcome Aider's own Python produced
 * at the pinned commit (captured by scripts/capture-oracle.mjs). Arguments are parsed against
 * `schema`, so a malformed case fails loudly instead of reaching the code under test.
 */
export function oracleCases<S extends TSchema>(area: string, op: string, schema: S): OracleCase<Static<S>>[] {
  const cases: RawCase[] = JSON.parse(readFileSync(join(oracleDir, `${area}.cases.json`), 'utf8'));
  const golden: Record<string, OracleOutcome> = JSON.parse(readFileSync(join(oracleDir, `${area}.golden.json`), 'utf8'));
  const selected = cases.filter((entry) => entry.op === op);
  if (selected.length === 0) throw new Error(`no oracle cases for ${op} in ${area}.cases.json`);
  return selected.map((entry) => {
    const expected = golden[entry.id];
    if (expected === undefined) throw new Error(`golden for ${entry.id} is missing; run scripts/capture-oracle.mjs ${area}`);
    return { id: entry.id, args: Value.Parse(schema, entry.args), expected };
  });
}

/** Runs `fn` and shapes its return value or thrown error like the oracle's outcome record. */
export async function outcomeOf(fn: () => unknown): Promise<OracleOutcome> {
  try {
    return { result: await fn() };
  } catch (error) {
    if (error instanceof Error) return { error: { type: error.name, message: error.message } };
    throw error;
  }
}
