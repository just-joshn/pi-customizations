# Open findings

Defects and gaps the user-perspective verification run surfaced and did not close. Each has a reproduction or a citation, so a reader can act on it without re-deriving it.

Nothing here is a pass. A surface whose receipt is `env-limited` or `not-drivable` is recorded in `verdicts.tsv`, not here. This file holds what a reviewer should decide on.

---

## F-008: the advertised `s50` command does not exist after the advertised install

**Status.** out-of-reach

**Repository-owned defect fixed.** The original bin pointed at TypeScript. A packed package copied under `node_modules` failed with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. The regression in `scripts/probe-s50-packaged-cli.mjs` retains that failing baseline. `8d01dc4` compiles the source to JavaScript, includes it in the package archive, and points the bin at `dist/cli/main.js`. `bc60b2b` makes the build set its executable permission and adds the build to the root gate. The packed-copy regression now passes both successful help with exit 0 and missing-run status with exit 1. The source extension still uses Pi's TypeScript loader.

**Remaining host constraint.** The installed Pi 1.0.4 `PackageManager.install()` handles a local source by resolving the path, checking that it exists, and returning. `installAndPersist()` then adds that source to settings. Neither method runs package code, a build hook, or a bin-link hook. The observed branch is recorded in `artifacts/user-perspective/f008-cli/host-local-install.txt`. Because this install path does not execute the repository's code, this package cannot make that command create a shell link or alter the caller's PATH. A host change or a separate shell-install action is required. Shipping a compiled bin fixes execution from an installed copy, but does not change this local-install branch.

**Real-artifact verification.** The new `s50-install` drive exits 0. Local Pi installation registers the command and skill but creates no bin in nine searched locations and leaves `which s50` empty. The npm-shaped Pi install does create `.pi/npm/node_modules/.bin/s50`, targeting the compiled JavaScript, and that bin runs the CLI. These observations are recorded in `artifacts/user-perspective/s50-install/raw/s50-install.json`. `S50-INSTALL-2` now asserts the compiled packed-copy behaviour, not the former inability to run it.

**Evidence.** `artifacts/user-perspective/f008-cli/pack-baseline.log`, `pack-fixed.log`, `unit-gate.log`, and `install-fixed.log` contain the failing-before test, passing-after test, passing typecheck and 849-test coverage run, and the passing real-Pi installation drive. Documentation alone was not used to close the finding. The full root gate with the new CLI build also exits 0, recorded in `artifacts/user-perspective/f008-cli/full-verify.log`.

---

## F-009: a receipt can be made to lie by editing the scenario that produces it

**Status.** open

**Found by** the run itself. A worker deleted the trailing `\n` from an expected string in `scenarios/caveman-tools.mjs` after the check failed. The receipt flipped to `verified` while its own `observed` field still showed the file without the newline. It was caught by a human reading the two fields against each other.

**Why it matters.** The done predicate trusts receipts. Nothing binds a receipt to the scenario text that produced it, so an expectation can be moved to match observed output and the report cannot tell.

**Implemented guard.** `4f97be4` records the producing scenario's SHA-256 digest in each receipt. The report rejects changed or unbound scenarios under strict completion. Legacy receipts are accepted only when git proves that their scenario text is unchanged. The sixteen formerly unbound scenarios have now been re-driven. The fresh report has 433 bound receipts, zero changed receipts, and zero unbound receipts. Evidence is under `artifacts/user-perspective/f009-rebinding/`.

**Re-drive regression.** The sweep exposed two scenarios reading historical recorder output. `78a875e` adds a real-Pi regression that seeds stale records and fails both drives. `af5da17` resets only the two owned recorder logs. Both regression cases and both canonical re-drives pass. The sweep also caught an obsolete fallback assertion left after F-019. `95764ea` replaces it with an assertion that no fallback child starts for an unavailable model; the real-Pi drive passes.

**Remaining defect.** A digest detects an after-the-fact edit, but not a weakened assertion followed by a new run. The reporter still cannot establish that a scenario's assertions cover the coordinator-owned expected result. F-009 remains open until that gap has a failing regression and a structural fix.

**Completion gate.** The strict report still exits 1 while F-009 or another finding remains open. Scenario binding alone does not close this finding.

---

## F-010: no gate enforces a coverage threshold

**Status.** fixed

**Closure evidence.** The policy regression in `1d42514` fails when any of the eight packages lacks an 80% floor for statements, branches, functions, or lines. `fd1c83a` adds those thresholds and behavioural tests for s50 status output and Git adapters. A scratch checkout of `1d42514` with the new thresholds reproduces the real coverage failure with 823 passing tests and 78.1% branches. The fixed s50 suite passes 849 tests with 80% branches. Full `make verify` exits 0, with all eight packages meeting all four enforced floors. Evidence is in `artifacts/user-perspective/f010-coverage/baseline.log`, `s50-threshold.log`, and `full-verify.log`.

**Found by** the baseline capture. `bun run ci` and every `test:coverage` script report a number and enforce nothing. No `vitest.config.ts` in the repository sets `thresholds`. Root `AGENTS.md` states 80% as a minimum.

**Measured coverage at the time of writing.** pi-caveman 95.34, pi-xai-oauth 98.91, pi-antigravity-oauth 97.13, pi-tui-skin 97.69, pi-one-dark-pro-theme 97.4, pi-anthropic-oauth 90.77, pi-s50 88.84, pi-pstack 80.55 statements.

**Enforcement.** `make verify` runs the coverage scripts with native Vitest thresholds. Its lint target also runs `scripts/check-coverage-policy.mjs`, which rejects a missing or lower threshold rather than accepting a temporarily high measurement.

---

## F-011: the packages typecheck against a different Pi than users run

**Status.** fixed

**Closure evidence.** `e2ec7bb` makes the version regression require Pi 1.0.4 in all eight packages and fails for all eight before the fix. `ce58533` aligns every Pi development pin and regenerates `bun.lock` from the local cache. `b5f35ea` regenerates Antigravity's copied SDK helper provenance from 1.0.4 rather than bypassing its vendor check. The version regression passes for all eight packages. Full `make verify` exits 0 with the aligned dependencies. A real-Pi schema drive also reaches the local Cloud Code endpoint in one request with no rejected keywords. Evidence is in `artifacts/user-perspective/f011-version/`, including `baseline.log`, `install.log`, `antigravity-regenerate.log`, `full-verify-after-vendor.log`, and `schema-direct-drive.log`. The development target is documented in `docs/pi-1.0.4-migration.md`.

**Found by** the baseline capture. Seven of eight packages pin `@earendil-works/pi-*` at 1.0.2 for typechecking and tests. The installed Pi that every user-perspective drive ran against is 1.0.4. `docs/pi-1.0.2-migration.md` describes the 1.0.2 migration as current.

**Consequence.** A type change between 1.0.2 and 1.0.4 can pass every gate and still break a user. No drive in this run found such a break, which is evidence that the gap is currently benign, not evidence that it is absent.

**Alignment.** Development dependencies now match the installed 1.0.4 runtime. Wildcard host peers remain unchanged. The earlier 1.0.2 migration report is historical.

**Earlier incorrect direction.** The original run moved caveman down to 1.0.2 to match the other packages. That left the development types behind the runtime. The upward alignment replaces that choice.

---

## F-012: the rubber-duck agent type cannot start on the Cloud Code Assist provider

**Status.** fixed

**Closure evidence.** The request-body regression lands before the fix in `169cbe6`. The repository-owned `cloudCodeSchema` adapter in `extensions/pi-antigravity-oauth/src/stream.ts` now recurses through schema arrays, translates literal `const` constraints into `enum`, and omits `uniqueItems` from the provider's OpenAPI schema. The vendored converter is unchanged and `check:vendor` passes. The original tool schema is not changed, so Pi retains argument validation. Property names such as `const` and `uniqueItems` are preserved. All 303 package tests and typecheck pass.

The real-Pi drive `scenarios/antigravity-tool-schema.mjs --baseline` loads the pre-fix converter in an isolated package and receives a local provider 400 on `const`, `const`, and `uniqueItems`. The same drive without the flag loads the fixed package and receives a successful response in one request. Both request payloads, RPC captures, and red/green logs are under `artifacts/user-perspective/f012-schema/`. This verifies the repository's provider adapter with a local endpoint enforcing the keywords rejected by the measured Cloud Code response. It does not claim a second live subscription-service request was made.

**Found by** the caveman fix unit, which tried to use it twice for plan review and self-reviewed instead. **Now measured directly** by the coordinator, because the run's own rigor rules say an unseen cause is a guess.

**What happens.** Spawning a `rubber-duck` subagent fails before the model is reached. The provider rejects the request payload:

```
Cloud Code Assist API error (400): Invalid JSON payload received.
Unknown name "const" at 'request.tools[0].function_declarations[9].parameters.properties[4].value.any_of[0]'
Unknown name "uniqueItems" at 'request.tools[0].function_declarations[32].parameters.properties[2].value'
```

**What it means for a user.** `/rubber-duck` and the `rubber-duck` agent type do not work for anyone whose task goes through the Cloud Code Assist provider, which in this repository is `google-antigravity`. The failure is a 400 at request time, not a graceful degradation.

**Cause.** The provider adapter selected the legacy OpenAPI parameters field but its sanitizer returned arrays unchanged. Literal `const` constraints inside `anyOf` therefore survived. It also forwarded `uniqueItems`. The measured API error rejects those two keywords; `any_of` is a path in the error, not itself a reported unsupported keyword. The reproduction confirms this defect independently of the particular tool names in the original child.

**Why it is parked.** It needs a fix in whichever layer builds the child's tool declarations, with a test that reproduces the 400 or asserts the schema shape, and that is a unit of its own. It is the clearest example of why the 172 discovery-scope verifications in `F-016` are worth reading carefully: this surface would have looked registered and healthy from a listing.

---

## F-013: `AN-EVT-2` cannot be falsified as specified

**Status.** fixed

**Closure evidence.** `scenarios/anthropic-shutdown.mjs` now runs the exported production guard inside real Pi, primes trim-notice deduplication on startup, and observes a second trim notice inside shutdown itself. No subsequent startup runs. Removing only the shutdown registration in an isolated copy leaves the count at one; the intact implementation produces two. The lifecycle captures and the independent unit-test mutant output are under `artifacts/user-perspective/f013-shutdown/`. The shutdown-only unit test fails with that same mutation and all 18 context-guard tests pass on the intact implementation. This fixes the verification blind spot, not a demonstrated product reset defect. The earlier inconclusive receipt remains historical evidence; the new behavioural receipt is under `artifacts/user-perspective/anthropic-shutdown/`.

**Found by** the OAuth unit. `session_shutdown` and `session_start` register the same reset closure at `extensions/pi-anthropic-oauth/src/guard.ts:169` and `:197-198`. Pi fires them back to back with no guard-observable request between them, so deleting either handler leaves every observation unchanged. The row's receipt is `inconclusive`, which is the correct verdict for a surface this harness cannot distinguish.

**What would settle it.** A guard-observable effect that can only happen between the two events, or a direct inspection of which handler is registered for which event.

**The risk this understates, from the cross-model review.** Sharing one reset closure across startup and shutdown means shutdown cleanup cannot be validated separately from startup. If the shutdown side of that closure is wrong, every observation still matches, because the next `session_start` resets the same state. The row being `inconclusive` is correct, and the practical consequence is that this extension's teardown is unverified rather than merely unverifiable in this harness.

---

## F-014: composite rows whose evidence is narrower than the row

**Status.** open

**Found by** the pi-tui-skin unit auditing its own work, and disclosed rather than left silent. Several rows in the inventory bundle clauses that behave independently. The drive asserts some of them and says so. The row therefore reads wider than its receipt, and a reader taking the row's text at face value would over-trust it.

| Row | Row claims | Receipt asserts | Not asserted |
| --- | --- | --- | --- |
| `TS-EVT-2` | Uninstalls every surface idempotently | `/reload` leaves one header, quit exits cleanly, no cleanup error | Each surface's individual uninstall, and more than one reload cycle |
| `TS-EVT-3` | Marks agent running for the activity widget | The running band and the interrupt hint | The activity widget line itself, which is `TS-UI-6` |
| `TS-EVT-7` | Repaints the footer on `model_select` and `thinking_level_select` | Shift+Tab thinking level | Model selection |
| `TS-UI-3` | Footer thinking-level row, model + context percentage row, location row | Model row by exact equality at zero usage, location row, thinking-level row | The context percentage, which is omitted at zero usage |
| `TS-UI-4` | Custom prompt editor with a working-animation band | The band | The animation, which is `TS-UI-5` |
| `TS-UI-5` | Animated glyph frames and the label "Working" | Both | Nothing |

`TS-EVT-1` was on this list and is resolved rather than parked: it duplicated the title clause that `TS-UI-1` owns, which is a subtraction, and the row now states the six surfaces it installs.

**Why it is parked rather than fixed.** Each of these rows needs either a stricter check or a split, and splitting them all is an inventory change that should be decided with the whole table in view rather than patched one row at a time. The rule the table already states is that a row whose veto cannot be written in one line is not a testable unit and must be split. These six are the rows that predate that rule being enforced.

**What to do about it.** Read a `verified` verdict for one of these rows as evidence for the clauses in the middle column, not for the whole of the left column. The receipts carry the `observed` value, so the boundary is visible from the artifact.

---

## F-015: the tui-skin spec still claims the skin sets the terminal title

**Status.** fixed

**Found by** the title fix, which reported it rather than editing outside its scope.

`extensions/pi-tui-skin/docs/PI_TUI_SKIN_IMPLEMENTATION_SPEC.md` stated in five places that the skin sets the terminal title, at lines 144, 178, 241, 586 and 1315. The behaviour was removed in `30706da`, because Pi owns the title and re-asserts it after the extension's `session_start` handler runs, so the call never survived in a real terminal.

**Fixed.** All five claims are corrected. The mechanism table no longer lists `ctx.ui.setTitle()` as selected, the ownership list no longer claims the title, the visible-element table now reads that Pi owns the title and that a call there never takes effect, the sample `installUi` no longer calls it, and the phase plan no longer tells an implementer to build it.

**Why this could not be left as documentation drift.** A reader following the spec would have reintroduced a call that is dead in production. Two tests already pin its absence, `test/index.test.ts:94` and `test/install-ui.test.ts:151`, so the correction cannot silently regress.

---

## F-016: declared resources are verified at discovery scope, not behaviour scope

**Status.** open

**Found by** the drift check that compares each receipt's expectation against its row's, which surfaced 89 divergences and 16 that drop three or more content words.

**What is happening.** A skill, prompt template, agent or theme that a package declares is a resource. The package's own surface is that it declares that resource and Pi discovers it under that name. The rows in `surfaces.tsv` nonetheless describe the resource's *effect*: `RS-SKILL-1` says "Reports Pi setup health, then applies only confirmed fixes", `PS-SKILL-01` says "Injects the skill body into the conversation", `AN-PROV-1` says "Claude Pro/Max subscription answers".

No drive exercises those effects. What the drives observed is registration and discovery. That is honest for the package, because injecting a skill body and answering on a subscription are Pi's and the service's behaviour rather than the package's, but it is not what the row's text claims.

**How to read the result.** `verdicts.tsv` now carries a `scope` column, so a reader can see which kind of observation stands behind each verdict without opening a receipt. `verified` next to `scope: discovery` means the resource is declared and discovered, and says nothing about its effect. `verified` next to `scope: behaviour` means a drive exercised the claim. At the time of writing that split is 161 behaviour and 172 discovery.

**Why it is parked rather than resolved.** Closing it means either rewriting the `expected` text of roughly 188 declared-resource rows to the claim the package actually owns, or writing behavioural drives for each effect. The first is a large mechanical edit to the program's contract and the second is a second program. Both are decisions about what this verification standard means, and making them silently inside a run is exactly the failure this file exists to prevent.

---

## F-017: the shutdown hook can be cut by a second shutdown

**Status.** out-of-reach

**Boundary proof.** `3b62704` adds a deterministic real-Pi probe at `scripts/probe-rpc-double-shutdown.mjs`. Both cases load production pstack, populate its context board, and point its detached launch at a local recorder. A preceding extension hook records entry, awaits one second, and records completion. With one shutdown, the hook completes and pstack launches consolidation. Closing stdin after disposal starts produces a second shutdown. The hook never completes and pstack never launches consolidation. Both observations repeat after formatting the probe. Captures and result JSON are in `artifacts/user-perspective/f017-double-shutdown/`.

**Mechanism outside this repository.** The installed Pi 1.0.4 RPC host calls `process.exit(exitCode)` when `shuttingDown` is already true, while its first call still awaits `runtimeHost.dispose()`. The observed source is recorded in `host-shutdown.txt`. That hard exit stops pending hooks before control reaches pstack. Moving pstack's launch within its own hook cannot make the host reach it while an earlier extension is still awaited. Extension code cannot guarantee completion after the host exits. Fixing the reentrant shutdown requires changing the installed host's shutdown implementation, which this repository neither supplies nor loads as an extension.

**Found by** the pi-pstack environment unit, which saw an intermittent failure rather than a clean one.

**Original symptom.** Two full environment drives did not record a consolidation launch within 60 seconds. Ten isolated attempts did launch. Those observations alone did not identify the trigger. The new probe isolates the double-shutdown failure without retries.

**Rerun the proof.** `node .pi/skills/verify-pi-customizations/scripts/probe-rpc-double-shutdown.mjs`. It asserts that the single-shutdown control completes and launches consolidation, while the double-shutdown treatment does neither.

**Evidence.** `artifacts/user-perspective/pstack-env-variables/raw/env-16-rem.json`, and the retry count recorded in `PS-ENV-16.json`.

**Limit of the proof.** This establishes the host's double-shutdown mechanism. It does not establish that the earlier intermittent drives produced that exact sequence. The package remains testable under a single orderly shutdown, but cannot enforce orderly shutdown against this host exit path.

---

## F-018: disabling a subagent does not take effect in the current session

**Status.** fixed

**Closure evidence.** The failing test and real-Pi reproduction land first in `057b2de`. After saving and adopting any subagent preference, `subagent-commands.ts` now invalidates the factory's offered-agent cache. All 20 command tests pass. The real-Pi drive `scenarios/pstack-subagents-disable.mjs` primes the cache, disables rubber-duck, and gets the disabled-agent warning immediately in the same session. Failing and passing outputs are under `artifacts/user-perspective/f018-settings/`; the raw RPC capture and new behavioural receipt are under `artifacts/user-perspective/pstack-subagents-disable/`.

**Found by** the same unit while driving `PS-CMD-9`.

`/subagents rubber-duck off` writes the preference but the current session keeps using the agent. `SettingsStore.adopt` updates the saved settings while `factory.offered` caches its list until `invalidateToolConfig` runs, at `extensions/pi-pstack/src/subagents/subagent-commands.ts:51` and `src/subagents/factory.ts:89`. The warning that the agent is disabled appears only in the next session, which is why the drive had to move to a fresh session to observe it.

**Why this matters to a user.** They turn an agent off, the confirmation says it worked, and it keeps running in the session they are in. The stale-settings gap is silent.

**Why it is parked.** It is a real product defect and the fix is in a package this run has otherwise left alone; it needs its own change with a test that fails before and passes after, not a drive-side workaround. The drive's fresh-session observation is correct for the row as written and the same-session gap is recorded here instead of being absorbed into the scenario.

---

## F-019: an unknown subagent model falls back silently where an unknown model elsewhere throws

**Status.** fixed

**Closure evidence.** The failing test and real-Pi reproduction land first in `72366f4`. Specialized execution and search tools now validate an enabled explicit model variable with the existing `resolveModel` boundary before creating a child. Valid models preserve their selection policy; a disabled model flag still ignores the variable. All 11 specialized-tool tests pass, and typecheck passes. `scenarios/pstack-execution-model.mjs` now gets `isError=true` and an error naming `missing/none` plus the available models on real Pi. Red and green outputs and the raw capture are under `artifacts/user-perspective/f019-model/`. The older environment scenario asserted the bug as expected behaviour; its invalid-model assertion now requires rejection.

**Found by** the same unit while driving `PS-ENV-20`.

Setting `EXECUTION_SUBAGENT_MODEL` to an unknown value does not fail. It falls back to the inherited model, and the drive records the fallback rather than a rejection. `resolveModel` throws for an unknown model elsewhere, at `extensions/pi-pstack/src/models.ts:82` against `src/subagents/specialized-tools.ts:58`.

**Why it is parked.** Two paths disagree about whether an unknown model is an error. That is a product decision about which behaviour is wanted, and the drive correctly recorded what the interface does rather than what a reader might expect.

---

## F-020: a subagent reads files the user excluded, because the exclusion never wires up

**Status.** fixed

**Found by** `PS-EVT-32` while driving the pi-pstack policy hooks. **Highest severity in this run.**

**What a user sees.** They configure `contentExclusions` so a subagent cannot read sensitive files. The child reads `.env` anyway. Nothing tells them.

**What the unit observed.** The drive set the exclusion both at the top level of the settings and under the `subagents` key, and the child read the excluded file in both cases. The exclusion extension never registers.

**Confirmed, fixed and verified.** The wiring passed the whole settings object to `parsePatterns`, which accepts only `Array<string>`, so the exclusion extension never registered. `parseContentExclusions` replaces it: it reads both placements, merges and deduplicates them, and returns its problems instead of swallowing them. `factory.create` now throws on a malformed setting rather than proceeding, because an empty pattern list is the failure that reads the files the user meant to protect.

**Proof.** The policy drive reported the child read `.env` before the fix and reports that the transcript does not contain the file content with `blockedByPolicy=true` after it. Nine tests fail on the pre-fix source and pass after. `PS-EVT-32` moved from `not-drivable` to `verified`, and its scenario now derives the verdict from the observation, so a regression writes `failed` rather than the stale reason that contradicted its own `observed` value.

**Severity.** High for a security setting, moderate in practice. It requires a user to have configured exclusions and a subagent to read a path matching them. It is silent, which is what makes it bad, and it fails open, which is the wrong direction for a protection setting.

---

## F-021: a worker transcript keeps reading `running` after shutdown

**Status.** fixed

**Closure evidence.** The failing unit test and real-Pi transcript reproduction land first in `2d97297`. Shutdown/finalization now explicitly persists each drained local worker's terminal record; branch restoration does not request that persistence. The generation barrier still suppresses stale completion delivery. All 29 worker tests and typecheck pass. `scenarios/pstack-worker-shutdown.mjs` observes `running` before closing real Pi and `interrupted` in the saved transcript immediately afterward, without another startup. Red/green logs are under `artifacts/user-perspective/f021-shutdown/`, and the complete transcript and behavioural receipt are under `artifacts/user-perspective/pstack-worker-shutdown/`. The older hooks scenario now asserts this state instead of treating the defect as not-drivable.

**Found by** `PS-EVT-44`. A local worker is in-process, so after shutdown the transcript still records the task as `running` plus a cleanup-usage entry, and only the next session start rewrites it to `interrupted`. Between the two, a user reading their own session sees a task that has already stopped.

**Why it is parked.** The rewrite does happen, so the state converges; the window is the defect. Fixing it means deciding whether shutdown should write the terminal state or the read path should derive it.

---

## F-022: navigating away from a task re-appends its settled record

**Status.** fixed

**Closure evidence.** The failing unit test and real-Pi navigation drive land first in `14094d1`. Worker cleanup now distinguishes shutdown from branch restoration. Shutdown persists terminal records and claims cleanup usage; restoration drains the old workers without appending those old records or usage claims to the newly selected branch. The original branch retains its completed record and uncollected usage. All 30 worker tests and typecheck pass. The real-Pi drive `scenarios/pstack-worker-tree.mjs` reports zero tasks after navigating before creation, then confirms the completed task remains when navigating back. The shutdown drive also still reports an immediately persisted interrupted record. Red/green outputs are under `artifacts/user-perspective/f022-navigation/`, and captures and the new behavioural receipt are under `artifacts/user-perspective/pstack-worker-tree/`. The older hooks scenario now rejects the duplication it previously expected.

**Found by** the same unit while driving `PS-EVT-43`. On a session-tree navigation, the worker-restore path re-appends an already-settled task record onto the newly navigated branch, so a task the user has navigated away from stays listed.

**Why it is parked.** It is branch-state duplication rather than data loss, and the fix belongs with whoever owns the session-tree restore path.

---

## F-023: two defensive guards are unreachable from a real session

**Status.** open

**Found by** `PS-EVT-30` and `PS-EVT-31`. Pi rejects a call to a deactivated tool with `Tool <name> not found` before any `tool_call` hook runs, so the policy guard for that case cannot execute. An agent with a named tool list never receives the other tools, and a child whose parent lacks `write` and `edit` has them dropped from its plan, so the second guard is unreachable for the same reason.

**Why it matters.** Unreachable guards read as protection and provide none, and they cost a reader time. Either they should be deleted, or the comment should say which host behaviour makes them dead. The verification consequence is recorded in the receipt as `not-drivable` rather than `verified`, because the row cannot be exercised.

---

## F-024: two packages were never driven together in a real terminal

**Status.** fixed

**Closure evidence.** `f1a63b3` adds `scripts/probe-pstack-skin-interaction.mjs`, reusing the existing isolated tmux probe with real Pi and both packages explicitly loaded. A deterministic local provider calls the real TodoWrite tool. The drive observes pstack's in-progress widget alongside exactly one skin header and the skin model footer. The widget survives resize and reload without duplication, and Pi exits 0. The control invocation with `--without-pstack` fails the widget assertion. Plain and ANSI frames for startup, tool completion, resize, reload, and exit, plus the result JSON and control failure log, are under `artifacts/user-perspective/pstack-skin-interaction/`. No model service or external network was used.

**Found by** the close-out audit against the requirement that coverage include cross-extension interaction.

**What was checked.** Two pairs, both in RPC mode. All three subscription providers were loaded into one session with `-e` for each, and they register without conflict, exposing 31 models: 16 for `claude-subscription`, 7 for `google-antigravity`, 8 for `grok-build`. `pi-pstack` and `pi-tui-skin` were loaded together and pi-pstack's ten extension commands are all present, so no collision.

**Original gap.** At discovery, no scenario exercised the skinned render with pstack's widgets in a real terminal. The existing terminal drives loaded one package plus its fixture. The new drive closes that interaction gap.

**How to rerun it.** `.pi/skills/verify-pi-customizations/scripts/probe-cross-extension.mjs` loads both pairs and writes `artifacts/baseline/cross-extension.txt`. Its output: the three subscription providers expose 31 models together without conflict, and pi-pstack with pi-tui-skin yields 150 commands with all ten of pstack's extension commands intact.

**Rerun the terminal drive.** `node .pi/skills/verify-pi-customizations/scripts/probe-pstack-skin-interaction.mjs`. Add `--without-pstack` to reproduce the failing control.
