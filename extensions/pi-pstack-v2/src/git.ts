import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { landing, within } from './paths.ts';
import { codePaths, PI_CODE } from './sweep.ts';

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function gitPath(cwd: string, flag: '--git-common-dir' | '--show-toplevel' | '--absolute-git-dir'): string | undefined {
  try {
    return resolve(cwd, git(cwd, ['rev-parse', flag]));
  } catch {
    return undefined;
  }
}

/** A job may only work inside the session's project, so the model cannot widen its own sandbox by naming another directory. */
export function projectPath(ctx: ExtensionContext, path: string | undefined): string {
  const root = realpathSync(gitPath(ctx.cwd, '--show-toplevel') ?? ctx.cwd);
  const target = realpathSync(path === undefined ? ctx.cwd : resolve(ctx.cwd, path));
  // A linked worktree of the same repository, such as a worker's checkout, is the same project on another branch.
  const common = gitPath(ctx.cwd, '--git-common-dir');
  const targetCommon = gitPath(target, '--git-common-dir');
  const sameRepository = common !== undefined && targetCommon !== undefined && landing(targetCommon) === landing(common);
  const worktree = sameRepository ? gitPath(target, '--show-toplevel') : undefined;
  if (!within(target, [root, ...(worktree ? [worktree] : [])])) throw new Error(`cwd must be inside this project (${root}), got ${target}. To work on another branch, pass worktree and the job gets its own checkout.`);
  // A checkout of another repository can sit inside the project, and a job there would be handed that repository's git directory.
  if (targetCommon !== undefined && !sameRepository && !within(targetCommon, [root])) throw new Error(`cwd ${target} is a checkout of another repository (${targetCommon}). A job works only in this session's repository.`);
  return target;
}

/** Each existing directory above `path` up to, and excluding, the checkout. */
function existingAncestors(path: string, cwd: string): string[] {
  const dir = dirname(path);
  if (!within(dir, [cwd]) || dir === cwd) return [];
  return [...(existsSync(dir) ? [dir] : []), ...existingAncestors(dir, cwd)];
}

/**
 * Paths an unsandboxed process later executes from: git hooks and config, Pi's project extensions and settings, and
 * editor and agent-harness configuration. Git finds hooks through `.git`, and in a linked worktree through its `commondir`
 * and `gitdir` files, so each of those is protected too. A job that could repoint any of them would make the next
 * `git commit` run its own hooks unsandboxed.
 */
export function protectedPaths(cwd: string, common: string | undefined): { protect: string[]; lock: string[]; gitDirs: string[] } {
  // Every code entry already in the checkout, at any depth, since Pi, git, editors, and harnesses find them anywhere.
  const found = codePaths([cwd]);
  const piDirs = [...new Set([join(cwd, '.pi'), ...found.filter((path) => basename(dirname(path)) === '.pi').map(dirname)])];
  const pi = piDirs.flatMap((dir) => PI_CODE.map((name) => join(dir, name)));
  // The checkout's own .git is its git directory, which the job may write. Any other is a repository git would run hooks
  // from, and an editor or harness entry runs as it stands. `pi` already covers each .pi directory, and a .pi link stays as it is.
  const others = found.filter((path) => basename(path) !== '.pi' && basename(dirname(path)) !== '.pi' && path !== join(cwd, '.git'));
  let protect = [...pi, ...others];
  let lock: string[] = [];
  if (common) {
    const own = gitPath(cwd, '--absolute-git-dir') ?? common;
    const worktree = own === common ? [] : [join(cwd, '.git'), ...['commondir', 'gitdir', 'config.worktree'].map((name) => join(own, name))];
    let hooksPath: string[] = [];
    try {
      const configured = git(cwd, ['config', '--get', 'core.hooksPath']);
      if (configured) hooksPath = [resolve(gitPath(cwd, '--show-toplevel') ?? cwd, configured)];
    } catch {
      // No custom hooks path.
    }
    protect = [...protect, join(common, 'hooks'), join(common, 'config'), join(common, 'config.worktree'), join(common, 'info'), ...worktree, ...hooksPath];
    lock = [join(cwd, '.git'), own, common];
  }
  // A directory above a protected path could be renamed away and replaced, so each existing one up to the checkout is locked.
  const ancestors = protect.flatMap((path) => existingAncestors(path, cwd));
  return { protect, lock: [...new Set([...lock, ...ancestors])], gitDirs: common ? [common] : [] };
}

/** Adds the worktree and returns whether it created the branch, so a failed start can remove it. */
export function addWorktree(cwd: string, path: string, branch: string, base: string | undefined): boolean {
  if (branch.startsWith('-') || base?.startsWith('-')) throw new Error('worktree and base cannot start with "-".');
  let exists = true;
  try {
    git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  } catch {
    exists = false;
  }
  git(cwd, exists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, base === undefined ? 'HEAD' : baseOrSoleRemoteBranch(cwd, base)]);
  return !exists;
}

export function dropWorktree(repo: string, createdBranch: string | undefined): void {
  git(repo, ['worktree', 'prune']);
  if (createdBranch !== undefined) git(repo, ['branch', '-D', createdBranch]);
}

function baseOrSoleRemoteBranch(cwd: string, base: string): string {
  try {
    git(cwd, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
    return base;
  } catch {
    const remote = git(cwd, ['for-each-ref', '--format=%(refname:short)', `refs/remotes/*/${base}`])
      .split('\n')
      .filter(Boolean);
    return remote.length === 1 ? (remote[0] ?? base) : base;
  }
}
