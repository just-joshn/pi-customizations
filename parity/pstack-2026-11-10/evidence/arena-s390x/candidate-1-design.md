# Candidate 1: a small static C broker that owns the seccomp listener and launches bubblewrap

Direction: a native helper (C, not Python) installs the seccomp user-notification filter and brokers `socketcall(SYS_SOCKET)` and `socketcall(SYS_SOCKETPAIR)`. The helper runs outside bubblewrap, as bubblewrap's parent. TypeScript owns every number and the refusal rule; the helper contains no architecture table.

Experiments, sources and logs are in `/tmp/arena-s390x/candidate-1/evidence/`. Scratch builds are in `scratch/`. The repository was not modified. No TypeScript in this document has been run. Only the C helper and the generated BPF were exercised.

## Problem

On s390x, glibc and static Go reach `socket` and `socketpair` through `socketcall(call, args*)`. A classic BPF filter cannot read the domain or type behind `args*`, so `linux-readonly-sandbox.ts` refuses `socketcall(SYS_SOCKET)` for every domain. That removes glibc TCP and loopback. The filter also allows `socketcall(SYS_SOCKETPAIR)`, which leaves the datagram path open. Refusing all of `socketcall` breaks Node `child_process` and asyncio, which use stream socketpairs. The only mechanism that can read the arguments is a seccomp user-notification supervisor (kernel 5.9 or later, plus access to the target's memory).

Constraints carried in from grounding:
- Keep fail-closed behavior, stdout socket inheritance, cancellation, and the facade `linuxReadonlyCommand(command, cwd)`.
- No policy table in a second language.
- Every dependency and kernel requirement is declared.
- Never claim parity from a table: the check runs in the exact launch profile.
- A fallback that removes network is not parity. It is a recorded gap.

## Usage (caller's view)

Callers do not change. `readonly-shell.ts` still calls the facade and still gets a shell string back.

```ts
// readonly-shell.ts (unchanged)
return linuxReadonlyCommand(command, cwd);
```

On x64 and arm64 the result is exactly today's command. On s390x, when the broker works, it is:

```sh
exec '<tmp>/netbroker' --policy 'socketcall=102,socket=1,socketpair=8,unix=1,stream=1,typemask=15' --filter-fd 3 -- \
  'bwrap' --new-session --die-with-parent --unshare-all --share-net --ro-bind / / --dev /dev --proc /proc --cap-drop ALL --chdir '<cwd>' -- \
  '/bin/bash' -c '<command>' 3< '<tmp>/s390x.bpf'
```

Two new, read-only diagnostics, so tests and the user can see which profile is active instead of trusting a table:

```ts
import { linuxReadonlyNetwork } from './linux-readonly-sandbox.ts';
linuxReadonlyNetwork(); // { kind: 'native' } | { kind: 'brokered' } | { kind: 'degraded', reason: 'ptrace_scope=3: /proc/<pid>/mem refused' }
```

On the real s390x kernel the s390x CI job asserts `kind === 'brokered'`. A `degraded` result is a failing test there, and a recorded gap on any other host.

## Shape

### Data first: one policy row

The existing `ARCHES` table gains one optional field. It is the single place the numbers live. `seccompFilter` and the helper's argv are both derived from it.

```ts
/** Kernel ABI constants the filter and the broker share. */
const SOCKET_ABI = { unixDomain: 1, streamType: 1, typeMask: 0xf, call: { socket: 1, socketpair: 8 } } as const;

interface Arch {
  audit: number; endian: 'LE' | 'BE'; socketpair: number; refusedWhen: [number, number][]; refused: number[];
  /** Present when the libc reaches socket/socketpair through socketcall(2) and the domain sits behind a pointer. */
  socketcall?: number;
}

type FilterMode = 'refuse' | 'broker';   // 'refuse': socketcall(SOCKET) -> EPERM (today). 'broker': socketcall(SOCKET|SOCKETPAIR) -> USER_NOTIF.
export function seccompFilter(arch: string, mode: FilterMode = 'refuse'): Buffer;   // existing function, one new parameter
function brokerPolicy(arch: string): string | undefined;   // `socketcall=102,socket=1,...`, built from SOCKET_ABI and Arch.socketcall
```

The helper's C code holds no syscall number, no `AUDIT_ARCH`, no `AF_UNIX`, no `SOCK_STREAM`, and no socketcall call numbers. It receives all of them in `--policy`. The things it does need per architecture come from the compiler, not from a table: `__NR_seccomp`, `struct seccomp_notif`, and the ioctl numbers from `<linux/seccomp.h>`, and `sizeof(unsigned long)` for the socketcall argument words (8 on s390x, 4 on 32-bit arm). A test (below) decodes the generated BPF and the policy string and checks they agree.

Only `s390x` gets `socketcall` set. `arm` already refuses the OABI `socketcall`, and the README shows glibc on armv7 and ppc64le uses direct syscalls. If one of them is later shown to need it, the change is one table field, and the build set (below) follows from it.

### The broker's job, and nothing else

The BPF program stays the owner of every decision it can make: direct `socket`, direct `socketpair`, io_uring, x32, wrong ABI. The broker sees only what BPF cannot decide: `socketcall` with call 1 or 8. It reads the argument block once, decides, creates the socket itself from that single read, and installs the descriptor into the target with `SECCOMP_IOCTL_NOTIF_ADDFD`. It never answers `SECCOMP_USER_NOTIF_FLAG_CONTINUE`, so a racing thread cannot change what was checked.

```c
// native/netbroker.c, about 150 lines, static, no libc network helpers
struct policy { long socketcall, call_socket, call_pair; int unix_domain, pair_type, type_mask; };
static void handle(int listener, struct seccomp_notif *n);
//   open /proc/<pid>/mem -> read args (3 or 4 words) -> ID_VALID -> decide ->
//   socket()/socketpair() in the broker -> ADDFD -> (socketpair: write the two fds into args[3]) -> SEND
// decide: socket(domain==unix) -> EPERM; socketpair(domain==unix && (type & typemask) != stream) -> EPERM; else perform it
// any failure to read the target (no ptrace access, EFAULT) -> refuse; it never allows what it could not check
```

### Process topology: the broker is bubblewrap's parent, not a child of the sandbox

```
pi tool process -> exec netbroker                       (unfiltered, host namespaces, the supervisor)
                       |-- fork: NNP, seccomp(NEW_LISTENER), send listener over a socketpair, exec bwrap
                                  `-- bwrap (filtered) -> pid-ns init -> bash -c "<command>"   (all inherit the filter)
```

I chose this over the prototype's inside-the-sandbox supervisor. It was tested on the real s390x 6.12 kernel (`evidence/vm-run1.txt`):
- The command cannot see, signal, ptrace, or open the memory of the supervisor: it lives in another pid namespace and another user namespace. This replaces the prototype's `PR_SET_DUMPABLE=0` argument with isolation the kernel enforces.
- There is one filter, loaded before bubblewrap, so the unproven "stacked with bubblewrap's filter" configuration does not exist. On a broker architecture `--seccomp 3` is dropped from `bwrapArgs`, and the helper reads the BPF from fd 3 and closes it. The command saw only fds 0 to 2 (the listing showed `0 1 2 3`, where 3 was `ls`'s own directory fd).
- `ptrace_scope=2` works, because Yama and the capability check use `ns_capable(<target's user namespace>, CAP_SYS_PTRACE)`, and the supervisor is the owner of the user namespace bubblewrap creates. Measured: scope 1 and scope 2 both brokered TCP and stream pairs; scope 3 refused everything (see below). A supervisor inside the same user namespace as the command has no such capability and would fail at scope 2. That is inferred from the kernel rule, not measured.

Cost of outside: the filter is on bubblewrap too, and `PR_SET_NO_NEW_PRIVS` is set before `exec bwrap`. A setuid bubblewrap loses its privilege, so a setuid-only host fails the probe and falls back (below). That is inferred, not tested; the fallback path covers it either way.

### Failure behavior: fail closed at every step, and measured in the real chain

Everything the helper cannot establish becomes a refusal or a non-zero exit, never an allow.

| Situation | Result | Evidence |
| --- | --- | --- |
| Bad filter bytes | exit 125, command never runs | `vm-run1.txt`: `exit=125`, `SHOULD-NOT-RUN` absent |
| Kernel without NEW_LISTENER or ADDFD | helper exits 125 before exec, or the selftest fails | by construction; no old kernel tested |
| `ptrace_scope=3` | every brokered `socketcall` is `EPERM`, so TCP and stream pairs fail | `vm-run1.txt` scope 3: TCP `EPERM`, stream pair `EPERM` |
| Supervisor killed | tasks blocked in or entering `socketcall` get `ENOSYS`; glibc does not retry the direct syscall | `vm-run2.txt`: `glibc socket(AF_INET) -> ENOSYS`, `socketpair -> ENOSYS`, raw direct `socket` still works |
| Supervisor stopped (SIGSTOP) | the command blocks in `socket()` until it continues, then completes | `vm-run3.txt`: `socket() took 7.0s` |
| Exit status | child status is returned; killed-by-signal becomes 128+sig | `vm-run1.txt`: `exit=7`, `exit=137` |

The `ENOSYS` row settles one of the grounding's unproven items: on glibc 2.41, a dead listener does not fall through to a direct syscall. The mechanism fails closed.

`checkSandbox()` gains a probe that runs the whole production chain and ends in `netbroker --policy ... --selftest`, which makes raw `socketcall` calls (no libc wrapper chooses the syscall) and requires: AF_INET stream works; AF_UNIX stream is `EPERM`; AF_UNIX datagram pair is `EPERM`; AF_UNIX stream pair works and its two fds are readable and writable. The probe runs in the same mode as the real command, so kernel version, ptrace mode, LSM policy and a noexec temp directory are all measured, not predicted. Its outcome is cached with the sandbox, as today.

If the probe fails, the facade falls back to the existing refusing filter, not to a weaker one, and `linuxReadonlyNetwork()` returns `{ kind: 'degraded', reason }`. This keeps the shell available and safe, but glibc network on that host is the gap. The alternative, throwing so the read-only shell is unavailable on s390x, is simpler to reason about and is the one-line change to make if the owner prefers that. I chose degrade because today's s390x behavior is the same state, so it is no regression.

### Cancellation

- The helper sets `PR_SET_PDEATHSIG(SIGKILL)` and exits if its parent already changed. It compares against the parent pid captured before `prctl`, not against 1. The prototype's `getppid() == 1` check would wrongly abort when pi runs as pid 1 of a container; this is a defect in the scratch code.
- SIGTERM, SIGINT and SIGHUP are blocked and read from a `signalfd`, then forwarded to bubblewrap. That matters because `--new-session` moves bubblewrap out of pi's process group, so a group signal would otherwise reach only the helper.
- `exec` in the shell string means the pid pi already holds is the helper.
- Measured: SIGTERM to the helper removed helper, both bubblewrap processes and `sleep`; SIGKILL to the helper removed them all too, through `--die-with-parent` (`vm-run2.txt`). Abort on a command blocked in `socketcall` rides the same paths and was not separately tested.
- After the child exits the helper returns its status at once. Bubblewrap is pid-namespace init, so any survivors die with it.

### Concurrency

The loop is a single-threaded `poll` over the listener and the signalfd, with level-triggered reads, so concurrent notifications queue in the kernel. Each handled call is microseconds of work and never blocks. `ID_VALID` runs after the memory read and before any decision, and `/proc/<pid>/mem` is opened once and kept, which pins the address space against pid reuse.

Measured on s390x under QEMU TCG: 8 threads, 2400 sockets plus 2400 pairs each, 1.14 s unsandboxed versus 2.93 s brokered, about 0.4 ms per brokered call in emulation (`vm-run1.txt`). The overhead is not a native measurement. A spam of notifications can slow other brokered calls, but cannot deadlock the broker.

A direct attack on the single-read claim: one thread flips the `socketcall` argument block between AF_INET and AF_UNIX while another issues the call, 20,000 times each for socket and socketpair. Results: 9,813 sockets created and 10,187 refused, with 0 AF_UNIX results; 10,029 pairs created and 9,971 refused, with 0 non-stream AF_UNIX pairs (`vm-run2.txt`).

### Language, build and packaging

- **Language: C.** The work is 150 lines of `ioctl`, `poll`, `fork` and `SCM_RIGHTS` against kernel structs, and every struct and syscall number it needs comes from the kernel headers at compile time. It gives a 41 KB static binary with no runtime. Rust would give memory safety for a tiny parser at the cost of a heavier cross toolchain; Go's runtime threads and the GC are the wrong shape for a process that forks and execs and holds a seccomp listener, and the binary would be about 1.5 MB; Python cannot be assumed on every host and was the thing this replaces.
- **Toolchain: `zig cc -target <arch>-linux-musl -Os -static -s`** with the Zig version pinned. In this run, `pip install ziglang` reported 0.17.1 and cross-built all five targets from one Linux container with no per-arch sysroot or cross-gcc packages:

| Target | Size |
| --- | --- |
| x86_64 | 38,328 B |
| aarch64 | 44,880 B |
| arm (armv7 hf) | 36,688 B |
| powerpc64le | 48,104 B |
| s390x | 41,304 B |

  A second s390x build produced the identical sha256 (`511c4733…`), so the output is reproducible and `--check` can compare bytes, as `scripts/build-helpers.mjs` already does for the Bun outputs.
- **What ships: only the architectures whose `ARCHES` row has `socketcall`.** Today that is `dist/netbroker-s390x`. `scripts/build-helpers.mjs` reads the TS table to decide the target list, so there is no second list to keep in step. `check:helpers` in `prepack` rebuilds and compares, like the existing outputs. x64 and arm64 never launch the helper, so they carry no new binary and no new risk. Building all five targets as a portability check in CI is cheap (all compiled here) but only the table-listed ones are committed.
- **Committed binary, not an install-time compile.** Hosts with no compiler are common, and a postinstall script is a supply-chain surface. The existing package already commits generated `dist/` and gates it with `prepack --check`. The C source ships under `native/` so the binary is auditable. musl's MIT notice goes in `licenses/`.
- **Execution path:** at check time the helper is copied from the package into the private `mkdtemp` directory already used for the filter, mode `0500`, and run from there. That avoids depending on the executable bit surviving npm, which I did not verify. A `noexec` temp directory fails the probe and degrades.

### Kernel and host requirements

- Linux 5.9 or later for `SECCOMP_IOCTL_NOTIF_ADDFD`. That excludes RHEL 8's 4.18 and Ubuntu 20.04's 5.4 GA kernel unless they carry backports, which I have not checked. The probe measures it rather than trusting a version string. `SECCOMP_ADDFD_FLAG_SEND` (5.14) is not required; without it an interrupted call can leave one orphan descriptor, an allowed socket, in the command's own table.
- `CONFIG_SECCOMP_FILTER`, and an unprivileged user able to `PR_SET_NO_NEW_PRIVS`.
- Same-uid read and write of `/proc/<pid>/mem` of the command (`ptrace_scope` 0 to 2). No `CAP_SYS_PTRACE`, no root, no capability in the host.
- Everything else is what the read-only shell already needs: bubblewrap with unprivileged user namespaces.
- An LSM that mediates `ptrace` between the supervisor and the bubblewrap child, such as SELinux or AppArmor, could refuse the memory access. Fail-closed: it degrades. Not tested.

### How it is tested on a real s390x kernel

The only valid s390x test is full-system QEMU. `qemu-user` refuses `PR_SET_SECCOMP`. The existing harness under `parity/evidence/linux-readonly-arches-2026-11-07/` is the base, and everything in `evidence/checks-run3.sh` is already shaped for it.

1. **Unit, any host (Vitest):**
   - Golden bytes for `seccompFilter('s390x', 'broker')`.
   - A small cBPF interpreter over `seccomp_data` samples, run for every architecture and both modes: `socketcall(1)` and `socketcall(8)` return `USER_NOTIF` in broker mode and `EPERM` in refuse mode, `socketcall(3)` is allowed, direct `socket(AF_UNIX)` is `EPERM`.
   - `brokerPolicy(arch)` agrees with the table the filter was built from.
   - Facade tests with a stubbed `spawnSync` for the probe result: the degrade and cached-failure paths.
2. **Build:** `check:helpers` reproduces the committed `dist/netbroker-s390x` byte for byte.
3. **Full-system s390x job, on every change to this area:** selftest in the real chain; glibc Python probe; Node TCP and `child_process`; Python subprocess and asyncio; the stdout-socket class check; the TOCTOU race; helper-death `ENOSYS`; SIGTERM and SIGKILL cleanup; exit status; bad-filter refusal; `ptrace_scope` 1 and 2 pass, and 3 yields `degraded` with the facade still refusing AF_UNIX. These ran green on Debian trixie, kernel 6.12.115, bubblewrap 0.12.0, glibc 2.41.
4. **Kernel and distro matrix, recorded gap until run:** the harness takes its kernel and initrd from a container's `/boot`, so a RHEL 9 (5.14), Ubuntu 24.04 (6.8) and Debian 12 (6.1) kernel can be swapped in. SELinux enforcing needs a RHEL-family rootfs and was not attempted.

## Synthesis decision

Filled in by arena.

## Tradeoffs accepted

- We accept a prebuilt binary in a TypeScript package in exchange for working network on hosts with no compiler and no extra interpreter. It is reproducible and byte-checked on `prepack`.
- We accept a second implementation language, 150 lines of C, in exchange for removing the Python dependency, a 41 KB static binary and kernel-header-derived structs. The policy stays in TypeScript, so only the mechanism is duplicated across languages, not the rules.
- We accept that the supervisor runs unsandboxed in the host's namespaces, in exchange for it being unreachable from the command and for `ptrace_scope=2` working. Its input is three or four integers from the command. It follows no pointer except the result slot in the command's own memory.
- We accept `PR_SET_NO_NEW_PRIVS` on bubblewrap itself, so a setuid-only bubblewrap falls back to the refusing filter, in exchange for a single filter and no stacking with bubblewrap's.
- We accept degrade-to-refusing rather than throwing. On a host where the broker cannot run, the shell stays up and safe, and s390x glibc network is the recorded gap.
- We accept the helper running only on architectures whose row has `socketcall`. x64 and arm64 keep one unchanged launch path. This looks like "two ways to launch", but the choice is derived from the table and not from a branch on architecture names.
- We accept an orphan fd in the command's own table in two corner cases: a signal interrupting a brokered call after `ADDFD`, and the second `ADDFD` of a pair failing. It is an allowed socket in the command's own descriptor space.
- We accept a hang bound to the supervisor, not to the command: while the helper is stopped, brokered calls block (tested). Only SIGSTOP or a debugger can do that, since the command cannot reach the helper.

## Alternatives considered

- **Python supervisor inside bubblewrap (the existing prototype).** Needs Python on every host, hard-codes a per-architecture table beside the TypeScript one, uses `PR_SET_DUMPABLE` as its only isolation, and depends on `ptrace_scope` 0 or 1 because the supervisor shares the command's user namespace. It also left stacked bubblewrap and notify filters unproven. Loses on interface depth and on duplicated policy.
- **Helper inside bubblewrap in C.** Same code, different topology. It would keep bubblewrap's own filter stacked, where `EPERM` for `socketcall(SOCKET)` outranks `USER_NOTIF`, so bubblewrap's filter has to be dropped or changed anyway. It then needs `PR_SET_DUMPABLE`, and it is a peer of the untrusted command in the namespaces. Outside is simpler and strictly less exposed.
- **Helper as a launcher that replaces bubblewrap, building the namespaces itself.** Avoids NNP-before-bwrap, but means reimplementing bubblewrap's mounts, userns maps and cap-drop. Far more surface than the 150 lines here.
- **`SECCOMP_USER_NOTIF_FLAG_CONTINUE` after checking.** Rejected: the arguments live in the command's memory and another thread can change them after the check. The race test shows the create-and-install path holds; CONTINUE would not.
- **Landlock or an LSM to deny AF_UNIX connect, with no seccomp broker.** Landlock's `LANDLOCK_ACCESS_FS_*` controls filesystem paths, not abstract sockets or socketpair datagram use. It is a complement to try later (6.12 reported Landlock up), not a replacement.
- **`LD_PRELOAD` or patching libc.** Not a boundary. Static binaries and direct syscalls skip it.
- **Disallow all `socketcall`.** Already measured to break Node pipes and asyncio.

## Open questions and risks

- Is degrade-to-refusing acceptable on s390x hosts where the broker cannot run, or should the read-only shell refuse to start there? This changes the facade behavior and the s390x CI assertion.
- Is a committed 41 KB binary in `dist/` acceptable for the project's supply-chain stance, or should it be built in release CI and attached to the package instead? Either way `prepack` must compare bytes.
- Which Zig version do we pin, and where is its checksum recorded? I used `pip install ziglang`, which printed 0.17.1; the build must not float.
- Hosts at `ptrace_scope=3` degrade, and the kernel logs a `ptrace attach ... was attempted by netbroker` line per brokered call (9 lines in one 3-call scope-3 probe). Is that log noise acceptable, or should the probe fail fast and the facade skip the broker, so a degraded host logs once?
- Are SELinux enforcing (RHEL, SLES) and AppArmor (Ubuntu 24.04) policies going to allow the supervisor to read `/proc/<pid>/mem` of the bubblewrap child? Not tested on either. The probe is the safety net, but whether parity is reached on those hosts is unknown.
- Kernel range: RHEL 9 (5.14), Ubuntu 24.04 (6.8) and Debian 12 (6.1) are not run. Do RHEL 8 s390x kernels carry the 5.9 notify features?
- Does the executable bit survive npm and Pi's package install? I did not check, which is why the helper is copied and chmod'd. Is a `noexec` temp directory on target hosts plausible?
- The pi bash tool's real abort path through `exec netbroker` was not exercised, only signals sent to the helper.
- The `arm` and `ppc64` binaries were built and never run, since no table row asks for them and no kernel exists to test them here. Are armv7 or ppc64le glibc hosts known to use `socketcall`?
- Load: only 8 threads under TCG. Real-hardware throughput and startup cost are unknown. The measured startup difference in `vm-run3.txt` (20 starts, bwrap alone 2.14 s, with the helper 1.89 s) is inside TCG noise.

## Next implementation step

Move `ARCHES` and `seccompFilter` into `seccomp-policy.ts`, add the `socketcall` field and `FilterMode`, and add the cBPF-interpreter unit test that pins both modes for every architecture, before any helper code is wired in.

## Appendix: experiments and what they showed

All on a Debian trixie s390x guest, kernel 6.12.115, full-system QEMU 10.0.13 TCG, bubblewrap 0.12.0, glibc 2.41, Python 3.13, Node 22.23.4. uid 1000 for the sandboxed runs.

| Experiment | Result | Log |
| --- | --- | --- |
| Raw `socketcall` selftest inside helper plus bubblewrap plus filter | INET ok; UNIX stream `EPERM`; UNIX dgram pair `EPERM`; UNIX stream pair ok | `vm-run1.txt` |
| glibc Python probe | `socket(AF_UNIX)` `EPERM`; all datagram, seqpacket and disconnect tricks `EPERM`; stream pair ok; TCP loopback ok | `vm-run1.txt` |
| Node | `process.stdout` is `WriteStream`; `spawn(pipe)` ok; TCP ok | `vm-run1.txt` |
| Node spawning the sandbox with pipes | `stdout is Socket` | `vm-run1.txt` |
| Python subprocess and asyncio | ok | `vm-run1.txt` |
| `ptrace_scope` 1, 2, 3 | 1 and 2 work; 3 refuses everything | `vm-run1.txt` |
| Bad filter | exit 125, command not run. The message read "No error information", a scratch-code bug (`errno` unset for the size check) | `vm-run1.txt` |
| Argument-flip race, 20,000 each | 0 escapes | `vm-run2.txt` |
| Listener closed, glibc | `ENOSYS`, no retry; direct syscall still works | `vm-run2.txt` |
| SIGTERM, SIGKILL to helper | nothing left running | `vm-run2.txt` |
| SIGSTOP of helper | `socket()` blocks until SIGCONT (7.0 s) | `vm-run3.txt` |
| Cross-build of all five targets, rebuilt twice | 36 to 48 KB; identical sha256 on rebuild | `binary-sizes.txt` |

Not run: any kernel other than 6.12; x64, arm64, arm and ppc64 helper binaries (built, not executed); SELinux and AppArmor; the TypeScript changes; the real pi bash-tool abort path.

Scratch defects found while writing this up, to be fixed in the real helper: the `getppid() == 1` check above; `die()` reporting a stale `errno` for the size check; the second-`ADDFD` failure leaving the first descriptor installed.
