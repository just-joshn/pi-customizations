import { readFileSync } from 'node:fs';

import { z } from 'zod';
import type { Json, JsonObject } from './json.ts';
import type { Extractor, Metric } from './metric-types.ts';

const PERCENT_SCALE = 100;
const EXACT_DIGITS = 100;
const HALF = 2;
const TIE_DIGIT = '5';
const ONLY_ZEROS = /^0*$/;
const PERCENT_SIGN = '%';

const RecordSchema = z.record(z.string(), z.json());

/** Parses each non-blank line of a run.py JSONL file. */
export function readRecords(path: string): JsonObject[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => RecordSchema.parse(JSON.parse(line)));
}

const LINE_BREAK = /\r\n|[\n\r\u0085\u2028\u2029]/;

/** The last line of a JSONL file, parsed. */
export function lastRecord(path: string): JsonObject {
  const line = readFileSync(path, 'utf8').trim().split(LINE_BREAK).at(-1);
  if (line === undefined || line === '') throw new Error(`${path} has no records`);
  return RecordSchema.parse(JSON.parse(line));
}

export const isObject = (value: Json | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

export function at(node: Json | undefined, path: readonly string[]): Json | undefined {
  return path.reduce<Json | undefined>((current, key) => (isObject(current) && Object.hasOwn(current, key) ? current[key] : undefined), node);
}

export function stringAt(record: JsonObject, key: string): string {
  const value = at(record, [key]);
  if (typeof value !== 'string') throw new Error(`record has no string "${key}"`);
  return value;
}

export function numberAt(record: JsonObject, key: string): number {
  const value = at(record, [key]);
  if (typeof value !== 'number') throw new Error(`record has no number "${key}"`);
  return value;
}

/** Items grouped by key, in order of first appearance. */
export function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  return new Map([...new Set(items.map(keyOf))].map((key) => [key, items.filter((item) => keyOf(item) === key)]));
}

function asNumber(value: Json | undefined): number | undefined {
  if (typeof value === 'number') return value;
  return typeof value === 'boolean' ? Number(value) : undefined;
}

const numberList = (value: Json | undefined): number[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const numbers = value.filter((item): item is number => typeof item === 'number');
  return numbers.length === value.length ? numbers : undefined;
};

export const metric = (name: string, extract: Extractor): Metric => ({ name, extract });

export const field =
  (...path: string[]): Extractor =>
  (record) =>
    asNumber(at(record, path));

export const sumOf =
  (...parts: Extractor[]): Extractor =>
  (record) => {
    const values = parts.map((part) => part(record));
    return values.every((value) => value !== undefined) ? values.reduce((total, value) => total + value, 0) : undefined;
  };

export const sumOfStepField =
  (key: string): Extractor =>
  (record) => {
    const steps = at(record, ['steps']);
    if (!isObject(steps)) return undefined;
    const values = Object.values(steps).map((step) => asNumber(at(step, [key])));
    return values.every((value) => value !== undefined) ? values.reduce((total, value) => total + value, 0) : undefined;
  };

export const percentileField =
  (path: string[], p: number): Extractor =>
  (record) => {
    const values = numberList(at(record, path));
    return values === undefined ? undefined : percentile(values, p);
  };

export const maxField =
  (path: string[]): Extractor =>
  (record) => {
    const values = numberList(at(record, path));
    return values === undefined || values.length === 0 ? undefined : Math.max(...values);
  };

/** Linear-interpolated percentile of a non-empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('percentile of an empty list');
  const ordered = values.toSorted((a, b) => a - b);
  const rank = ((ordered.length - 1) * p) / PERCENT_SCALE;
  const low = Math.trunc(rank);
  const high = Math.min(low + 1, ordered.length - 1);
  const lowValue = ordered[low] ?? 0;
  const highValue = ordered[high] ?? 0;
  return lowValue + (highValue - lowValue) * (rank - low);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of an empty list');
  const ordered = values.toSorted((a, b) => a - b);
  const middle = Math.trunc(ordered.length / HALF);
  const upper = ordered[middle] ?? 0;
  if (ordered.length % HALF === 1) return upper;
  return ((ordered[middle - 1] ?? 0) + upper) / HALF;
}

export const requireValue = (extract: Extractor, record: JsonObject): number => {
  const value = extract(record);
  if (value === undefined) throw new Error('record lacks a metric the workload should have');
  return value;
};

/** Fixed-point text that rounds exact ties to even, like Python's format(), where toFixed rounds them up. */
export function formatFixed(value: number, digits: number): string {
  const [whole = '', fraction = ''] = Math.abs(value).toFixed(EXACT_DIGITS).split('.');
  const tail = fraction.slice(digits);
  const isTie = tail.startsWith(TIE_DIGIT) && ONLY_ZEROS.test(tail.slice(1));
  const truncated = `${whole}${fraction.slice(0, digits)}`;
  const lastDigit = Number(truncated.slice(-1));
  if (!isTie || lastDigit % HALF === 1) return value.toFixed(digits);
  const sign = value < 0 || Object.is(value, -0) ? '-' : '';
  const split = truncated.length - digits;
  return `${sign}${truncated.slice(0, split)}${digits > 0 ? '.' : ''}${truncated.slice(split)}`;
}

/** Python's `{value:.Nf%}` with an optional leading `+` for non-negative values. */
export function formatPercent(value: number, digits: number, signed = false): string {
  const text = formatFixed(value * PERCENT_SCALE, digits);
  const plus = signed && !text.startsWith('-') ? '+' : '';
  return `${plus}${text}${PERCENT_SIGN}`;
}

export const write = (lines: readonly string[]): void => {
  process.stdout.write(`${lines.join('\n')}\n`);
};
