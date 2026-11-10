const LD_ABS_W = 0x20;
const JEQ_K = 0x15;
const JGE_K = 0x35;
const AND_K = 0x54;
const RET_K = 0x06;
const SECCOMP_RET_ALLOW = 0x7fff_0000;
const SECCOMP_RET_USER_NOTIF = 0x7fc0_0000;
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

/** The numbers the s390x broker's answers depend on, from the constants the filter is built with. */
export const BROKER_POLICY = `socketcall=${SOCKETCALL},socket=${SYS_SOCKET},socketpair=${SYS_SOCKETPAIR},unix=${AF_UNIX},stream=${SOCK_STREAM},typemask=${SOCK_TYPE_MASK}`;

interface Arch {
  audit: number;
  endian: 'LE' | 'BE';
  socket: number;
  socketpair: number;
  refused: number[];
  socketcall?: {
    /** The socketcall calls the filter fails for every domain. */
    refused: number[];
    /** The calls a broker answers instead, so the filter sends them to its user-notification listener. */
    brokered?: number[];
  };
}

// AUDIT_ARCH_* from include/uapi/linux/audit.h and syscall numbers from each architecture's syscall table; Linux 5.14
// through 6.12 agree. A multiplexed socketcall hides the domain and type of socket and socketpair behind a pointer a
// classic BPF filter cannot read, so socketcall(SYS_SOCKET) fails for every domain. socketcall(SYS_SOCKETPAIR) is refused
// only where glibc also has a direct socketpair syscall (arm, ppc64): s390x glibc has none, and refusing it there breaks
// Node and Python pipes. socketcall's other calls only use descriptors the command already holds, as they
// do on x64. ARM's OABI indirect syscall would run any syscall past the filter. ppc64 is little-endian: Node publishes
// no big-endian build.
const ARCHES: Record<string, Arch> = {
  x64: { audit: 0xc000_003e, endian: 'LE', socket: 41, socketpair: 53, refused: [IO_URING_SETUP] },
  arm64: { audit: 0xc000_00b7, endian: 'LE', socket: 198, socketpair: 199, refused: [IO_URING_SETUP] },
  arm: { audit: 0x4000_0028, endian: 'LE', socket: 281, socketpair: 288, refused: [IO_URING_SETUP, ARM_OABI_SYSCALL], socketcall: { refused: [SYS_SOCKET, SYS_SOCKETPAIR] } },
  ppc64: { audit: 0xc000_0015, endian: 'LE', socket: 326, socketpair: 333, refused: [IO_URING_SETUP], socketcall: { refused: [SYS_SOCKET, SYS_SOCKETPAIR] } },
  s390x: { audit: 0x8000_0016, endian: 'BE', socket: 359, socketpair: 360, refused: [IO_URING_SETUP], socketcall: { refused: [SYS_SOCKET], brokered: [SYS_SOCKET, SYS_SOCKETPAIR] } },
};

type Label = symbol;
type Step = { label: Label } | { code: number; k: number; jt?: Label | undefined; jf?: Label | undefined };

/** Encodes `steps` as a classic BPF program in `endian` byte order. A step's jumps name labels, and a label occupies no slot. */
function assemble(steps: Step[], endian: Arch['endian']): Buffer {
  const le = endian === 'LE';
  const positions = new Map<Label, number>();
  const instructions: Extract<Step, { code: number }>[] = [];
  for (const step of steps) {
    if ('label' in step) positions.set(step.label, instructions.length);
    else instructions.push(step);
  }
  return Buffer.concat(
    instructions.map((step, index) => {
      const jump = (label: Label | undefined) => {
        if (label === undefined) return 0;
        const position = positions.get(label);
        if (position === undefined) throw new Error(`seccomp label ${String(label)} is never defined`);
        const offset = position - index - 1;
        if (offset < 0 || offset > 255) throw new Error(`seccomp jump at instruction ${index} is out of range`);
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

/**
 * The policy as one program. Any other architecture or the x32 ABI kills the process. `socket` fails with EPERM for
 * AF_UNIX, `socketpair` fails with EPERM for AF_UNIX unless its type is SOCK_STREAM, the socketcall calls in
 * `socketcall.refused` fail with EPERM for every domain (or go to the user-notification listener when `brokered`), and
 * the `refused` syscalls fail with EPERM outright. Everything else is allowed.
 */
function buildFilter(target: Arch, brokered: boolean): Buffer {
  const allow: Label = Symbol('allow');
  const errno: Label = Symbol('errno');
  const notify: Label = Symbol('notify');
  const kill: Label = Symbol('kill');
  const loadArgument = (n: number): Step => ({ code: LD_ABS_W, k: 16 + 8 * n + (target.endian === 'LE' ? 0 : 4) });
  const equals = (k: number, jt?: Label, jf?: Label): Step => ({ code: JEQ_K, k, jt, jf });
  /** Gives `verdict` to `syscall` when its first argument is one of `values`, and leaves every other syscall to the next rule. */
  const refuseFirstArgument = (syscall: number, values: number[], verdict: Label): Step[] => {
    const next: Label = Symbol('next');
    return [equals(syscall, undefined, next), loadArgument(0), ...values.map((value, at) => equals(value, verdict, at === values.length - 1 ? allow : undefined)), { label: next }];
  };
  const afterSocketpair: Label = Symbol('afterSocketpair');
  const socketcall = target.socketcall;
  const steps: Step[] = [
    { code: LD_ABS_W, k: 4 },
    equals(target.audit, undefined, kill),
    { code: LD_ABS_W, k: 0 },
    { code: JGE_K, k: X32_SYSCALL_BIT, jt: kill },
    ...refuseFirstArgument(target.socket, [AF_UNIX], errno),
    ...(socketcall === undefined ? [] : brokered && socketcall.brokered !== undefined ? refuseFirstArgument(SOCKETCALL, socketcall.brokered, notify) : refuseFirstArgument(SOCKETCALL, socketcall.refused, errno)),
    equals(target.socketpair, undefined, afterSocketpair),
    loadArgument(0),
    equals(AF_UNIX, undefined, allow),
    loadArgument(1),
    { code: AND_K, k: SOCK_TYPE_MASK },
    equals(SOCK_STREAM, allow, errno),
    { label: afterSocketpair },
    ...target.refused.map((nr) => equals(nr, errno)),
    { label: allow },
    { code: RET_K, k: SECCOMP_RET_ALLOW },
    { label: errno },
    { code: RET_K, k: SECCOMP_RET_ERRNO_EPERM },
    ...(brokered ? ([{ label: notify }, { code: RET_K, k: SECCOMP_RET_USER_NOTIF }] satisfies Step[]) : []),
    { label: kill },
    { code: RET_K, k: SECCOMP_RET_KILL_PROCESS },
  ];
  return assemble(steps, target.endian);
}

/** The filter the read-only shell loads for `arch`. Throws for an architecture it has no policy for. */
export function seccompFilter(arch: string): Buffer {
  const target = ARCHES[arch];
  if (target === undefined) throw new Error(`the read-only shell has no seccomp filter for ${arch}`);
  return buildFilter(target, false);
}

/** The filter for the socket broker, which answers the architecture's socketcall creation calls, or undefined where the architecture needs no broker. */
export function brokeredSeccompFilter(arch: string): Buffer | undefined {
  const target = ARCHES[arch];
  return target?.socketcall?.brokered === undefined ? undefined : buildFilter(target, true);
}
