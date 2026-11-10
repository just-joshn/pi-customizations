# s390x network parity: shared grounding for the arena

## Task

Design how the Linux read-only shell can give s390x commands the same network access as x64 (TCP and loopback) while still refusing host Unix sockets. This is a defensive design for pi-pstack's own sandbox. A fallback that removes network access is not parity.

## Verified facts

- The sandbox is bubblewrap (`--unshare-all --share-net --ro-bind / /`) plus a classic BPF seccomp filter loaded through `--seccomp 3`. Code: `extensions/pi-pstack/src/linux-readonly-sandbox.ts`. The filter now refuses non-stream `AF_UNIX` socketpairs directly (this run, Stage 1).
- On s390x, glibc (2.39 and 2.41) and static Go reach `socket` and `socketpair` through `socketcall(call, args*)`. A classic BPF filter reads `call` but not the domain or type behind `args*`. So the filter cannot allow AF_INET and refuse AF_UNIX there. musl uses direct syscalls.
- The current s390x filter refuses `socketcall(SYS_SOCKET)` for every domain, which removes glibc network access. It allows `socketcall(SYS_SOCKETPAIR)`, which leaves the datagram path open there (filter-level evidence).
- A prototype seccomp user-notification supervisor in Python (`/tmp/pstack-sandbox-architect/candidate-1/evidence/notify-launcher.py`) restored glibc and Node TCP, kept Unix denied, and kept Node pipes on a real s390x 6.12 kernel under QEMU. It needs kernel 5.9 or later and ptrace-read access. It was not tested stacked with the bubblewrap filter, under abort, under concurrency, or on other kernels.
- Closing the socketcall path with a refusing filter measurably breaks Node `child_process` pipes and Python asyncio on s390x.
- Full-system QEMU is the only valid s390x kernel test. qemu-user refuses `PR_SET_SECCOMP`. Harness: `parity/evidence/linux-readonly-arches-2026-11-07/`.

## Constraints

- A native helper is allowed if justified. Do not hide complexity in another language to reduce TypeScript, and do not duplicate policy across languages.
- Preserve fail-closed behavior, stdout socket inheritance, cancellation, and the existing facade `linuxReadonlyCommand(command, cwd)`.
- Declare every dependency and kernel requirement. Behavior must hold on every supported Linux environment, or the gap stays recorded.
- Never claim parity from a table. Prefer capability measured in the exact profile that runs.

## Unproven

Supervisor on RHEL, SLES, Ubuntu; `ptrace_scope=2`; SELinux or AppArmor; load; abort; the stacked configuration; startup cost. Whether glibc retries the direct syscall when `socketcall` returns ENOSYS.
