import { existsSync, realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { BRANDING } from '../branding.ts';
import type { Host } from '../core/host.ts';
import { findGitRoot } from '../settings/config-files.ts';

/** Outcome of Aider's discover → setup → open → sanity → gitignore startup path. */
export type RepoStartupResult = { readonly kind: 'ready'; readonly root: string } | { readonly kind: 'disabled' };

export type OpenSingleRootResult = { readonly kind: 'ok'; readonly root: string } | { readonly kind: 'none' } | { readonly kind: 'multiple' };

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** The directory holding `.git` at or above `cwd`, as Aider's `get_git_root` finds the repository. */
export function discoverGitRoot(cwd: string): string | null {
  const found = findGitRoot(cwd);
  return found ? canonical(found) : null;
}

async function gitExec(host: Host, cwd: string, args: readonly string[]) {
  return host.exec({ command: 'git', args, cwd });
}

async function resolveToplevel(host: Host, path: string): Promise<string | null> {
  const probe = resolve(path);
  const cwd = existsSync(probe) ? probe : resolve(probe, '..');
  const shown = await gitExec(host, cwd, ['rev-parse', '--show-toplevel']);
  if (shown.code !== 0) return null;
  const root = shown.stdout.trim();
  return root ? canonical(root) : null;
}

/** Open exactly one repository root from the input paths, matching Aider `GitRepo` construction. */
export async function openSingleRoot(host: Host, paths: readonly string[]): Promise<OpenSingleRootResult> {
  const roots = new Set<string>();
  for (const path of paths.length > 0 ? paths : ['.']) {
    const root = await resolveToplevel(host, path);
    if (root) roots.add(root);
  }
  if (roots.size === 0) return { kind: 'none' };
  if (roots.size > 1) {
    host.error('Files are in different git repos.');
    return { kind: 'multiple' };
  }
  return { kind: 'ok', root: [...roots][0]! };
}

async function gitCommandAvailable(host: Host, cwd: string): Promise<boolean> {
  try {
    const version = await gitExec(host, cwd, ['--version']);
    return version.code === 0;
  } catch {
    return false;
  }
}

async function indexVersion(host: Host, root: string): Promise<number | null> {
  const shown = await gitExec(host, root, ['update-index', '--show-index-version']);
  if (shown.code === 0) {
    const value = Number.parseInt(shown.stdout.trim(), 10);
    if (Number.isFinite(value)) return value;
  }
  const pathOut = await gitExec(host, root, ['rev-parse', '--git-path', 'index']);
  if (pathOut.code !== 0) return null;
  const relative = pathOut.stdout.trim();
  const indexPath = isAbsolute(relative) ? relative : resolve(root, relative);
  try {
    const buf = await readFile(indexPath);
    if (buf.length < 8 || buf.subarray(0, 4).toString('utf8') !== 'DIRC') return null;
    return buf.readUInt32BE(4);
  } catch {
    return null;
  }
}

function refuseIndexVersion(host: Host): false {
  host.error('Aider only works with git repos with version number 1 or 2.');
  host.output('You may be able to convert your repo: git update-index --index-version=2');
  host.output('Or run aider --no-git to proceed without using git.');
  return false;
}

/** Refuse bare, corrupt, and index versions above 2; accept detached HEAD. */
export async function sanityCheckRepo(host: Host, root: string): Promise<boolean> {
  const bare = await gitExec(host, root, ['rev-parse', '--is-bare-repository']);
  if (bare.code === 0 && bare.stdout.trim() === 'true') {
    host.error('The git repo does not seem to have a working tree?');
    return false;
  }
  const inside = await gitExec(host, root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code === 0 && inside.stdout.trim() === 'true') {
    const version = await indexVersion(host, root);
    if (version !== null && version > 2) return refuseIndexVersion(host);
    const listed = await gitExec(host, root, ['ls-files', '--cached']);
    if (listed.code !== 0) {
      const errorMsg = listed.stderr.trim() || listed.stdout.trim() || 'Unable to read git repository';
      if (errorMsg.includes('version in (1, 2)') || /bad index version/i.test(errorMsg)) return refuseIndexVersion(host);
      host.error('Unable to read git repository, it may be corrupt?');
      host.output(errorMsg);
      return false;
    }
    return true;
  }
  if (bare.code === 0 && bare.stdout.trim() === 'false') {
    host.error('The git repo does not seem to have a working tree?');
    return false;
  }
  const listed = await gitExec(host, root, ['ls-files', '--cached']);
  const errorMsg = listed.stderr.trim() || listed.stdout.trim() || 'Unable to read git repository';
  host.error('Unable to read git repository, it may be corrupt?');
  host.output(errorMsg);
  return false;
}

async function ensureUserIdentity(host: Host, root: string): Promise<void> {
  const name = await gitExec(host, root, ['config', '--get', 'user.name']);
  const email = await gitExec(host, root, ['config', '--get', 'user.email']);
  const haveName = name.code === 0 && name.stdout.trim().length > 0;
  const haveEmail = email.code === 0 && email.stdout.trim().length > 0;
  if (haveName && haveEmail) return;
  if (!haveName) {
    await gitExec(host, root, ['config', 'user.name', 'Your Name']);
    host.warning('Update git name with: git config user.name "Your Name"');
  }
  if (!haveEmail) {
    await gitExec(host, root, ['config', 'user.email', 'you@example.com']);
    host.warning('Update git email with: git config user.email "you@example.com"');
  }
}

async function makeNewRepo(host: Host, gitRoot: string): Promise<string | null> {
  const init = await gitExec(host, gitRoot, ['init']);
  if (init.code !== 0) {
    host.error(`Unable to create git repo in ${gitRoot}`);
    host.output(init.stderr.trim() || init.stdout.trim());
    return null;
  }
  await checkGitignore(host, gitRoot, false);
  const root = canonical(gitRoot);
  host.output(`Git repository created in ${root}`);
  await ensureUserIdentity(host, root);
  return root;
}

/** When no repository exists, offer initialization outside the home directory. */
export async function setupGit(host: Host, cwd: string, home: string): Promise<string | null> {
  const existing = discoverGitRoot(cwd);
  if (existing) {
    await ensureUserIdentity(host, existing);
    return existing;
  }
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  if (resolvedCwd === resolvedHome) {
    host.warning("You should probably run aider in your project's directory, not your home dir.");
    return null;
  }
  const confirmed = await host.confirm({
    question: "No git repo found, create one to track aider's changes (recommended)?",
  });
  if (!confirmed) return null;
  return makeNewRepo(host, resolvedCwd);
}

async function pathIgnored(host: Host, root: string, path: string): Promise<boolean> {
  const check = await gitExec(host, root, ['check-ignore', '-q', '--', path]);
  return check.code === 0;
}

/** Offer to append branding and environment-file exclusions to `.gitignore`. */
export async function checkGitignore(host: Host, root: string, ask: boolean): Promise<void> {
  const patterns: string[] = [];
  if (!(await pathIgnored(host, root, '.pi-maintainer'))) patterns.push(BRANDING.gitignorePattern);
  if (existsSync(join(root, '.env')) && !(await pathIgnored(host, root, '.env'))) patterns.push('.env');
  if (patterns.length === 0) return;

  const gitignoreFile = join(root, '.gitignore');
  let content = '';
  if (existsSync(gitignoreFile)) {
    try {
      content = await readFile(gitignoreFile, 'utf8');
      if (content.length > 0 && !content.endsWith('\n')) content += '\n';
    } catch (error) {
      host.error(`Error when trying to read ${gitignoreFile}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }

  if (ask) {
    host.output('You can skip this check with --no-gitignore');
    const confirmed = await host.confirm({
      question: `Add ${patterns.join(', ')} to .gitignore (recommended)?`,
    });
    if (!confirmed) return;
  }

  content += `${patterns.join('\n')}\n`;
  try {
    await writeFile(gitignoreFile, content);
    host.output(`Added ${patterns.join(', ')} to .gitignore`);
  } catch (error) {
    host.error(`Error when trying to write to ${gitignoreFile}: ${error instanceof Error ? error.message : String(error)}`);
    host.output('Try running with appropriate permissions or manually add these patterns to .gitignore:');
    for (const pattern of patterns) host.output(`  ${pattern}`);
  }
}

/**
 * Run Aider's repository startup sequence using Host.confirm and Host.exec.
 * Returns a ready root or disables Git integration without crashing the session.
 */
export async function prepareGitRepository(options: {
  readonly host: Host;
  readonly cwd: string;
  readonly home: string;
  readonly gitEnabled: boolean;
  readonly gitignoreOffer: boolean;
  readonly paths?: readonly string[];
}): Promise<RepoStartupResult> {
  const { host, cwd, home, gitEnabled, gitignoreOffer } = options;
  if (!gitEnabled) return { kind: 'disabled' };
  if (!(await gitCommandAvailable(host, cwd))) return { kind: 'disabled' };

  let root = discoverGitRoot(cwd);
  if (!root) {
    root = await setupGit(host, cwd, home);
    if (!root) return { kind: 'disabled' };
  }

  const paths = options.paths ?? [cwd];
  const opened = await openSingleRoot(host, paths);
  if (opened.kind !== 'ok') return { kind: 'disabled' };
  root = opened.root;

  if (!(await sanityCheckRepo(host, root))) return { kind: 'disabled' };
  if (gitignoreOffer) await checkGitignore(host, root, true);
  await ensureUserIdentity(host, root);
  return { kind: 'ready', root };
}
