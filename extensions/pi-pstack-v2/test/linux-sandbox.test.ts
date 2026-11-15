import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bwrapArgs, type SandboxPolicy, sandboxed, seccompFilter } from '../src/sandbox.ts';

type Access = 'writable' | 'read-only' | 'hidden';

/** What a job inside bubblewrap sees at a path: the last mount covering it wins, and a tmpfs hides what lay beneath it. */
function access(args: string[], path: string): Access {
  const mounts: { at: string; access: Access; tmpfs: boolean }[] = [];
  for (let i = 0; i < args.length && args[i] !== '--'; i++) {
    const flag = args[i];
    if (flag === '--bind' || flag === '--ro-bind') {
      mounts.push({ at: args[i + 2] ?? '', access: flag === '--bind' ? 'writable' : 'read-only', tmpfs: false });
      i += 2;
    } else if (flag === '--tmpfs') {
      mounts.push({ at: args[i + 1] ?? '', access: 'writable', tmpfs: true });
      i += 1;
    } else if (flag === '--remount-ro') {
      const target = mounts.findLast((mount) => mount.at === args[i + 1]);
      if (target) target.access = 'read-only';
      i += 1;
    } else if (flag === '--dev' || flag === '--proc') {
      i += 1;
    }
  }
  const covering = mounts.findLast((mount) => mount.at === '/' || path === mount.at || path.startsWith(`${mount.at}/`));
  if (!covering) return 'hidden';
  return covering.tmpfs && path !== covering.at ? 'hidden' : covering.access;
}

/** Runs the classic BPF program bubblewrap hands the kernel against one syscall, as seccomp would. */
function verdict(filter: Buffer, call: { arch: number; nr: number; arg0?: number }): 'allow' | 'deny' {
  const data = { 0: call.nr, 4: call.arch, 16: call.arg0 ?? 0 } as Record<number, number>;
  let accumulator = 0;
  for (let pc = 0; pc * 8 < filter.length; pc++) {
    const code = filter.readUInt16LE(pc * 8);
    const jt = filter.readUInt8(pc * 8 + 2);
    const jf = filter.readUInt8(pc * 8 + 3);
    const k = filter.readUInt32LE(pc * 8 + 4);
    if (code === 0x20) accumulator = data[k] ?? 0;
    else if (code === 0x15) pc += accumulator === k ? jt : jf;
    else if (code === 0x35) pc += accumulator >= k ? jt : jf;
    else if (code === 0x06) return k === 0x7fff0000 ? 'allow' : 'deny';
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
    expect(verdict(filter, { arch: audit, nr: 0x40000000 + 41, arg0: AF_UNIX })).toBe('deny');
    expect(verdict(filter, { arch: 0x40000003, nr: 102, arg0: AF_UNIX })).toBe('deny');
  });

  test('an architecture without known syscall numbers is refused rather than run unfiltered', () => {
    expect(() => seccompFilter('ia32')).toThrow(/supports x64 and arm64, not ia32/);
  });
});

describe('the bubblewrap mounts', () => {
  let work: string;
  let repo: string;
  let common: string;
  let policy: SandboxPolicy;

  beforeEach(() => {
    // Outside /tmp, which the job sees as its own empty directory on Linux, so the fixture reads the same on every platform.
    work = realpathSync(mkdtempSync(join(homedir(), '.pstack-bwrap-')));
    repo = join(work, 'repo');
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', join(work, 'own')]);
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', join(work, 'other')]);
    common = join(repo, '.git');
    mkdirSync(join(common, 'modules', 'sub', 'hooks'), { recursive: true });
    writeFileSync(join(common, 'modules', 'sub', 'config'), '');
    const agentDir = join(work, 'agent');
    const credentials = join(work, 'job', 'agent');
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(credentials, { recursive: true });
    writeFileSync(join(credentials, 'auth.json'), '{}');
    writeFileSync(join(credentials, 'settings.json'), '{}');
    mkdirSync(join(repo, 'locked-dir'));
    writeFileSync(join(repo, 'locked-file'), '');
    policy = {
      writable: [join(work, 'own'), common, join(work, 'missing')],
      protect: [join(common, 'hooks'), join(common, 'config')],
      lock: [join(common, 'worktrees', 'own'), join(repo, 'locked-dir'), join(repo, 'locked-file')],
      gitDirs: [common],
      checkouts: [],
      credentials,
      agentDir,
      jobDir: join(work, 'job'),
    };
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  test("a job writes its checkout and git directory, and the rest of the machine and Pi's agent directory stay read-only", () => {
    const args = bwrapArgs(policy, {}, 501);
    expect(access(args, join(work, 'own', 'file.ts'))).toBe('writable');
    expect(access(args, join(common, 'objects'))).toBe('writable');
    expect(access(args, '/usr/bin')).toBe('read-only');
    expect(access(args, join(policy.agentDir, 'auth.json'))).toBe('read-only');
    expect(access(args, join(work, 'missing'))).toBe('read-only');
    expect(args.slice(-2)).toEqual(['--die-with-parent', '--']);
  });

  test('the shared /tmp is private and read-only', () => {
    const args = bwrapArgs(policy, {}, 501);
    expect(access(args, '/tmp')).toBe('read-only');
    expect(access(args, '/tmp/tmux-501/default')).toBe('hidden');
  });

  test('only the credentials copy is writable in the job agent directory, which still takes new lock directories', () => {
    const args = bwrapArgs(policy, {}, 501);
    expect(access(args, join(policy.credentials, 'auth.json'))).toBe('writable');
    expect(access(args, join(policy.credentials, 'settings.json'))).toBe('read-only');
    expect(access(args, policy.credentials)).toBe('writable');
  });

  test('git config, hooks, other worktrees, and submodule git directories stay read-only, while its own worktree metadata does not', () => {
    const args = bwrapArgs(policy, {}, 501);
    expect(access(args, join(common, 'hooks', 'pre-commit'))).toBe('read-only');
    expect(access(args, join(common, 'config'))).toBe('read-only');
    expect(access(args, join(common, 'worktrees', 'other', 'HEAD'))).toBe('read-only');
    expect(access(args, join(common, 'worktrees', 'own', 'HEAD'))).toBe('writable');
    expect(access(args, join(common, 'worktrees', 'own', 'gitdir'))).toBe('read-only');
    expect(access(args, join(common, 'modules', 'sub', 'objects'))).toBe('read-only');
  });

  test('a locked directory keeps its contents writable and a locked file is read-only, so neither can be swapped out', () => {
    const args = bwrapArgs(policy, {}, 501);
    expect(access(args, join(repo, 'locked-dir', 'x'))).toBe('writable');
    expect(access(args, join(repo, 'locked-file'))).toBe('read-only');
  });

  test('the runtime directory is hidden, but a runtime path that is a link is left for the mount it points into', () => {
    const runtime = join(work, 'runtime');
    mkdirSync(runtime);
    expect(access(bwrapArgs(policy, { XDG_RUNTIME_DIR: runtime }, 501), join(runtime, 'bus'))).toBe('hidden');
    const linked = join(work, 'runtime-link');
    symlinkSync(runtime, linked);
    expect(bwrapArgs(policy, { XDG_RUNTIME_DIR: linked }, 501)).not.toContain(linked);
  });

  test('a policy without a credentials copy mounts no job agent directory', () => {
    const args = bwrapArgs({ ...policy, credentials: '' }, {}, 501);
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
    chmodSync(join(bin, 'bwrap'), 0o755);
    vi.stubEnv('PATH', `${bin}:${process.env['PATH'] ?? ''}`);
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
    expect(argv.slice(0, 5)).toEqual(['/bin/sh', '-c', 'exec 9<"$1"; shift; exec bwrap --seccomp 9 "$@"', 'sh', file]);
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
