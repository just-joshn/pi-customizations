import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const SANDBOX_ENV = 'PSTACK_V2_SANDBOXED';
/** The job directory of the sandboxed process. Jobs it asks the root to start are requested under its writable `nested/` directory. */
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
  /** Checkouts the job may write. No `.pi` code entry or `.git` entry anywhere in them may be written, even one that does not exist yet. */
  checkouts: string[];
  agentDir: string;
  /**
   * The job's own Pi agent directory, shared with every job its top-level job starts. Only the contents of its credentials
   * copy and Pi's lock directories are writable, so no job can change what another job's Pi loads.
   */
  credentials: string;
  /** The job's own directory. Jobs it asks the root to start are requested under its `nested/` directory. */
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
const gitRedirects = (common: string): string => `^${escapeRegex(real(common))}/(config\\.worktree|worktrees/[^/]+/(commondir|gitdir|config\\.worktree)|modules/.+/(hooks|config|info|commondir|gitdir|config\\.worktree))(/|$)`;

/** The git directories of the linked worktrees the job works in, which it may write apart from their redirection files. */
const ownWorktrees = (policy: SandboxPolicy): string[] => policy.lock.filter((path) => policy.gitDirs.some((common) => dirname(path) === join(common, 'worktrees')));

/**
 * bubblewrap can only make read-only what exists, so the git paths a job may not create are created first, empty. Git
 * reads an empty `config.worktree` as no settings, and empty `hooks`, `info`, `worktrees`, and `modules` directories as none.
 */
function placeholders(policy: SandboxPolicy): void {
  for (const common of policy.gitDirs) {
    if (!existsSync(common)) continue;
    for (const name of ['hooks', 'info', 'worktrees', 'modules']) mkdirSync(join(common, name), { recursive: true });
    for (const dir of [common, ...ownWorktrees(policy)]) if (existsSync(dir) && !existsSync(join(dir, 'config.worktree'))) writeFileSync(join(dir, 'config.worktree'), '');
  }
}

export function seatbeltProfile(policy: SandboxPolicy): string {
  const subpaths = (paths: string[]): string => paths.map((path) => `(subpath ${quote(real(path))})`).join(' ');
  // A protected path that is itself a symlink is guarded at the link as well as at its target, so it cannot be swapped.
  const guarded = [...policy.protect.map((path) => `(subpath ${quote(real(path))}) (literal ${quote(entry(path))})`), ...policy.lock.map((path) => `(literal ${quote(real(path))}) (literal ${quote(entry(path))})`)];
  const inAgentDir = policy.writable.filter((path) => real(path) === real(policy.agentDir) || real(path).startsWith(`${real(policy.agentDir)}/`));
  const lines = [
    '(version 1)',
    '(allow default)',
    // Later rules win, so the order is the job's own paths, then Pi's agent directory closed even when a job path holds
    // it, then the job's own paths inside it, then the paths an unsandboxed process would execute from. Shared temp
    // directories are not writable: unsandboxed programs load code cached there, so each job gets its own.
    '(deny file-write*)',
    `(allow file-write* (literal "/dev/null") (literal "/dev/ptmx") (regex #"^/dev/tty") (regex #"^/dev/fd/") ${subpaths(policy.writable)})`,
    `(deny file-write* (subpath ${quote(real(policy.agentDir))}))`,
    // Inside Pi's agent directory only the job's own paths are writable, its session, nested jobs, temp, and its own agent
    // directory with its credentials copy. Your real auth.json and settings are never writable.
    ...(inAgentDir.length ? [`(allow file-write* ${subpaths(inAgentDir)})`] : []),
    ...(policy.credentials ? [`(allow file-write-data (literal ${quote(join(real(policy.credentials), 'auth.json'))}))`, `(allow file-write* (regex #"^${escapeRegex(real(policy.credentials))}/[^/]+\\.lock(/|$)"))`] : []),
    // A job may not add or change a worktree or submodule, apart from the metadata of the worktree it works in.
    ...policy.gitDirs.map((common) => `(deny file-write* (subpath ${quote(real(join(common, 'worktrees')))}) (subpath ${quote(real(join(common, 'modules')))}))`),
    ...(ownWorktrees(policy).length ? [`(allow file-write* ${subpaths(ownWorktrees(policy))})`] : []),
    `(deny file-write* (regex #"${TMUX_SOCKETS}") ${guarded.join(' ')} ${policy.gitDirs.map((common) => `(regex #"${gitRedirects(common)}")`).join(' ')})`,
    // Any .git a checkout gains is a repository git would run hooks from, apart from the checkout's own git directory.
    ...policy.checkouts.map((root) => {
      const git = existsSync(join(root, '.git')) && statSync(join(root, '.git')).isDirectory() ? '.+/\\.git' : '(.*/)?\\.git';
      return `(deny file-write* (regex #"^${escapeRegex(real(root))}/(${git}|(.*/)?\\.pi/(extensions|settings\\.json|mcp\\.json|npm|git))(/|$)"))`;
    }),
    // Any local service socket could start a process outside the sandbox, such as Docker's, so only DNS is reachable.
    '(deny network-outbound (remote unix-socket))',
    '(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))',
    // Nor may it serve one, such as a tmux server of its own. Linux refuses the same through seccomp.
    '(deny network-bind (local unix-socket))',
    // Services that start processes on a caller's behalf would run them outside the sandbox: LaunchServices (`open`) and Apple Events.
    // `open -a` on an app the job wrote launches it through launchd, so the lookup rules below cannot stop it, and lsopen does.
    '(deny appleevent-send)',
    '(deny lsopen)',
    // A job may signal only processes in its own sandbox, never the wrapper that cleans up after it or the root Pi.
    '(deny signal)',
    '(allow signal (target same-sandbox))',
    // launchservicesd stays reachable because Firefox checks in with it at startup and aborts without it. Opening goes through lsopen.
    '(deny mach-lookup (global-name-regex #"^com\\.apple\\.lsd\\.") (global-name "com.apple.coreservices.appleevents"))',
    // launchd would run a job it is handed outside the sandbox, and preference writes go through a daemon outside it.
    '(deny mach-lookup (global-name-regex #"^com\\.apple\\.xpc\\.launchd\\."))',
    '(deny user-preference-write)',
  ];
  return lines.join('\n');
}

/** Existing worktree and submodule redirection files under a git common directory, for bubblewrap, which can only bind what exists. */
function existingRedirects(common: string): string[] {
  const found: string[] = [];
  const worktrees = join(common, 'worktrees');
  found.push(join(common, 'config.worktree'));
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
  // A private /tmp, since unsandboxed programs load code they cached in the shared one. It also hides outside tmux sockets.
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--unshare-pid', '--tmpfs', '/tmp'];
  // Pi's agent directory stays visible, read-only, even when it sits under the private /tmp.
  if (existsSync(policy.agentDir)) args.push('--ro-bind', policy.agentDir, policy.agentDir);
  const writable = policy.writable.filter(existsSync);
  for (const path of writable) args.push('--bind', path, path);
  // Later mounts win, so everything below lands on top of the writable paths, even one that contains these.
  // Service sockets live under /run, such as Docker's and the system bus, so it is hidden, except the DNS resolver's files.
  for (const hidden of new Set(['/run', '/var/run', `/run/user/${uid}`, env['XDG_RUNTIME_DIR']])) if (hidden && existsSync(hidden) && !lstatSync(hidden).isSymbolicLink()) args.push('--tmpfs', hidden);
  for (const resolver of ['/run/systemd/resolve', '/run/resolvconf']) if (existsSync(resolver)) args.push('--ro-bind', resolver, resolver);
  // The job's agent directory becomes a throwaway tmpfs holding its entries read-only, so Pi can create lock directories,
  // and only its credentials copy is bound writable.
  if (policy.credentials && existsSync(policy.credentials)) {
    args.push('--tmpfs', policy.credentials);
    for (const name of readdirSync(policy.credentials)) {
      const path = join(policy.credentials, name);
      args.push(name === 'auth.json' ? '--bind' : '--ro-bind', path, path);
    }
  }
  // A mount point cannot be renamed, so a locked directory is bound onto itself, still writable inside, and a locked file read-only.
  for (const path of policy.lock.filter(existsSync)) args.push(statSync(path).isDirectory() ? '--bind' : '--ro-bind', path, path);
  for (const common of policy.gitDirs) for (const name of ['worktrees', 'modules']) if (existsSync(join(common, name))) args.push('--ro-bind', join(common, name), join(common, name));
  for (const own of ownWorktrees(policy)) args.push('--bind', own, own);
  for (const path of [...policy.protect, ...policy.gitDirs.flatMap(existingRedirects)].filter(existsSync)) args.push('--ro-bind', path, path);
  // Shared /tmp is read-only, as on macOS, once everything under it is mounted.
  return [...args, '--remount-ro', '/tmp', '--die-with-parent', '--'];
}

/** Linux syscall numbers and audit architecture for the seccomp filter, per Node architecture. */
const SYSCALLS: Partial<Record<NodeJS.Architecture, { audit: number; socket: number; ioUringSetup: number }>> = {
  x64: { audit: 0xc000003e, socket: 41, ioUringSetup: 425 },
  arm64: { audit: 0xc00000b7, socket: 198, ioUringSetup: 425 },
};

/**
 * A classic BPF program for bubblewrap's `--seccomp`: a job may not open a Unix socket, the way macOS denies binding or
 * connecting one, so it reaches no local service, abstract socket, or tmux server. Socket pairs, which child processes
 * use for pipes, stay allowed. io_uring could open a socket around the filter, and another architecture's syscall
 * numbers around its checks, so both are refused.
 */
export function seccompFilter(arch: NodeJS.Architecture = process.arch): Buffer {
  const nr = SYSCALLS[arch];
  if (!nr) throw new Error(`pstack's Linux sandbox supports x64 and arm64, not ${arch}.`);
  const LD = 0x20;
  const JEQ = 0x15;
  const JGE = 0x35;
  const RET = 0x06;
  const ALLOW = 0x7fff0000;
  const DENY = 0x00050001;
  const program: [number, number, number, number][] = [
    [LD, 0, 0, 4],
    [JEQ, 0, 7, nr.audit],
    [LD, 0, 0, 0],
    [JGE, 5, 0, 0x40000000],
    [JEQ, 4, 0, nr.ioUringSetup],
    [JEQ, 0, 2, nr.socket],
    [LD, 0, 0, 16],
    [JEQ, 1, 0, 1],
    [RET, 0, 0, ALLOW],
    [RET, 0, 0, DENY],
  ];
  const bytes = Buffer.alloc(program.length * 8);
  program.forEach(([code, jt, jf, k], index) => {
    bytes.writeUInt16LE(code, index * 8);
    bytes.writeUInt8(jt, index * 8 + 2);
    bytes.writeUInt8(jf, index * 8 + 3);
    bytes.writeUInt32LE(k, index * 8 + 4);
  });
  return bytes;
}

/** The filter's file in Pi's agent directory, which no job may write, so none can loosen the filter before a launch. */
function seccompFile(agentDir: string): string {
  const path = join(agentDir, 'pstack-v2', `seccomp-${process.arch}.bpf`);
  const filter = seccompFilter();
  if (!existsSync(path) || !readFileSync(path).equals(filter)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, filter);
  }
  return path;
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
  if (platform === 'darwin' && available('command -v sandbox-exec')) {
    placeholders(policy);
    return ['sandbox-exec', '-p', seatbeltProfile(policy), ...argv];
  }
  if (platform === 'linux' && available('command -v bwrap')) {
    placeholders(policy);
    // bubblewrap reads the filter from a file descriptor, which the shell opens just before it becomes bwrap.
    return ['/bin/sh', '-c', 'exec 9<"$1"; shift; exec bwrap --seccomp 9 "$@"', 'sh', seccompFile(policy.agentDir), ...bwrapArgs(policy, env), ...argv];
  }
  throw new Error(`pstack runs every job in a sandbox and found none on ${platform}. Install bubblewrap (bwrap) on Linux or WSL2, or use macOS, where Seatbelt (sandbox-exec) is built in.`);
}
