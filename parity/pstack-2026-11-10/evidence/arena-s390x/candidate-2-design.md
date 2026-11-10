# Candidate 2: s390x network parity with no helper

Direction: bubblewrap, namespaces, mounts and a static seccomp filter only. No new process or binary.

**Verdict: parity is impossible on s390x without a helper.** Every mechanism I could name fails, and each failure is measured below. The deliverable is the safest profile that can be measured: it closes the datagram gap that the current s390x filter leaves open and says plainly that network access is absent. It is not parity and does not claim to be.

All kernel runs used the Debian 6.12.115 s390x kernel under full-system QEMU with glibc 2.41 and bubblewrap 0.12.0. I booted it through a copy of the repo's harness in `scratch/run-vm.sh`. I did not touch the repo. Evidence is in `evidence/`.

## Problem

An s390x glibc or Go program reaches `socket`, `connect`, `sendto` and `sendmsg` through `socketcall(call, args*)`. A classic BPF filter reads `call` but cannot read the domain or sockaddr behind `args*`. So it cannot allow AF_INET and refuse AF_UNIX there.

The current filter refuses `socketcall(SYS_SOCKET)` for every domain, which already removes glibc and Go network access. Its measured behavior (`evidence/vm-s390x-run3.txt`, filter `eperm-socket`):

- **Datagram gap.** `socketcall(SOCKETPAIR)` is allowed for every type. A `socketpair(AF_UNIX, SOCK_DGRAM)` endpoint can be re-pointed at any host datagram socket, by path or by abstract name.
- **Bypass through direct syscalls.** The re-pointing can use the direct `connect`, `sendto`, `sendmsg` and `sendmmsg` syscalls. Those go through `socketcall` or are plain syscalls (362, 369, 370, 358), so even a `socketcall` block has to be paired with a direct-syscall block (`evidence/vm-s390x-run4.txt`).
- **Partial network for musl.** A musl-style program that makes every call directly still gets TCP on loopback.

Constraints I honored: fail closed, keep the facade `linuxReadonlyCommand(command, cwd)`, keep inherited stdout sockets and Node and Python child pipes working, and keep the unix-socket refusal.

## Why parity cannot be reached without a helper

| Mechanism | Result | Evidence |
| --- | --- | --- |
| `socketcall` returns ENOSYS, EAFNOSUPPORT or EPERM and glibc retries directly | **No retry.** glibc 2.41 picks `socket()` at build time: `#ifdef __ASSUME_SOCKET_SYSCALL` direct, else `SOCKETCALL`. `s390/kernel-features.h` undefines that when the minimum kernel is below 4.3, and Debian's build does. Go on s390x has only `socketcall`/`rawsocketcall`. Measured under all three errnos: Python, curl, Node and static Go all surface the errno (ENOSYS gives `errno=38`, `go tcp: ... function not implemented`). The direct `socket(AF_INET)` still returns fd 3, so only direct-syscall programs get a socket. | `evidence/vm-s390x-run1.txt`, `scratch/src/{socket.c,socketcall.h,s390_kernel-features.h,syscall_linux_s390x.go}` |
| Refuse all `socketcall` | Breaks Node `child_process` (`undefined ENOSYS`) and Python asyncio. This is the already-recorded regression. | `evidence/vm-s390x-run1.txt`, `enosys-all-socketcall` |
| Filter reads `args*` | Impossible. cBPF sees only `seccomp_data` (nr, arch, ip, 6 raw registers). The pointer's value says nothing about its contents. | seccomp ABI |
| Own netns plus a relay that needs no refused socket | Dead on three counts. (1) An unprivileged veth cannot place its peer in the host netns: `RTNETLINK answers: Operation not permitted`. Reaching the host network from a netns needs a userspace forwarder (pasta, slirp, socat). (2) The loopback and TCP in a fresh netns reach nothing on the host (`tcp loopback connect: ECONNREFUSED`). (3) Pathname unix sockets cross netns, so the point of the exercise is lost. | `evidence/veth-arm64.txt`, `evidence/kernel-generic-arm64.txt` ("own netns"), `evidence/vm-s390x-run2.txt` |
| Own netns plus allow `socketcall(SYS_SOCKET)` for every domain | Strictly worse than today. Abstract sockets become unreachable, but pathname stream sockets stay reachable (`unix path stream connect: b'HELLO'` on the s390x kernel in its own netns) and loopback no longer reaches the host. | same |
| Per-namespace reachability: hide host unix sockets with mounts or uids | `--ro-bind / /` does not hide them, since `connect` needs no write access on a read-only mount. `--uid 4242` does not hide them, because the kuid still owns them. Masking with `--ro-bind /dev/null <path>` does work, but only for paths named at launch. Abstract sockets cannot be masked in a shared netns (`HELLO` still returned). | `evidence/kernel-generic-arm64.txt` |
| Same masking, with the paths read from `/proc/net/unix` | It stops *pathname* datagram reach (`ECONNREFUSED`) but not abstract datagram reach, and it misses sockets created after the scan. On s390x it mitigates and does not close. | `evidence/vm-s390x-run2.txt` section C |
| Landlock, SELinux `--exec-label`, `newuidmap` subordinate ids | Each needs a launcher, a policy, or a setuid helper, and none is portable. Excluded by the direction. I did not test them. | none |
| Kernel-only forwarder (nft DNAT, veth) | Needs CAP_NET_ADMIN over the host netns. See row 4. | `evidence/veth-arm64.txt` |

The remaining option is a supervised launcher: a seccomp user-notification supervisor as in the earlier candidate, or a relay process. That is a helper, which this direction forbids. It is the only route to parity.

## Usage (caller's view)

Nothing changes for callers. `linuxReadonlyCommand(command, cwd)` stays as it is and `bwrapArgs` is unchanged.

```ts
// x64, arm64, ppc64le, armv7: unchanged.
// s390x: still no AF_INET for glibc or Go, now with no datagram gap and no musl TCP.
const cmd = linuxReadonlyCommand('git log -1', cwd);   // works
const net = readonlyNetwork();                          // 'full' on x64, 'none' on s390x: measured in the profile that runs
```

Two call sites follow from that. The first is the read-only tool's description or error text, which says "no network here" when `readonlyNetwork() === 'none'`. The second is a verification test that asserts `readonlyNetwork()` matches the architecture's expectation.

## Shape

**Data first.** One table row per architecture. Add `refusedWhen` entries and `refused` syscalls for s390x. There is no new type for the filter.

```ts
s390x: { ..., refusedWhen: [[359, AF_UNIX],
                            [SOCKETCALL, 1 /*SOCKET*/], [SOCKETCALL, 3 /*CONNECT*/],
                            [SOCKETCALL, 11 /*SENDTO*/], [SOCKETCALL, 16 /*SENDMSG*/], [SOCKETCALL, 20 /*SENDMMSG*/]],
         refused: [IO_URING_SETUP, 362 /*connect*/, 369 /*sendto*/, 370 /*sendmsg*/, 358 /*sendmmsg*/] }
```

**Rule.** Every call that takes a destination address from the sandboxed program is refused on both paths, `socketcall` and direct. A socketpair endpoint can then be created but cannot be re-pointed at a host socket. A stream or seqpacket pair already fails to reconnect: `EISCONN` for a stream or seqpacket host socket and `EPROTOTYPE` for a datagram host socket (`evidence/residual-arm64.txt`). The datagram→datagram case is the only gap, and refusing `connect`, `sendto`, `sendmsg` and `sendmmsg` closes it. `socketcall(SOCKETPAIR)`, `SEND` and `RECV` stay allowed, because they carry no destination address.

**A latent generator bug the change needs fixed.** `seccompFilter` sends a rule whose syscall matches but whose value does not straight to ALLOW. A second `refusedWhen` entry for the same syscall is therefore unreachable. I measured this: the data-only change gave `socketpair(DGRAM) -> connect host path: ... send ok` (`evidence/vm-s390x-run6.txt`).

The fix in `evidence/proposed-sandbox.diff` reloads the syscall number at the start of each rule, and a value mismatch falls through to the next rule. It costs one extra instruction per rule.

**Equivalence.** I generated old and new filters for the five architectures and ran both through a cBPF interpreter over 88,512 (arch, syscall, args) cases per architecture (`evidence/filter-differential.txt`). x64, arm64, arm and ppc64 differ in zero cases. s390x differs only for `socketcall` calls 3, 11, 16 and 20 and for syscalls 358, 362, 369 and 370, as intended.

**Capability measured in the profile that runs.** `checkSandbox` already starts bubblewrap once to prove the filter loads. It gains a second probe in the same profile and with the same `3<` filter: `LC_ALL=C bash -c 'exec 3<>/dev/tcp/127.0.0.1/1'`. It needs no listener.

- "Connection refused" means a socket was created and the connect reached the kernel, so `network = 'full'`.
- "Operation not permitted" means `network = 'none'`.

I measured both messages: allow-all gives `Connection refused`, and every refusing filter gives `Operation not permitted` (`evidence/vm-s390x-run5.txt`). The probe uses only bash, which the facade already requires, and no helper.

```ts
type Network = 'full' | 'none';
/** What the exact profile that runs allows for TCP: probed once in checkSandbox, never assumed from the architecture. */
export function readonlyNetwork(): Network { /* not implemented: verifiedSandbox().network */ }
function probeNetwork(bwrap: string, filterFd: number, shell: string): Network { /* not implemented: spawnSync as checkSandbox does, match 'Connection refused' */ }
```

**Interface depth.** The public surface grows by one read-only function. The refused-call set, the byte order and the filter layout stay behind `seccompFilter`. Callers do not learn why s390x has no network, because the probe tells them whether it does.

**Measured profile** (`evidence/vm-s390x-run7.txt`, filter from the patched `seccompFilter('s390x')`):

| Check | Result |
| --- | --- |
| host unix path/abstract stream connect, dgram sendto | EPERM |
| `socketpair(DGRAM)` → connect host path or abstract dgram | EPERM (was `send ok` under the current filter) |
| direct `connect`/`sendto`/`sendmsg`/`sendmmsg`, path and abstract | EPERM (was OK) |
| glibc TCP, curl, Go, Node TCP | EPERM, and they stay refused |
| musl-style direct TCP | EPERM (was `HELLO`) |
| Node `spawn`, `spawnSync`, `fork` IPC, inherited stdout socket | work |
| Python asyncio subprocess, `multiprocessing` Queue and Pipe, `subprocess`, stream socketpair send/recv | work |
| git, `ls`, write refusal | work, `touch` fails with `Read-only file system` |

## Synthesis decision

Left to arena. My recommendation for synthesis: this candidate is the floor. Any candidate that adds a helper has to beat this profile on the one thing a helper buys, which is restoring TCP. This profile also supplies the filter fix and the `readonlyNetwork()` probe, which a helper design needs regardless.

## Tradeoffs accepted

- We accept losing musl-style direct TCP on s390x (a partial network today) in exchange for closing the datagram gap. Allowing direct `connect` re-opens the gap, because the filter cannot tell a TCP socket from a datagram pair.
- We accept s390x having no network in exchange for staying fail-closed. This is the recorded gap, now measured at startup.
- We accept one extra instruction per rule on every architecture in exchange for correct multi-value rules. The differential test shows no behavior change elsewhere.
- We keep `socketcall(SYS_SOCKET)` refused even though refusing `connect` makes a fresh socket mostly useless. That keeps abstract-name bind/listen closed, as on x64. I did not test an allow-all variant.

## Alternatives considered

- **Refuse `socketcall` wholesale.** Hides complexity from callers and closes everything, but breaks Node and Python child pipes (measured). It loses on observable behavior.
- **Current profile plus `/proc/net/unix` masks.** It keeps musl TCP but leaves the abstract datagram gap open and races with new sockets. It needs per-launch scanning in TypeScript, which adds a moving part to the facade.
- **Own netns.** No network and no closure of pathname sockets. It loses on both axes.
- **Landlock, an SELinux label or a subuid map.** Each needs a launcher, policy or setuid helper, and none is portable.

## Open questions and risks

Unproven assumptions, stated plainly:

- Is no s390x network acceptable, or does a helper's cost buy back TCP? That is a product decision, not an engineering one.
- Is losing musl-style TCP on s390x (Alpine) acceptable? Alpine on s390x exists but has no official Node build. I did not test a musl userland, only a raw-syscall stand-in.
- Does `child.send(handle)` (Node IPC fd passing) or Python `socket.sendmsg` with SCM_RIGHTS need `sendmsg` without an address? Both are refused now. I did not test them, and libuv takes the `sendmsg` path only when a handle is sent.
- Do all s390x kernel versions behave the same? I tested 6.12 only. Kernels before 4.3 lack the direct syscalls, so the direct entries are harmless there. RHEL 8 is 4.18 and I did not boot it.
- Distributions whose glibc is built for kernel 4.3 or later use direct syscalls on s390x. There the current filter may already give glibc TCP and unix refusal, and this profile would take that TCP away. The probe reports it correctly, but the filter would be needlessly strict. I did not find or test such a distribution, and a conditional profile would be speculative without one.
- bash may lack `/dev/tcp`, because some distributions disable it. The probe must then report 'unknown', not 'none'. I did not design that branch.
- Does the unchanged `bwrap` argument list keep working with AppArmor or SELinux enabled? Unproven here, as before.

## Next implementation step

Apply `evidence/proposed-sandbox.diff` to `seccompFilter` and the s390x row, then add `readonlyNetwork()` and its bash probe to `checkSandbox` and a differential test: old and new filters must agree on every non-s390x case.
