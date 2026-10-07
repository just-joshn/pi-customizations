import { appendFile, readFile } from 'node:fs/promises';

import { type Decoded, type Decoder, decode, isRecord, parseJson } from '../orchestrator/decode.ts';

// Every line carries its own version so one append-only file can outlive a shape change; lines written before versioning are version 1.
const JSONL_SCHEMA_VERSION = 1;

export async function readJsonl<T>(path: string, decoder: Decoder<T>): Promise<Decoded<readonly T[]>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { kind: 'ok', value: [] };
    throw error;
  }
  const out: T[] = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    const json = parseJson(line);
    if (json.kind === 'invalid') return { kind: 'invalid', reason: `${path}:${index + 1}: ${json.reason}` };
    const { schemaVersion: version = JSONL_SCHEMA_VERSION } = isRecord(json.value) ? json.value : {};
    if (version !== JSONL_SCHEMA_VERSION) return { kind: 'invalid', reason: `${path}:${index + 1}: unsupported record schema version ${String(version)}` };
    const item = decode(decoder, json.value);
    if (item.kind === 'invalid') return { kind: 'invalid', reason: `${path}:${index + 1}: ${item.reason}` };
    out.push(item.value);
  }
  return { kind: 'ok', value: out };
}

export async function appendJsonl(path: string, items: readonly object[]): Promise<void> {
  if (items.length === 0) return;
  await appendFile(path, items.map((item) => `${JSON.stringify({ schemaVersion: JSONL_SCHEMA_VERSION, ...item })}\n`).join(''), 'utf8');
}

export function latestById<T extends { readonly id: string }>(items: readonly T[]): readonly T[] {
  const latest = new Map<string, T>();
  for (const item of items) latest.set(item.id, item);
  return [...latest.values()];
}
