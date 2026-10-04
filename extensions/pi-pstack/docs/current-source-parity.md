# Current-source parity audit

## Authority and completion rule

The authority for this run is `/Users/josh-desktop/src/experiments/plugins/pstack` at `e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a`, version 0.15.9. The package previously pinned `9511e60321f7e533a187d62854a3d53a53752874`, version 0.15.7. Two upstream commits change six files across that range.

Complete Pi-native parity requires coverage of the current source, faithful delivered instructions, and verified native replacements for required host behavior. Source equality alone does not establish behavioral parity. Historical reconstructions and earlier accepted exclusions do not define the requirements for this run.

The workflow uses high rigor because persona instructions, package discovery, and host adaptation affect every downstream workflow. The implementation remains small because the upstream update is primarily instructional. This run does not add a second agent loop, scheduler, resource loader, or session authority.

## Designed workflow

1. Pin the actual authoritative tree and capture the existing source and runtime gates.
2. Add failing tests for the delivered 0.15.9 contracts, refresh normalized sources, and regenerate native resources.
3. Audit the entire current source, including agents, dormant automations, guides, helpers, and metadata.
4. Correct native adapters that contradict the authoritative instructions. Verify each correction before proceeding.
5. Run full extension coverage, helper tests, type checking, strict lint, native-first checks, and installed Pi CLI, RPC, and TUI journeys.
6. Review the final diff and decision trail independently. Keep unresolved contracts visible and do not mark the goal complete unless the completion rule passes.

One worker owns the source snapshot and generated resources. The parent owns source verification, persona composition, evidence reconciliation, and this report. Read-only auditors do not share writes. The initial source and policy gates precede implementation.

## Full-source delivery census

The current source contains 161 files. `docs/source-inventory.json` records their normalized bytes and hashes. `docs/resource-map.json` maps 125 source files to generated delivery. The other 36 files have these dispositions.

| Source group | Files | Native disposition | Existing verification |
| --- | --- | --- | --- |
| Workflow skills, references, playbooks, and helpers | 125 | Generated skills, prompt aliases, and supporting files. | `scripts/resources.mjs`, generator tests, `test/latest-content-parity.test.ts`. |
| Agent personas | 2 | `src/personas.ts` reads the preserved agent prompts. Poteto workers also receive the complete generated mode. | `test/personas.test.ts`, `test/skills-parity.test.ts`, `test/parity-runtime-agents.test.ts`. |
| Dormant Benny automation pack | 12 | Preserved pack plus the Pi setup, reviewed-routine, trigger, and control adapters. The source does not register these files as ordinary slash skills. | `test/benny-parity.test.ts`, `test/benny-parity-discovery.mjs`, `test/routine-relay.test.ts`. |
| Guide chapters and illustrations | 17 | Preserved upstream guide and adapted `docs/guide/` pages. | `test/parity-package-docs.test.ts`. |
| Package metadata, README, license, ignore rules, and logo | 5 | Preserved source plus native package manifest, README, license, and package image. | `test/parity-package-manifest.test.ts`, `scripts/check-latest-source.mjs`, installed package discovery. |

These dispositions account for files. They are not a claim that every model follows every instruction or that every external deployment works.

## Changes made

The perf-issue playbook now delivers the seven performance mantras in their authoritative order. It stops when an earlier mantra meets the target. Hillclimb borrows the ordering but not that stop rule. The benchmark checklist names the new mantras.

Architect now screens designs for contributors that reason from a limited set of opened files. Its design flags include split ownership, duplicate task paths, importable internals, and hand-synchronized lists. An older generator rule also inserted a forced arena rerun not present in the source. That rule is deleted. A regression requires the complete authoritative two-candidate paragraph and rejects the extra convergence policy.

The native Poteto persona previously prepended a resume policy that contradicted the source's fresh-worker default. That override and its unused text-removal field are deleted. Persona composition now preserves the complete authoritative agent and the native mode without an extra resume rule.

The source checker now supports `--current`. It rejects a pinned source that differs from the current pstack tree and rejects uncommitted authoritative pstack files. Unrelated commits elsewhere in the plugins repository remain valid. Existing pinned-release verification remains available without the flag.

The independent final transformation review also found a host banner that forced unconfigured roles to inherit the parent. The banner now retains skill defaults and the source fallback policy. Generic Task model omission still inherits the parent, as its native API requires. It does not infer a workflow role. The guide now includes all 24 principles and the source's Explain the Number description. Both regressions failed before correction. The subsequent scoped run passed 42 tests.

Version declarations, the lockfile, normalized snapshots, source hashes, and generated resource hashes now identify 0.15.9. Pi provenance identifies the installed and tested 1.0.2 host. Historical ledger citations are updated to actual files and test names without changing external-service verdicts.

## Reproduction

Run from `extensions/pi-pstack` after installing the repository's frozen Bun dependencies.

```sh
node scripts/check-latest-source.mjs /Users/josh-desktop/src/experiments/plugins --current
bun run check:resources
bun run test:coverage
bun run test:helpers
bun run typecheck
bun run check:native-first
bun run check:parity
bun run check:cli
bun run check:journeys
bun run check:progress-tui
```

Run `bun run ci`, `bun run check:agents`, and `bun run check:tests` from the repository root. The source checkout path is an explicit authority argument, not a portable prerequisite for ordinary package tests.

## Verification status

The seven source-check tests passed after the current-tree checks were added. A further regression for flag ordering failed before argument handling changed and passed afterward. Persona equality failed with the obsolete override and passed after deletion. The delivered-content tests cover all changed upstream contracts.

The installed Pi CLI verified package loading, command discovery, status, mode-off behavior, and orderly shutdown without model calls. The full CLI and RPC journey run passed 518 checks with zero findings. The TUI run verified status rendering, child shell-start progress, child read-finish progress, and completion with a deterministic provider.

The first broader test run reproduced two missing current-source checks and stale version assertions. Its isolated installed-CLI timeout did not recur in the narrow user-perspective run. The first coverage run exposed another assertion that expected the deleted resume prefix. That assertion now requires exact persona composition instead.

The pre-cleanup V8 coverage run passed 1,737 tests across 189 files. One pre-existing intentional test remains skipped. Aggregate coverage passed the existing 80% thresholds with 80.71% statements, 81.72% branches, 82.91% functions, and 83.43% lines. The separate helper run passed 399 tests with zero failures. Resource verification confirmed 190 preserved files and 211 generated resources. Type checking passed for both the extension and helper tests. Strict repository lint passed after formatting the new source tests and replacing a false-positive secret-shaped commit literal with a hash-shape assertion. The current-tree checker independently verifies the actual pinned revision against the authority.

The independent full-source audit accounted for all 161 current source files and confirmed the six-file update was delivered. It found two further portability defects and identified an adjacent terminology corruption. A cross-family trail review also distinguished source coverage from instruction fidelity and questioned an older architect policy addition that is not a Pi API adaptation. The completed transformation audit checked every generated adaptation against the sole source. The portability corrections are implemented and verified by 27 source and delivery tests plus 94 generated-parser tests. The architect policy-removal regression failed before deletion. After regeneration, 40 affected tests and the current-source comparison passed. The exhaustive transformation audit found 97 unique labels that change portable policy or helper behavior, 25 justified native adaptations, 13 equivalent clarifications, and four inconclusive native adapter contracts. These are baseline classifications, not a final parity verdict. The policy and helper cleanup is regenerated. The current map contains 43 pstack transformation labels. A fresh label gate finds no rejected baseline label remaining. This gate does not replace independent review of mixed-label content or native runtime behavior. Source-contract tests pass after regeneration. Two stale role-count and scratch-worktree expectations were corrected to the authoritative contracts.

A security review also found that both the authoritative and delivered log helpers emit a double-quoted formula unchanged. A fresh TSV parsing probe decoded the quoted evidence into a cell beginning with `=`. Spreadsheet execution was not tested. The source explicitly promises that attacker-controlled evidence must not become formula execution. The port now retains that guarantee with a minimal initial-double-quote guard. The executed parser regression in `test/helpers/log.test.ts` confirms apostrophe-prefixed cells after TSV parsing. The previous leading-whitespace hardening was not established as necessary and is removed. Leading whitespace retains the authoritative first-character behavior. The authoritative checkout remains unchanged. The Origin transformations that added `--push`, `--stack-on`, and lossy unresolved-thread filtering are removed. The delivered commands retain the source's ready status, base-branch chain, and complete evidence query. The parent subsequently verified the public Origin installer in isolated directories. Installed CLI help confirms the retained source commands support `--base`, `--status open`, and unfiltered thread queries. The malformed installer URL is fixed in [companion PR #58](https://github.com/just-joshn/pi-customizations/pull/58). The parent reviewed and integrated its focused patch, reproduced both failing regressions before the URL change, and verified all 16 host-skill tests afterward. Authentication and proprietary hosted operations remain unverified.

A real installed-Pi experiment also found background completion starvation during active goal continuations. The parent reproduced it independently. The extension held notices until `agent_settled`, which does not occur between successful goal continuations. The native repair now flushes held notices through Pi's public completed pre-settlement boundary. The parent independently reran real CLI shell and Task fixtures. Both received exactly one completion notice before goal completion and root settlement, with empty stderr. The no-goal control also passed. Abort, error, manual-consumption, late-arrival, and native queued-retry cases are covered by the SDK tests. Independent cross-family code review approved the fix without a confirmed regression. It separately notes synthetic provider-error branch coverage and a pre-existing one-boundary latency case. The routine adapter now preserves source-selected field names and requested Tailscale workflow scope. Its filesystem watcher invalidates the fallback queue for the existing receiver loop. The 38-test routine run verifies actual Pi wakes from accepted events and an isolated idle fallback, duplicate suppression, and disable cleanup. The acknowledgement mismatch is also corrected. HTTP 200 now requires a successful public started response, a matching native activity receipt, and a durable wake timestamp. Gated installed-Pi tests prove that acceptance alone is not acknowledged and that wake does not require model completion. Busy, duplicate, timeout, rejected, handled, disabled, and bounded-waiter cases also pass. The shared field schema now preserves bounded JSON member names rather than requiring JavaScript identifiers. Fieldless payloads and empty JSON member names are legal. Five field regressions failed before that change. The refreshed six-file routine run passes 59 tests and type checking. Independent maintained-code and security reviews found no confirmed new defect. The integrated final command gate passed 1,786 tests across 192 files with one intentional skip, 379 helper tests, 518 RPC journey checks, installed CLI loading, and deterministic TUI progress. V8 coverage passed the configured thresholds with 80.74% statements, 81.83% branches, 82.86% functions, and 83.46% lines. Source equality passed before and after the run. The final independent cross-family requirement audit returned PASS. It independently rechecked source authority, the 17 roles, both outside-generator corrections, native mechanism evidence, and the documented host/service/recovery conditions. Those conditions are not missing current-source requirements.

## Additional current-source findings

The authoritative watcher recognizes GitHub author `cursor` when a comment has automation or security-review markers. The lowercase branding normalization changed that real account identifier to `reference`. A direct parser check observed false classification and zero review passes for `cursor`, while the substituted account received true classification and one pass. The correction removes the watcher files from lowercase branding normalization. Executed parser regressions now verify one review pass for a marked `cursor` comment and negative classification for an unmarked comment and a lookalike account. Synthetic Git fixtures reject the corrupted `reference` account while preserving `endCursor` pagination.

The reflection synthesizer recommends putting path-shaped triggers in `paths:` metadata. Pi does not implement that skill field, and the generator removes it. The native recommendation now uses directory-scoped `AGENTS.md` for persistent context and imperative descriptions or `/skill:name` for on-demand skills. An exact-match generator rule performs this adaptation. The source snapshot remains unchanged, and tests verify both versions.

The same lowercase normalization changed `cursor location`, meaning the editor caret, into `reference location` in the why skill. The normalized source now preserves `cursor location`. Native delivery uses `available file context` through a narrowly scoped generator rule. Tests reject the corrupted `reference location` wording and do not imply unavailable editor context.

## Historical and external evidence

The historical clause ledger covers an older reconstruction, not the sole current source. Its seven external clauses concern live Slack, trackers, observability services, and proprietary marketplace behavior. Updating evidence citations does not turn those clauses into passes.

Pi package installation is the native counterpart to marketplace installation. Native remote workers, durable subscriptions, reviewed routines, and explicit recovery already exist. The current source audit found no requirement for automatic OS-reboot recovery. The source orchestration workflow describes explicit recovery after a host restart.

Benny's source keeps configuration and secrets outside the pack and requires a user-configured control adapter. Those credentials are operator-owned prerequisites, not omitted package capabilities. The source Babysit playbook says its public watcher is GitHub-specific and explicitly rejects adding an Origin implementation merely to run that playbook. The native command watcher and optional configured subscription preserve that boundary. None of these findings proves access to an unconfigured live service.

The native routine's secret and state restrictions currently require macOS `sandbox-exec`. Unsupported hosts fail closed. The runtime evidence here uses installed Pi 1.0.2 on macOS and does not claim cross-platform equivalence. An ambiguous crash requires receipt reconciliation rather than automatic replay. Retained event storage remains bounded without automatic rotation. These constraints are visible in the native adapter and the independent reviews.

The first integrated full run found a stale host-default assertion. The next run hit the bulk AST conformance check's five-second default deadline under coverage and subprocess load. The check passed in isolation. Its deadline is now scoped to that whole-tree check; global concurrency, isolation, and timeouts are unchanged. The subsequent full command run passed. Both failed attempts remain in the local audit directory.

The local evidence and decision trail are under `.audit/pstack-0.15.9/`. The trail records failed checks as well as successful corrections. The initial cross-family review is `trail-review-initial.txt`. Its requested exhaustive audit and corrections are complete. The final acceptance is `final-trail-review.txt`. A pre-existing vacuous reflection command fence remains a documented cosmetic observation, not a behavioral gap. Historical `docs/latest-parity.md` remains a record of the 0.15.7 run.
