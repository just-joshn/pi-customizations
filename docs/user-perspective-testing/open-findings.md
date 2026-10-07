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

---

## F-012: the rubber-duck agent type cannot start

**Found by** the caveman fix unit, which tried to use it twice for plan review. Both attempts failed with provider 400s, on the inherited model and on an explicit one. The unit reports that the agent type's tool declarations use `const`, `any_of` and `uniqueItems`, which the backing API rejects. The unit self-reviewed instead.

**Why it is parked.** It blocks the cross-model review step that `show-me-your-work` requires at the close of a run, so it has a direct effect on this program's own rigor. Reproducing and fixing it belongs in its own unit against `extensions/pi-pstack`.

---

## F-013: `AN-EVT-2` cannot be falsified as specified

**Found by** the OAuth unit. `session_shutdown` and `session_start` register the same reset closure at `extensions/pi-anthropic-oauth/src/guard.ts:169` and `:197-198`. Pi fires them back to back with no guard-observable request between them, so deleting either handler leaves every observation unchanged. The row's receipt is `inconclusive`, which is the correct verdict for a surface this harness cannot distinguish.

**What would settle it.** A guard-observable effect that can only happen between the two events, or a direct inspection of which handler is registered for which event.

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
