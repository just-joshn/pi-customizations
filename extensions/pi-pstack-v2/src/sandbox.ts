import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { z } from 'zod';

import { hostEnv } from './host-env.ts';
import { EDITOR_CODE, HARNESS_DIRS, HARNESS_INSTRUCTIONS, WORKSPACE_SUFFIX } from './sweep.ts';

type Env = NodeJS.ProcessEnv;
type Arch = NodeJS.Architecture;
type Platform = NodeJS.Platform;

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

/** Validates a policy read back from a job's spec file. */
export const SandboxPolicySchema: z.ZodType<SandboxPolicy> = z.object({
  writable: z.array(z.string()),
  protect: z.array(z.string()),
  lock: z.array(z.string()),
  gitDirs: z.array(z.string()),
  checkouts: z.array(z.string()),
  agentDir: z.string(),
  credentials: z.string(),
  jobDir: z.string(),
});

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

/** Rules refusing a checkout's git entries, Pi code, and editor and harness configuration. */
function checkoutRules(policy: SandboxPolicy): string[] {
  return [
    // Any .git a checkout gains is a repository git would run hooks from, apart from the checkout's own git directory.
    ...policy.checkouts.map((root) => {
      const git = existsSync(join(root, '.git')) && statSync(join(root, '.git')).isDirectory() ? '.+/\\.git' : '(.*/)?\\.git';
      return `(deny file-write* (regex #"^${escapeRegex(real(root))}/(${git}|(.*/)?\\.pi/(extensions|settings\\.json|mcp\\.json|npm|git))(/|$)"))`;
    }),
    // Editor and agent-harness configuration runs unsandboxed when the checkout is opened, so it is refused at any depth,
    // apart from the harnesses' instruction directories.
    ...policy.checkouts.map((root) => {
      const under = `^${escapeRegex(real(root))}/(.*/)?`;
      const alt = (names: readonly string[]): string => names.map(escapeRegex).join('|');
      const harness = `${under}(${alt(HARNESS_DIRS)})`;
      return `(deny file-write* (regex #"${under}(${alt(EDITOR_CODE)}|[^/]*${escapeRegex(WORKSPACE_SUFFIX)})(/|$)") (require-all (regex #"${harness}(/|$)") (require-not (regex #"${harness}/(${alt(HARNESS_INSTRUCTIONS)})(/|$)"))))`;
    }),
  ];
}

/** Rules that hold for every job: local sockets, launch services, signals, and preference writes. */
const SEATBELT_TAIL: string[] = [
  // Any local service socket could start a process outside the sandbox, such as Docker's, so only DNS is reachable.
  '(deny network-outbound (remote unix-socket))',
  // biome-ignore lint/security/noSecrets: macOS DNS uses this fixed mDNSResponder Unix socket path.
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
    ...checkoutRules(policy),
    ...SEATBELT_TAIL,
  ];
  return lines.join('\n');
}

const REDIRECT_FILES = ['commondir', 'gitdir', 'config.worktree'];
const MODULE_REDIRECTS = ['hooks', 'config', 'info', ...REDIRECT_FILES];
const MAX_MODULE_DEPTH = 6;

/** Existing worktree and submodule redirection files under a git common directory, for bubblewrap, which can only bind what exists. */
function existingRedirects(common: string): string[] {
  const worktrees = join(common, 'worktrees');
  const linked = existsSync(worktrees) ? readdirSync(worktrees).flatMap((name) => REDIRECT_FILES.map((file) => join(worktrees, name, file))) : [];
  const walk = (dir: string, depth: number): string[] => {
    if (depth > MAX_MODULE_DEPTH || !existsSync(dir)) return [];
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (MODULE_REDIRECTS.includes(name)) return [path];
      return statSync(path).isDirectory() ? walk(path, depth + 1) : [];
    });
  };
  return [join(common, 'config.worktree'), ...linked, ...walk(join(common, 'modules'), 0)].filter(existsSync);
}

const ROOT_DIR = '/';
const DEV_DIR = '/dev';
const PROC_DIR = '/proc';
const PRIVATE_TMP_DIR = '/tmp';
const RUN_DIR = '/run';
const VAR_RUN_DIR = '/var/run';
const SYSTEMD_RESOLVE_DIR = '/run/systemd/resolve';
const RESOLVCONF_DIR = '/run/resolvconf';
const RESOLVER_DIRS = [SYSTEMD_RESOLVE_DIR, RESOLVCONF_DIR];
const SHELL = '/bin/sh';

const bind = (flag: string, path: string): string[] => [flag, path, path];

/** The job's agent directory becomes a throwaway tmpfs holding its entries read-only, and only its credentials copy is bound writable. */
const credentialMounts = (credentials: string): string[] =>
  credentials && existsSync(credentials)
    ? ['--tmpfs', credentials, ...readdirSync(credentials).flatMap((name) => bind(name === 'auth.json' ? '--bind' : '--ro-bind', join(credentials, name)))]
    : [];

export function bwrapArgs(policy: SandboxPolicy, env: Env = hostEnv(), uid: number = process.getuid?.() ?? 0): string[] {
  // Service sockets live under /run, such as Docker's and the system bus, so it is hidden, except the DNS resolver's files.
  const hidden = [...new Set([RUN_DIR, VAR_RUN_DIR, `/run/user/${uid}`, env['XDG_RUNTIME_DIR']])].filter((path): path is string => Boolean(path) && existsSync(path as string) && !lstatSync(path as string).isSymbolicLink());
  const worktreeGitDirs = policy.gitDirs.flatMap((common) => ['worktrees', 'modules'].map((name) => join(common, name)).filter(existsSync));
  return [
    // Its own PID namespace means every process a job starts dies with it, and none can signal the wrapper outside.
    // A private /tmp, since unsandboxed programs load code they cached in the shared one. It also hides outside tmux sockets.
    ...['--ro-bind', ROOT_DIR, ROOT_DIR, '--dev', DEV_DIR, '--proc', PROC_DIR, '--unshare-pid', '--tmpfs', PRIVATE_TMP_DIR],
    // Pi's agent directory stays visible, read-only, even when it sits under the private /tmp.
    ...(existsSync(policy.agentDir) ? bind('--ro-bind', policy.agentDir) : []),
    ...policy.writable.filter(existsSync).flatMap((path) => bind('--bind', path)),
    // Later mounts win, so everything below lands on top of the writable paths, even one that contains these.
    ...hidden.flatMap((path) => ['--tmpfs', path]),
    ...RESOLVER_DIRS.filter(existsSync).flatMap((path) => bind('--ro-bind', path)),
    ...credentialMounts(policy.credentials),
    // A mount point cannot be renamed, so a locked directory is bound onto itself, still writable inside, and a locked file read-only.
    ...policy.lock.filter(existsSync).flatMap((path) => bind(statSync(path).isDirectory() ? '--bind' : '--ro-bind', path)),
    ...worktreeGitDirs.flatMap((path) => bind('--ro-bind', path)),
    ...ownWorktrees(policy).flatMap((path) => bind('--bind', path)),
    ...[...policy.protect, ...policy.gitDirs.flatMap(existingRedirects)].filter(existsSync).flatMap((path) => bind('--ro-bind', path)),
    // Shared /tmp is read-only, as on macOS, once everything under it is mounted.
    ...['--remount-ro', PRIVATE_TMP_DIR, '--die-with-parent', '--'],
  ];
}

/** Linux syscall numbers and audit architecture for the seccomp filter, per Node architecture. */
const SYSCALLS: Partial<Record<Arch, { audit: number; socket: number; ioUringSetup: number }>> = {
  x64: { audit: 0xc000003e, socket: 41, ioUringSetup: 425 },
  arm64: { audit: 0xc00000b7, socket: 198, ioUringSetup: 425 },
};

const ALLOW = 0x7fff0000;
const DENY = 0x00050001;
const SECCOMP_ARCH_OFFSET = 4;
const SECCOMP_FIRST_ARG_OFFSET = 16;
const SKIP_TO_DENY_FROM_ARCH = 7;
const SKIP_TO_DENY_FROM_X32 = 5;
const SKIP_TO_DENY_FROM_IO_URING = 4;
const SKIP_SOCKET_CHECK = 2;
const X32_SYSCALL_BIT = 0x40000000;
const AF_UNIX = 1;
const BPF_INSTRUCTION_BYTES = 8;
const BPF_JT_OFFSET = 2;
const BPF_JF_OFFSET = 3;
const BPF_K_OFFSET = 4;

/**
 * A classic BPF program for bubblewrap's `--seccomp`: a job may not open a Unix socket, the way macOS denies binding or
 * connecting one, so it reaches no local service, abstract socket, or tmux server. Socket pairs, which child processes
 * use for pipes, stay allowed. io_uring could open a socket around the filter, and another architecture's syscall
 * numbers around its checks, so both are refused.
 */
export function seccompFilter(arch: Arch = process.arch): Buffer {
  const nr = SYSCALLS[arch];
  if (!nr) throw new Error(`pstack's Linux sandbox supports x64 and arm64, not ${arch}.`);
  const LD = 0x20;
  const JEQ = 0x15;
  const JGE = 0x35;
  const RET = 0x06;
  const program: [number, number, number, number][] = [
    [LD, 0, 0, SECCOMP_ARCH_OFFSET],
    [JEQ, 0, SKIP_TO_DENY_FROM_ARCH, nr.audit],
    [LD, 0, 0, 0],
    [JGE, SKIP_TO_DENY_FROM_X32, 0, X32_SYSCALL_BIT],
    [JEQ, SKIP_TO_DENY_FROM_IO_URING, 0, nr.ioUringSetup],
    [JEQ, 0, SKIP_SOCKET_CHECK, nr.socket],
    [LD, 0, 0, SECCOMP_FIRST_ARG_OFFSET],
    [JEQ, 1, 0, AF_UNIX],
    [RET, 0, 0, ALLOW],
    [RET, 0, 0, DENY],
  ];
  const bytes = Buffer.alloc(program.length * BPF_INSTRUCTION_BYTES);
  program.forEach(([code, jt, jf, k], index) => {
    const at = index * BPF_INSTRUCTION_BYTES;
    bytes.writeUInt16LE(code, at);
    bytes.writeUInt8(jt, at + BPF_JT_OFFSET);
    bytes.writeUInt8(jf, at + BPF_JF_OFFSET);
    bytes.writeUInt32LE(k, at + BPF_K_OFFSET);
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
    execFileSync(SHELL, ['-c', command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wraps argv so it runs with writes limited to the policy. bubblewrap nests, so a Linux job inside a sandbox gets its own
 * narrower one. macOS refuses a second Seatbelt profile, so a sandboxed macOS worker asks the root Pi to launch instead.
 */
export function sandboxed(argv: string[], policy: SandboxPolicy, platform: Platform = process.platform, env: Env = hostEnv()): string[] {
  if (platform === 'darwin' && available('command -v sandbox-exec')) {
    placeholders(policy);
    return ['sandbox-exec', '-p', seatbeltProfile(policy), ...argv];
  }
  if (platform === 'linux' && available('command -v bwrap')) {
    placeholders(policy);
    // bubblewrap reads the filter from a file descriptor, which the shell opens just before it becomes bwrap.
    return [SHELL, '-c', 'exec 9<"$1"; shift; exec bwrap --seccomp 9 "$@"', 'sh', seccompFile(policy.agentDir), ...bwrapArgs(policy, env), ...argv];
  }
  throw new Error(`pstack runs every job in a sandbox and found none on ${platform}. Install bubblewrap (bwrap) on Linux or WSL2, or use macOS, where Seatbelt (sandbox-exec) is built in.`);
}
