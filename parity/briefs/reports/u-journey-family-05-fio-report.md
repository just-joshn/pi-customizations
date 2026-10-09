# u-journey-family-05-fio report

## Status

**pass** for the capture brief (linked Cursor+Pi pair on real PTY, honest host delta). Requirement behavior is **not** green on both hosts. Cursor satisfied playbook-before-product. Pi skipped (product edits before any playbook artifact). Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `38afcd44-b9f2-4ba3-ad91-f345d71bdd73` |
| pi | `a45d9cf4-4cea-4974-a9ad-7d56195c5259` |

Pair. `parity/evidence/figure-it-out/pair-figure-it-out-playbook-first-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Playbook before product?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | FS poll. `decisions.tsv` at `2026-10-08T19:14:06.421Z`; first product `src/store.js` at `2026-10-08T19:14:35.506Z`. Snapshot keeps the TSV with phase rows and a falsifiable done predicate. |
| pi | **no** | FS poll. product-only at `2026-10-08T19:17:03.955Z`. Session `01a11cf2…` one bash wrote `src/store.js` → `src/format.js` → `src/cli.js` → verify/`notes.json` → `DECISIONS.md` → done.txt. Phase A–E todos still pending on the settled screen. |

Worker capture playbook. `parity/evidence/figure-it-out/PLAYBOOK.md` was written before the fixture product files and `capture-figure-it-out-playbook-first.mjs`.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths.
2. Wrote worker `PLAYBOOK.md`, then fixture-app, then `parity/scripts/capture-figure-it-out-playbook-first.mjs`.
3. `node parity/scripts/capture-figure-it-out-playbook-first.mjs --cursor-only` (~198s).
4. `node parity/scripts/capture-figure-it-out-playbook-first.mjs --pi-only` (~38s).
5. Re-read screens, poll logs, Cursor fixture-snapshot, Pi session tool order.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Cursor’s early artifact was `decisions.tsv` (trail carrying phase + done predicate), not a separate `PLAYBOOK.md`.
3. Pi attached `[skill] figure-it-out` but did not land an on-disk playbook before product code. Honest fail for the requirement on Pi.
4. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or the family-05 stub.
5. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-05 `evidencePaths` when ready.
2. File or update a Pi mismatch for playbook-before-product (product-first bash + late `DECISIONS.md`).
3. Optionally tighten the capture poller to treat `DECISIONS.md` as a trail path (would still score Pi as product_before_playbook from session order).
