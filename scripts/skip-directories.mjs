// Directories no repository scanner descends into: dependencies, build output,
// agent worktrees and pinned upstream snapshots.
export const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'coverage', 'artifacts', '.audit', 'dist', '.pi', '.claude', '.agents', 'upstream', 'upstream-team-kit']);
