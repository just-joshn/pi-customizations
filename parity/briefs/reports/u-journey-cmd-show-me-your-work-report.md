# u-journey-cmd-show-me-your-work report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both hosts kept a single `decisions.tsv` with prescribed columns and pointer evidence cells. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `9da98ab4-2dda-47d1-9c06-8927937c3e23` |
| pi | `cb93e390-6979-4e43-a7f9-ee35df2ccc0b` |

Pair. `parity/evidence/show-me-your-work/pair-show-me-your-work-tsv-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## TSV contract held?

| Side | Prescribed columns | Data rows | Evidence pointers | Verdict |
| --- | --- | --- | --- | --- |
| cursor | yes | 2 | `src/greet.js:2`, `src/greet.js:5` | **yes** (`fixture-out/cursor/decisions.tsv`) |
| pi | yes | 4 | `decisions.tsv`, `src/greet.js:2`, `src/greet.js:5` | **yes** (`fixture-out/pi/decisions.tsv`) |

Oracle. On-disk TSV re-read after each side. Product snapshots both show `greet() → hello` and `farewell() → bye`.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Wrote worker `PLAYBOOK.md`, seeded greet fixture, then `parity/scripts/capture-show-me-your-work-tsv.mjs`.
3. `node parity/scripts/capture-show-me-your-work-tsv.mjs --cursor-only` (~75s).
4. Re-read `fixture-out/cursor/decisions.tsv` (2 rows, contractHeld).
5. `node parity/scripts/capture-show-me-your-work-tsv.mjs --pi-only` (~51s) with `ensurePiTrust` + `waitPiChatReady`.
6. Re-read `fixture-out/pi/decisions.tsv` (4 rows including start + supersede, contractHeld).

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Cursor wrote product ~2s before the TSV appeared on disk. Pi trail and product landed in the same poll window.
3. Pi logged a `start` row and a superseding `phase1` row after a BSD `sed` failure. Append-only supersede matches the skill. Contract still held.
4. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or the scenario stub.
5. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge `show-me-your-work-tsv-1` into family-13 / `cmd-show-me-your-work-tsv` evidence and close PSTACK-CMD-SHOW-ME-YOUR-WORK-TSV-001 when ready.
2. Optionally tighten the oracle if a later freeze wants ≥1 row per named phase without counting `start` or supersede rows separately.
