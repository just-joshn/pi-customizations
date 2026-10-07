import type { InvocationPolicy, LeaderboardEntry, LockedSkill, RegistryLock } from '../domain/registry.ts';
import type { PinnedSource } from './validate.ts';

export const REQUIRED_SKILLS = [
  'grilling',
  'domain-modeling',
  'codebase-design',
  'prototype',
  'tdd',
  'diagnosing-bugs',
  'frontend-design',
  'vercel-react-best-practices',
  'web-design-guidelines',
  'agent-browser',
  'triage',
  'improve-codebase-architecture',
  'setup-matt-pocock-skills',
] as const;

export const OPTIONAL_SKILLS = ['find-skills', 'grill-me', 'grill-with-docs', 'handoff', 'teach'] as const;

export const S50_SKILLS: readonly string[] = [...REQUIRED_SKILLS, ...OPTIONAL_SKILLS];

const CUTOFF = 50;

const PREREQUISITES: Readonly<Record<string, readonly string[]>> = {
  triage: ['skill:setup-matt-pocock-skills writes docs/agents/issue-tracker.md'],
  'agent-browser': ['cli:agent-browser on PATH'],
  'web-design-guidelines': ['network:https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md'],
  'find-skills': ['cli:skills (npx skills)'],
};

export type LockInput = {
  readonly leaderboard: readonly LeaderboardEntry[];
  readonly sources: Readonly<Record<string, PinnedSource>>;
  readonly snapshotTime: string;
  readonly source: string;
};

export type LockResult = { readonly lock: RegistryLock; readonly dropped: readonly string[] };

function locked(name: string, entry: LeaderboardEntry, pin: PinnedSource): LockedSkill {
  const policy: InvocationPolicy = pin.invocationPolicy;
  return {
    name,
    source: entry.source,
    rank: entry.rank,
    installs: entry.installs,
    lock: { kind: 'git_commit', repository: pin.repository, commit: pin.commit, path: pin.path, contentHash: pin.contentHash },
    invocationPolicy: policy,
    prerequisites: PREREQUISITES[name] ?? [],
  };
}

export function buildLock(input: LockInput): LockResult {
  const top = input.leaderboard.filter((entry) => entry.rank <= CUTOFF).toSorted((a, b) => a.rank - b.rank);
  const eligible = (name: string): LockedSkill | null => {
    const entry = top.find((candidate) => candidate.skillId === name);
    const pin = input.sources[name];
    return entry === undefined || pin === undefined || pin.repository !== entry.source ? null : locked(name, entry, pin);
  };
  const ineligible = REQUIRED_SKILLS.filter((name) => eligible(name) === null);
  if (top.length < CUTOFF) return { lock: { kind: 'rejected', checkedAt: input.snapshotTime, source: input.source, ineligible: [`leaderboard has ${top.length} entries, fewer than ${CUTOFF}`] }, dropped: [] };
  if (ineligible.length > 0) return { lock: { kind: 'rejected', checkedAt: input.snapshotTime, source: input.source, ineligible }, dropped: [] };
  const skills = S50_SKILLS.map(eligible).filter((skill) => skill !== null);
  const dropped = OPTIONAL_SKILLS.filter((name) => eligible(name) === null);
  return {
    lock: {
      kind: 'approved',
      snapshot: { schemaVersion: 1, snapshotTime: input.snapshotTime, source: input.source, view: 'all-time', rankingBasis: 'install_telemetry', cutoff: CUTOFF, leaderboard: top, skills },
    },
    dropped,
  };
}
