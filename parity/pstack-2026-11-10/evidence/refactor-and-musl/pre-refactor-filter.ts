// The Linux read-only sandbox: bubblewrap with every namespace but the network unshared, the whole filesystem bound read-only, and a
// seccomp filter that refuses Unix sockets. bubblewrap installs the filter itself, so this needs no nested user
// namespace, which hosts with kernel.apparmor_restrict_unprivileged_userns=1 (Ubuntu 24.04 and later) refuse.
import { spawnSync } from 'node:child_process';
import { accessSync, closeSync, constants, existsSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const LD_ABS_W = 0x20;
const JEQ_K = 0x15;
const JGE_K = 0x35;
const AND_K = 0x54;
const RET_K = 0x06;
const SECCOMP_RET_ALLOW = 0x7fff_0000;
const SECCOMP_RET_ERRNO_EPERM = 0x0005_0001;
const SECCOMP_RET_KILL_PROCESS = 0x8000_0000;
const X32_SYSCALL_BIT = 0x4000_0000;
const AF_UNIX = 1;
const SOCK_STREAM = 1;
const SOCK_TYPE_MASK = 0xf;
const SYS_SOCKET = 1;
const SYS_SOCKETPAIR = 8;
const IO_URING_SETUP = 425;
const SOCKETCALL = 102;
const ARM_OABI_SYSCALL = 113;

interface Arch {
  audit: number;
  endian: 'LE' | 'BE';
  /** socketpair(2): a connectionless AF_UNIX pair can sendto or connect to a host socket, so only stream pairs stay allowed. */
  socketpair: number;
  /** Syscalls that fail with EPERM when their first argument is the given value. */
  refusedWhen: [syscall: number, firstArgument: number][];
  refused: number[];
}

// AUDIT_ARCH_* from include/uapi/linux/audit.h and syscall numbers from each architecture's syscall table; Linux 5.14
// through 6.12 agree. socketcall(SYS_SOCKET) hides socket's domain behind a pointer a classic BPF filter cannot read, so
// it fails for every domain; its other calls only use descriptors the command already holds, as they do on x64. ARM's
// OABI indirect syscall would run any syscall past the filter. ppc64 is little-endian: Node publishes no big-endian build.
const SOCKETCALL_SOCKET: [number, number] = [SOCKETCALL, SYS_SOCKET];
const SOCKETCALL_SOCKETPAIR: [number, number] = [SOCKETCALL, SYS_SOCKETPAIR];
const ARCHES: Record<string, Arch> = {
  x64: { socketpair: 53, audit: 0xc000_003e, endian: 'LE', refusedWhen: [[41, AF_UNIX]], refused: [IO_URING_SETUP] },
  arm64: { socketpair: 199, audit: 0xc000_00b7, endian: 'LE', refusedWhen: [[198, AF_UNIX]], refused: [IO_URING_SETUP] },
  arm: { socketpair: 288, audit: 0x4000_0028, endian: 'LE', refusedWhen: [[281, AF_UNIX], SOCKETCALL_SOCKET, SOCKETCALL_SOCKETPAIR], refused: [IO_URING_SETUP, ARM_OABI_SYSCALL] },
  ppc64: { socketpair: 333, audit: 0xc000_0015, endian: 'LE', refusedWhen: [[326, AF_UNIX], SOCKETCALL_SOCKET, SOCKETCALL_SOCKETPAIR], refused: [IO_URING_SETUP] },
  s390x: { socketpair: 360, audit: 0x8000_0016, endian: 'BE', refusedWhen: [[359, AF_UNIX], SOCKETCALL_SOCKET], refused: [IO_URING_SETUP] },
};

/**
 * A classic BPF seccomp program in the architecture's byte order: the `refusedWhen` and `refused` syscalls fail with
 * EPERM, any other architecture or the x32 ABI kills the process, and everything else is allowed. Jumps are relative
 * to the next instruction.
 */
export function seccompFilter(arch: string): Buffer {
  const target = ARCHES[arch];
  if (target === undefined) throw new Error(`the read-only shell has no seccomp filter for ${arch}`);
  const le = target.endian === 'LE';
  const instruction = (code: number, jt: number, jf: number, k: number): Buffer => {
    const bytes = Buffer.alloc(8);
    if (le) bytes.writeUInt16LE(code, 0);
    else bytes.writeUInt16BE(code, 0);
    bytes.writeUInt8(jt, 2);
    bytes.writeUInt8(jf, 3);
    if (le) bytes.writeUInt32LE(k >>> 0, 4);
    else bytes.writeUInt32BE(k >>> 0, 4);
    return bytes;
  };
  const pairAt = 4 + 4 * target.refusedWhen.length;
  const refusedAt = pairAt + 6;
  const allow = refusedAt + target.refused.length;
  const errno = allow + 1;
  const kill = allow + 2;
  const to = (from: number, label: number) => label - from - 1;
  return Buffer.concat([
    instruction(LD_ABS_W, 0, 0, 4), // 0: architecture
    instruction(JEQ_K, 0, to(1, kill), target.audit), // 1: native → 2, otherwise → kill
    instruction(LD_ABS_W, 0, 0, 0), // 2: syscall number
    instruction(JGE_K, to(3, kill), 0, X32_SYSCALL_BIT), // 3: x32 → kill
    ...target.refusedWhen.flatMap(([nr, value], index) => {
      const at = 4 + 4 * index;
      return [
        instruction(JEQ_K, 0, 3, nr), // this syscall → next, otherwise → the next rule
        instruction(LD_ABS_W, 0, 0, le ? 16 : 20), // the low word of the first argument
        instruction(JEQ_K, to(at + 2, errno), 0, value), // this value → errno, otherwise → the next rule, which may name the same syscall
        instruction(LD_ABS_W, 0, 0, 0), // the syscall number again for the next rule
      ];
    }),
    instruction(JEQ_K, 0, 5, target.socketpair), // 0: socketpair → next, otherwise → past this rule
    instruction(LD_ABS_W, 0, 0, le ? 16 : 20), // 1: the low word of the domain
    instruction(JEQ_K, 0, to(pairAt + 2, allow), AF_UNIX), // 2: AF_UNIX → next, otherwise → allow
    instruction(LD_ABS_W, 0, 0, le ? 24 : 28), // 3: the low word of the type
    instruction(AND_K, 0, 0, SOCK_TYPE_MASK), // 4: without SOCK_NONBLOCK and SOCK_CLOEXEC
    instruction(JEQ_K, to(pairAt + 5, allow), to(pairAt + 5, errno), SOCK_STREAM), // 5: stream → allow, otherwise → errno
    ...target.refused.map((nr, index) => instruction(JEQ_K, to(refusedAt + index, errno), 0, nr)),
    instruction(RET_K, 0, 0, SECCOMP_RET_ALLOW), // allow
    instruction(RET_K, 0, 0, SECCOMP_RET_ERRNO_EPERM), // errno
    instruction(RET_K, 0, 0, SECCOMP_RET_KILL_PROCESS), // kill
  ]);
}

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** bubblewrap's arguments before the command: nothing is writable, and only the network is shared with the host. */
export function bwrapArgs(cwd: string): string[] {
  return ['--new-session', '--die-with-parent', '--unshare-all', '--share-net', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--cap-drop', 'ALL', '--chdir', cwd, '--seccomp', '3'];
}

interface Sandbox {
  bwrap: string;
  filterPath: string;
  shell: string;
}

/** The first executable `name` on PATH, so every command runs the bubblewrap the check ran. */
function onPath(name: string): string | undefined {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter).filter((entry) => entry !== '')) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here; keep looking.
    }
  }
  return undefined;
}

let verified: { sandbox: Sandbox } | { error: Error } | undefined;

/** The checked sandbox, or the error that stopped it; either is kept, so a failed host never retries into a weaker state. */
function verifiedSandbox(): Sandbox {
  verified ??= (() => {
    try {
      return { sandbox: checkSandbox() };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error(String(error)) };
    }
  })();
  if ('error' in verified) throw verified.error;
  return verified.sandbox;
}

/** Writes the filter into a private directory and checks that bubblewrap can load it here. */
function checkSandbox(): Sandbox {
  const filter = seccompFilter(process.arch);
  const bwrap = onPath('bwrap');
  if (bwrap === undefined) throw new Error('bubblewrap (bwrap) is not available: no bwrap on PATH');
  const dir = mkdtempSync(join(tmpdir(), 'pi-pstack-ro-'));
  const filterPath = join(dir, 'unix-block.bpf');
  writeFileSync(filterPath, filter, { mode: 0o400 });
  const shell = existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
  const fd = openSync(filterPath, 'r');
  try {
    const probe = spawnSync(bwrap, [...bwrapArgs('/'), '--', shell, '-c', 'exit 0'], { stdio: ['ignore', 'ignore', 'pipe', fd], encoding: 'utf8', timeout: 15_000 });
    if (probe.error !== undefined) throw new Error(`bubblewrap (bwrap) could not run: ${probe.error.message}`);
    if (probe.status !== 0) throw new Error(`bubblewrap could not start the read-only sandbox: ${probe.stderr.trim() || `exit ${probe.status}`}`);
  } finally {
    closeSync(fd);
  }
  return { bwrap, filterPath, shell };
}

/** The shell command that runs `command` inside the read-only sandbox, or an error when no sandbox can start. */
export function linuxReadonlyCommand(command: string, cwd: string): string {
  const { bwrap, filterPath, shell } = verifiedSandbox();
  return `exec ${quote(bwrap)} ${bwrapArgs(cwd).map(quote).join(' ')} -- ${quote(shell)} -c ${quote(command)} 3< ${quote(filterPath)}`;
}
