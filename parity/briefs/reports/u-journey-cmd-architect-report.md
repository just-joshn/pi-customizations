# u-journey-cmd-architect report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both hosts produced how-traced grounding before the soft-delete sketch. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `284b1831-6051-4b83-92b4-44a4b72609bf` |
| pi | `ab355606-e9f0-48e7-9508-08a6952de959` |

Pair. `parity/evidence/architect/pair-architect-ground-how-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Contract held?

| Side | Grounding artifact | Sketch artifact | how before sketch | Verdict |
| --- | --- | --- | --- | --- |
| cursor | `fixture-out/cursor/grounding.md` | `fixture-out/cursor/sketch.md` | yes (mtime + content order) | **yes** |
| pi | `fixture-out/pi/grounding.md` | `fixture-out/pi/sketch.md` | yes (session tool order + mtime) | **yes** |

Oracle. Durable `grounding.md` / `sketch.md` / `done.txt` on each side, plus re-read settled screens and the Pi session. Product `src/*.js` digests unchanged after both runs.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Trusted fixture cwd in `/tmp/pi-ref-agent/trust.json`.
3. Planted `parity/evidence/architect/fixture-app` (store → api → cli) and wrote `parity/scripts/capture-architect-ground-how.mjs`.
4. `node parity/scripts/capture-architect-ground-how.mjs --self-test` (ordering scorer pass/fail cases).
5. `node parity/scripts/capture-architect-ground-how.mjs --cursor-only` (~406s).
6. `node parity/scripts/capture-architect-ground-how.mjs --pi-only` (~54s).
7. Re-read both grounding/sketch files, Cursor settled screen (Arena after grounding), Pi session (`read how/SKILL.md` before write bash), product digests.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Cursor ran how explorers + arena fan-out (3 candidates). Pi used the how simple path inline (no how Task) and skipped arena, writing candidates in the sketch. Ordering still how-grounding then sketch on both.
3. Pi wrote grounding and sketch in one bash heredoc. Grounding mtime is still earlier by ~9ms. Session order is the stronger proof.
4. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or scenario stubs.
5. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge `architect-ground-how-1` into `cmd-architect-ground-how` evidence and close PSTACK-CMD-ARCHITECT-GROUND-HOW-001 when ready.
2. Decide whether Pi's inline how / skipped arena is acceptable parity or needs a stricter spawn gate matching Cursor.
3. Optionally recapture Pi with a larger fixture that forces how Task spawn and arena runners.
