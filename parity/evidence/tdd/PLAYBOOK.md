# Playbook: u-journey-cmd-tdd

Falsifiable done predicate. `parity/evidence/tdd/pair-tdd-explicit-gate-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations record whether a focused failing test appeared and was exercised before any product-code edit under the fixture (or an honest impractical-skip with reason); report published at `parity/briefs/reports/u-journey-cmd-tdd-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on ordering evidence (filesystem poll timestamps plus re-read of screens and host sessions). Medium on finishing the held-out fix (ordering is the requirement under test).

## Phases

1. Scaffold held-out fixture `fixture-app/` (buggy `src/clamp.js`, empty `test/`, `npm test` via node:test). Verify. Baseline digest of `src/clamp.js` recorded; no test/product outputs yet under `fixture-out/`.
2. Write `parity/scripts/capture-tdd-explicit-gate.mjs` with residual-safe `/tdd` prompt and live FS poll of test vs product first-seen times. Verify. Locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; poll log written; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score ordering from poll logs, screens, and session tool order. Verify. Per-host verdict in `{test_before_product, product_before_test, test_only, product_only, skip_impractical, neither, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or family stubs.
- Committing.
- Repairing host product if Pi skips red-before-green (honest fail / mismatch note only).
- Using Cursor as an implementation backend for Pi.

## Held-out candidate task (what the hosts see)

Upper-bound bug in `src/clamp.js` invoked via `/tdd`, residual-safe after Pi slash strip. Agents must not be told this is a parity ordering experiment.
