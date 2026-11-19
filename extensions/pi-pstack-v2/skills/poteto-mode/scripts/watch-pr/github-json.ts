import { z } from "zod";
import type { QueryFailure } from "./types.ts";

const jsonValue = z.json();

export class WatcherQueryError extends Error {
  constructor(readonly failure: QueryFailure) {
    super(failure.detail);
  }
  override get name(): string {
    return "WatcherQueryError";
  }
}
export class ChecksUnavailable extends WatcherQueryError {
  constructor(detail: string) {
    super({ kind: "checks-unavailable", retryable: true, detail });
  }
  override get name(): string {
    return "ChecksUnavailable";
  }
}
export const firstLine = (value: string): string =>
  value.trim().split(/\r?\n/, 1)[0]?.slice(0, 240) ?? "";
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
export function parseJson(text: string, label: string): unknown {
  try {
    return jsonValue.parse(JSON.parse(text));
  } catch (error) {
    throw new WatcherQueryError({
      kind: "json-parse",
      retryable: true,
      detail: `${label}: ${errorMessage(error)}`,
    });
  }
}
function raw(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
export function missing(path: string, value?: unknown): never {
  throw new WatcherQueryError({
    kind: "missing-key",
    retryable: true,
    detail:
      value === undefined
        ? `missing ${path}`
        : `invalid ${path}: ${raw(value)}`,
    ...(value === undefined ? {} : { rawValue: raw(value) }),
  });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) missing(path, value);
  return value;
}
export function list(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) missing(path, value);
  return value;
}
export function at(value: unknown, path: readonly string[]): unknown {
  return path.reduce((current, key) => {
    const object = record(current, path.join("."));
    if (!(key in object)) missing(path.join("."));
    return object[key];
  }, value);
}
export function string(value: unknown, path: string): string {
  if (typeof value !== "string") missing(path, value);
  return value;
}
export const optionalString = (value: unknown, path: string): string | null =>
  value === null ? null : string(value, path);
export function enumValue<const V extends readonly string[]>(
  value: unknown,
  values: V,
  path: string
): V[number] {
  const match = values.find((candidate) => candidate === value);
  return match ?? missing(path, value);
}
export const nullableEnum = <const V extends readonly string[]>(
  value: unknown,
  values: V,
  path: string
): V[number] | null => (value === null ? null : enumValue(value, values, path));
