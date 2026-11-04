# Pstack behavior reconstruction

## Goal and completion condition

Understand Cursor pstack and the behavior its dependencies supply, then make pi-pstack provide those behaviors through native Pi mechanisms.

A behavior is complete only when its upstream evidence, Pi owner, observable result, and verification evidence are recorded. A passing existing test is not evidence that the behavior inventory is complete. Unobserved remote behavior stays inconclusive.

The reference is the locally installed and checked-out pstack 0.15.36, team-kit 1.2.0, Cursor CLI 2026.10.22-27dcf5f, and Cursor desktop 3.27.22. The starting Pi checkout is c6a73af5. Source hashes are captured by the discovery script. No subagents are used, including during design and review.

## Workflow

1. Discover every authored plugin file, dependency declaration, host-tool use, executable script, and external integration. Capture versions and source hashes before changing code.
2. Reconstruct the skills, playbooks, agent definitions, setup, automation pack, and executable helpers. Compare each adaptation with its reference rather than trusting earlier reports.
3. Reconstruct Cursor host contracts from shipped implementations and direct probes. Trace each native Pi implementation through validation, lifecycle, persistence, cancellation, and recovery.
4. Record mismatches before fixing them. For each coherent change, reproduce the mismatch, choose the smallest native implementation, and verify its observable behavior before proceeding.
5. Exercise actual Pi CLI and RPC journeys, run the affected suites and type checks, inspect the package, and audit the evidence against the transcript.
6. Report verified behavior separately from residual gaps. Do not describe an incomplete reconstruction as 100 percent parity.

## Throughput checkpoint

The first inventory found 58 pstack skill directories, 18 team-kit skills, 613 files across pstack, team-kit, and cursor-sdk, and 6,607 lines in Pi host modules. Binary assets and test corpora are not equivalent to behavioral units. The investigation follows import and instruction edges rather than rereading identical assets or launching one agent per file. A deterministic inventory and difference report makes source drift review repeatable. Existing parity artifacts are leads, not current evidence.

## Rigor and tradeoffs

High rigor is warranted because task execution, read-only enforcement, timers, and webhooks can modify files or act after the initiating turn. Baseline evidence precedes fixes. Local source, direct runtime observations, and inference are recorded separately. Remote services, authentication, OS support, and unavailable model features must not be silently normalized away.

Design alternatives are considered serially because the user prohibited subagents. Reversible local changes proceed without approval. No deployment, destructive cleanup, force push, or merge is part of this task.

## Verification checkpoint

`make-verify-handoff.txt` records the last full repository pass before the Unix-socket audit. pi-pstack passed 677 tests in 45 files. Its coverage was 77.22 percent statements, 69.83 percent branches, 76.83 percent functions, and 80.87 percent lines. Other package totals were 1,949 maintainer tests, 1,510 rea tests with one skipped, 393 Anthropic OAuth tests, 349 Antigravity OAuth tests, and 131 xAI OAuth tests. `make-verify-handoff-formatting.txt` preserves the preceding failure on audit JSON formatting. That failure was corrected before the successful rerun.

The later readonly audit reproduced a host-socket escape through an actual Pi child. A disposable host service changed a file on the child's request. A fake Slack token was also visible in the child. `readonly-boundary-baseline.txt` records both observations. The stricter sandbox probe fails while writing `/proc/self/setgroups` on this Linux host. Applying an existing per-process AppArmor profile did not resolve that refusal. Those failed probes are retained. The host's global security settings were not changed.

The subsequent safety change keeps Unix sockets blocked and refuses a missing seccomp helper. Restricted shell commands do not run on this host. The final reconstruction run before PR preparation, `make-verify-status-and-readonly.txt`, exits at pi-pstack's coverage suite with 680 passing tests and five failing positive shell checks in 46 files. The fresh `pr-make-verify.txt` run repeats that outcome. `pr-preparation.md` records the branch, commit grouping, focused checks, and publication review. The preceding `make-verify-readonly-strict.txt` attempt is retained with its 675 passing tests and five failures. The typecheck and preceding repository checks pass. The earlier green repository receipt does not cover this change. Benny's credential requirements must fail closed rather than treating readonly tool restrictions as credential isolation. `review-checkpoint.md` records bounded review coverage and remaining workflow and schema discrepancies.
