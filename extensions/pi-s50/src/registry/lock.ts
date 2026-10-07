import type { LeaderboardEntry, LockedSkill, RegistrySnapshot } from '../domain/registry.ts';
import type { SourceEntry } from './validate.ts';

export const S50_DEPENDENCIES = [
  'find-skills',
  'grill-me',
  'grill-with-docs',
  'improve-codebase-architecture',
  'agent-browser',
  'tdd',
  'frontend-design',
  'setup-matt-pocock-skills',
  'handoff',
  'triage',
  'prototype',
  'grilling',
  'vercel-react-best-practices',
  'domain-modeling',
  'teach',
  'codebase-design',
  'diagnosing-bugs',
  'web-design-guidelines',
] as const;

const CUTOFF = 50;

const PREREQUISITES: Readonly<Record<string, readonly string[]>> = { triage: ['setup-matt-pocock-skills'] };

export type BuildInput = {
  readonly leaderboard: readonly LeaderboardEntry[];
  readonly sources: Readonly<Record<string, SourceEntry>>;
  readonly required: readonly string[];
  readonly snapshotTime: string;
  readonly source: string;
};

export type BuildResult = { readonly kind: 'ok'; readonly snapshot: RegistrySnapshot } | { readonly kind: 'ineligible'; readonly skills: readonly string[] };

export function buildSnapshot(input: BuildInput): BuildResult {
  const top = input.leaderboard.filter((entry) => entry.rank <= CUTOFF).toSorted((a, b) => a.rank - b.rank);
  const ineligible: string[] = [];
  const skills: LockedSkill[] = [];
  for (const name of input.required) {
    const entry = top.find((candidate) => candidate.skillId === name);
    const source = input.sources[name];
    if (entry === undefined || source === undefined || source.repository !== entry.source) {
      ineligible.push(name);
      continue;
    }
    skills.push({
      name,
      source: entry.source,
      rank: entry.rank,
      installs: entry.installs,
      lock: { kind: 'git_commit', repository: source.repository, commit: source.commit, path: source.path, contentHash: source.contentHash },
      invocationPolicy: source.invocationPolicy,
      prerequisites: PREREQUISITES[name] ?? [],
    });
  }
  if (ineligible.length > 0) return { kind: 'ineligible', skills: ineligible };
  return {
    kind: 'ok',
    snapshot: {
      schemaVersion: 1,
      snapshotTime: input.snapshotTime,
      source: input.source,
      view: 'all-time',
      rankingBasis: 'install_telemetry',
      cutoff: CUTOFF,
      leaderboard: top,
      skills,
    },
  };
}
