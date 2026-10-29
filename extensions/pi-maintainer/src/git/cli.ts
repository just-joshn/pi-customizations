import { relative, resolve, sep } from 'node:path';

import type { ExecOutcome, Host } from '../core/host.ts';

/** Normalize a repo-relative path the way Aider's `normalize_path` does on POSIX. */
export function normalizeRepoPath(root: string, path: string): string {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  return rel.split(sep).join('/');
}

export type GitRun = (args: readonly string[], options?: { readonly signal?: AbortSignal; readonly env?: Readonly<Record<string, string>> }) => Promise<ExecOutcome>;

/** Run git via Host.exec; an attribution overlay layers over the resolved maintainer environment. */
export function createGitRun(host: Host, root: string): GitRun {
  return async (args, options = {}) => {
    const env = options.env && Object.keys(options.env).length > 0 ? options.env : undefined;
    return host.exec({ command: 'git', args, cwd: root, ...(env ? { env } : {}), ...(options.signal ? { signal: options.signal } : {}) });
  };
}
