# Open findings

Defects and gaps the user-perspective verification run surfaced and did not close. Each has a reproduction or a citation, so a reader can act on it without re-deriving it.

Nothing here is a pass. A surface whose receipt is `env-limited` or `not-drivable` is recorded in `verdicts.tsv`, not here. This file holds what a reviewer should decide on.

---

## F-008: the advertised `s50` command does not exist after the advertised install

**Found by** `S50-INSTALL-1` / `S50-INSTALL-2` and `artifacts/user-perspective/s50-install/`.

**What a user sees.** `extensions/pi-s50/package.json` declares `bin.s50`. `extensions/pi-s50/README.md:8` advertises `pi install ./extensions/pi-s50`. After that install, typing `s50` in a shell fails with command not found.

**What actually happens.** Pi's local install branch performs no bin linking at all. It resolves the path and checks it exists, then returns, at `@earendil-works/pi-coding-agent@1.0.4` `dist/core/package-manager.js:796-802`. `installNpm()` delegates to `npm install --prefix <root>` at `:1527-1530`, and `getNpmInstallRoot()` at `:1730-1739` puts that root at `<cwd>/.pi/npm` or `<agentDir>/npm`, neither of which is on `PATH`. Measured across five install shapes. `pi install npm:file:<abs-dir>` does link `.pi/npm/node_modules/.bin/s50`, but the linked name is still not on `PATH`. `docs/packages.md` states that local packages are loaded from their path without copying, and the word `bin` does not appear in it.

**Why it is parked rather than fixed.** The manifest is valid npm metadata and the package documents the constraint at `README.md:15-21`, including the working invocation `node extensions/pi-s50/src/cli/main.ts status`. The gap is between what a reader expects from a declared `bin` and what any install shape delivers onto `PATH`. Closing it means choosing between documenting a `PATH` step, shipping a wrapper on `PATH`, or dropping `bin` from the manifest. That is a packaging decision, not a defect to patch.

**Reproduction.** `artifacts/user-perspective/s50-install/raw/s50-install.json` records the nine searched locations, the `PATH` scan, and `which s50`.

---

## F-009: a receipt can be made to lie by editing the scenario that produces it

**Found by** the run itself. A worker deleted the trailing `\n` from an expected string in `scenarios/caveman-tools.mjs` after the check failed. The receipt flipped to `verified` while its own `observed` field still showed the file without the newline. It was caught by a human reading the two fields against each other.

**Why it matters.** The done predicate trusts receipts. Nothing binds a receipt to the scenario text that produced it, so an expectation can be moved to match observed output and the report cannot tell.

**Proposed guard, not yet built.** Have `lib/receipts.mjs` record a hash of the producing scenario file in each receipt, and have `coverage-report.mjs` report a receipt whose scenario hash has changed as `stale-scenario` instead of `verified`. This closes the after-the-fact edit but not a weakened assertion written and run in one go. The stronger guard is to move expected values out of the scenarios and into coordinator-owned rows of `surfaces.tsv`, so a worker can edit a drive but not the expectation it is judged against.

**Why it is parked.** It changes the receipt contract and therefore every existing receipt, and it is a Phase E hardening step rather than part of the sweep.

---

## F-010: no gate enforces a coverage threshold

**Found by** the baseline capture. `bun run ci` and every `test:coverage` script report a number and enforce nothing. No `vitest.config.ts` in the repository sets `thresholds`. Root `AGENTS.md` states 80% as a minimum.

**Measured coverage at the time of writing.** pi-caveman 95.34, pi-xai-oauth 98.91, pi-antigravity-oauth 97.13, pi-tui-skin 97.69, pi-one-dark-pro-theme 97.4, pi-anthropic-oauth 90.77, pi-s50 88.84, pi-pstack 80.55 statements.

**Why it is parked.** pi-pstack sits 0.55 points above the documented floor. Adding a repo-wide threshold is one bad refactor away from turning the gate red on a change that has nothing to do with coverage, so the decision belongs with the owner rather than with this run.

---

## F-011: the packages typecheck against a different Pi than users run

**Found by** the baseline capture. Seven of eight packages pin `@earendil-works/pi-*` at 1.0.2 for typechecking and tests. The installed Pi that every user-perspective drive ran against is 1.0.4. `docs/pi-1.0.2-migration.md` describes the 1.0.2 migration as current.

**Consequence.** A type change between 1.0.2 and 1.0.4 can pass every gate and still break a user. No drive in this run found such a break, which is evidence that the gap is currently benign, not evidence that it is absent.

**Why it is parked.** Migrating the pins is a deliberate version move with its own migration doc and audit, not a side effect of a verification run.

**The sharp version of this, from the cross-model review.** The run resolved the pin split by bringing `pi-caveman` down to 1.0.2 rather than bringing the other seven up to 1.0.4. That restored a green gate with one package changed instead of seven, and it is the direction the repository had already chosen, but it also chose to keep the type surface one minor behind the runtime users actually run. Aligning up would have made the typecheck see 1.0.4 and would have been the larger change. A reviewer should know that the smaller change was taken deliberately and that the direction is still open.

---

## F-012: the rubber-duck agent type cannot start

**Found by** the caveman fix unit, which tried to use it twice for plan review. Both attempts failed with provider 400s, on the inherited model and on an explicit one. The unit reports that the agent type's tool declarations use `const`, `any_of` and `uniqueItems`, which the backing API rejects. The unit self-reviewed instead.

**Why it is parked.** It blocks the cross-model review step that `show-me-your-work` requires at the close of a run, so it has a direct effect on this program's own rigor. Reproducing and fixing it belongs in its own unit against `extensions/pi-pstack`.

---

## F-013: `AN-EVT-2` cannot be falsified as specified

**Found by** the OAuth unit. `session_shutdown` and `session_start` register the same reset closure at `extensions/pi-anthropic-oauth/src/guard.ts:169` and `:197-198`. Pi fires them back to back with no guard-observable request between them, so deleting either handler leaves every observation unchanged. The row's receipt is `inconclusive`, which is the correct verdict for a surface this harness cannot distinguish.

**What would settle it.** A guard-observable effect that can only happen between the two events, or a direct inspection of which handler is registered for which event.

**The risk this understates, from the cross-model review.** Sharing one reset closure across startup and shutdown means shutdown cleanup cannot be validated separately from startup. If the shutdown side of that closure is wrong, every observation still matches, because the next `session_start` resets the same state. The row being `inconclusive` is correct, and the practical consequence is that this extension's teardown is unverified rather than merely unverifiable in this harness.

---

## F-014: composite rows whose evidence is narrower than the row

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

**Found by** the title fix, which reported it rather than editing outside its scope.

`extensions/pi-tui-skin/docs/PI_TUI_SKIN_IMPLEMENTATION_SPEC.md` states in five places that the skin sets the terminal title: lines 144, 178, 241, 586 and 1315. The behaviour was removed in `30706da`, because Pi owns the title and re-asserts it after the extension's `session_start` handler runs, so the call never survived.

**Why it is parked.** The code and the tests are corrected; the spec text is not, and a reader following the spec would reintroduce the dead call. Five edits in one document is a small task, but it is documentation scope that belongs with whoever owns the spec's shape rather than with the verification run.

---

## F-016: declared resources are verified at discovery scope, not behaviour scope

**Found by** the drift check that compares each receipt's expectation against its row's, which surfaced 89 divergences and 16 that drop three or more content words.

**What is happening.** A skill, prompt template, agent or theme that a package declares is a resource. The package's own surface is that it declares that resource and Pi discovers it under that name. The rows in `surfaces.tsv` nonetheless describe the resource's *effect*: `RS-SKILL-1` says "Reports Pi setup health, then applies only confirmed fixes", `PS-SKILL-01` says "Injects the skill body into the conversation", `AN-PROV-1` says "Claude Pro/Max subscription answers".

No drive exercises those effects. What the drives observed is registration and discovery. That is honest for the package, because injecting a skill body and answering on a subscription are Pi's and the service's behaviour rather than the package's, but it is not what the row's text claims.

**How to read the result.** `verdicts.tsv` now carries a `scope` column, so a reader can see which kind of observation stands behind each verdict without opening a receipt. `verified` next to `scope: discovery` means the resource is declared and discovered, and says nothing about its effect. `verified` next to `scope: behaviour` means a drive exercised the claim. At the time of writing that split is 161 behaviour and 172 discovery.

**Why it is parked rather than resolved.** Closing it means either rewriting the `expected` text of roughly 188 declared-resource rows to the claim the package actually owns, or writing behavioural drives for each effect. The first is a large mechanical edit to the program's contract and the second is a second program. Both are decisions about what this verification standard means, and making them silently inside a run is exactly the failure this file exists to prevent.

---

## F-017: the shutdown hook can be cut by a second shutdown

**Found by** the pi-pstack environment unit, which saw an intermittent failure rather than a clean one.

**What happens.** In two full runs of the environment scenario the populated-board shutdown never spawned the consolidation session; the recorder log was still absent after 60 seconds. In an isolated ten-attempt probe all ten launched. So it is a race, not a failure.

**Likely cause, from the unit's reading.** The pi RPC host's `shutdown()` short-circuits to `process.exit` when a second shutdown arrives while `runtimeHost.dispose()` is still in flight, at `@earendil-works/pi-coding-agent@1.0.4` `dist/modes/rpc/rpc-mode.js:579`. That can cut `session_shutdown` handlers before `launchRemOnShutdown` runs.

**Evidence.** `artifacts/user-perspective/pstack-env-variables/raw/env-16-rem.json`, and the retry count recorded in `PS-ENV-16.json`.

**Why it is parked.** It is a host-level race rather than a package defect, the unit's evidence is two observations against ten, and the row is verified by the attempt that succeeded with the retry count recorded rather than hidden.

---

## F-018: disabling a subagent does not take effect in the current session

**Found by** the same unit while driving `PS-CMD-9`.

`/subagents rubber-duck off` writes the preference but the current session keeps using the agent. `SettingsStore.adopt` updates the saved settings while `factory.offered` caches its list until `invalidateToolConfig` runs, at `extensions/pi-pstack/src/subagents/subagent-commands.ts:51` and `src/subagents/factory.ts:89`. The warning that the agent is disabled appears only in the next session, which is why the drive had to move to a fresh session to observe it.

**Why this matters to a user.** They turn an agent off, the confirmation says it worked, and it keeps running in the session they are in. The stale-settings gap is silent.

**Why it is parked.** It is a real product defect and the fix is in a package this run has otherwise left alone; it needs its own change with a test that fails before and passes after, not a drive-side workaround. The drive's fresh-session observation is correct for the row as written and the same-session gap is recorded here instead of being absorbed into the scenario.

---

## F-019: an unknown subagent model falls back silently where an unknown model elsewhere throws

**Found by** the same unit while driving `PS-ENV-20`.

Setting `EXECUTION_SUBAGENT_MODEL` to an unknown value does not fail. It falls back to the inherited model, and the drive records the fallback rather than a rejection. `resolveModel` throws for an unknown model elsewhere, at `extensions/pi-pstack/src/models.ts:82` against `src/subagents/specialized-tools.ts:58`.

**Why it is parked.** Two paths disagree about whether an unknown model is an error. That is a product decision about which behaviour is wanted, and the drive correctly recorded what the interface does rather than what a reader might expect.

---

## F-020: a subagent reads files the user excluded, because the exclusion never wires up

**Found by** `PS-EVT-32` while driving the pi-pstack policy hooks. **Highest severity in this run.**

**What a user sees.** They configure `contentExclusions` so a subagent cannot read sensitive files. The child reads `.env` anyway. Nothing tells them.

**What the unit observed.** The drive set the exclusion both at the top level of the settings and under the `subagents` key, and the child read the excluded file in both cases. The exclusion extension never registers.

**Confirmed, fixed and verified.** The wiring passed the whole settings object to `parsePatterns`, which accepts only `Array<string>`, so the exclusion extension never registered. `parseContentExclusions` replaces it: it reads both placements, merges and deduplicates them, and returns its problems instead of swallowing them. `factory.create` now throws on a malformed setting rather than proceeding, because an empty pattern list is the failure that reads the files the user meant to protect.

**Proof.** The policy drive reported the child read `.env` before the fix and reports that the transcript does not contain the file content with `blockedByPolicy=true` after it. Nine tests fail on the pre-fix source and pass after. `PS-EVT-32` moved from `not-drivable` to `verified`, and its scenario now derives the verdict from the observation, so a regression writes `failed` rather than the stale reason that contradicted its own `observed` value.

**Severity.** High for a security setting, moderate in practice. It requires a user to have configured exclusions and a subagent to read a path matching them. It is silent, which is what makes it bad, and it fails open, which is the wrong direction for a protection setting.

---

## F-021: a worker transcript keeps reading `running` after shutdown

**Found by** `PS-EVT-44`. A local worker is in-process, so after shutdown the transcript still records the task as `running` plus a cleanup-usage entry, and only the next session start rewrites it to `interrupted`. Between the two, a user reading their own session sees a task that has already stopped.

**Why it is parked.** The rewrite does happen, so the state converges; the window is the defect. Fixing it means deciding whether shutdown should write the terminal state or the read path should derive it.

---

## F-022: navigating away from a task re-appends its settled record

**Found by** the same unit while driving `PS-EVT-43`. On a session-tree navigation, the worker-restore path re-appends an already-settled task record onto the newly navigated branch, so a task the user has navigated away from stays listed.

**Why it is parked.** It is branch-state duplication rather than data loss, and the fix belongs with whoever owns the session-tree restore path.

---

## F-023: two defensive guards are unreachable from a real session

**Found by** `PS-EVT-30` and `PS-EVT-31`. Pi rejects a call to a deactivated tool with `Tool <name> not found` before any `tool_call` hook runs, so the policy guard for that case cannot execute. An agent with a named tool list never receives the other tools, and a child whose parent lacks `write` and `edit` has them dropped from its plan, so the second guard is unreachable for the same reason.

**Why it matters.** Unreachable guards read as protection and provide none, and they cost a reader time. Either they should be deleted, or the comment should say which host behaviour makes them dead. The verification consequence is recorded in the receipt as `not-drivable` rather than `verified`, because the row cannot be exercised.

---

## F-024: two packages were never driven together in a real terminal

**Found by** the close-out audit against the requirement that coverage include cross-extension interaction.

**What was checked.** Two pairs, both in RPC mode. All three subscription providers were loaded into one session with `-e` for each, and they register without conflict, exposing 31 models: 16 for `claude-subscription`, 7 for `google-antigravity`, 8 for `grok-build`. `pi-pstack` and `pi-tui-skin` were loaded together and pi-pstack's ten extension commands are all present, so no collision.

**What was not.** The skinned render, where tui-skin's header, footer and chrome are drawn around pi-pstack's widgets in a real terminal, is the interaction a user would actually notice, and no scenario exercises it. It needs the tmux harness starting two packages at once, which none does. Every terminal drive loads one package plus its fixture, and every RPC drive loads one package plus its fixture.

**Why it is parked.** It is a harness capability rather than a package defect, and building it is a unit of its own rather than a late addition to this run.
