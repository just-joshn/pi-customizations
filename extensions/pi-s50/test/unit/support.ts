import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EvidenceRecord } from '../../src/domain/evidence.ts';
import type { GraphNode } from '../../src/domain/graph.ts';
import type { LeaderboardEntry, RegistrySnapshot } from '../../src/domain/registry.ts';
import type { HostCapabilities, RunState } from '../../src/domain/run.ts';
import type { Mode, Phase } from '../../src/domain/state.ts';
import { fixedClock } from '../../src/orchestrator/clock.ts';
import { type Command, type GraphNodeInput, type Outcome, SHARED_UNDERSTANDING_ID, apply, startRun } from '../../src/orchestrator/coordinator.ts';
import { buildSnapshot, S50_DEPENDENCIES } from '../../src/registry/lock.ts';
import { parseLeaderboardFile, type SourceEntry, parseSources } from '../../src/registry/validate.ts';

export const fixturePath = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(fixturePath(name), 'utf8'));
}

export function loadLeaderboard(): readonly LeaderboardEntry[] {
  const parsed = parseLeaderboardFile(readFixture('leaderboard.2026-10-07.json'));
  if (parsed.kind === 'invalid') throw new Error(parsed.reason);
  return parsed.value.entries;
}

export function loadSources(): Readonly<Record<string, SourceEntry>> {
  const parsed = parseSources(readFixture('skill-sources.2026-10-07.json'));
  if (parsed.kind === 'invalid') throw new Error(parsed.reason);
  return parsed.value;
}

export function registry(): RegistrySnapshot {
  const built = buildSnapshot({ leaderboard: loadLeaderboard(), sources: loadSources(), required: S50_DEPENDENCIES, snapshotTime: '2026-10-07T09:14:55Z', source: 'https://skills.sh/' });
  if (built.kind !== 'ok') throw new Error(`ineligible: ${built.skills.join(',')}`);
  return built.snapshot;
}

export const NO_CAPS: HostCapabilities = { independentAgents: false, isolatedWorktrees: false, browserDriver: false, nativeAutomation: false, installedSkills: [] };

export const ALL_SKILLS: readonly string[] = S50_DEPENDENCIES;

export const PARALLEL_CAPS: HostCapabilities = { ...NO_CAPS, independentAgents: true, isolatedWorktrees: true, installedSkills: ALL_SKILLS };

export function freshRun(options: { mode?: Mode; capabilities?: HostCapabilities; criteria?: readonly string[]; consumer?: RunState['run']['consumer'] } = {}): RunState {
  return startRun(
    {
      mode: options.mode ?? 'feature',
      objective: 'export invoices as CSV',
      repository: '/repo',
      revision: 'r1',
      consumer: options.consumer ?? { kind: 'cli', userPath: 'invoices export --csv' },
      acceptanceCriteria: options.criteria ?? ['csv export lists every invoice'],
      constraints: [],
      nonGoals: [],
      capabilities: options.capabilities ?? { ...NO_CAPS, installedSkills: ALL_SKILLS },
    },
    registry(),
    fixedClock(),
  );
}

export function node(id: string, overrides: Partial<GraphNodeInput> = {}): GraphNodeInput {
  return {
    id,
    objective: `slice ${id}`,
    dependencies: [],
    owner: 'worker',
    writeSet: [`src/${id}/**`],
    schemas: [],
    migrations: [],
    definesInterfaces: [],
    consumesInterfaces: [],
    runtimeOwnership: [],
    expectedBehavior: `${id} works end to end`,
    verification: 'test',
    ...overrides,
  };
}

export function graphNode(id: string, status: GraphNode['status'], overrides: Partial<GraphNodeInput> = {}): GraphNode {
  return { ...node(id, overrides), status };
}

export function measured(criterion: string, revision: string, overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: `ev-${criterion}`,
    claim: criterion,
    criterion,
    state: 'MEASURED',
    revision,
    dependencies: ['src/**'],
    method: 'cli',
    expected: 'exit 0',
    observed: 'exit 0',
    artifact: 'log.txt',
    recordedAt: '2026-10-07T00:00:00.000Z',
    supersedes: null,
    ...overrides,
  };
}

function modeFor(from: Phase, to: Phase): Mode {
  if (from === 'CLASSIFY' && to === 'DIAGNOSE') return 'bug';
  if (to === 'EXPLICIT_TRIAGE') return 'external_issue';
  if (to === 'EXPLICIT_ARCH_REVIEW') return 'architecture_survey';
  return 'feature';
}

export function satisfiedAt(from: Phase, to: Phase): RunState {
  const base = freshRun({ mode: modeFor(from, to) });
  const seam = { id: 'seam-cli', description: 'CLI output', catches: 'format bugs', misses: 'perf' };
  return {
    run: {
      ...base.run,
      phase: from,
      frozenRevision: 'r1',
      domain: { ...base.run.domain, terms: ['invoice'], decisions: [{ id: SHARED_UNDERSTANDING_ID, question: 'ok?', answer: 'confirmed', decidedBy: 'user' }] },
      architecture: {
        candidates: [
          { id: 'a', summary: 'stream', tradeoffs: 'memory' },
          { id: 'b', summary: 'buffer', tradeoffs: 'latency' },
        ],
        chosen: { id: 'a', reason: 'scales' },
        interfaces: [],
        seams: [],
        ownership: [],
      },
      testContract: { proposedSeams: [seam], confirmedSeams: [seam] },
      diagnostics: [{ id: 'loop-1', kind: 'failing_test', command: 'npm test', symptom: 'crash', status: 'promoted', promotedTo: 'seam-cli' }],
      rootCause: 'off by one',
      prototypes: [{ question: 'stream?', verdict: 'yes', branch: 'proto/stream', issuePointer: null }],
    },
    graph: { schemaVersion: 1, nodes: [graphNode('export', 'integrated')] },
    evidence: [measured('csv export lists every invoice', 'r1')],
    findings: [],
  };
}

export type Step = { readonly command: Command; readonly phase: Phase };

export function applyAll(state: RunState, commands: readonly Command[], clock = fixedClock()): { readonly state: RunState; readonly outcomes: readonly Outcome[] } {
  const outcomes: Outcome[] = [];
  let current = state;
  for (const command of commands) {
    const outcome = apply(current, command, clock);
    outcomes.push(outcome);
    if (outcome.kind === 'rejected') throw new Error(`${command.kind} rejected: ${outcome.reason}`);
    current = outcome.state;
  }
  return { state: current, outcomes };
}

export function expectOk(outcome: Outcome): RunState {
  if (outcome.kind !== 'ok') throw new Error(`rejected: ${outcome.reason}`);
  return outcome.state;
}
