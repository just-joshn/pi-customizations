# Linux readonly shell on armv7, ppc64le, and s390x (2026-11-07)

pi-pstack's readonly shell runs commands under bubblewrap with a seccomp filter. Before this change the filter table held only x64 and arm64, so on armv7, ppc64le, and s390x every readonly command failed with `the read-only shell has no seccomp filter for <arch>`. Node publishes Linux builds for all three (armv7l through Node 22), so they are supported targets.

## Result

Every check ran against a real kernel of the target architecture, booted under full-system QEMU. The `before` phase uses `src/linux-readonly-sandbox.ts` from main (`0bb0d452`). The `after` phase uses this branch. The VM logs were taken before two comment and formatting edits to that file; `seccompFilter` emits the same bytes for every architecture before and after them.

| Target | Kernel | Before | After |
| --- | --- | --- | --- |
| armv7 | Debian 6.12.115 armmp, `qemu-system-arm -M virt` | refused: no filter for arm | PASS 13/13 |
| armv7 userland on an arm64 kernel (compat) | Debian 6.12.115 arm64, `qemu-system-aarch64 -cpu cortex-a57` | refused: no filter for arm | PASS 13/13 |
| ppc64le | Debian 6.12.115 powerpc64le, `qemu-system-ppc64 -M pseries` | refused: no filter for ppc64 | PASS 12/12 |
| s390x | Debian 6.12.115 s390x, `qemu-system-s390x` | refused: no filter for s390x | PASS 12/12, network reads refused (see below) |
| arm64 (control) | OrbStack 7.2.12, native container | PASS 11/11 | PASS 11/11 |

Each probe runs unsandboxed first as the baseline, then through `linuxReadonlyCommand`. The probes check that `cat`, `ls`, and `git log` work; that `touch` fails with a read-only file system and leaves no file; that a Node connect to a host Unix socket fails with EPERM and never reaches the server; that `socket(AF_UNIX)` fails through Python, through the raw `socket` syscall, and through `socketcall(SYS_SOCKET)`; that the raw `socket(AF_INET)` syscall succeeds; that `io_uring_setup` fails with EPERM; that Node keeps writing to a stdout socket it inherited; and that Node `fetch` and `curl` read a loopback HTTP server. On arm the check also tries the OABI indirect `syscall(socket, AF_UNIX)`.

The package's readonly Vitest files also pass at HEAD in a privileged native arm64 container: 35 passed, 3 skipped (`logs/vitest-arm64-native.txt`).

## s390x network reads

glibc on s390x creates and connects every socket through `socketcall` unless it is built for kernels 4.3 or later (`sysdeps/unix/sysv/linux/s390/kernel-features.h` in glibc 2.41). Debian trixie's glibc does so (`logs/libc-socket-syscalls.txt`). A classic BPF filter can read `socketcall`'s call number but not the argument block that holds the domain, so the filter refuses `socketcall(SYS_SOCKET)` for every domain. Network reads from glibc programs, Node included, fail inside the s390x readonly shell. Writes, Unix sockets, and io_uring stay refused, and a program that issues the direct `socket` syscall (musl, or the raw probe) still gets AF_INET sockets.

The filter allows `socketcall`'s other calls, since they only operate on descriptors the command already holds, as they do on x64. Refusing `socketcall` outright breaks more. Node's `child_process` gives a child a socketpair as stdout, and Pi starts the shell that way. With every `socketcall` refused, Node inside the sandbox replaces `process.stdout` with a stream that discards output: `logs/vm-s390x-deny-all-socketcall.txt` shows `stream=Writable` instead of `stream=Socket`, and the Node probes print nothing. That Node classifies the socket through `socketcall` is inferred from libuv's `uv_guess_handle`, not traced.

glibc on armv7 and ppc64le and musl on all three architectures use the direct `socket` and `connect` syscalls.

## Why full-system emulation

Docker's `--platform linux/s390x` containers run under binfmt qemu-user on the arm64 host kernel. qemu-user refuses `PR_SET_SECCOMP` (`linux-user/syscall.c` in QEMU 10.0), and the host kernel only ever sees arm64 syscalls. The `logs/container-*-qemu-user.txt` runs show the pre-fix refusal, and that after the fix bubblewrap cannot create its namespaces there, so they cannot test the filter.

## Sources

`logs/kernel-constants.txt` holds the values `kernel-constants.sh` read from torvalds/linux at v5.14 (RHEL 9), v6.1 (Debian 12), v6.8 (Ubuntu 24.04), and v6.12 (Debian 13). The four versions agree on every value.

| Arch (`process.arch`) | `AUDIT_ARCH_*` (`include/uapi/linux/audit.h`, `elf-em.h`) | `socket` | `socketcall` | `io_uring_setup` | Table |
| --- | --- | --- | --- | --- | --- |
| `arm` | `AUDIT_ARCH_ARM` = EM_ARM 40 \| LE = `0x40000028` | 281 | 102 (OABI only) | 425 | `arch/arm/tools/syscall.tbl` |
| `ppc64` | `AUDIT_ARCH_PPC64LE` = EM_PPC64 21 \| 64BIT \| LE = `0xC0000015` | 326 | 102 | 425 | `arch/powerpc/kernel/syscalls/syscall.tbl` |
| `s390x` | `AUDIT_ARCH_S390X` = EM_S390 22 \| 64BIT = `0x80000016` | 359 | 102 | 425 | `arch/s390/kernel/syscalls/syscall.tbl` |

`SYS_SOCKET` is 1 (`include/uapi/linux/net.h`). ARM's OABI `syscall` (113, `arch/arm/tools/syscall.tbl`) dispatches another syscall without a second seccomp check (`sys_syscall` in `arch/arm/kernel/entry-common.S`), so the arm filter refuses it. s390x is big-endian, so its filter is written in big-endian order and reads the low word of the first argument at offset 20 of `struct seccomp_data`, not 16. Any other audit architecture, such as AArch32 compat on arm64, 31-bit s390, or 32-bit or big-endian ppc, kills the process, as i386 and x32 do on x64.

## Rerun

```sh
docker build --platform linux/arm64 -t ro-arches-qemu -f qemu.Dockerfile .
./build-rootfs.sh linux/arm64 arm64 linux-image-arm64 arm64
./build-rootfs.sh linux/arm/v7 armv7 linux-image-armmp armv7l
./build-rootfs.sh linux/ppc64le ppc64le linux-image-powerpc64le ppc64le
./build-rootfs.sh linux/s390x s390x linux-image-s390x s390x
./run-all.sh            # 3.5 minutes on an M-series Mac; writes logs/
./libc-syscalls.sh > logs/libc-socket-syscalls.txt
./kernel-constants.sh > logs/kernel-constants.txt
```

`run-vm.sh <target> <work dir>` boots one target. `check.ts` is the probe driver, `syscalls.py` makes the raw syscalls, `checks.sh` runs both phases as uid 1000, and `guest-init.sh` is PID 1 in the guest. The rootfs images are Debian trixie with bubblewrap 0.12.0, glibc 2.41, Python 3.13, and the official Node v22.23.4 build for each architecture.
