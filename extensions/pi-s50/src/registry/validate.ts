import type { LeaderboardEntry, LockedSkill, RegistrySnapshot, SourceLock } from '../domain/registry.ts';
import { array, type Decoded, type Decoder, decode, nonEmptyStr, num, object, oneOf, str, stringMap, tagged } from '../orchestrator/decode.ts';

export type SourceEntry = {
  readonly repository: string;
  readonly commit: string;
  readonly path: string;
  readonly contentHash: string;
  readonly invocationPolicy: 'model' | 'user';
};

export type LeaderboardFile = { readonly fetchedAt: string; readonly source: string; readonly entries: readonly LeaderboardEntry[] };

export const leaderboardEntry: Decoder<LeaderboardEntry> = object<LeaderboardEntry>({ rank: num, source: nonEmptyStr, skillId: nonEmptyStr, installs: num });

const leaderboardFile: Decoder<LeaderboardFile> = (input, path) => {
  const file = object<LeaderboardFile & { readonly view: 'all-time' }>({
    fetchedAt: str,
    source: str,
    view: oneOf(['all-time']),
    entries: array(leaderboardEntry),
  })(input, path);
  return { fetchedAt: file.fetchedAt, source: file.source, entries: file.entries };
};

const sourceEntry: Decoder<SourceEntry> = object<SourceEntry>({
  repository: nonEmptyStr,
  commit: nonEmptyStr,
  path: nonEmptyStr,
  contentHash: nonEmptyStr,
  invocationPolicy: oneOf(['model', 'user']),
});

const sourceLock: Decoder<SourceLock> = tagged<SourceLock>({
  git_commit: object({ kind: oneOf(['git_commit']), repository: nonEmptyStr, commit: nonEmptyStr, path: nonEmptyStr, contentHash: nonEmptyStr }),
  content_hash: object({ kind: oneOf(['content_hash']), contentHash: nonEmptyStr }),
});

const lockedSkill: Decoder<LockedSkill> = object<LockedSkill>({
  name: nonEmptyStr,
  source: nonEmptyStr,
  rank: num,
  installs: num,
  lock: sourceLock,
  invocationPolicy: oneOf(['model', 'user']),
  prerequisites: array(str),
});

export const registrySnapshot: Decoder<RegistrySnapshot> = object<RegistrySnapshot>({
  schemaVersion: oneOf([1]),
  snapshotTime: str,
  source: str,
  view: oneOf(['all-time']),
  rankingBasis: oneOf(['install_telemetry']),
  cutoff: oneOf([50]),
  leaderboard: array(leaderboardEntry),
  skills: array(lockedSkill),
});

export function parseLeaderboardFile(input: unknown): Decoded<LeaderboardFile> {
  return decode(leaderboardFile, input);
}

export function parseSources(input: unknown): Decoded<Readonly<Record<string, SourceEntry>>> {
  return decode(stringMap(sourceEntry), input);
}

export function parseSnapshot(input: unknown): Decoded<RegistrySnapshot> {
  return decode(registrySnapshot, input);
}

export function verifySnapshot(snapshot: RegistrySnapshot): readonly string[] {
  return snapshot.skills.flatMap((skill) => {
    if (skill.rank > snapshot.cutoff) return [`${skill.name} rank ${skill.rank} exceeds cutoff ${snapshot.cutoff}`];
    const entry = snapshot.leaderboard.find((candidate) => candidate.skillId === skill.name && candidate.source === skill.source);
    if (entry === undefined) return [`${skill.name} missing from leaderboard`];
    if (entry.rank !== skill.rank) return [`${skill.name} rank ${skill.rank} does not match leaderboard rank ${entry.rank}`];
    return [];
  });
}
