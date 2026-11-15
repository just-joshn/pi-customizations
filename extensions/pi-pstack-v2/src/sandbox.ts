import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

export const SANDBOX_ENV = 'PSTACK_V2_SANDBOXED';
/** The job directory of the sandboxed process. Jobs it starts, and their tmux socket, live under its writable `nested/` directory. */
export const JOB_DIR_ENV = 'PSTACK_V2_JOB_DIR';

export interface SandboxPolicy {
  /** Paths the job may write. */
  writable: string[];
  /** Paths inside `writable` that stay read-only because an unsandboxed process would execute what they hold, such as git hooks. */
  protect: string[];
  agentDir: string;
  /** The job's own directory. Only its `nested/` tmux socket is reachable; every other tmux server stays out of reach. */
  jobDir: string;
}

const real = (path: string): string => (existsSync(path) ? realpathSync(path) : path);
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quote = (text: string): string => JSON.stringify(text);

// tmux servers outside the sandbox run commands unsandboxed, so a job may not connect to their sockets or replace them.
const TMUX_SOCKETS = '^/private/(tmp|var/folders/[^/]+/[^/]+/T)/(tmux|pstack-v2)-';

export function seatbeltProfile(policy: SandboxPolicy): string {
  const agent = escapeRegex(real(policy.agentDir));
  const subpaths = (paths: string[]): string => paths.map((path) => `(subpath ${quote(real(path))})`).join(' ');
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    // Later rules win, so the order is temp directories, then Pi's agent directory closed even when it sits in a temp
    // directory, then the job's own paths, then the paths an unsandboxed process would execute from.
    '(allow file-write* (literal "/dev/null") (literal "/dev/ptmx") (regex #"^/dev/tty") (regex #"^/dev/fd/") (subpath "/private/tmp") (subpath "/private/var/folders"))',
    `(deny file-write* (subpath ${quote(real(policy.agentDir))}))`,
    // Pi refreshes credentials in place and takes lock directories beside its files. Nothing else in its agent directory is writable.
    `(allow file-write* ${subpaths(policy.writable)} (literal ${quote(`${real(policy.agentDir)}/auth.json`)}) (regex #"^${agent}/[^/]+\\.lock(/|$)"))`,
    `(deny file-write* (regex #"${TMUX_SOCKETS}")${policy.protect.length ? ` ${subpaths(policy.protect)}` : ''})`,
    `(deny network-outbound (remote unix-socket (path-regex #"${TMUX_SOCKETS}")) (remote unix-socket (path-regex #"^${agent}/pstack-v2/")))`,
    `(allow network-outbound (remote unix-socket (path-regex #"^${escapeRegex(real(policy.jobDir))}/nested/")))`,
  ];
  return lines.join('\n');
}

export function bwrapArgs(policy: SandboxPolicy, env: NodeJS.ProcessEnv = process.env, uid: number = process.getuid?.() ?? 0): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--bind', '/tmp', '/tmp'];
  for (const hidden of [`/tmp/tmux-${uid}`, `/tmp/pstack-v2-${uid}`, env['XDG_RUNTIME_DIR']]) if (hidden && existsSync(hidden)) args.push('--tmpfs', hidden);
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
  for (const path of policy.protect.filter(existsSync)) args.push('--ro-bind', path, path);
  return [...args, '--die-with-parent', '--'];
}

function available(command: string): string | undefined {
  try {
    return execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return undefined;
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
