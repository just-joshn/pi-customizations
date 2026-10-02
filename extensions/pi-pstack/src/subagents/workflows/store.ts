import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { Type } from 'typebox';
import { Check } from 'typebox/value';
import type { WorkflowLimits } from '../settings.ts';
import { effectiveLimits } from './limits.ts';
import type { Journal, RunRecord, WorkflowDeclaration } from './types.ts';

export type WorkflowTables = Readonly<{
  runs: Readonly<Record<string, RunRecord>>;
  progress: Readonly<Record<string, Readonly<{ intent: string; updatedAt: number }>>>;
  agents: readonly Readonly<{ runId: string; agentId: string; prompt: string; startedAt: number; finishedAt?: number }>[];
  journal: Readonly<Record<string, Journal>>;
  charges: readonly Readonly<{ runId: string; agentId: string; credits: number; at: number }>[];
}>;

const empty: WorkflowTables = { runs: {}, progress: {}, agents: [], journal: {}, charges: [] };
const RunSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  attempt: Type.Integer({ minimum: 1 }),
  status: Type.String(),
  arguments: Type.Unknown(),
  ownerEpoch: Type.Integer({ minimum: 0 }),
  leaseExpiresAt: Type.Number(),
  declaredLimits: Type.Object({}),
  effectiveLimits: Type.Object({}),
  consumption: Type.Object({ subagents: Type.Integer({ minimum: 0 }), credits: Type.Number(), startedAt: Type.Number(), elapsedSeconds: Type.Number() }),
  logs: Type.Array(Type.String()),
  phases: Type.Array(Type.String()),
});
/** The durable tables of the report (factory_runs, factory_progress, factory_phases, factory_agents, factory_journal, factory_credit_charges) in one per-session file. */
export class WorkflowStore {
  private tables: WorkflowTables = empty;
  private file: string | undefined;
  private ready = false;

  constructor(private readonly fileFor: () => string | undefined) {}

  private ensure(): void {
    if (this.ready) return;
    this.ready = true;
    this.file = this.fileFor();
    this.tables = this.load(this.file);
  }

  private load(file: string | undefined): WorkflowTables {
    if (!file) return empty;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return empty;
      const source = parsed as Partial<WorkflowTables>;
      return { runs: source.runs ?? {}, progress: source.progress ?? {}, agents: source.agents ?? [], journal: source.journal ?? {}, charges: source.charges ?? [] };
    } catch {
      return empty;
    }
  }

  private persist(): void {
    const file = this.file;
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const staged = `${file}.staged`;
    writeFileSync(staged, JSON.stringify(this.tables, null, 2));
    renameSync(staged, file);
  }

  private edit(edit: (tables: WorkflowTables) => WorkflowTables): void {
    this.ensure();
    this.tables = edit(this.tables);
    this.persist();
  }

  list(): readonly RunRecord[] {
    this.ensure();
    return Object.values(this.tables.runs).filter((run): run is RunRecord => Check(RunSchema, run));
  }

  get(id: string): RunRecord | undefined {
    this.ensure();
    const run = this.tables.runs[id];
    return Check(RunSchema, run) ? run : undefined;
  }

  journalOf(runId: string): Journal {
    this.ensure();
    return this.tables.journal[runId] ?? {};
  }

  create(name: string, declaration: Pick<WorkflowDeclaration, 'limits'>, args: unknown, overrides: Partial<WorkflowLimits>, now: number): RunRecord {
    const id = `${name}-${now.toString(36)}`;
    const effective = effectiveLimits({ declaration, ...(Object.keys(overrides).length > 0 ? { overrides } : {}), defaults: {} });
    const record: RunRecord = {
      id,
      name,
      attempt: 1,
      status: 'pending',
      arguments: args,
      ownerEpoch: 0,
      leaseExpiresAt: 0,
      declaredLimits: declaration.limits ?? {},
      effectiveLimits: effective,
      consumption: { subagents: 0, credits: 0, startedAt: now, elapsedSeconds: 0 },
      logs: [],
      phases: [],
      createdAt: now,
      updatedAt: now,
    };
    this.edit((tables) => ({ ...tables, runs: { ...tables.runs, [id]: record } }));
    return record;
  }

  /** The compare-and-set of the report: only a pending row becomes running, and only while it holds the current epoch. */
  claim(id: string, epoch: number, leaseMs: number, now: number): RunRecord | undefined {
    const run = this.get(id);
    if (run?.status !== 'pending' || run.ownerEpoch >= epoch) return undefined;
    const claimed: RunRecord = { ...run, status: 'running', ownerEpoch: epoch, leaseExpiresAt: now + leaseMs, consumption: { ...run.consumption, startedAt: now } };
    this.edit((tables) => ({ ...tables, runs: { ...tables.runs, [id]: claimed } }));
    return claimed;
  }

  heartbeat(id: string, epoch: number, leaseMs: number, now: number): void {
    const run = this.get(id);
    if (!run || run.ownerEpoch !== epoch) return;
    this.edit((tables) => ({ ...tables, runs: { ...tables.runs, [id]: { ...run, leaseExpiresAt: now + leaseMs } } }));
  }

  settle(id: string, epoch: number, patch: Partial<Omit<RunRecord, 'id'>>): RunRecord | undefined {
    const run = this.get(id);
    if (!run || run.ownerEpoch !== epoch) return undefined;
    if (['completed', 'failed', 'cancelled', 'halted'].includes(run.status)) return undefined;
    const settled: RunRecord = { ...run, ...patch, updatedAt: Date.now() };
    this.edit((tables) => ({ ...tables, runs: { ...tables.runs, [id]: settled } }));
    return settled;
  }

  log(id: string, message: string, phase?: string): void {
    const run = this.get(id);
    if (!run) return;
    const next: RunRecord = { ...run, logs: [...run.logs.slice(-499), message], ...(phase && !run.phases.includes(phase) ? { phases: [...run.phases, phase] } : {}), updatedAt: Date.now() };
    this.edit((tables) => ({ ...tables, runs: { ...tables.runs, [id]: next }, phases: phase ? { ...tables.progress, [id]: { intent: phase, updatedAt: Date.now() } } : tables.progress }));
  }

  admitSubagent(id: string, prompt: string, now: number): { placeholder: string; record: RunRecord } {
    const run = this.get(id);
    if (!run) throw new Error(`Unknown workflow run: ${id}`);
    const max = run.effectiveLimits.maxTotalSubagents;
    if (max !== undefined && run.consumption.subagents >= max) throw new Error(`The workflow reached its maxTotalSubagents limit (${max}).`);
    const placeholder = `pending-${run.consumption.subagents + 1}`;
    const admitted: RunRecord = { ...run, consumption: { ...run.consumption, subagents: run.consumption.subagents + 1 } };
    this.edit((tables) => ({ ...tables, runs: { ...tables.runs, [id]: admitted }, agents: [...tables.agents, { runId: id, agentId: placeholder, prompt, startedAt: now }] }));
    return { placeholder, record: admitted };
  }

  attachSubagent(id: string, placeholder: string, agentId: string): void {
    this.edit((tables) => ({ ...tables, agents: tables.agents.map((agent) => (agent.runId === id && agent.agentId === placeholder ? { ...agent, agentId } : agent)) }));
  }

  finishSubagent(id: string, agentId: string, credits: number, now: number): RunRecord | undefined {
    const run = this.get(id);
    if (!run) return undefined;
    const settled: RunRecord = { ...run, consumption: { ...run.consumption, credits: run.consumption.credits + credits } };
    this.edit((tables) => ({
      ...tables,
      runs: { ...tables.runs, [id]: settled },
      agents: tables.agents.map((agent) => (agent.agentId === agentId ? { ...agent, finishedAt: now } : agent)),
      charges: [...tables.charges, { runId: id, agentId, credits, at: now }],
    }));
    return settled;
  }

  putJournal(id: string, key: string, value: unknown): void {
    const journal = this.tables.journal[id] ?? {};
    this.edit((tables) => ({ ...tables, journal: { ...tables.journal, [id]: { ...journal, [key]: value } } }));
  }
}
