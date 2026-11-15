import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const SANDBOX_ENV = 'PSTACK_V2_SANDBOXED';
/** The job directory of the sandboxed process. Jobs it starts, and their tmux socket, live under its writable `nested/` directory. */
export const JOB_DIR_ENV = 'PSTACK_V2_JOB_DIR';
/** The directory of the top-level job a process descends from. Its `brokered/` directory holds what the root launched for descendants. */
export const TOP_DIR_ENV = 'PSTACK_V2_TOP_DIR';

export interface SandboxPolicy {
  /** Paths the job may write. */
  writable: string[];
  /** Paths inside `writable` that stay read-only because an unsandboxed process would execute what they hold, such as git hooks. */
  protect: string[];
  /** Paths whose own entry may not be renamed, removed, or replaced, while writes inside them stay allowed, such as `.git`. */
  lock: string[];
  /** Git common directories the job may write. Every worktree and submodule redirection file under them stays read-only. */
  gitDirs: string[];
  agentDir: string;
  /** The job's own directory. Only its `nested/` tmux socket is reachable; every other tmux server stays out of reach. */
  jobDir: string;
}

const real = (path: string): string => (existsSync(path) ? realpathSync(path) : path);
/** A path as the kernel sees it when the entry itself is the target: the real parent plus the entry's own name, links unresolved. */
const entry = (path: string): string => join(real(dirname(path)), basename(path));
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quote = (text: string): string => JSON.stringify(text);

// tmux servers outside the sandbox run commands unsandboxed, so a job may not connect to their sockets or replace them.
const TMUX_SOCKETS = '^/private/(tmp|var/folders/[^/]+/[^/]+/T)/(tmux|pstack-v2)-';
// Files through which git finds a worktree's or submodule's hooks and config.
const gitRedirects = (common: string): string => `^${escapeRegex(real(common))}/(worktrees/[^/]+/(commondir|gitdir|config\\.worktree)|modules/.+/(hooks|config|info|commondir|gitdir|config\\.worktree))(/|$)`;

export function seatbeltProfile(policy: SandboxPolicy): string {
  const agent = escapeRegex(real(policy.agentDir));
  const subpaths = (paths: string[]): string => paths.map((path) => `(subpath ${quote(real(path))})`).join(' ');
  // A protected path that is itself a symlink is guarded at the link as well as at its target, so it cannot be swapped.
  const guarded = [...policy.protect.map((path) => `(subpath ${quote(real(path))}) (literal ${quote(entry(path))})`), ...policy.lock.map((path) => `(literal ${quote(real(path))}) (literal ${quote(entry(path))})`)];
  const lines = [
    '(version 1)',
    '(allow default)',
    // Later rules win, so the order is temp directories, then Pi's agent directory closed even when it sits in a temp
    // directory, then the job's own paths, then the paths an unsandboxed process would execute from.
    '(deny file-write*)',
    '(allow file-write* (literal "/dev/null") (literal "/dev/ptmx") (regex #"^/dev/tty") (regex #"^/dev/fd/") (subpath "/private/tmp") (subpath "/private/var/folders"))',
    `(deny file-write* (subpath ${quote(real(policy.agentDir))}))`,
    // Pi refreshes credentials in place and takes lock directories beside its files. Nothing else in its agent directory is writable.
    `(allow file-write* ${subpaths(policy.writable)} (literal ${quote(`${real(policy.agentDir)}/auth.json`)}) (regex #"^${agent}/[^/]+\\.lock(/|$)"))`,
    `(deny file-write* (regex #"${TMUX_SOCKETS}") ${guarded.join(' ')} ${policy.gitDirs.map((common) => `(regex #"${gitRedirects(common)}")`).join(' ')})`,
    `(deny network-outbound (remote unix-socket (path-regex #"${TMUX_SOCKETS}")) (remote unix-socket (path-regex #"^${agent}/pstack-v2/")))`,
    `(allow network-outbound (remote unix-socket (path-regex #"^${escapeRegex(real(policy.jobDir))}/nested/")))`,
    // Services that start processes on a caller's behalf would run them outside the sandbox: LaunchServices (`open`) and Apple Events.
    '(deny appleevent-send)',
    '(deny mach-lookup (global-name "com.apple.coreservices.launchservicesd") (global-name-regex #"^com\\.apple\\.lsd\\.") (global-name "com.apple.coreservices.appleevents"))',
  ];
  return lines.join('\n');
}

/** Existing worktree and submodule redirection files under a git common directory, for bubblewrap, which can only bind what exists. */
function existingRedirects(common: string): string[] {
  const found: string[] = [];
  const worktrees = join(common, 'worktrees');
  if (existsSync(worktrees)) for (const name of readdirSync(worktrees)) for (const file of ['commondir', 'gitdir', 'config.worktree']) found.push(join(worktrees, name, file));
  const walk = (dir: string, depth: number): void => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (['hooks', 'config', 'info', 'commondir', 'gitdir', 'config.worktree'].includes(name)) found.push(path);
      else if (statSync(path).isDirectory()) walk(path, depth + 1);
    }
  };
  walk(join(common, 'modules'), 0);
  return found.filter(existsSync);
}

export function bwrapArgs(policy: SandboxPolicy, env: NodeJS.ProcessEnv = process.env, uid: number = process.getuid?.() ?? 0): string[] {
  // Its own PID namespace means every process a job starts dies with it, and none can signal the wrapper outside.
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--unshare-pid', '--bind', '/tmp', '/tmp'];
  // Outside tmux servers and the user's session bus would run what a job sends them outside the sandbox.
  for (const hidden of new Set([`/tmp/tmux-${uid}`, `/tmp/pstack-v2-${uid}`, `/run/user/${uid}`, env['XDG_RUNTIME_DIR']])) if (hidden && existsSync(hidden)) args.push('--tmpfs', hidden);
  // Pi's agent directory becomes a throwaway tmpfs holding its real entries read-only, so Pi can still create its lock
  // directories. Credentials stay writable because Pi refreshes them in place. This nests, unlike an overlay mount.
  if (existsSync(policy.agentDir)) {
    args.push('--tmpfs', policy.agentDir);
    for (const name of readdirSync(policy.agentDir)) {
      const path = join(policy.agentDir, name);
      args.push(name === 'auth.json' ? '--bind' : '--ro-bind', path, path);
    }
  }
  for (const path of policy.writable.filter(existsSync)) args.push('--bind', path, path);
  for (const path of [...policy.protect, ...policy.gitDirs.flatMap(existingRedirects)].filter(existsSync)) args.push('--ro-bind', path, path);
  // A locked directory cannot be renamed while read-only mounts sit inside it, so only a locked file needs its own mount.
  for (const path of policy.lock.filter((path) => existsSync(path) && !statSync(path).isDirectory())) args.push('--ro-bind', path, path);
  return [...args, '--die-with-parent', '--'];
}

function available(command: string): boolean {
  try {
    execFileSync('/bin/sh', ['-c', command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wraps argv so it runs with writes limited to the policy. bubblewrap nests, so a Linux job inside a sandbox gets its own
 * narrower one. macOS refuses a second Seatbelt profile, so a sandboxed macOS worker asks the root Pi to launch instead.
 */
export function sandboxed(argv: string[], policy: SandboxPolicy, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'darwin' && available('command -v sandbox-exec')) return ['sandbox-exec', '-p', seatbeltProfile(policy), ...argv];
  if (platform === 'linux' && available('command -v bwrap')) return ['bwrap', ...bwrapArgs(policy, env), ...argv];
  throw new Error(`pstack runs every job in a sandbox and found none on ${platform}. Install bubblewrap (bwrap) on Linux or WSL2, or use macOS, where Seatbelt (sandbox-exec) is built in.`);
}
