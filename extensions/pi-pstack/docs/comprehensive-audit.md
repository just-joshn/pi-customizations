# Comprehensive project audit

This audit compares the entire tracked project with root `AGENTS.md`, current official pi documentation, and the three supplied reverse-engineering directories. It fixes confirmed defects in maintained code and preserves the explicit source and host conflicts approved by the user. It does not claim literal zero violations across preserved third-party code or 100% Reference behavior parity.

The baseline was `8cff868ca33e3c9e9acd668bf959e44cf45a4f59`, with 465 tracked files. The original extension suite passed 38 tests, with 93.31% statement and line coverage, 80% branch coverage, and 98% function coverage. That original denominator excluded executable Python helpers and extension maintenance scripts.

## Evidence and method

The audit partitions runtime, reference parity, and other project files. Each partition has an independent report under the repository's `.audit` directory. Confirmed behavior defects receive failing regressions before fixes. Structural refactors retain the existing behavioral suite. Tests exercise real pi resource loading, SDK sessions, deterministic provider requests, the packaged CLI over RPC, and subprocess entry points in temporary directories. Separate installed-CLI tests send actual RPC question responses and verify that cancellation never becomes approval.

The official pi repository's HEAD remained `2b0a123de98318c2ff8069661721ce0c3794c34e` when checked on 2026-09-26. The installed SDK is 0.87.1. Context7 searches for both official project names returned only third-party libraries. The audit used the [official extension documentation](https://github.com/earendil-works/pi/blob/2b0a123de98318c2ff8069661721ce0c3794c34e/packages/coding-agent/docs/extensions.md), exported declarations, implementation, skills documentation, package documentation, and session/package management source directly.

The local reference reports were read from these directories:

- `~/Documents/RE/pstack-re/re` supplies plugin and helper behavior.
- `~/Documents/RE/re-team-kit/re/REPORT.md` distinguishes plugin source intent from observed rule and model delivery.
- `~/Documents/RE/re-reference-agent/re/REPORT.md` and its model/source findings distinguish local Task, question, loop, goal, and synced-skill mechanisms from unknown server behavior.

## Fixed defects

| Defect | Correction and evidence |
| --- | --- |
| Differential case IDs could delete paths outside the output directory | Removed obsolete deletion. Validate the entire corpus before either CLI runs. Reject managed-option overrides and symlinked output artifacts. Process tests protect disposable victim directories and previous evidence. |
| Differential comparison could accept malformed or unusable evidence | Validate records and triage. Failed launch and incomplete capture return an error instead of a false MATCH. Test legacy valid records too. |
| Doctor settings could crash or falsely report success | Validate settings shapes, relative session paths, and day bounds. Anchor relative session directories to the requested workspace. |
| Doctor could return another workspace's prompt | Match validated session-header cwd and reconstruct only active ancestry. Test matching and foreign workspace logs. |
| Doctor skipped valid spaced JSON and crashed on malformed entries | Parse and validate records before counting. Test equivalent encodings, malformed data, and official tool deltas. |
| Doctor could recurse through symlink cycles | Prune already visited directory identities. Test an actual directory cycle. |
| Doctor estimated project package paths incorrectly | Resolve npm and Git packages within their settings scope, normalize supported remote forms, and reject unsafe managed paths. |
| Probe terminal dimensions failed after output creation or accepted invalid bounds | Validate unsigned terminal dimensions before filesystem effects. Test invalid values and both valid boundaries. |
| Questions accepted ambiguous IDs and display keys | Validate identifiers and rendered option uniqueness before opening dialogs. Preserve free-text cancellation semantics. |
| Sibling question tools could open overlapping dialogs | Register questions for sequential execution and test a real two-call pi batch. Mode and todo tools also declare sequential execution. |
| Restored todos could bypass uniqueness validation | Ignore invalid branch snapshots and retain the latest valid state. Test null, invalid shapes, invalid status, and duplicate IDs. |
| Large todo and question results could exceed the model-facing output limit | Share the existing 48,000-character bound, retain complete structured details, and include a transcript pointer. Two actual-SDK regressions fail before the fix and pass afterward. |
| CI watcher forced a selector stripped by the observed Reference plugin loader | Inherit the parent model unless explicitly overridden. Preserve the original persona source file. |
| Team-kit rules were injected despite their absence in observed Reference requests | Keep rules archived and omit runtime injection. Test actual parent and child requests. |
| Readonly tasks could not use extension-provided parent models | Copy only the selected provider registration into an isolated model runtime. Keep extension tools disabled. |
| Failed foreground tasks lost nested usage | Attach usage through pi's supported tool-result event return while retaining failed result status. Verify exactly-once accounting. |
| Unclaimed background usage disappeared on reload or resume | Persist validated pending usage on the owning branch. Retrieval appends a claimed record before returning usage. Test reload, repeated retrieval, and foreground/background resume. |
| Child extension deduplication repeatedly searched prior entries | Preserve first occurrence and input order with an immutable O(n log n) implementation. |
| Maintained functions exceeded the project size limits | Split runtime responsibilities and Python process operations into cohesive helpers. Add structural regression checks. |
| Maintenance scripts used prohibited console logging | Preserve stdout bytes through `process.stdout.write`. |
| Coverage omitted maintained scripts | Expand the extension denominator to maintenance scripts. Add Python branch and subprocess coverage with aliases for copied replay code. |

## Approved conflicts and applicability

The user explicitly chose "Preserve pi behavior; document conflicts" after being shown the conflict between the universal mutation prohibition, the official mutable pi API, and preserved upstream sources.

| Rule or requirement | Explicit treatment |
| --- | --- |
| Never mutate objects | Project business-state updates use new snapshots where practical. Pi's structured prompt event must mutate the shared options object. Its runner ignores immutable replacements. SDK sessions, process handles, browser state, worker lifecycle reservations, and scan-local streaming accumulators remain explicit mutable boundaries. Rebuilding the same lookup collection per item would trade these local mutations for quadratic work. |
| Sequential tools sharing mutable state | Dialogs and simple state tools are sequential. Worker control must support waiting and stopping or messaging the same child concurrently. Its lifecycle reservations and generation checks retain that behavior. The final runtime tests cover this case. |
| All source files below 800 lines and functions below 50 | Enforced for maintained implementation and tests. Exact upstream and generated helper copies remain source-preservation conflicts. `orch/store.ts` has 1,607 lines and `watch-pr/policy.ts` has 832 in each copy. |
| Source helper mutation and renderer behavior | Preserved source includes mutable algorithms, console output, and known renderer defects. The renderer accepts malformed arrays, has avoidable row searches, shifts line numbers after import filtering, mishandles a deleted double-hyphen comment, and counts a no-newline marker as context. These are retained source behaviors, not fixed defects. |
| No hardcoded values | Protocol names, source defaults, schemas, and intended UI text define the contract. Replacing these with speculative configuration would conflict with simplicity and parity. Operational output limits have names. |
| Every function must receive every invalid-input test category | Public input and persistence boundaries receive meaningful invalid-input tests. Internal typed functions, zero-argument callbacks, and fixed domain constants do not have meaningful null or wrong-type input categories. |
| TDD for preexisting code | New defects have recorded red/green regressions. No retrospective claim is made about how existing upstream code was originally written. |
| Security endpoint checklist | The project does not implement application HTTP endpoints, SQL persistence, browser authentication sessions, or CSRF-sensitive routes. Endpoint rate limiting, SQL parameterization, and CSRF checks have no corresponding implementation here. Filesystem boundaries, CLI inputs, HTML escaping, dependency vulnerabilities, and credential handling remain relevant. |

## Remaining parity limits

Exact source bytes do not prove identical model choices or UI behavior. Pi prompt aliases only expand in the positions supported by pi, and some aliases ask the model to read a skill. Reference's observed whitespace-delimited skill token discovery differs. No claim is made that an LLM always reads or follows those instructions.

Reference cloud execution, reviewed Automations editor flows, credential isolation, loop notifications and timers, active-goal continuation, synced skill distribution, built-in collector personas, external integrations, and provider entitlements remain unimplemented or environment-dependent. The supplied reference evidence documents some of these mechanisms. Their absence is an implementation limit, not proof that the mechanism is unknowable.

No paid model calls, live cloud deployments, external messages, or business-service writes were made. Review agents used the available GPT family. The requested cross-family review models were unavailable, so that diversity gate is not claimed.

## Reproduction

The checks require Node, Bun, and uv. Install the workspace dependencies first with `bun install` at the repository root. From the repository root, run `make verify`. It checks source and resource integrity, TypeScript, maintained-code structure, runtime/integration/package CLI tests, and both coverage gates. Python coverage includes all four maintained scripts and maps copied replay scripts back to their original implementation. The coverage configuration excludes no production lines.

The archived Bun helpers are verified in a temporary copy with their frozen lockfile. The original 52 tests cover 2,328 of 2,908 measured lines, or 80.06%. Six supplemental output tests raise that to 2,450 of 2,909 lines, or 84.22%, with 89.97% function coverage. This LCOV denominator contains seven imported files, including the test helper. It does not include unimported executable entry points. Bun's text file averages differ and are not the gate. A controlled 70% LCOV report was rejected, and cleanup ran on failure. The source remains unchanged. The source-preservation conflicts above remain visible regardless of test results.

## Final verification

`make verify` passed after all implementation changes on 2026-09-26:

| Check | Result |
| --- | --- |
| Source and resource integrity | 187 upstream files and 205 generated resources verified; archived sources and generated resources have no diff. |
| TypeScript | Passed against official pi SDK 0.87.1. |
| Extension unit, integration, package CLI, and RPC tests | 61 passed, zero failures. Includes real question response/cancellation, concurrent worker controls, and bounded results. |
| Extension coverage, including maintenance scripts | 92.50% lines/statements, 84.27% branches, 94.78% functions. All aggregate gates exceed 80%. |
| Preserved helper tests | 58 passed with 261 assertions; 84.22% measured line coverage and 89.97% function coverage, subject to the denominator described above. |
| Python process, integration, and structural tests | 43 passed: 13 doctor, 11 differential, 19 reverse-engineering. |
| Python combined statement/branch coverage | 91% across all four maintained scripts: doctor 91%, differential 91%, investigate 99%, probe 86%. A separate assertion checks that every maintained Python script is measured. |
| Dependency and secret checks | npm audit reported zero vulnerabilities. Final gitleaks scan of tracked and nonignored new project files reported zero leaks. |
| Patch whitespace | `git diff --check` passed. |

Independent runtime, project, parity, and comment reviews are recorded in `.audit/`. The decision log records red/green evidence, source-preservation decisions, and the correction from Bun's text averages to aggregate LCOV coverage. Fix-root-causes, test-behavior-not-implementation, and prove-it-works shaped the remediation: remove unsafe deletion, exercise real SDK/process boundaries, and verify the packaged artifact. The approved conflicts and remaining host limits above still apply. These results describe the verified working tree before commit and PR publication.
