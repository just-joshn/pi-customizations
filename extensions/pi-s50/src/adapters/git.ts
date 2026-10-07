import { runCommand } from './shell.ts';

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runCommand('git', args, cwd);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function revision(cwd: string): Promise<string> {
  return git(cwd, ['rev-parse', 'HEAD']);
}

export async function changedPaths(cwd: string, from: string, to: string): Promise<readonly string[]> {
  const out = await git(cwd, ['diff', '--name-only', '--no-renames', from, to]);
  return out === '' ? [] : out.split('\n');
}

export async function isDirty(cwd: string): Promise<boolean> {
  return (await git(cwd, ['status', '--porcelain'])) !== '';
}
