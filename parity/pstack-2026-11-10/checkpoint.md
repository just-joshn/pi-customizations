# pi-pstack parity checkpoint, 2026-11-10

## Definition of done

The original request is complete only when every source-derived obligation has verified exact or independently reviewed equivalent behavior, including the required installed-package, live integration, and platform gates. Existing source coverage and passing local checks are not sufficient.

## Baseline

- Cursor plugins repository HEAD: `de8ee15dd1194627d21eb5fcd41cb1873208dabb`, retrieved 2026-11-10 UTC.
- Package's existing source revision: `ae5650febf4320793844c12c4adaa937f417f8da`, pstack 0.15.36.
- Both revisions have pstack tree `4719e1c4b4c43bac85d4206a8b41dd2899769c1c` and cursor-team-kit tree `6ccaf3821c0e9f82780c5224a2f2cd5ef3f580ee`. Repository-wide changes therefore do not change these two source trees. Other dependencies still need independent drift checks.
- Pi coding agent: 1.5.2. Its upstream `v1.5.2` tag resolves to `b4afdddf44e059c67ccf5097e5317d913521b470`. npm reported 1.5.2 as current on 2026-11-10.
- Cursor CLI: `2026.11.05-86047df`, invoked as `cursor-agent`. The `agent` command on PATH is a different CLI. Node: `v24.22.1`. Host: macOS arm64. Target package: `@justjoshn/pi-pstack` `0.15.36-pi.37`.

Repeat the tree comparison with `gh api repos/cursor/plugins/git/trees/<revision> --jq '.tree[] | select(.path == "pstack" or .path == "cursor-team-kit") | [.path,.sha] | @tsv'`.

## Workflow

1. Compare current source and dependencies with the existing inventory. Record unresolved references and drift before adapting behavior.
2. Run existing deterministic checks and probe the paired live-model and platform prerequisites. Preserve unavailable checks as unverified.
3. For each demonstrated gap, capture a failing behavioral check, make a focused correction, and rerun the check. Do not weaken source obligations.
4. Test the packed distributable in isolated profiles and execute paired and platform gates where access exists. Independently review the evidence and report all remaining gaps.

The existing baseline and limitations are in `parity/status-2026-11-07.md`, `parity/corpus-2026-11-07/report.md`, and `parity/pi-native-parity-2026-11-09/usage-blocked.md`. They are historical evidence, not proof for the new Pi release or every required workflow.

## Current observations

- Package typecheck and generated-helper freshness checks passed locally on 2026-11-10. The package regression suite passed 988 tests; 25 were skipped across 79 files. The package's development dependencies resolve Pi APIs at 1.5.0, not the installed CLI's 1.5.2. This is a macOS source-tree run, not proof of Pi 1.5.2 compatibility, installed-package behavior, or cross-platform parity.
- Direct Cursor CLI probes of `gpt-5.6-sol-medium` and `claude-sonnet-5-5-high` failed with weekly-usage errors. This does not establish that other models or paired tests are impossible.
- The initial Docker probe found its configured OrbStack socket unavailable. Starting OrbStack succeeded and Docker reports server 29.8.2. A clean Linux arm64 container installed the packed package with Pi 1.5.2; RPC returned 88 commands and assertions found `mode` and `poteto-mode` (`evidence/661211.txt`, `evidence/linux-arm64-rpc.json`). This does not verify their full behavior or the platform matrix.
- Source inspection indicates that the s390x read-only sandbox denies `socketcall(SYS_SOCKET)` for every domain because classic BPF cannot inspect its pointer arguments (`extensions/pi-pstack/src/linux-readonly-sandbox.ts`). Allowing that syscall without another enforcement mechanism would also allow Unix sockets. This run had not yet executed an s390x test (superseded: see the s390x broker update); a replacement remains unproven.
- Full parity remains **INCONCLUSIVE**. Existing unverified live integrations and platform cells remain open.

## Restart queue

1. Save reproducible upstream tree comparison and typecheck receipts; enumerate skipped tests.
2. Recheck Pi 1.5.2 public APIs against `extensions/pi-pstack/docs/native-gaps.md` and run relevant checks against 1.5.2 dependencies.
3. Run the existing s390x QEMU harness at `parity/evidence/linux-readonly-arches-2026-11-07/` and investigate a secure portable network solution without weakening the sandbox.
4. Probe available matched models and author the missing paired corpus scenarios, preserving unavailable live runs as unverified.
5. Refresh dependency closure, requirement statuses, and the platform matrix. Test the packed package across remaining supported environments and integrations.

The run stopped after preliminary checks; no runtime implementation changes were made. An independent trail review also noted that the two initial in-progress log rows were written after their commands had completed; later rows record their results.

## Update: datagram socketpair bypass (Stage 1)

- Verified on a real arm64 kernel with bubblewrap, against the unmodified shipped module: a datagram `socketpair` could `sendto` and `connect` to host pathname and abstract Unix sockets (`evidence/interrogate/run1.mjs`).
- Fix: `extensions/pi-pstack/src/linux-readonly-sandbox.ts` now refuses `socketpair(AF_UNIX, type)` unless `type & 0xf` is `SOCK_STREAM`, for the direct syscall on all five architectures. `socketcall(SYS_SOCKETPAIR)` is still allowed on arm, ppc64 and s390x, so the fix is complete only on x64 and arm64 (superseded: the s390x broker and the arm and ppc64 refusal came later). `test/linux-readonly-seccomp.test.ts` covers DGRAM, DGRAM with flags, RAW, SEQPACKET, a high-bit domain, STREAM, and AF_INET. It failed on all five before the change and passes after.
- Real kernel after the fix: the datagram pair fails with EPERM and the host log is never created. Node child pipes (`stdout` still a `Socket`) and loopback TCP still work (`evidence/interrogate/pipes.mjs`).
- Package typecheck is clean. The full suite shows the same 20 `cloud-machine.e2e` failures with and without this change; they need a LAN address and Docker setup.

Still open:

- s390x: `socketcall(SYS_SOCKETPAIR)` stays allowed, because refusing it measurably breaks Node child pipes and Python asyncio there. The bypass therefore remains on s390x through glibc. This is a security versus compatibility decision for you.
- s390x network parity is unchanged. It still needs a supervisor or equivalent, and a measured fallback to no network is not parity.
- The x64, armv7, and ppc64le real-kernel runs, and the s390x QEMU rerun, have not been done for this change.
- The startup check does not detect a bubblewrap that ignores the filter, and one transient failure disables the sandbox for the process.
- Loopback TCP can reach host services. The shell is not a security boundary against them.

- Interrogation reruns: `socketcall(SYS_SOCKETPAIR)` bypass reproduced at filter level for arm, ppc64, s390x and on a real s390x kernel; a reviewer also reproduced it on ppc64le. Inherited descriptors and `SCM_RIGHTS` can reach host sockets if a caller leaks or passes one (not rerun here). See `s390x-synthesis.md`.

## Update: socketcall socketpair on arm and ppc64

- Failing test first: `test/linux-readonly-seccomp.test.ts` expected `socketcall(SYS_SOCKETPAIR)` to return EPERM on arm and ppc64 and got ALLOW (`2147418112` instead of `327681`). s390x stays ALLOW in the test, named as open until the broker.
- Fix: arm and ppc64 refuse `socketcall(8)`. The filter now continues to the next rule when a syscall matches but its value does not, so two rules can name `socketcall`. Previously the second was unreachable.
- After: seccomp tests green, typecheck clean, differential check over all five architectures shows 0 mismatches, and the arm64 kernel run still passes Node pipes, loopback TCP, and the closed datagram bypass.
- Measured by a reviewer on real ppc64le and armv7 kernels (QEMU): stock check 12/12 and 13/13, Node fork IPC and spawn pipes, Python asyncio and multiprocessing, git, and loopback curl all work with `socketcall(8)` refused. glibc on ppc64le uses the direct `socketpair` syscall, shown by a QEMU strace. Logs: `evidence/interrogate3/`. Not run by me directly.
- Default chosen without your answer: refuse on arm and ppc64, leave s390x for the broker. Easy to revert.

- Third interrogation: no new findings beyond the known s390x `socketcall` gap. A reference-model fuzz of all five filters over 16.6 million cases found 0 mismatches. Not run: musl or Alpine, Go and static binaries, x64 real kernel.

## Corrections from the third interrogation

- armv7 EABI has no `socketcall`: on real armv7 and armv7-on-arm64 kernels `syscall(102, 8, ...)` returns `ENOSYS`, so the arm `socketcall(SYS_SOCKETPAIR)` rule is a filter-level guard for OABI compat, not a demonstrated bypass. The bypass through `socketcall(8)` is demonstrated on ppc64le (`ok` before, `EPERM` after) and s390x.
- The earlier line saying no real arm or ppc64le kernel had run is stale. armv7, armv7-on-arm64 and ppc64le kernels ran with the new filter, and Node, Python asyncio, git and loopback TCP worked.
- SEQPACKET `AF_UNIX` pairs are refused. On the old filter a SEQPACKET pair did not reach a host socket on arm64, so this is stricter than needed. It is kept on purpose: its safety depends on kernel behavior not verified across versions, and nothing measured needs it. Reconsider if a real program fails.
- Mutation checks (23 variants, reported by a reviewer, no artifact saved) all failed the seccomp tests except widening the type mask to 0xff, which is behaviorally equivalent because the kernel rejects type bits 4 to 7.
- Not run: the x32 guard on a real kernel, `SCM_RIGHTS`, armeb, 31-bit s390, and 32-bit ppc. Superseded since: the x64 kernel is covered by the CI runner, descriptor leaks by unit 1, and musl and Go on arm64 by `evidence/refactor-and-musl/`.

## Update: quality refactor of the filter builder

Applied the strict code-quality audit. `refusedWhen` now groups first-argument values per syscall, which removed the per-rule syscall reload and the `SOCKETCALL_SOCKETPAIR` constant. Jump offsets come from labels instead of hand-counted indices, so adding a rule no longer means recounting. The policy comment now says why `socketcall(SYS_SOCKETPAIR)` is refused on arm and ppc64 and left open on s390x. A duplicate test was removed.

- Behavior unchanged: the pre-refactor and new filters were compared over 225,504 cases per architecture with 0 decision differences. Programs shrank from 18, 18, 27, 26, 22 to 17, 17, 22, 21, 20 instructions (x64, arm64, arm, ppc64, s390x).
- Checks: typecheck clean, biome applied to the two files, the five related test files pass (41 passed, 6 skipped), and the arm64 kernel run still passes Node pipes and loopback TCP with the datagram pair refused.
- Not rerun after the refactor: the s390x, ppc64le and armv7 kernel runs. The differential covers the decisions, but the new byte layout was loaded by a real kernel only on arm64.
- File length went from 169 to 217 lines, so the assembler is larger than the audit's estimate. It is still well under any size limit.

## Update: inherited descriptors (unit 1 of `open-items-plan.md`)

- Failing before: with a datagram socket left open as descriptor 11, the sandboxed process sent on it and the host service received `LEAK` (`test/linux-readonly-sandbox.test.ts`, run on a Linux kernel against the committed source).
- Fix: `linuxReadonlyCommand` closes every descriptor above 3 before `exec bwrap`, keeping the filter on fd 3. It relies on bash, which is how Pi runs the command.
- After: the same test passes on Linux, the datagram socketpair is still refused, and Node child pipes and loopback TCP still work.
- Not covered: a descriptor received over an allowed stream socket with `SCM_RIGHTS`. That needs the sandboxed command to cooperate with a peer that already holds a host socket, which the shell does not hand it. Still open as a documented limit.
- The test skips on macOS and when `python3` is missing. It was run in a Linux container, not on a developer Linux host.

## Update: s390x socket broker (unit 4)

- Built `native/netbroker.c` (about 150 lines, static, `-Werror` clean) and `dist/netbroker-s390x` (41,448 bytes, sha256 `dee421f0...`). Two builds with Zig 0.17.1 are byte-identical. `node scripts/build-netbroker.mjs --check` compares the bytes.
- The three defects from the candidate's scratch code are fixed: the parent-pid check no longer assumes pid 1, the filter-size error no longer reports a stale `errno`, and a failed second descriptor install no longer pretends to be atomic.
- `seccompFilter(arch, brokered)` sends the s390x `socketcall` creation calls to the listener. The broker policy string comes from the same constants. `linuxReadonlyCommand` launches the broker, bubblewrap, then the command. The sandbox verifies the whole chain with the helper's self-test and falls back to the filter alone when it fails. `linuxReadonlyProfile()` reports which one is active.
- Real s390x 6.12 kernel under QEMU, production TypeScript and the committed binary (`evidence/s390x-broker/vm3.log`): glibc TCP to the host loopback works, glibc AF_UNIX sockets and datagram or seqpacket socketpairs are refused while stream pairs work, Python asyncio, Node child pipes, fork IPC, `fetch` and the stdout `Socket` work, writes stay refused, 20,000 argument-flip races each for `socket` and `socketpair` produced no escape, abort leaves no broker, bwrap or command behind, and the host Unix datagram service received nothing. With the binary removed the profile is `degraded` and commands still run.
- x64: the new descriptor test ran and passed on the CI x64 runner, so the filter and the closing prefix are verified on a real x64 kernel.

Still open or not measured:

- The broker ran on one kernel (Debian 6.12.115). Not run: RHEL, SLES or Ubuntu s390x kernels, SELinux or AppArmor policies, `ptrace_scope` 2 or 3 (the sandbox is designed to degrade, but that path was only tested by removing the binary), and per-call overhead on native hardware.
- Stacking with a setuid bubblewrap was not tested.
- The stream-socket `SCM_RIGHTS` path and the Cursor parity comparison are unchanged.

## Gap: the broker has no independent review

An independent adversarial review of `native/netbroker.c` and the brokered sandbox mode was started and did not run: the review request was stopped by a cyber-content safeguard before any work began. The broker's evidence is the author's own real-kernel run (`evidence/s390x-broker/vm3.log`), the candidate's earlier prototype run, and the CI runs. Treat the broker as unreviewed security-sensitive native code until an independent reviewer has tried to break it. A reviewer with cyber-verification access, or a human reviewer, can start from `evidence/s390x-broker/README.md`.

## Update: packaging and fallback review

A review of how the helper ships found three problems in the failure path. Each was reproduced by a rerun before any change.

- An unreadable helper or a full temp directory made `copyFileSync` throw, and the cached error left the read-only shell dead for the rest of the process. `stagedBroker` now falls back to the filter alone. After the change both cases report `degraded` and run the command (unreadable helper as `nobody`, and a 16 KB tmpfs temp directory).
- Every process left its temp directory behind, now holding a 41 KB helper copy. The directory is removed at process exit.
- A stale `check:netbroker` printed `Stale...` and then `Checked...`. It now exits non-zero without the success line.
- Still open: nothing in CI or `prepack` runs `check:netbroker`, because it needs Zig 0.17.1. The committed binary's reproducibility is verified only when someone runs the check.
- Held up: the committed binary matches a rebuild (sha256 `dee421f0...`), `npm pack` includes it at mode 755 and the mode survives a `umask 077` install, the default filters for every other architecture are byte-identical to before, and a noexec temp directory, a failing self-test, and a hanging helper all degrade.

## Update: claims review

A review of every claim against its evidence found these. Each was checked before changing anything.

- README said the shell never falls back to permitting Unix sockets. That is false on s390x when the broker cannot run, because the filter alone allows a glibc datagram pair through `socketcall`. The README now states the exception, and the PR's "Not fixed" list names it.
- The synthesis described a fallback that refuses address-taking calls. The code uses the filter alone. The synthesis now says so.
- Saved now: the 225,504-case comparison of the pre-refactor and current filters with its instruction counts (`evidence/refactor-and-musl/differential.ts`, `differential.txt`, `pre-refactor-filter.ts`), and the musl and static Go run (`musl-probe.mjs`, `go/main.go`, `musl-go-run.txt`, on Alpine arm64 with bubblewrap 0.12.0). Previously they were numbers without a receipt.
- Not saved: the 23 mutation variants and the ppc64le "before" run, which rest on a reviewer's report.
- `ptrace_scope`: the committed binary was run on the s390x 6.12 kernel at scope 2 and 3 (`evidence/s390x-broker/vm4.log`). At scope 2 the profile is `brokered` and every probe passes. At scope 3 the self-test fails and the profile is `degraded`, and commands still run. The log records the helper's sha256 (`dee421f0...`), which matches the committed binary.
- Still not checked here: kernels other than Debian 6.12.115, and the 988-test macOS figure from before these changes.
