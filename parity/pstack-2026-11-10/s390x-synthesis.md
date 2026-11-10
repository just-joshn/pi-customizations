# s390x network parity: arena synthesis

Candidates and their evidence are kept in `evidence/arena-s390x/`. Both ran on the Debian 6.12 s390x kernel under full-system QEMU. No cross-family judge ran: the Grok slug was rejected and the pool held no other non-Claude entry. The base was picked by one reader.

## Base: candidate 1, a small static broker

A static C helper of about 150 lines owns the seccomp user-notification listener and runs bubblewrap as its child. It brokers only `socketcall(SOCKET)` and `socketcall(SOCKETPAIR)`. It reads the arguments once, creates the socket itself, and installs it with `ADDFD`, so the checked values are the executed values. It never answers `CONTINUE`. TypeScript generates both the BPF and the helper's `--policy` string from one architecture row, so the helper holds no table. The helper runs outside bubblewrap, so the command cannot reach it and there is one filter.

Measured on s390x 6.12 (`evidence/arena-s390x/candidate-1-evidence/vm-run1.txt`): TCP to loopback works and every non-stream AF_UNIX variant is refused. 20,000 argument-flip races each for `socket` and `socketpair` produced zero escapes (`vm-run2.txt`, which then ends in a syntax error in its checks script). The Node `child_process`, asyncio, and stdout `Socket` claims are the candidate's statement and were not rechecked here. With the helper gone glibc gets `ENOSYS` and does not retry the direct syscall.

## Why not candidate 2

Candidate 2 shows that no mechanism without a helper gives parity: ENOSYS or errno tricks, a network namespace relay, and path masking all fail with measured evidence. Its safest profile (no network for any program) is a recorded gap, not parity.

## Grafts from candidate 2

- **Fallback profile (not implemented).** The synthesis chose to degrade, when the broker cannot run, to candidate 2's profile that refuses the address-taking calls (`connect`, `sendto`, `sendmsg`, `sendmmsg`). The code instead falls back to the filter alone, which is candidate 1's fallback and leaves the datagram path open on s390x. That choice was made to keep today's behavior and avoid breaking pipes; it is recorded in `docs/host-limits.md`.
- **Filter fix.** Reload the syscall number at the start of each rule. Today a second rule for the same syscall, such as a second `socketcall` call value, is unreachable. A differential check over 88,512 cases per architecture showed the other four architectures unchanged (`candidate-2-evidence/filter-differential.txt`, `proposed-sandbox.diff`).
- **Capability probe.** Report the measured network capability from a probe inside the exact profile, not from the architecture.

## Rejected

The Python supervisor (policy duplicated in a second language), any claim of parity from a table, and a fallback that removes network and is called equivalent.

## Defects and gaps to fix before implementing

- Candidate 1's scratch C has three listed defects, including a `getppid() == 1` check that wrongly aborts when Pi runs as pid 1 of a container.
- Not run: any kernel other than 6.12 (RHEL 9, Ubuntu 24.04, Debian 12), SELinux, AppArmor, the arm, ppc64le, x64, and arm64 helper binaries, and the real Pi abort path through `exec`. Setuid-only bubblewrap would lose privilege under no-new-privs, which is inferred, not tested.
- Superseded: the broker, its TypeScript, and a real-kernel run now exist (see `checkpoint.md`, unit 4).

## Decisions for you

1. When the broker cannot run, degrade to the measured no-network profile with a visible `degraded` status, or refuse to run the shell. Degrading keeps the shell usable but is not parity.
2. Commit the built helper binary, or attach it in CI. Committing makes npm installs work with no build tools. `prepack` would rebuild and compare bytes either way.
3. Which Zig version to pin for the cross-build. The design says two s390x builds gave the same sha256, but the evidence records one hash and the design's truncated hash does not match it, so reproducibility is unverified.

## Next step

Done: the per-rule reload was removed, the policy generator and brokered mode were written, and the production chain ran on the s390x QEMU harness.


## Interrogation of the Stage 1 change (verified by rerun)

- `socketcall(SYS_SOCKETPAIR)` is still allowed on arm, ppc64 and s390x. A real s390x kernel run reproduced a datagram from glibc `socketpair(AF_UNIX, SOCK_DGRAM)` reaching a host Unix socket. A reviewer also reproduced it on a ppc64le kernel through a raw `socketcall`; the filter-level result for arm, ppc64 and s390x was rerun here. The broker design would close this on s390x. arm and ppc64 need a decision, because glibc uses direct syscalls there and refusing `socketcall(8)` is likely harmless, but that is untested.
- Descriptors the caller leaves open, and descriptors received over an allowed stream socket with `SCM_RIGHTS`, can reach host sockets. Both need the caller to leak or pass a descriptor. Whether Pi's own launch path leaks one was not tested.
