// bubblewrap installs the seccomp filter itself, so this needs no nested user namespace, which hosts with
// kernel.apparmor_restrict_unprivileged_userns=1 (Ubuntu 24.04 and later) refuse.
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
  socketpair: number;
  refusedWhen: [syscall: number, firstArguments: number[]][];
  refused: number[];
}

// AUDIT_ARCH_* from include/uapi/linux/audit.h and syscall numbers from each architecture's syscall table; Linux 5.14
// through 6.12 agree. A multiplexed socketcall hides the domain and type of socket and socketpair behind a pointer a
// classic BPF filter cannot read, so socketcall(SYS_SOCKET) fails for every domain. socketcall(SYS_SOCKETPAIR) is refused
// only where glibc also has a direct socketpair syscall (arm, ppc64): s390x glibc has none, and refusing it there breaks
// Node and Python pipes. socketcall's other calls only use descriptors the command already holds, as they
// do on x64. ARM's OABI indirect syscall would run any syscall past the filter. ppc64 is little-endian: Node publishes
// no big-endian build.
const ARCHES: Record<string, Arch> = {
  x64: { socketpair: 53, audit: 0xc000_003e, endian: 'LE', refusedWhen: [[41, [AF_UNIX]]], refused: [IO_URING_SETUP] },
  arm64: { socketpair: 199, audit: 0xc000_00b7, endian: 'LE', refusedWhen: [[198, [AF_UNIX]]], refused: [IO_URING_SETUP] },
  arm: {
    socketpair: 288,
    audit: 0x4000_0028,
    endian: 'LE',
    refusedWhen: [
      [281, [AF_UNIX]],
      [SOCKETCALL, [SYS_SOCKET, SYS_SOCKETPAIR]],
    ],
    refused: [IO_URING_SETUP, ARM_OABI_SYSCALL],
  },
  ppc64: {
    socketpair: 333,
    audit: 0xc000_0015,
    endian: 'LE',
    refusedWhen: [
      [326, [AF_UNIX]],
      [SOCKETCALL, [SYS_SOCKET, SYS_SOCKETPAIR]],
    ],
    refused: [IO_URING_SETUP],
  },
  s390x: {
    socketpair: 360,
    audit: 0x8000_0016,
    endian: 'BE',
    refusedWhen: [
      [359, [AF_UNIX]],
      [SOCKETCALL, [SYS_SOCKET]],
    ],
    refused: [IO_URING_SETUP],
  },
};

type Label = 'allow' | 'errno' | 'kill' | `next${number}` | 'afterPair';
type Step = { label: Label } | { code: number; k: number; jt?: Label | undefined; jf?: Label | undefined };

/**
 * A classic BPF seccomp program in the architecture's byte order. Any other architecture or the x32 ABI kills the
 * process. The `refusedWhen` syscalls fail with EPERM for the listed first-argument values, `socketpair` fails with
 * EPERM for AF_UNIX unless its type is SOCK_STREAM, and the `refused` syscalls fail with EPERM outright. Everything
 * else is allowed.
 */
export function seccompFilter(arch: string): Buffer {
  const target = ARCHES[arch];
  if (target === undefined) throw new Error(`the read-only shell has no seccomp filter for ${arch}`);
  const le = target.endian === 'LE';
  const loadArgument = (n: number) => ({ code: LD_ABS_W, k: 16 + 8 * n + (le ? 0 : 4) });
  const equals = (k: number, jt?: Label, jf?: Label): Step => ({ code: JEQ_K, k, jt, jf });
  const steps: Step[] = [
    { code: LD_ABS_W, k: 4 },
    equals(target.audit, undefined, 'kill'),
    { code: LD_ABS_W, k: 0 },
    { code: JGE_K, k: X32_SYSCALL_BIT, jt: 'kill' },
    ...target.refusedWhen.flatMap(([nr, values], index): Step[] => [
      equals(nr, undefined, `next${index}`),
      loadArgument(0),
      ...values.map((value, at) => equals(value, 'errno', at === values.length - 1 ? 'allow' : undefined)),
      { label: `next${index}` },
    ]),
    equals(target.socketpair, undefined, 'afterPair'),
    loadArgument(0),
    equals(AF_UNIX, undefined, 'allow'),
    loadArgument(1),
    { code: AND_K, k: SOCK_TYPE_MASK },
    equals(SOCK_STREAM, 'allow', 'errno'),
    { label: 'afterPair' },
    ...target.refused.map((nr) => equals(nr, 'errno')),
    { label: 'allow' },
    { code: RET_K, k: SECCOMP_RET_ALLOW },
    { label: 'errno' },
    { code: RET_K, k: SECCOMP_RET_ERRNO_EPERM },
    { label: 'kill' },
    { code: RET_K, k: SECCOMP_RET_KILL_PROCESS },
  ];
  const instructions = steps.filter((step) => 'code' in step);
  const indexOf = (label: Label) => {
    let index = 0;
    for (const step of steps) {
      if ('label' in step) {
        if (step.label === label) return index;
      } else index++;
    }
    throw new Error(`seccomp label ${label} is never defined`);
  };
  return Buffer.concat(
    instructions.map((step, index) => {
      const jump = (label?: Label) => {
        const offset = label === undefined ? 0 : indexOf(label) - index - 1;
        if (offset < 0 || offset > 255) throw new Error(`seccomp jump to ${label} at instruction ${index} is out of range`);
        return offset;
      };
      const bytes = Buffer.alloc(8);
      if (le) bytes.writeUInt16LE(step.code, 0);
      else bytes.writeUInt16BE(step.code, 0);
      bytes.writeUInt8(jump(step.jt), 2);
      bytes.writeUInt8(jump(step.jf), 3);
      if (le) bytes.writeUInt32LE(step.k >>> 0, 4);
      else bytes.writeUInt32BE(step.k >>> 0, 4);
      return bytes;
    }),
  );
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
