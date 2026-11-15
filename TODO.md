# Publish the v2 extensions

## Bug fix

- [x] Reproduce it yourself on the matching surface via the control skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
- [x] Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with a trace of the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with `tmux_run` watchers and heartbeats that `wake` you. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
- [x] Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a worker (`pi_spawn`) using your configured bug-fix model with a specific scope.
- [x] Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
- [ ] Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
- [x] Run **Opening a PR**.

## Throughput checkpoint

- [x] **Blocking first steps.** Reproduce release detection and inspect package metadata, registry state, and release history before changing publishing eligibility.
- [x] **Independent workstreams.** Partition the read-only audit into package artifacts and registry/workflow identity. One owner writes the fix after aggregation.
- [x] **Shared mutable state.** Audit workers use isolated worktrees. Only the implementation owner changes release files.
- [x] **Smallest safe decomposition.** One implementation owner keeps the three package manifests and any release documentation consistent.

## Investigation swarm

- [x] Frame
- [x] Fan out
- [x] Aggregate
- [x] Report

The audit must identify every reproducible blocker for the three v2 OAuth packages without publishing or exposing credentials. Each slice returns PASS, ISSUES, or BLOCKED with evidence.

## Audit result

Both audit slices found the private-manifest skip at base c7709085c3edddc1270a39130fa2ec4755a5d568. Audit branches swarm/v2-release-audit-1 and swarm/v2-release-audit-2 contain no changes. Parent checked PR 220 and corrected the artifact worker's claim that the private flag had no stated intent. PR 220 explicitly deferred release. The actual pack lists and workflow log confirm the mechanism.

The data shape remains the existing package manifest. No provider logic or function boundaries need to change. Add public access and repository metadata for the existing publication paths. Give SpaceX the same runtime-only package contract as the other extensions.

The public registry returns 404 for all three v2 names. NPM_TOKEN exists, but its permissions are unverified. Actual npm publication is an irreversible external write and remains gated on operator approval after local verification.

## Verification and review

- The unchanged release detector omitted all three v2 directories before the fix and selected exactly those three afterward. Artifacts are in .audit/v2-release/.
- All three package typechecks and all 270 tests pass before and after the metadata fix. Frozen-lockfile install, check:toolchain, targeted Biome, and diff whitespace checks pass.
- Packed all three real npm tarballs, installed them offline without development dependencies, and loaded all four providers through Pi 1.5.2 from the installed tarballs. No tests, fixtures, or developer scripts shipped. All four CLI runs had empty stderr.
- Independent review found no actionable release defect. Dismissed the suggestion to add temporary unpublished status to long-lived docs because the initial-release procedure already names all three packages. Existing Unreleased changelog sections are optional release-note cleanup, not a publication blocker, and remain untouched.
- no-comments review found no comments to delete, no suppressions, and no required encodings. Deslop review found no new abstraction, casts, defensive code, or application comments because no provider code changed.
- Failing-test-first history skip: this metadata-only fault was reproduced with an integration check of the unchanged workflow detector. The fix is verified by actual packed npm installation and Pi loading, not a new hardcoded private-flag unit test.
- Forge selection is gh. The origin executable is unavailable, so the PR uses GitHub CLI.

Step 5 skip: the failing repro is a release-workflow integration check and tarball-install verification, not a cheap unit-test change. Baseline and passing outputs are saved locally instead of adding a deliberately failing metadata-only test commit.

PR https://github.com/just-joshn/pi-customizations/pull/230 is open and ready on fix/publish-v2-extensions at b0c47047131730546f76a70ba1b12f3cecf3a405. No merge or publication was attempted. Npm token permissions remain unverified. Operator approval is required before the merge that starts irreversible first publication.
