import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { EvidenceRecord } from '../../src/domain/evidence.ts';
import type { GraphNode } from '../../src/domain/graph.ts';
import type { LeaderboardEntry, RegistrySnapshot } from '../../src/domain/registry.ts';
import type { HostCapabilities, InstalledSkill, Preflight, RunState } from '../../src/domain/run.ts';
import type { Mode, Phase } from '../../src/domain/state.ts';
import { type Command, type GraphNodeInput, type Outcome, SHARED_UNDERSTANDING_ID } from '../../src/orchestrator/command.ts';
import { apply, startRun } from '../../src/orchestrator/coordinator.ts';
import { MODEL_CHANGE_ID } from '../../src/orchestrator/facts.ts';
import { DESIGN_BRIEF } from '../../src/orchestrator/phases.ts';
import { buildLock, S50_SKILLS } from '../../src/registry/lock.ts';
import { type PinnedSource, parseLeaderboardFile, parseSources } from '../../src/registry/validate.ts';
import { fixedClock } from '../support/clock.ts';

export const fixturePath = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(fixturePath(name), 'utf8'));
}

export function loadLeaderboard(): readonly LeaderboardEntry[] {
  const parsed = parseLeaderboardFile(readFixture('leaderboard.2026-10-07.json'));
  if (parsed.kind === 'invalid') throw new Error(parsed.reason);
  return parsed.value.entries;
}

export function loadSources(): Readonly<Record<string, PinnedSource>> {
  const parsed = parseSources(readFixture('skill-sources.2026-10-07.json'));
  if (parsed.kind === 'invalid') throw new Error(parsed.reason);
  return parsed.value;
}

export function registry(): RegistrySnapshot {
  const { lock } = buildLock({ leaderboard: loadLeaderboard(), sources: loadSources(), snapshotTime: '2026-10-07T09:14:55Z', source: 'https://skills.sh/' });
  if (lock.kind !== 'approved') throw new Error(`rejected: ${lock.ineligible.join(',')}`);
  return lock.snapshot;
}

export const NO_CAPS: HostCapabilities = { independentAgents: false, isolatedWorktrees: false, browserDriver: false, nativeAutomation: false, installedSkills: [] };

export const ALL_SKILLS: readonly string[] = S50_SKILLS;

export const INSTALLED: readonly InstalledSkill[] = ALL_SKILLS.map((name) => ({ name, contentHash: null }));

export const CLEAN_REPO: Preflight = {
  repositoryRoot: '/repo',
  remote: null,
  revision: 'r1',
  dirty: false,
  languages: ['typescript'],
  packageManager: 'bun',
  testCommands: ['bun run test'],
  buildCommands: ['bun run typecheck'],
  instructions: [],
  glossary: [],
  adrs: 0,
  issueTrackerDoc: true,
  reactStack: false,
};

export const PARALLEL_CAPS: HostCapabilities = { ...NO_CAPS, independentAgents: true, isolatedWorktrees: true, installedSkills: INSTALLED };

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
      capabilities: options.capabilities ?? { ...NO_CAPS, installedSkills: INSTALLED },
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
      domain: {
        ...base.run.domain,
        terms: ['invoice'],
        decisions: [
          { id: SHARED_UNDERSTANDING_ID, question: 'ok?', answer: 'confirmed', decidedBy: 'user' },
          { id: MODEL_CHANGE_ID, question: 'does the model change?', answer: 'yes', decidedBy: 'fact' },
          ...DESIGN_BRIEF.map((item) => ({ id: `design.${item}`, question: item, answer: 'settled', decidedBy: 'user' as const })),
        ],
      },
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
      diagnostics: [{ id: 'loop-1', kind: 'failing_test', command: 'bun run test', symptom: 'crash', status: 'green', promotedTo: 'seam-cli', instrumentation: [] }],
      rootCause: 'off by one',
      prototypes: [{ question: 'stream?', verdict: 'yes', branch: 'proto/stream', issuePointer: null }],
    },
    graph: { schemaVersion: 1, nodes: [graphNode('export', 'integrated')] },
    evidence: [measured('csv export lists every invoice', 'r1'), measured('review', 'r1', { criterion: 'review', method: 'review', dependencies: ['**'] })],
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
