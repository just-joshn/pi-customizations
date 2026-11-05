# Full pstack behavioral parity

## Goal and verdict rule

Make pi-pstack reproduce the actual Cursor pstack behavior through Pi-native mechanisms. The operator prohibits other LLM agents. Deterministic test processes are permitted. One mistaken CLI probe breached that restriction, as recorded below.

VERIFIED requires every discovered requirement to have a reference contract, a working native implementation, and observable verification. Unknown behavior and missing access do not count as passes. Existing parity reports and tests are investigation leads only.

## Reference selection

The installed Cursor cache is pstack 0.15.36 at cursor/plugins revision ae5650febf4320793844c12c4adaa937f417f8da. The local source checkout at /Users/josh-desktop/src/experiments/plugins is older, e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a, and contains pstack 0.15.9. It is not the target.

Upstream HEAD observed during this run is bb68f2365eceafa0cb2d253112f675acf5f144cc. The GitHub comparison reports 14 subsequent commits and no changed pstack or cursor-team-kit files. The upstream archive SHA-256 is 851e9bff58322f9b470ace1e8ddedfe633505fcbea9df9b7c62225b8950f7b20. These facts do not independently prove runtime parity.

The reference archive and comparison are in .audit/pstack-full-parity-2026-11-04/reference/. The baseline is fixed for this run. Further source changes require an explicit recorded decision.

The installed Cursor CLI is 2026.10.22-27dcf5f. The cursor launcher reports no Cursor IDE installation. Pi is 1.5.0. Node is v24.13.1. Bun is 1.4.4. The repository starts clean at 0ab0b0c97699fafa31e462aecf8f3a5fdf3154ab. pi-pstack is 0.15.36-pi.14.

## Workflow

1. Pin source and runtime identities. Independently enumerate files, declarations, instruction references, executable entry points, and host dependencies.
2. Reconstruct reference contracts and inspect actual Pi APIs. Separate authored instructions, host enforcement, observations, and inaccessible services.
3. Reproduce a concrete mismatch before editing it. Compare distinct native designs locally. Implement a cohesive unit, then exercise its public entry point before advancing.
4. Run the final applicable gates. Perform separate verify, confirm, and fact-check reviews. Record residual implementation gaps, runtime limitations, missing access, and unverified behavior.

## Throughput checkpoint

Initial discovery found 602 packaged reference files and 41 pi-pstack runtime modules with 7,674 lines. Resource counts are not behavioral coverage. High-risk unknowns include subprocess ownership across session changes, cancellation, persistence, and hosted dependencies. Deterministic traversal will retain file hashes and evidence pointers so unchanged files do not need repeated inspection. The rigor is high because tools execute commands and schedule later work.

## Autonomy and boundaries

Reversible repository edits proceed without approval. No deployment, force push, user-data deletion, external message, or merge is authorized by this run. Design alternatives and reviews run serially in this conversation because the operator prohibits additional agents. Multi-model skill steps cannot supply independent review under that restriction. The final report must state that limitation.

## Process-constraint breach

The command `cursor agent status` was intended as a status probe. Cursor treated `status` as a prompt and launched another LLM. Its response was not requested as a task delegation and is excluded from reference evidence, implementation decisions, and reviews. The operator was informed immediately after this was recognized. No further Cursor prompt invocation is permitted in this run. This run cannot be represented as compliant with the work-alone constraint.

## Shell-monitor contract and design

The actual Cursor local-exec factory is 9209baa549d98f4780aea681d99427808525faee764d3c847ecaaa20c6392ba7. Its output observer scans streamed text with a 1,024-character carryover and 65,536-character processing slices. It counts every new match, immediately sends the first occurrence, batches later matches from the second occurrence, flushes on completion, and announces its default 100-occurrence limit. It limits titles to 500 characters plus an ellipsis and omits matched text longer than 5,000 characters. Cursor's shipped license identifies re2js 1.2.2. The registry archive SHA-256 is a99650dbb6d8cbd77d5954bc76f9706eb0e4b4bb942c8ccb0cfba8006b607cc6.

The data shape is one bounded monitor per shell, with a lifecycle, monotonically increasing occurrence and notification totals, optional pending batch, and one batch timer. Process ownership remains in the existing shell-job registry. The Pi alternatives were a larger inline shell registry and a separate monitor module. The separate module owns the regex and batching invariants without coupling them to process/file lifecycle. It replaces the existing line-buffer and timer functions rather than layering on top of them. This serial design comparison replaces agent-based exploration under the operator's explicit restriction.

The original Cursor observer, extracted with factory-hash checks, runs in isolation with the identified regex dependency to produce test fixtures. That is stronger than expectations invented from Pi code but is not evidence of an end-to-end Cursor workflow. Three new actual-Pi regressions fail against the unmodified shell runtime. They cover progress before a newline or process exit, multiple matches in one chunk, and the notification limit. The failure transcript is .audit/pstack-full-parity-2026-11-04/shell-regression-baseline.txt.

## Handoff state

The shell-monitor unit has 22 stable behavior IDs from original-component execution. The final actual-installed-Pi shell and package suites pass all 18 cases. The complete pi-pstack suite passes 731 cases and skips five. The separate seeded comparison matches 256 cases at 3,438 checkpoints.

The default Node 24.13.1 root gate fails because pi-rea needs the newer SQLite limits API. The full root gate passes with Node 26.13.0 selected only for that command. No global runtime or unrelated package code changed. Source, dependency, and Pi API identity checks pass. The three review passes are in verify.md, confirm.md, and fact-check.md.

The whole-plugin verdict remains NOT VERIFIED. At the initial handoff, the work was uncommitted and no PR was open. The later PR preparation packages the shell-monitor fixes and audit without changing that verdict.

## Current open evidence

The Cursor desktop implementation is unavailable locally. Existing Linux desktop extracts are historical, not observations on this host. Cursor-hosted cloud VMs, hosted automation triggers, account-dependent capabilities, and server-side model behavior need separate access and evidence. No equivalence claim is made for local worktrees versus remote VMs.
