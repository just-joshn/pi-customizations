# Playbook: u-journey-family-05-fio

Falsifiable done predicate. `parity/evidence/figure-it-out/pair-figure-it-out-playbook-first-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations record whether a playbook artifact (phases + falsifiable done predicate) appeared before any product-code edit under the fixture; report published at `parity/briefs/reports/u-journey-family-05-fio-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on ordering evidence (filesystem poll timestamps plus re-read of screens and host sessions). Medium on finishing the held-out migration (ordering is the requirement under test).

## Phases

1. Scaffold held-out fixture `fixture-app/` (tiny note-store with three product files). Verify. Baseline digests of `src/*` recorded; no playbook/product outputs yet under `fixture-out/`.
2. Write `parity/scripts/capture-figure-it-out-playbook-first.mjs` with residual-safe `/figure-it-out` prompt and live FS poll of playbook vs product first-seen times. Verify. Script `--help`/dry parse; locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; poll log written; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score ordering from poll logs, screens, and session tool order. Verify. Per-host verdict in `{playbook_before_product, product_before_playbook, playbook_only, product_only, neither, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or family stubs.
- Committing.
- Repairing host product if Pi skips playbook-first (honest fail / mismatch note only).
- Using Cursor as an implementation backend for Pi.

## Held-out candidate task (what the hosts see)

Multi-part note-store migration invoked via `/figure-it-out`, residual-safe after Pi slash strip. Agents must not be told this is a parity ordering experiment.
