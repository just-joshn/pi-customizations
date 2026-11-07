import { describe, expect, test } from 'vitest';
import { seccompFilter } from '../src/linux-readonly-sandbox.ts';

const ALLOW = 0x7fff_0000;
const EPERM = 0x0005_0001;
const KILL = 0x8000_0000;
const AF_UNIX = 1;
const AF_INET = 2;
const SOCKETCALL = 102;
const SYS_SOCKET = 1;
const SYS_CONNECT = 3;
const SYS_GETSOCKNAME = 6;

type Endian = 'LE' | 'BE';

interface Kernel {
  arch: string;
  endian: Endian;
  audit: number;
  socket: number;
  openat: number;
  socketcall: boolean;
  refused: Record<string, number>;
  otherAbis: Record<string, number>;
}

// AUDIT_ARCH_* from include/uapi/linux/audit.h and elf-em.h; syscall numbers from arch/x86/entry/syscalls/syscall_64.tbl,
// include/uapi/asm-generic/unistd.h, arch/arm/tools/syscall.tbl, arch/powerpc/kernel/syscalls/syscall.tbl, and
// arch/s390/kernel/syscalls/syscall.tbl. Linux 5.14, 6.1, 6.8, and 6.12 agree on every value.
const kernels: Kernel[] = [
  { arch: 'x64', endian: 'LE', audit: 0xc000_003e, socket: 41, openat: 257, socketcall: false, refused: { io_uring_setup: 425 }, otherAbis: { i386: 0x4000_0003 } },
  { arch: 'arm64', endian: 'LE', audit: 0xc000_00b7, socket: 198, openat: 56, socketcall: false, refused: { io_uring_setup: 425 }, otherAbis: { arm: 0x4000_0028 } },
  { arch: 'arm', endian: 'LE', audit: 0x4000_0028, socket: 281, openat: 322, socketcall: true, refused: { io_uring_setup: 425, syscall: 113 }, otherAbis: { armeb: 0x0000_0028 } },
  { arch: 'ppc64', endian: 'LE', audit: 0xc000_0015, socket: 326, openat: 286, socketcall: true, refused: { io_uring_setup: 425 }, otherAbis: { ppc: 0x0000_0014, ppc64: 0x8000_0015 } },
  { arch: 's390x', endian: 'BE', audit: 0x8000_0016, socket: 359, openat: 288, socketcall: true, refused: { io_uring_setup: 425 }, otherAbis: { s390: 0x0000_0016 } },
];

const X32_SYSCALL_BIT = 0x4000_0000;

/** struct seccomp_data { int nr; __u32 arch; __u64 instruction_pointer; __u64 args[6]; } in the kernel's byte order. */
function seccompData(endian: Endian, audit: number, nr: number, args: number[]): Buffer {
  const data = Buffer.alloc(64);
  const le = endian === 'LE';
  if (le) data.writeUInt32LE(nr >>> 0, 0);
  else data.writeUInt32BE(nr >>> 0, 0);
  if (le) data.writeUInt32LE(audit, 4);
  else data.writeUInt32BE(audit, 4);
  args.forEach((arg, index) => {
    if (le) data.writeBigUInt64LE(BigInt(arg), 16 + index * 8);
    else data.writeBigUInt64BE(BigInt(arg), 16 + index * 8);
  });
  return data;
}

/** Runs a classic BPF seccomp program the way the kernel does: native-endian instructions and native-endian word loads. */
function runFilter(program: Buffer, endian: Endian, data: Buffer): number {
  const le = endian === 'LE';
  const u16 = (buffer: Buffer, at: number) => (le ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
  const u32 = (buffer: Buffer, at: number) => (le ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
  const length = program.length / 8;
  if (!Number.isInteger(length) || u16(program, (length - 1) * 8) !== 0x06) throw new Error('the kernel rejects a program that does not end in a return');
  let accumulator = 0;
  for (let pc = 0; pc < length; pc++) {
    const code = u16(program, pc * 8);
    const jt = program.readUInt8(pc * 8 + 2);
    const jf = program.readUInt8(pc * 8 + 3);
    const k = u32(program, pc * 8 + 4);
    switch (code) {
      case 0x20:
        if (k % 4 !== 0 || k >= data.length) throw new Error(`the kernel rejects a load at offset ${k}`);
        accumulator = u32(data, k);
        break;
      case 0x15:
        pc += accumulator === k ? jt : jf;
        break;
      case 0x35:
        pc += accumulator >= k ? jt : jf;
        break;
      case 0x06:
        return k;
      default:
        throw new Error(`the kernel rejects opcode 0x${code.toString(16)} at instruction ${pc}`);
    }
  }
  throw new Error('the program ran past its last instruction');
}

describe.for(kernels)('the $arch seccomp filter', (kernel) => {
  const decide = (nr: number, args: number[] = [], audit = kernel.audit) => runFilter(seccompFilter(kernel.arch), kernel.endian, seccompData(kernel.endian, audit, nr, args));

  test('refuses socket(AF_UNIX) with EPERM', () => {
    expect(decide(kernel.socket, [AF_UNIX, 1, 0])).toBe(EPERM);
  });

  test('allows socket(AF_INET) and an ordinary syscall', () => {
    expect([decide(kernel.socket, [AF_INET, 1, 0]), decide(kernel.openat, [0, 0, 0])]).toEqual([ALLOW, ALLOW]);
  });

  test('refuses io_uring_setup and the ARM indirect syscall with EPERM', () => {
    const decisions = Object.fromEntries(Object.entries(kernel.refused).map(([name, nr]) => [name, decide(nr, [AF_INET, 1, 0])]));
    expect(decisions).toEqual(Object.fromEntries(Object.keys(kernel.refused).map((name) => [name, EPERM])));
  });

  test.runIf(kernel.socketcall)('refuses socketcall(SYS_SOCKET) for every domain and allows its other calls', () => {
    const pointer = 0x1000;
    expect([decide(SOCKETCALL, [SYS_SOCKET, pointer]), decide(SOCKETCALL, [SYS_CONNECT, pointer]), decide(SOCKETCALL, [SYS_GETSOCKNAME, pointer])]).toEqual([EPERM, ALLOW, ALLOW]);
  });

  test('kills a syscall made through another ABI', () => {
    const decisions = Object.fromEntries(Object.entries(kernel.otherAbis).map(([abi, audit]) => [abi, decide(kernel.openat, [], audit)]));
    expect(decisions).toEqual(Object.fromEntries(Object.keys(kernel.otherAbis).map((abi) => [abi, KILL])));
  });
});

test('the x64 filter kills an x32 syscall', () => {
  const x64 = kernels[0] as Kernel;
  expect(runFilter(seccompFilter('x64'), 'LE', seccompData('LE', x64.audit, X32_SYSCALL_BIT | x64.openat, []))).toBe(KILL);
});
