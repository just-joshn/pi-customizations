# Read-only Linux sandbox grounding

`src/readonly-shell.ts` wraps Pi's bash tool for read-only children and plan mode. `src/linux-readonly-sandbox.ts` generates a classic BPF seccomp filter, probes bubblewrap, and runs each command with a read-only filesystem and shared network namespace. Unix socket access is intended to be denied because host services can mutate state. TCP and loopback access are intended to work. The sandbox is not a credential boundary.

The s390x glibc `socketcall(SYS_SOCKET)` passes its domain through a pointer inaccessible to classic BPF. The current filter rejects the call for every domain, so normal glibc TCP fails. Direct `socket(AF_UNIX)` is also rejected. The existing full-system QEMU harness and historical evidence are in `parity/evidence/linux-readonly-arches-2026-11-07/`; this run has not re-executed it.

A Linux container experiment found that an AF_UNIX datagram socketpair can send to a separate pathname socket. The existing filter permits socketpair. The actual sandbox exploit has not been tested. A solution must not introduce or preserve an unexamined Unix-socket bypass.

Read `extensions/pi-pstack/src/linux-readonly-sandbox.ts`, `src/readonly-shell.ts`, `test/linux-readonly-seccomp.test.ts`, `test/linux-readonly-sandbox.test.ts` and the harness README. Preserve inherited stdout sockets, cancellation and failure-closed behavior. Do not assume users have a new privileged kernel facility, distribution package, native binary, or container daemon. Record kernel/version and platform requirements. Test the real architecture rather than qemu-user seccomp emulation.
