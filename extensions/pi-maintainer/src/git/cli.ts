import { relative, resolve, sep } from 'node:path';

import type { ExecOutcome, Host } from '../core/host.ts';
import { isolatedExec } from '../core/isolated-exec.ts';

/** Normalize a repo-relative path the way Aider's `normalize_path` does on POSIX. */
export function normalizeRepoPath(root: string, path: string): string {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  return rel.split(sep).join('/');
}

export type GitRun = (args: readonly string[], options?: { readonly signal?: AbortSignal; readonly env?: Readonly<Record<string, string>> }) => Promise<ExecOutcome>;

/** Run git via Host.exec; attribution env overlays use isolatedExec. */
export function createGitRun(host: Host, root: string): GitRun {
  return async (args, options = {}) => {
    if (options.env && Object.keys(options.env).length > 0) {
      const base = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
      return isolatedExec({ command: 'git', args, cwd: root, ...(options.signal ? { signal: options.signal } : {}) }, { ...base, ...options.env });
    }
    return host.exec({ command: 'git', args, cwd: root, ...(options.signal ? { signal: options.signal } : {}) });
  };
}
