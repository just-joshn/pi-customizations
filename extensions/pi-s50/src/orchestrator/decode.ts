export type Decoded<T> = { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'invalid'; readonly reason: string };

export type Decoder<T> = (input: unknown, path: string) => T;

class DecodeError extends Error {}

function fail(path: string, expected: string): never {
  throw new DecodeError(`${path}: expected ${expected}`);
}

export function decode<T>(decoder: Decoder<T>, input: unknown): Decoded<T> {
  try {
    return { kind: 'ok', value: decoder(input, '$') };
  } catch (error) {
    if (error instanceof DecodeError) return { kind: 'invalid', reason: error.message };
    throw error;
  }
}

export function parseJson(text: string): Decoded<unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return { kind: 'ok', value };
  } catch (error) {
    return { kind: 'invalid', reason: error instanceof Error ? error.message : 'invalid JSON' };
  }
}

export const str: Decoder<string> = (input, path) => (typeof input === 'string' ? input : fail(path, 'string'));

export const nonEmptyStr: Decoder<string> = (input, path) => (typeof input === 'string' && input.trim() !== '' ? input : fail(path, 'non-empty string'));

export const num: Decoder<number> = (input, path) => (typeof input === 'number' && Number.isFinite(input) ? input : fail(path, 'number'));

export const bool: Decoder<boolean> = (input, path) => (typeof input === 'boolean' ? input : fail(path, 'boolean'));

export function oneOf<const T extends string | number>(values: readonly T[]): Decoder<T> {
  return (input, path) => {
    const found = values.find((value) => value === input);
    return found === undefined ? fail(path, `one of ${values.join('|')}`) : found;
  };
}

export function array<T>(item: Decoder<T>): Decoder<readonly T[]> {
  return (input, path) => (Array.isArray(input) ? input.map((value: unknown, index) => item(value, `${path}[${index}]`)) : fail(path, 'array'));
}

export function nullable<T>(inner: Decoder<T>): Decoder<T | null> {
  return (input, path) => (input === null ? null : inner(input, path));
}

export function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

export function record(input: unknown, path: string): Readonly<Record<string, unknown>> {
  return isRecord(input) ? input : fail(path, 'object');
}

export function object<T>(fields: { readonly [K in keyof T]-?: Decoder<T[K]> }): Decoder<T> {
  return (input, path) => {
    const source = record(input, path);
    const out: Partial<Record<keyof T, unknown>> = {};
    for (const key of Object.keys(fields) as (keyof T & string)[]) {
      out[key] = fields[key](source[key], `${path}.${key}`);
    }
    return out as T;
  };
}

export function tagged<T extends { readonly kind: string }>(variants: { readonly [K in T['kind']]: Decoder<Extract<T, { kind: K }>> }): Decoder<T> {
  return (input, path) => {
    const { kind } = record(input, path);
    const keys = Object.keys(variants) as T['kind'][];
    const match = keys.find((key) => key === kind);
    if (match === undefined) return fail(`${path}.kind`, `one of ${keys.join('|')}`);
    return variants[match](input, path);
  };
}

export function stringMap<T>(value: Decoder<T>): Decoder<Readonly<Record<string, T>>> {
  return (input, path) => {
    const source = record(input, path);
    const out: Record<string, T> = {};
    for (const [key, item] of Object.entries(source)) out[key] = value(item, `${path}.${key}`);
    return out;
  };
}
