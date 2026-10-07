import type { Shell } from './shell.ts';

async function git(shell: Shell, args: readonly string[]): Promise<string> {
  const result = await shell('git', args);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function revision(shell: Shell): Promise<string> {
  return git(shell, ['rev-parse', 'HEAD']);
}

export function topLevel(shell: Shell): Promise<string> {
  return git(shell, ['rev-parse', '--show-toplevel']);
}

export async function remoteUrl(shell: Shell): Promise<string | null> {
  const result = await shell('git', ['remote', 'get-url', 'origin']);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function changedPaths(shell: Shell, from: string, to: string): Promise<readonly string[]> {
  const out = await git(shell, ['diff', '--name-only', '--no-renames', '--relative', from, to]);
  return out === '' ? [] : out.split('\n');
}

export async function isDirty(shell: Shell): Promise<boolean> {
  return (await git(shell, ['status', '--porcelain'])) !== '';
}

// Pruning first drops entries whose directory is gone; the exact absolute path keeps a sibling package's `.s50` from matching.
export async function ensureWorktree(shell: Shell, path: string, branch: string): Promise<void> {
  await git(shell, ['worktree', 'prune']);
  const top = await git(shell, ['rev-parse', '--show-toplevel']);
  const prefix = await git(shell, ['rev-parse', '--show-prefix']);
  const target = `${top}/${prefix}${path}`;
  const blocks = (await git(shell, ['worktree', 'list', '--porcelain'])).split('\n\n');
  const existing = blocks.find((block) => block.split('\n')[0] === `worktree ${target}`);
  if (existing === undefined) {
    await git(shell, ['worktree', 'add', '-B', branch, path]);
    return;
  }
  if (!existing.split('\n').includes(`branch refs/heads/${branch}`)) throw new Error(`worktree ${path} is checked out on another branch; remove it with git worktree remove ${path}`);
}

export async function remoteHead(shell: Shell, repository: string): Promise<string> {
  const out = await git(shell, ['ls-remote', `https://github.com/${repository}`, 'HEAD']);
  const sha = out.split(/\s/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`git ls-remote ${repository} HEAD returned no commit`);
  return sha;
}
