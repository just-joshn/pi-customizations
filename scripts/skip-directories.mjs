// Directories no repository scanner descends into: dependencies, build output,
// and agent worktrees.
export const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'coverage', 'artifacts', '.audit', 'dist', '.pi', '.claude', '.agents']);
