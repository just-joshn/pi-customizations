import { z } from "zod";

export const OBSERVED_AT = "2026-07-26T00:00:00.000Z";

const verdictLine = z.looseObject({
  schemaVersion: z.literal(1),
  sequence: z.number(),
  observedAt: z.string(),
  mode: z.string(),
  kind: z.string(),
  terminal: z.boolean(),
  exitCode: z.number().optional(),
});

export type VerdictLine = z.infer<typeof verdictLine>;

/** Parses NDJSON the way an agent reading the watcher's stdout would. */
export function parseLines(stdout: string): readonly VerdictLine[] {
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => verdictLine.parse(JSON.parse(line)));
}

export const kindsOf = (lines: readonly VerdictLine[]): readonly string[] =>
  lines.map((line) => line.kind);

/** Reads a dotted path such as `scope.pr.context.number` from parsed output. */
export function get(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        typeof current === "object" && current !== null ? Reflect.get(current, key) : undefined,
      value
    );
}

/** Reads `key` from every item of the array at `path`. */
export function pluck(value: unknown, path: string, key: string): readonly unknown[] {
  const items = get(value, path);
  return Array.isArray(items) ? items.map((item) => get(item, key)) : [];
}
