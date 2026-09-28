# Vitest convention audit

Objective: make every vitest test file under `extensions/` strictly adhere to `extensions/AGENTS.md`.

Falsifiable predicate: the convention checker reports zero violations, all four extension suites pass, all four typechecks pass, and a per-file judgment pass finds no remaining deviation.

Rigor: high. The suites are the safety net for four shipped extensions, so weakening or churning a test outweighs the cost of a slow pass. Every unit was verified against the real suite before the next one started and the delegated work was reviewed here rather than trusted.

## Result

| Rule | Baseline | Now |
| --- | --- | --- |
| unmanaged env mutation (use `vi.stubEnv`) | 29 | 0 |
| real waits (observable readiness only) | 12 | 0 |
| weak-only assertions | 6 | 0 |
| unawaited async expectations | 2 | 0 |
| missing `coverage.include` | 2 | 0 |
| test with no assertion | 1 | 0 |
| total | 52 | 0 |

Tests: 342 to 371 by suite count, no test definition removed, no `skip`, `only`, `todo`, retry, or raised timeout added. Assertions: +101 net. Two assertions were removed with a recorded follow-up: a machine-dependent Reference built-ins count, and a tautological tmux focus-gate block whose two branches return the same value.

`weak-only-assertion` is an interpretation, stated so it can be dialed back. It flags a test whose every assertion is an absence, a call count, or a truthiness check. The rule it reads is "make every assertion prove the behavior named by the test": `expect(result).toBeUndefined()` for a test named "y approves" passes for any implementation that returns undefined. The precise-matcher rule alone would not flag it.

Coverage after the rewrites. `pi-tui-parity` 89.84 statements / 89.74 branches (thresholds 80). `pi-pstack` 85.48 / 82.22 (thresholds 80). `pi-anthropic-oauth` 87.5 / 90. `pi-antigravity-oauth` 87.87 / 71.15.

## What changed

- `extensions/scripts/check-vitest-conventions.mjs` encodes every mechanically decidable rule and prints `path:line rule message`. `extensions/scripts/check-vitest-conventions.selftest.mjs` feeds it a known-bad fixture per rule and a clean one, for all 18 detectors, so a silently broken detector cannot report zero violations.
- Both OAuth extensions gained `coverage.include`, `@vitest/coverage-v8`, and a `test:coverage` script.
- 23 manual `process.env` save and restore blocks became `vi.stubEnv` and `vi.unstubAllEnvs`. `FORCE_COLOR` moved into the `pi-tui-parity` vitest `env` block, because it has to exist before the module import and `unstubEnvs` restores per-test stubs.
- Hand-rolled poll loops became `vi.waitFor`. The shell settle sleeps became a process-group death check. The dialog sleep became a held deferred released by the test.
- `extensions/pi-pstack/test/worker-gates.ts` replaces the in-process descendant settle sleeps: the provider registers pending work, the abort path clears it, and the test releases whatever is left. A leaked abort now fails the test instead of passing after a timer.
- Six absence-only assertions now assert presence on the other input in the same test.
- The judgment pass removed developer-machine dependencies: `$HOME/.pi/agent/settings.json`, `~/.upstream/skills-reference`, sibling `experiments/plugins` checkouts, a repo-root `.test-decision-log.tsv`, and a globally installed `pi` binary in the CLI e2e.
- It also removed self-comparisons (`expect(started.details).toEqual(record)` where `record` was `started.details`), unfalsifiable helpers (`expect(rows.length > 0).toBe(true)`, analyzer output indistinguishable from clean code), and a tautological tmux focus-gate block.

## Verification

Commands and their observed results:

- `node extensions/scripts/check-vitest-conventions.selftest.mjs` exits 0.
- `node extensions/scripts/check-vitest-conventions.mjs` reports `0 violations, 241 review items` across 40 vitest files.
- `npx vitest run` per extension: 6, 38, 112, 215 tests pass. Baseline was 5, 33, 105, 199.
- `npm run typecheck` inside each extension directory exits 0 for all four. The root `npm run typecheck` is a different command and does not run in this checkout.
- `npx vitest run --coverage` passes both configured 80% thresholds.
- After a full run: zero `pstack-*` temporary directories and zero live processes.
- The pending-work gate was falsified on purpose: deleting the abort-path clear made both worker tests fail, then the change was reverted.
- Every exit code above was captured, not inferred: `npm test` 0, checker 0, selftest 0, four typechecks 0.

## The gate

`npm run check:tests` at the repository root, wired into `make verify` as `verify-test-conventions`. It runs the selftest first, then the checker.

The gate scans `*.test.ts` files. Test-support modules (`session-fixture.ts`, `worker-provider.ts`, and the like) are outside its scope, so a future fixture that sleeps or mutates the environment would not be caught by it. That gap is known and unfixed.

## Provenance

Commit `e9355743` (toolchain and rules) carries working-tree changes that predated this run. `biome.json`, `tsconfig.json`, `extensions/AGENTS.md`, and the toolchain fields of the root `package.json` were already modified when the audit started, and this run did not author them. The commit message describes what they contain. Amending a pushed commit needs a force-push to a shared branch, so the disclosure lives here and in the trail.

## Open items

- The root `npm run typecheck` cannot run in this checkout. There is no root install, so `tsc` is not on the path, and the root tsconfig asks for `types: ["node"]` that no installed package provides.
- The root `npm run ci` fails. Running Biome 2.5.14 against the tree reports 364 errors and 437 warnings, mostly formatting, and `--error-on-warnings` promotes the warnings. Both scripts landed before this run and neither was made green by it.
- `pi-antigravity-oauth` branch coverage is 71.15%, below the repository's 80% guideline. It has `coverage.include` but no threshold gate, so the number is visible without failing the build. Raising it means covering roughly 36 branches across `cloudcode.ts`, `command.ts`, `oauth.ts`, and `stream.ts`.
- Two dead production branches were found and left alone, since production code was fenced out of this pass. `src/notify/osc.ts` returns the same value on both sides of the `insideTmux` branch in `FocusGate.shouldNotify`. `src/models.ts` has an empty-selection arm that no input can reach because `''.split(',')` is `['']`.
- `skills-parity.test.ts` used to count the 22 Reference built-in skills from `~/.upstream/skills-reference`. That assertion passed only on this machine and nothing in the repository pins those 22 names, so it was removed. Restoring it needs a generated inventory, for example from `scripts/resources.mjs`.
- `context-review.test.ts` mixes real-session cases with unit-level cases that hand-build an `ExtensionAPI`. The 8192-byte branches need 100 synthetic models and are unreachable through a real session, so they stay at unit level. The file name does not claim otherwise.
- 90 test names exceed the checker's 72-character advisory. The rule asks for short behavior-based names; each of these names one behavior, and the threshold is the checker's heuristic rather than the rule, so they were left unchanged.
- `worker-provider.ts` keeps `setTimeout` latency for the scripted `WAIT`, `NEST_ROOT`, and `WAIT_BLOCKED` model replies. That is the faked model boundary, not a test-side readiness wait; every test awaits `vi.waitFor` or an event.

## Trail

`.audit/vitest-conventions.tsv`, one row per decision. `.audit/vitest-conventions/baseline.txt` holds the pre-fix census. `.audit/vitest-conventions/audit-contract.md` is the contract the six delegated auditors followed.
