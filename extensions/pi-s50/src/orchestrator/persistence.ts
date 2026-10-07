import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RegistrySnapshot } from '../domain/registry.ts';
import { RUN_SCHEMA_VERSION, type RunState } from '../domain/run.ts';
import { appendJsonl, latestById, readJsonl } from '../evidence/store.ts';
import { parseSnapshot } from '../registry/validate.ts';
import type { DecisionLog } from './coordinator.ts';
import { type Decoded, decode, isRecord, parseJson } from './decode.ts';
import { decisionLog, evidenceRecord, finding, graph, run } from './schema.ts';

export const S50_DIR = '.s50';

// A self-ignoring .gitignore keeps run data local without editing the project's own ignore rules.
async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' }).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  });
}

export const FILES = {
  registry: 'registry.lock.json',
  run: 'run.json',
  graph: 'graph.json',
  evidence: 'evidence.jsonl',
  findings: 'findings.jsonl',
  decisions: 'decisions.jsonl',
} as const;

export function migrate(input: unknown): Decoded<unknown> {
  if (!isRecord(input)) return { kind: 'invalid', reason: 'run.json is not an object' };
  const { schemaVersion: version, status: phase, rootCause } = input;
  if (version === RUN_SCHEMA_VERSION) return { kind: 'ok', value: input };
  if (version !== 1) return { kind: 'invalid', reason: `unsupported run schema version ${String(version)}` };
  if (typeof phase !== 'string') return { kind: 'invalid', reason: 'v1 run.json status must be a phase string' };
  return {
    kind: 'ok',
    value: { ...input, schemaVersion: RUN_SCHEMA_VERSION, phase, status: { kind: 'active' }, diagnostics: [], rootCause: rootCause ?? null },
  };
}

async function readJsonFile(path: string): Promise<Decoded<unknown> | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  return parseJson(text);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export type Loaded = { readonly kind: 'ok'; readonly state: RunState; readonly migrated: boolean } | { readonly kind: 'missing' } | { readonly kind: 'invalid'; readonly reason: string };

export async function loadState(dir: string): Promise<Loaded> {
  const rawRun = await readJsonFile(join(dir, FILES.run));
  if (rawRun === null) return { kind: 'missing' };
  if (rawRun.kind === 'invalid') return rawRun;
  const migrated = migrate(rawRun.value);
  if (migrated.kind === 'invalid') return migrated;
  const decodedRun = decode(run, migrated.value);
  if (decodedRun.kind === 'invalid') return { kind: 'invalid', reason: `run.json ${decodedRun.reason}` };
  const rawGraph = await readJsonFile(join(dir, FILES.graph));
  if (rawGraph?.kind === 'invalid') return rawGraph;
  const decodedGraph = rawGraph === null ? ({ kind: 'ok', value: { schemaVersion: 1, nodes: [] } } as const) : decode(graph, rawGraph.value);
  if (decodedGraph.kind === 'invalid') return { kind: 'invalid', reason: `graph.json ${decodedGraph.reason}` };
  const evidence = await readJsonl(join(dir, FILES.evidence), evidenceRecord);
  if (evidence.kind === 'invalid') return evidence;
  const findings = await readJsonl(join(dir, FILES.findings), finding);
  if (findings.kind === 'invalid') return findings;
  const state: RunState = { run: decodedRun.value, graph: decodedGraph.value, evidence: evidence.value, findings: latestById(findings.value) };
  return { kind: 'ok', state, migrated: rawRun.value !== migrated.value };
}

export async function saveState(dir: string, before: RunState | null, after: RunState, decisions: readonly DecisionLog[]): Promise<void> {
  await ensureDir(dir);
  const known = new Set(before?.evidence.map((record) => record.id) ?? []);
  await appendJsonl(
    join(dir, FILES.evidence),
    after.evidence.filter((record) => !known.has(record.id)),
  );
  const changed = after.findings.filter((item) => {
    const prior = before?.findings.find((candidate) => candidate.id === item.id);
    return prior === undefined || prior.status !== item.status;
  });
  await appendJsonl(join(dir, FILES.findings), changed);
  await appendJsonl(join(dir, FILES.decisions), decisions);
  await writeJsonAtomic(join(dir, FILES.graph), after.graph);
  await writeJsonAtomic(join(dir, FILES.run), after.run);
}

export async function readDecisions(dir: string): Promise<Decoded<readonly DecisionLog[]>> {
  return readJsonl(join(dir, FILES.decisions), decisionLog);
}

export async function readLock(dir: string): Promise<Decoded<RegistrySnapshot> | null> {
  const raw = await readJsonFile(join(dir, FILES.registry));
  if (raw === null || raw.kind === 'invalid') return raw;
  return parseSnapshot(raw.value);
}

export async function writeLock(dir: string, snapshot: RegistrySnapshot): Promise<void> {
  await ensureDir(dir);
  await writeJsonAtomic(join(dir, FILES.registry), snapshot);
}
