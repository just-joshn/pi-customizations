export type InvocationPolicy = 'model' | 'user';

export type LeaderboardEntry = { readonly rank: number; readonly source: string; readonly skillId: string; readonly installs: number };

export type SourceLock = { readonly kind: 'git_commit'; readonly repository: string; readonly commit: string; readonly path: string; readonly contentHash: string } | { readonly kind: 'content_hash'; readonly contentHash: string };

export type LockedSkill = {
  readonly name: string;
  readonly source: string;
  readonly rank: number;
  readonly installs: number;
  readonly lock: SourceLock;
  readonly invocationPolicy: InvocationPolicy;
  readonly prerequisites: readonly string[];
};

export type RegistrySnapshot = {
  readonly schemaVersion: 1;
  readonly snapshotTime: string;
  readonly source: string;
  readonly view: 'all-time';
  readonly rankingBasis: 'install_telemetry';
  readonly cutoff: 50;
  readonly leaderboard: readonly LeaderboardEntry[];
  readonly skills: readonly LockedSkill[];
};
