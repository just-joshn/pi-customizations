import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RegistryLock } from '../domain/registry.ts';
import { RUN_SCHEMA_VERSION, type RunState } from '../domain/run.ts';
import { appendJsonl, latestById, readJsonl } from '../evidence/store.ts';
import { parseLock, REGISTRY_LOCK_VERSION } from '../registry/validate.ts';
import type { DecisionLog } from './command.ts';
import { type Decoded, decode, isRecord, parseJson } from './decode.ts';
import { decisionLog, evidenceRecord, finding, graph, run } from './schema.ts';

export const S50_DIR = '.s50';

// A self-ignoring .gitignore keeps run data local without editing the project's own ignore rules.
// It is written only when the directory is created, so a project that deletes it to commit an audit trail keeps that choice.
async function ensureDir(dir: string): Promise<void> {
  const created = await mkdir(dir, { recursive: true });
  if (created !== undefined) await writeFile(join(dir, '.gitignore'), '*\n', 'utf8');
}

export const FILES = {
  registry: 'registry.lock.json',
  run: 'run.json',
  graph: 'graph.json',
  evidence: 'evidence.jsonl',
  findings: 'findings.jsonl',
  decisions: 'decisions.jsonl',
} as const;

type Migration = (input: Readonly<Record<string, unknown>>) => Decoded<Readonly<Record<string, unknown>>>;

function v2Loop(loop: unknown): unknown {
  if (!isRecord(loop)) return loop;
  // A v2 "promoted" loop never proved the reproducer green, so it migrates as red with its promotion kept.
  const { status } = loop;
  return { ...loop, status: status === 'promoted' ? 'red' : status, instrumentation: [] };
}

function v2Capabilities(capabilities: Readonly<Record<string, unknown>>): unknown {
  const { installedSkills: installed } = capabilities;
  return { ...capabilities, installedSkills: Array.isArray(installed) ? installed.map((name) => ({ name, contentHash: null })) : installed };
}

const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: (input) => {
    const { status: phase, rootCause } = input;
    if (typeof phase !== 'string') return { kind: 'invalid', reason: 'v1 run.json status must be a phase string' };
    return { kind: 'ok', value: { ...input, schemaVersion: 2, phase, status: { kind: 'active' }, diagnostics: [], rootCause: rootCause ?? null } };
  },
  2: (input) => {
    const { diagnostics: loops, capabilities: host } = input;
    const diagnostics = Array.isArray(loops) ? loops.map(v2Loop) : loops;
    const capabilities = isRecord(host) ? v2Capabilities(host) : host;
    return { kind: 'ok', value: { ...input, schemaVersion: 3, diagnostics, capabilities, integrationOwner: null, preflight: null } };
  },
};

function versionOf({ schemaVersion }: Readonly<Record<string, unknown>>): unknown {
  return schemaVersion;
}

export function migrate(input: unknown): Decoded<unknown> {
  if (!isRecord(input)) return { kind: 'invalid', reason: 'run.json is not an object' };
  let current: Readonly<Record<string, unknown>> = input;
  while (versionOf(current) !== RUN_SCHEMA_VERSION) {
    const version = versionOf(current);
    const step = typeof version === 'number' ? MIGRATIONS[version] : undefined;
    if (step === undefined) return { kind: 'invalid', reason: `unsupported run schema version ${String(version)}` };
    const next = step(current);
    if (next.kind === 'invalid') return next;
    current = next.value;
  }
  return { kind: 'ok', value: current };
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

export async function readLock(dir: string): Promise<Decoded<RegistryLock> | null> {
  const raw = await readJsonFile(join(dir, FILES.registry));
  if (raw === null || raw.kind === 'invalid') return raw;
  return parseLock(raw.value);
}

export async function writeLock(dir: string, lock: RegistryLock): Promise<void> {
  await ensureDir(dir);
  await writeJsonAtomic(join(dir, FILES.registry), { schemaVersion: REGISTRY_LOCK_VERSION, ...lock });
}
