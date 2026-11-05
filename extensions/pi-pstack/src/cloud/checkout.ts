// A cloud machine's code is a fresh clone of the pushed remote, the way a Cursor cloud agent clones the repository on
// its VM: commits that exist only in the local checkout, local branches, and uncommitted changes never reach it.
import { execFile, execFileSync } from 'node:child_process';
import { join } from 'node:path';

export interface Remote {
  name: string;
  url: string;
}

/** Where a cloud machine's clone starts: the pushed branch and the commit the remote reported. */
export interface CloudBase {
  remote: Remote;
  branch: string;
  commit: string;
}

function git(dir: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function tryGit(dir: string, args: readonly string[]): string | undefined {
  try {
    return git(dir, args);
  } catch (error) {
    if (typeof (error as { status?: unknown }).status === 'number') return undefined;
    throw error;
  }
}

function gitAsync(args: readonly string[], signal: AbortSignal | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { encoding: 'utf8', maxBuffer: 16 << 20, ...(signal === undefined ? {} : { signal }) }, (error, stdout, stderr) => {
      if (error === null) resolve(stdout.trim());
      else reject(new Error(signal?.aborted === true ? 'stopped' : (stderr || error.message).trim()));
    });
  });
}

/** origin, else the current branch's upstream remote, else the only remote. */
export function remoteOf(cwd: string): Remote {
  if (tryGit(cwd, ['rev-parse', '--show-toplevel']) === undefined) throw new Error(`environment "cloud" clones the repository onto its own machine, but ${cwd} is not inside a git repository. Omit environment to run the subagent here.`);
  const names = (tryGit(cwd, ['remote']) ?? '').split('\n').filter(Boolean);
  const upstream = tryGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])?.split('/')[0];
  const name = names.includes('origin') ? 'origin' : upstream !== undefined && names.includes(upstream) ? upstream : names.length === 1 ? names[0] : undefined;
  if (name === undefined)
    throw new Error(
      names.length === 0
        ? `A cloud agent starts from pushed code, and ${cwd} has no git remote. Push the repository first, or omit environment to run the subagent here.`
        : `A cloud agent starts from pushed code, and ${cwd} has several remotes but none named origin. Name the remote to clone origin.`,
    );
  return { name, url: git(cwd, ['remote', 'get-url', name]) };
}

/** `refs/heads/<branch>` on the remote, or undefined when the remote has no such branch. */
async function remoteCommit(remote: Remote, branch: string, signal: AbortSignal | undefined): Promise<string | undefined> {
  const line = await gitAsync(['ls-remote', '--heads', remote.url, `refs/heads/${branch}`], signal).catch((error: unknown) => {
    throw new Error(`Could not read ${remote.url}: ${error instanceof Error ? error.message : String(error)}`);
  });
  return line.split('\t')[0] || undefined;
}

async function defaultBranch(remote: Remote, signal: AbortSignal | undefined): Promise<string> {
  const lines = await gitAsync(['ls-remote', '--symref', remote.url, 'HEAD'], signal);
  const branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(lines)?.[1];
  if (branch === undefined) throw new Error(`${remote.url} reports no default branch, so a cloud agent has nothing to start from. Pass cloud_base_branch.`);
  return branch;
}

/**
 * The pushed branch a cloud agent starts from: cloud_base_branch when given, else the current branch when the remote
 * has it, else the remote's default branch. The commit is the remote's, not the local branch's.
 */
export async function resolveCloudBase(cwd: string, baseBranch: string | undefined, signal?: AbortSignal): Promise<CloudBase> {
  const remote = remoteOf(cwd);
  if (baseBranch !== undefined) {
    const commit = await remoteCommit(remote, baseBranch, signal);
    if (commit === undefined) throw new Error(`cloud_base_branch "${baseBranch}" is not on ${remote.name} (${remote.url}). A cloud agent sees only pushed code: push the branch first.`);
    return { remote, branch: baseBranch, commit };
  }
  const current = tryGit(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (current !== undefined) {
    const commit = await remoteCommit(remote, current, signal);
    if (commit !== undefined) return { remote, branch: current, commit };
  }
  const branch = await defaultBranch(remote, signal);
  const commit = await remoteCommit(remote, branch, signal);
  if (commit === undefined) throw new Error(`${remote.url} has no ${branch} branch to start from. Pass cloud_base_branch.`);
  return { remote, branch, commit };
}

/** The directory inside the clone that corresponds to the parent's place in its repository. */
export function mappedCwd(cwd: string, clone: string, commit: string): string {
  const prefix = tryGit(cwd, ['rev-parse', '--show-prefix'])?.replace(/\/$/, '') ?? '';
  return prefix !== '' && tryGit(clone, ['cat-file', '-e', `${commit}:${prefix}`]) !== undefined ? join(clone, prefix) : clone;
}

/**
 * Clones the remote into `dest` and checks out a new branch at the base commit. The local repository lends its objects
 * (`--reference-if-able ... --dissociate`) so the clone is fast, but every ref comes from the remote. The branch tracks
 * the remote branch of the same name, so a plain `git push` publishes it.
 */
export async function cloneCheckout(cwd: string, base: CloudBase, dest: string, branch: string, signal?: AbortSignal): Promise<void> {
  const common = tryGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  await gitAsync(['clone', '--quiet', '--no-checkout', ...(common === undefined ? [] : ['--reference-if-able', common, '--dissociate']), '--origin', 'origin', base.remote.url, dest], signal).catch((error: unknown) => {
    throw new Error(`Could not clone ${base.remote.url} for the cloud agent: ${error instanceof Error ? error.message : String(error)}`);
  });
  await gitAsync(['-C', dest, 'checkout', '--quiet', '-b', branch, base.commit], signal);
  await gitAsync(['-C', dest, 'config', `branch.${branch}.remote`, 'origin'], signal);
  await gitAsync(['-C', dest, 'config', `branch.${branch}.merge`, `refs/heads/${branch}`], signal);
  for (const key of ['user.name', 'user.email']) {
    const value = tryGit(cwd, ['config', key]);
    if (value !== undefined) await gitAsync(['-C', dest, 'config', key, value], signal);
  }
}
