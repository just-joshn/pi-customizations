# AGENTS compliance audit

## Scope and decisions

This audit started at commit `e3f6ea716cfbb49c122c60dd9e1c944861dda60c` and covered the maintained extension, Python tools, tests, and first-party documentation. Preserved upstream resources received inventory, parity, and selected semantic checks, not an exhaustive semantic certification.

The operator approved these interpretations without changing the root `AGENTS.md`:

- Preserve immutable upstream sources and generated copies. Report their violations rather than edit them.
- Permit private, single-owner bookkeeping and local accumulators. Keep caller inputs and published records independent of mutable internal state.
- Treat unexplained operational values as hardcoded values. Named constants, protocol values, and fixtures are not blanket violations.
- Report historical test-first development as unverifiable.

Two designs and an independent comparison favored targeted repairs. Custom persistent collections, a worker event journal, and a selector-loop rewrite were rejected as unnecessary machinery.

## Changes

Doctor validates managed npm paths, reports partial inspections, preserves readable evidence through filesystem failures, and excludes raw version-command stderr from diagnostics.

The evidence tools distinguish completed output capture from input delivery. Unexpected I/O failures cannot produce successful completeness claims. Seed copies use their validated resolved destinations. Replay validates identities, assertions, and observations before accepting evidence and reads only newly appended log records. Differential execution validates every numeric option occurrence before launching cases.

The extension publishes independent task and todo snapshots. Context results contain bounded metadata instead of recursively embedded session entries. Worker cleanup preserves failures without skipping independent disposal, handles startup and restoration races, and avoids duplicate usage claims. RPC verification rejects extension errors and malformed shutdown output.

Independent reviews found additional defects in the initial fixes. Corrections received focused regressions and follow-up review before integration. The final different-model-family audit reviewed the decision trail rather than redoing implementation.

## Verification

Run `make verify` from the repository root. It checks generated-resource parity, TypeScript types, extension tests and coverage, packaged CLI behavior, preserved helpers, Python tests, and the maintained Python coverage denominator.

The pre-commit run passed 113 extension tests and 134 Python tests. Extension coverage was 90.90% for lines and statements, 86.48% for branches, and 94.32% for functions. Maintained Python coverage was 95% across all four production scripts. These are aggregate measurements, not per-file guarantees or coverage of every shipped upstream helper.

All 134 Python tests also passed on Python 3.10. The host was macOS. Linux execution remains unverified. Gitleaks found no secrets in tracked files and new source/test files. npm reported no dependency advisories. Neither scanner result proves the absence of every security issue.

Relevant regressions include:

- `skills/doctor/tests/test_boundaries.py` and `test_review_regressions.py`.
- `skills/reverse-engineer-cli/tests/test_capture.py`, `test_lifecycle.py`, and `test_tools.py`.
- `skills/implement-cli-from-contract/tests/test_outcomes.py`.
- `extensions/pi-pstack/test/context-review.test.ts`, `worker-review.test.ts`, `worker-errors.test.ts`, `state-snapshots.test.ts`, and `rpc-process.test.ts`.

The original capture defect reproduced against the baseline before root source integration. Two fixture-cleanup regressions were added after their initial edits. That test-first sequencing deviation remains disclosed rather than retroactively claimed compliant.

## Compatibility changes

- Equal or ancestor/descendant seed destinations are rejected, including formerly valid merges. Combine fixtures beforehand or use disjoint destinations.
- Seed paths retain their initially validated resolved destinations rather than traversal semantics changed by an earlier copied symlink.
- Assertions and manually authored observations require canonical signal names. Signal-delivery options still accept supported aliases.
- New observations omit the unsupported `descendants_killed` claim. Existing records remain readable.
- Existing evidence workspaces retain their copied helpers until deliberately updated. New workspaces receive the corrected standalone scripts.
- Context entry details contain bounded metadata and transcript pointers. History discovery reports unknown completeness separately from budget omissions because the SDK may skip unreadable sessions.

## Remaining findings

Project-wide zero violations was not established. First-party agent-facing prose still contains unsafe shared-process cleanup, predictable temporary resources, unchecked screenshot names, REPL races, and incomplete failure handling. Affected documents include `skills/run/examples/`, `skills/doctor/references/checks.md`, and `skills/simplify/SKILL.md`.

The required `create-skill` workflow is unavailable in this host. The operator explicitly chose to retain that gate and deliver verified code changes with prose remediation blocked. The existing upstream size, mutation, renderer, workflow, and coverage exceptions also remain. `AGENTS.md`, upstream snapshots, generated skills, and generated prompts are unchanged.

Raw logs, exploratory designs, temporary worktree locations, and the detailed local decision trail remain working artifacts rather than package contents. The maintained tests are the reproducible verification artifacts.
