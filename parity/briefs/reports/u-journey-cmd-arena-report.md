# u-journey-cmd-arena report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both hosts ran N=2 fan-out, picked a base, grafted from the loser, and verified. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `c29a2b1d-9134-40bf-927f-68411fdb5772` |
| pi | `e4631b87-3d59-4e77-b3ff-05f7b0a740a3` |

Pair. `parity/evidence/arena/pair-arena-base-graft-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Contract held?

| Side | Fan-out | Base | Graft | Verify | Verdict |
| --- | --- | --- | --- | --- | --- |
| cursor | c1+c2 dirs; Phase B on settled screen | c2 | from c1 (decode + typeof) | Node ESM asserts in synthesis | **yes** |
| pi | session `task`×2; c1+c2 dirs | c1 | from c2 (`decodeRun`) | 12-input node compare in synthesis | **yes** |

Oracle. Durable candidates, `synthesized/parseQuery.js`, `synthesis.md`, and `done.txt` on each side, plus re-read settled screens and the Pi session tool order. Scorer `contractOk` true both sides.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Trusted fixture cwd in `/tmp/pi-ref-agent/trust.json`.
3. Planted `parity/evidence/arena/fixture-app` and wrote `parity/scripts/capture-arena-base-graft.mjs`.
4. `node parity/scripts/capture-arena-base-graft.mjs --self-test` (pass/fail/converge cases).
5. `node parity/scripts/capture-arena-base-graft.mjs --cursor-only` (~261s).
6. `node parity/scripts/capture-arena-base-graft.mjs --pi-only` (~113s).
7. Re-read synthesis files, Cursor settled screen (Phase B–E), Pi session (`task`×2 then synthesis).

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Cursor picked base **c2**; Pi picked base **c1**. Both grafted from the loser. Shape differs, contract matches.
3. Cursor ran an Arena cross-judge agent. Pi skipped cross-judge and scored the rubric in the parent (honest delta in synthesis).
4. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or scenario stubs.
5. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge `arena-base-graft-1` into `cmd-arena-base-graft` evidence and close PSTACK-CMD-ARENA-BASE-GRAFT-001 when ready.
2. Decide whether Pi skipping Phase C cross-judge is acceptable parity or needs a spawn gate matching Cursor.
3. Optionally recapture with N=3 or a design-only bakeoff if product wants stronger multi-model diversity evidence.
