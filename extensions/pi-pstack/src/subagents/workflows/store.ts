import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';
import type { Branch } from '../agent-node.ts';
import type { WorkflowLimits } from '../settings.ts';
import { effectiveLimits } from './limits.ts';
import type { Journal, RunRecord, WorkflowDeclaration } from './types.ts';

export const workflowEntryType = 'reference-assistant-workflow';
const logCap = 500;
const open = ['pending', 'running'];
const terminal = ['completed', 'failed', 'cancelled', 'halted'];

const Limits = Type.Object({ maxConcurrentSubagents: Type.Optional(Type.Number()), maxTotalSubagents: Type.Optional(Type.Number()), timeoutSeconds: Type.Optional(Type.Number()), maxAiCredits: Type.Optional(Type.Number()) });
const Status = Type.Union([Type.Literal('pending'), Type.Literal('running'), Type.Literal('completed'), Type.Literal('halted'), Type.Literal('paused'), Type.Literal('cancelled'), Type.Literal('error')]);
const RunSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  attempt: Type.Integer({ minimum: 1 }),
  status: Status,
  arguments: Type.Unknown(),
  ownerEpoch: Type.Integer({ minimum: 0 }),
  declaredLimits: Limits,
  effectiveLimits: Limits,
  consumption: Type.Object({ subagents: Type.Integer({ minimum: 0 }), credits: Type.Number(), startedAt: Type.Number(), elapsedSeconds: Type.Number() }),
  logs: Type.Array(Type.String()),
  phases: Type.Array(Type.String()),
  checkpoint: Type.Optional(Type.String()),
  failure: Type.Optional(Type.Object({ type: Type.Union([Type.Literal('workflow_limit_reached'), Type.Literal('interrupted'), Type.Literal('error')]), message: Type.String() })),
  result: Type.Optional(Type.Unknown()),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
});
const ChangeSchema = Type.Union([
  Type.Object({ kind: Type.Literal('run'), run: RunSchema }),
  Type.Object({ kind: Type.Literal('log'), runId: Type.String(), message: Type.String(), phase: Type.Optional(Type.String()) }),
  Type.Object({ kind: Type.Literal('journal'), runId: Type.String(), key: Type.String(), value: Type.Unknown() }),
]);

/** One durable fact about a workflow run. The store state is the fold of these in session order, so it follows the active branch. */
export type Change = Static<typeof ChangeSchema>;
type Tables = Readonly<{ runs: Readonly<Record<string, RunRecord>>; journal: Readonly<Record<string, Journal>> }>;

const empty: Tables = { runs: {}, journal: {} };

function apply(tables: Tables, change: Change): Tables {
  switch (change.kind) {
    case 'run': {
      const prior = tables.runs[change.run.id];
      return { ...tables, runs: { ...tables.runs, [change.run.id]: { ...change.run, logs: prior?.logs ?? [], phases: prior?.phases ?? [] } } };
    }
    case 'log': {
      const run = tables.runs[change.runId];
      if (!run) return tables;
      const phases = change.phase && !run.phases.includes(change.phase) ? [...run.phases, change.phase] : run.phases;
      return { ...tables, runs: { ...tables.runs, [run.id]: { ...run, logs: [...run.logs.slice(-(logCap - 1)), change.message], phases } } };
    }
    case 'journal':
      return { ...tables, journal: { ...tables.journal, [change.runId]: { ...tables.journal[change.runId], [change.key]: change.value } } };
    default: {
      const exhaustive: never = change;
      return exhaustive;
    }
  }
}

export class WorkflowStore {
  private tables: Tables = empty;

  constructor(private readonly persist: (change: Change) => void) {}

  restore(branch: Branch): void {
    this.tables = branch.flatMap((entry) => (entry.type === 'custom' && entry.customType === workflowEntryType && Check(ChangeSchema, entry.data) ? [entry.data] : [])).reduce(apply, empty);
  }

  private commit(change: Change): void {
    this.tables = apply(this.tables, change);
    this.persist(change);
  }

  private save(run: RunRecord): RunRecord {
    this.commit({ kind: 'run', run: { ...run, logs: [], phases: [] } });
    return this.tables.runs[run.id] ?? run;
  }

  list(): readonly RunRecord[] {
    return Object.values(this.tables.runs);
  }

  get(id: string): RunRecord | undefined {
    return this.tables.runs[id];
  }

  journalOf(runId: string): Journal {
    return this.tables.journal[runId] ?? {};
  }

  create(name: string, declaration: Pick<WorkflowDeclaration, 'limits'>, args: unknown, overrides: Partial<WorkflowLimits>, defaults: WorkflowLimits, now: number): RunRecord {
    return this.save({
      id: `${name}-${now.toString(36)}`,
      name,
      attempt: 1,
      status: 'pending',
      arguments: structuredClone(args),
      ownerEpoch: 0,
      declaredLimits: declaration.limits ?? {},
      effectiveLimits: effectiveLimits({ declaration, ...(Object.keys(overrides).length > 0 ? { overrides } : {}), defaults }),
      consumption: { subagents: 0, credits: 0, startedAt: now, elapsedSeconds: 0 },
      logs: [],
      phases: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  /** The compare-and-set of the report: only a pending run becomes running, and only for an epoch newer than its owner. */
  claim(id: string, epoch: number, now: number): RunRecord | undefined {
    const run = this.get(id);
    if (run?.status !== 'pending' || run.ownerEpoch >= epoch) return undefined;
    return this.save({ ...run, status: 'running', ownerEpoch: epoch, consumption: { ...run.consumption, startedAt: now } });
  }

  settle(id: string, epoch: number, patch: Partial<Omit<RunRecord, 'id'>>): RunRecord | undefined {
    const run = this.get(id);
    if (!run || run.ownerEpoch !== epoch || terminal.includes(run.status)) return undefined;
    return this.save({ ...run, ...patch, updatedAt: Date.now() });
  }

  /** Runs a previous process left open cannot continue, so they settle as interrupted and can be resumed. */
  interruptOpen(except: ReadonlySet<string>): readonly RunRecord[] {
    const stale = this.list().filter((run) => open.includes(run.status) && !except.has(run.id));
    return stale.flatMap((run) => this.settle(run.id, run.ownerEpoch, { status: 'error', failure: { type: 'interrupted', message: `Run ${run.id} was interrupted and can be resumed.` } }) ?? []);
  }

  log(id: string, message: string, phase?: string): void {
    if (this.get(id)) this.commit({ kind: 'log', runId: id, message, ...(phase ? { phase } : {}) });
  }

  admitSubagent(id: string): RunRecord {
    const run = this.get(id);
    if (!run) throw new Error(`Unknown workflow run: ${id}`);
    const max = run.effectiveLimits.maxTotalSubagents;
    if (max !== undefined && run.consumption.subagents >= max) throw new Error(`The workflow reached its maxTotalSubagents limit (${max}).`);
    return this.save({ ...run, consumption: { ...run.consumption, subagents: run.consumption.subagents + 1 } });
  }

  /** A failed preparation rolls its admission back; the guarded decrement never falls below zero. */
  releaseSubagent(id: string): RunRecord | undefined {
    const run = this.get(id);
    if (!run) return undefined;
    if (run.consumption.subagents <= 0) return run;
    return this.save({ ...run, consumption: { ...run.consumption, subagents: run.consumption.subagents - 1 } });
  }

  finishSubagent(id: string, credits: number): RunRecord | undefined {
    const run = this.get(id);
    return run ? this.save({ ...run, consumption: { ...run.consumption, credits: run.consumption.credits + credits } }) : undefined;
  }

  putJournal(id: string, key: string, value: unknown): void {
    this.commit({ kind: 'journal', runId: id, key, value: structuredClone(value) });
  }
}
