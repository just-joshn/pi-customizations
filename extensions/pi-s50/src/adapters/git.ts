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

export async function ensureWorktree(shell: Shell, path: string, branch: string): Promise<void> {
  const listed = await git(shell, ['worktree', 'list', '--porcelain']);
  if (listed.split('\n').some((line) => line.startsWith('worktree ') && line.endsWith(`/${path}`))) return;
  await git(shell, ['worktree', 'add', '-B', branch, path]);
}

export async function remoteHead(shell: Shell, repository: string): Promise<string> {
  const out = await git(shell, ['ls-remote', `https://github.com/${repository}`, 'HEAD']);
  const sha = out.split(/\s/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`git ls-remote ${repository} HEAD returned no commit`);
  return sha;
}
