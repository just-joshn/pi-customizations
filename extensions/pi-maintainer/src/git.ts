/**
 * Git helpers used for the /lint file list. Only what the reference feature
 * needs: whether a repository exists, and its dirty files.
 *
 * Dirty means staged changes plus unstaged changes to tracked files. Untracked
 * files are not linted, and every path resolves against the repository root so
 * a subdirectory working directory still reports the same files.
 */

import { resolve } from 'node:path';

export interface GitRunner {
  exec(args: readonly string[]): Promise<{ readonly code: number; readonly stdout: string }>;
}

const TOP_LEVEL: readonly string[] = ['rev-parse', '--show-toplevel'];
const DIFF_ARGS: readonly (readonly string[])[] = [
  ['diff', '--name-only', '--cached'],
  ['diff', '--name-only'],
];

export async function isGitRepo(git: GitRunner): Promise<boolean> {
  const result = await git.exec(TOP_LEVEL);
  return result.code === 0;
}

export async function dirtyFiles(git: GitRunner): Promise<readonly string[]> {
  const rootResult = await git.exec(TOP_LEVEL);
  if (rootResult.code !== 0) return [];
  const root = rootResult.stdout.trim();
  if (root.length === 0) return [];

  const paths: string[] = [];
  for (const args of DIFF_ARGS) {
    const result = await git.exec(args);
    if (result.code !== 0) continue;
    for (const line of result.stdout.split('\n')) {
      const path = line.trim();
      if (path.length > 0 && !paths.includes(path)) paths.push(path);
    }
  }
  return paths.map((path) => resolve(root, path));
}
