import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { bwrapArgs, type SandboxPolicy, sandboxed, seccompFilter } from '../src/sandbox.ts';

const ROOT_DIR = '/';
const USR_BIN_DIR = '/usr/bin';
const SHARED_TMP_DIR = '/tmp';
const SHELL_PATH = '/bin/sh';
const envSchema = z.object({ PATH: z.string().optional() });
const BPF_INSN_BYTES = 8;
const BPF_JT_OFFSET = 2;
const BPF_JF_OFFSET = 3;
const BPF_K_OFFSET = 4;
const BPF_LOAD_ABSOLUTE = 0x20;
const BPF_JUMP_EQUAL = 0x15;
const BPF_JUMP_GREATER_EQUAL = 0x35;
const BPF_RETURN = 0x06;
const SECCOMP_RET_ALLOW = 0x7fff0000;
const SECCOMP_DATA_ARCH_OFFSET = 4;
const SECCOMP_DATA_ARG0_OFFSET = 16;
const X32_SYSCALL_BIT = 0x40000000;
const X32_AUDIT_ARCH = 0x40000003;
const X32_SOCKET_NR = 41;
const UNRELATED_SYSCALL_NR = 102;
const SAMPLE_UID = 501;
const EXECUTABLE_MODE = 0o755;
const LAUNCH_PREFIX_ARGS = 5;

type Access = 'writable' | 'read-only' | 'hidden';

type Mount = { at: string; access: Access; tmpfs: boolean };

const MOUNT_FLAG_WIDTH: Record<string, number> = { '--bind': 3, '--ro-bind': 3, '--tmpfs': 2, '--remount-ro': 2, '--dev': 2, '--proc': 2 };

function nextMount(mounts: readonly Mount[], args: string[], i: number): readonly Mount[] {
  const flag = args[i];
  if (flag === '--bind' || flag === '--ro-bind') return [...mounts, { at: args[i + 2] ?? '', access: flag === '--bind' ? 'writable' : 'read-only', tmpfs: false }];
  if (flag === '--tmpfs') return [...mounts, { at: args[i + 1] ?? '', access: 'writable', tmpfs: true }];
  if (flag !== '--remount-ro') return mounts;
  const index = mounts.findLastIndex((mount) => mount.at === args[i + 1]);
  return index < 0 ? mounts : mounts.map((mount, at) => (at === index ? { ...mount, access: 'read-only' as const } : mount));
}

function parseMounts(args: string[]): readonly Mount[] {
  let mounts: readonly Mount[] = [];
  for (let i = 0; i < args.length && args[i] !== '--'; i += MOUNT_FLAG_WIDTH[args[i] ?? ''] ?? 1) mounts = nextMount(mounts, args, i);
  return mounts;
}

/** What a job inside bubblewrap sees at a path: the last mount covering it wins, and a tmpfs hides what lay beneath it. */
function access(args: string[], path: string): Access {
  const mounts = parseMounts(args);
  const covering = mounts.findLast((mount) => mount.at === ROOT_DIR || path === mount.at || path.startsWith(`${mount.at}/`));
  if (!covering) return 'hidden';
  return covering.tmpfs && path !== covering.at ? 'hidden' : covering.access;
}

/** Runs the classic BPF program bubblewrap hands the kernel against one syscall, as seccomp would. */
function verdict(filter: Buffer, call: { arch: number; nr: number; arg0?: number }): 'allow' | 'deny' {
  const data = { 0: call.nr, [SECCOMP_DATA_ARCH_OFFSET]: call.arch, [SECCOMP_DATA_ARG0_OFFSET]: call.arg0 ?? 0 } as Record<number, number>;
  let accumulator = 0;
  for (let pc = 0; pc * BPF_INSN_BYTES < filter.length; pc++) {
    const at = pc * BPF_INSN_BYTES;
    const code = filter.readUInt16LE(at);
    const jt = filter.readUInt8(at + BPF_JT_OFFSET);
    const jf = filter.readUInt8(at + BPF_JF_OFFSET);
    const k = filter.readUInt32LE(at + BPF_K_OFFSET);
    if (code === BPF_LOAD_ABSOLUTE) accumulator = data[k] ?? 0;
    else if (code === BPF_JUMP_EQUAL) pc += accumulator === k ? jt : jf;
    else if (code === BPF_JUMP_GREATER_EQUAL) pc += accumulator >= k ? jt : jf;
    else if (code === BPF_RETURN) return k === SECCOMP_RET_ALLOW ? 'allow' : 'deny';
    else throw new Error(`unexpected BPF instruction ${code}`);
  }
  throw new Error('the filter fell off its end');
}

const ARCH = { x64: { audit: 0xc000003e, socket: 41 }, arm64: { audit: 0xc00000b7, socket: 198 } } as const;
const AF_UNIX = 1;
const AF_INET = 2;
const IO_URING_SETUP = 425;

describe('the Linux seccomp filter', () => {
  test.for(['x64', 'arm64'] as const)('on %s a job cannot open a Unix socket but can open a network socket and run other calls', (arch) => {
    const filter = seccompFilter(arch);
    const { audit, socket } = ARCH[arch];
    expect(verdict(filter, { arch: audit, nr: socket, arg0: AF_UNIX })).toBe('deny');
    expect(verdict(filter, { arch: audit, nr: socket, arg0: AF_INET })).toBe('allow');
    expect(verdict(filter, { arch: audit, nr: 0 })).toBe('allow');
  });

  test.for(['x64', 'arm64'] as const)('on %s io_uring, x32 calls, and another architecture are refused, since each could open a socket around the check', (arch) => {
    const filter = seccompFilter(arch);
    const { audit } = ARCH[arch];
    expect(verdict(filter, { arch: audit, nr: IO_URING_SETUP })).toBe('deny');
    expect(verdict(filter, { arch: audit, nr: X32_SYSCALL_BIT + X32_SOCKET_NR, arg0: AF_UNIX })).toBe('deny');
    expect(verdict(filter, { arch: X32_AUDIT_ARCH, nr: UNRELATED_SYSCALL_NR, arg0: AF_UNIX })).toBe('deny');
  });

  test('an architecture without known syscall numbers is refused rather than run unfiltered', () => {
    expect(() => seccompFilter('ia32')).toThrow(/supports x64 and arm64, not ia32/);
  });
});

type BwrapFixture = { work: string; repo: string; common: string; policy: SandboxPolicy };

let work: string;
let repo: string;
let common: string;
let policy: SandboxPolicy;

function makeBwrapFixture(): BwrapFixture {
  // Outside /tmp, which the job sees as its own empty directory on Linux, so the fixture reads the same on every platform.
  const fixtureWork = realpathSync(mkdtempSync(join(homedir(), '.pstack-bwrap-')));
  const fixtureRepo = join(fixtureWork, 'repo');
  execFileSync('git', ['init', '-q', fixtureRepo]);
  execFileSync('git', ['-C', fixtureRepo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  execFileSync('git', ['-C', fixtureRepo, 'worktree', 'add', '-q', '--detach', join(fixtureWork, 'own')]);
  execFileSync('git', ['-C', fixtureRepo, 'worktree', 'add', '-q', '--detach', join(fixtureWork, 'other')]);
  const gitCommon = join(fixtureRepo, '.git');
  mkdirSync(join(gitCommon, 'modules', 'sub', 'hooks'), { recursive: true });
  writeFileSync(join(gitCommon, 'modules', 'sub', 'config'), '');
  const agentDir = join(fixtureWork, 'agent');
  const credentials = join(fixtureWork, 'job', 'agent');
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(credentials, { recursive: true });
  writeFileSync(join(credentials, 'auth.json'), '{}');
  writeFileSync(join(credentials, 'settings.json'), '{}');
  mkdirSync(join(fixtureRepo, 'locked-dir'));
  writeFileSync(join(fixtureRepo, 'locked-file'), '');
  return {
    work: fixtureWork,
    repo: fixtureRepo,
    common: gitCommon,
    policy: {
      writable: [join(fixtureWork, 'own'), gitCommon, join(fixtureWork, 'missing')],
      protect: [join(gitCommon, 'hooks'), join(gitCommon, 'config')],
      lock: [join(gitCommon, 'worktrees', 'own'), join(fixtureRepo, 'locked-dir'), join(fixtureRepo, 'locked-file')],
      gitDirs: [gitCommon],
      checkouts: [],
      credentials,
      agentDir,
      jobDir: join(fixtureWork, 'job'),
    },
  };
}

const useBwrapFixture = () => {
  beforeEach(() => {
    ({ work, repo, common, policy } = makeBwrapFixture());
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });
};

describe('the bubblewrap mounts', () => {
  useBwrapFixture();

  test("a job writes its checkout and git directory, and the rest of the machine and Pi's agent directory stay read-only", () => {
    const args = bwrapArgs(policy, {}, SAMPLE_UID);
    expect(access(args, join(work, 'own', 'file.ts'))).toBe('writable');
    expect(access(args, join(common, 'objects'))).toBe('writable');
    expect(access(args, USR_BIN_DIR)).toBe('read-only');
    expect(access(args, join(policy.agentDir, 'auth.json'))).toBe('read-only');
    expect(access(args, join(work, 'missing'))).toBe('read-only');
    expect(args.slice(-2)).toEqual(['--die-with-parent', '--']);
  });

  test('the shared /tmp is private and read-only', () => {
    const args = bwrapArgs(policy, {}, SAMPLE_UID);
    expect(access(args, SHARED_TMP_DIR)).toBe('read-only');
    expect(access(args, `/tmp/tmux-${SAMPLE_UID}/default`)).toBe('hidden');
  });

  test('only the credentials copy is writable in the job agent directory, which still takes new lock directories', () => {
    const args = bwrapArgs(policy, {}, SAMPLE_UID);
    expect(access(args, join(policy.credentials, 'auth.json'))).toBe('writable');
    expect(access(args, join(policy.credentials, 'settings.json'))).toBe('read-only');
    expect(access(args, policy.credentials)).toBe('writable');
  });
});

describe('the bubblewrap mounts, git paths and runtime', () => {
  useBwrapFixture();

  test('git config, hooks, other worktrees, and submodule git directories stay read-only, while its own worktree metadata does not', () => {
    const args = bwrapArgs(policy, {}, SAMPLE_UID);
    expect(access(args, join(common, 'hooks', 'pre-commit'))).toBe('read-only');
    expect(access(args, join(common, 'config'))).toBe('read-only');
    expect(access(args, join(common, 'worktrees', 'other', 'HEAD'))).toBe('read-only');
    expect(access(args, join(common, 'worktrees', 'own', 'HEAD'))).toBe('writable');
    expect(access(args, join(common, 'worktrees', 'own', 'gitdir'))).toBe('read-only');
    expect(access(args, join(common, 'modules', 'sub', 'objects'))).toBe('read-only');
  });

  test('a locked directory keeps its contents writable and a locked file is read-only, so neither can be swapped out', () => {
    const args = bwrapArgs(policy, {}, SAMPLE_UID);
    expect(access(args, join(repo, 'locked-dir', 'x'))).toBe('writable');
    expect(access(args, join(repo, 'locked-file'))).toBe('read-only');
  });

  test('the runtime directory is hidden, but a runtime path that is a link is left for the mount it points into', () => {
    const runtime = join(work, 'runtime');
    mkdirSync(runtime);
    expect(access(bwrapArgs(policy, { XDG_RUNTIME_DIR: runtime }, SAMPLE_UID), join(runtime, 'bus'))).toBe('hidden');
    const linked = join(work, 'runtime-link');
    symlinkSync(runtime, linked);
    expect(bwrapArgs(policy, { XDG_RUNTIME_DIR: linked }, SAMPLE_UID)).not.toContain(linked);
  });

  test('a policy without a credentials copy mounts no job agent directory', () => {
    const args = bwrapArgs({ ...policy, credentials: '' }, {}, SAMPLE_UID);
    expect(access(args, join(policy.credentials, 'auth.json'))).toBe('read-only');
  });
});

describe('launching under bubblewrap', () => {
  let work: string;

  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-bwrap-launch-')));
    const bin = join(work, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'bwrap'), '#!/bin/sh\n');
    chmodSync(join(bin, 'bwrap'), EXECUTABLE_MODE);
    vi.stubEnv('PATH', `${bin}:${envSchema.parse(process.env).PATH ?? ''}`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(work, { recursive: true, force: true });
  });

  const policyIn = (common: string): SandboxPolicy => ({ writable: [], protect: [], lock: [], gitDirs: [common, join(work, 'gone')], checkouts: [], credentials: '', agentDir: join(work, 'agent'), jobDir: join(work, 'job') });

  test.runIf(process.arch === 'x64' || process.arch === 'arm64')('the seccomp filter is loaded from a file no job can write, and a changed file is rewritten before the launch', () => {
    const common = join(work, 'git');
    mkdirSync(common);
    const argv = sandboxed(['pi', '-p'], policyIn(common), 'linux', {});
    const file = join(work, 'agent', 'pstack-v2', `seccomp-${process.arch}.bpf`);
    expect(argv.slice(0, LAUNCH_PREFIX_ARGS)).toEqual([SHELL_PATH, '-c', 'exec 9<"$1"; shift; exec bwrap --seccomp 9 "$@"', 'sh', file]);
    expect(argv.slice(-2)).toEqual(['pi', '-p']);
    expect(readFileSync(file).equals(seccompFilter())).toBe(true);
    writeFileSync(file, 'loosened');
    sandboxed(['pi'], policyIn(common), 'linux', {});
    expect(readFileSync(file).equals(seccompFilter())).toBe(true);
  });

  test.runIf(process.arch === 'x64' || process.arch === 'arm64')('git paths a job may not create exist before it starts, since bubblewrap can only protect what exists', () => {
    const common = join(work, 'git');
    mkdirSync(common);
    sandboxed(['pi'], policyIn(common), 'linux', {});
    for (const name of ['hooks', 'info', 'worktrees', 'modules']) expect(existsSync(join(common, name))).toBe(true);
    expect(readFileSync(join(common, 'config.worktree'), 'utf8')).toBe('');
    expect(existsSync(join(work, 'gone'))).toBe(false);
  });
});
