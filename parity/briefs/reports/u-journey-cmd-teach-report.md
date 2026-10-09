# u-journey-cmd-teach report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both hosts wrote how and why grounding artifacts before the woven teach explanation. Product `src/clamp.js` digest unchanged. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `738b745d-a4e0-464e-809a-928d12529074` |
| pi | `9056a9b3-2f90-4015-b907-8895a599ae3a` |

Pair. `parity/evidence/teach/pair-teach-how-why-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Contract held?

| Side | how artifact | why artifact | teach artifact | how/why before teach | Verdict |
| --- | --- | --- | --- | --- | --- |
| cursor | `fixture-out/cursor/how.md` | `fixture-out/cursor/why.md` | `fixture-out/cursor/teach.md` | yes (mtime + content shapes) | **yes** |
| pi | `fixture-out/pi/how.md` | `fixture-out/pi/why.md` | `fixture-out/pi/teach.md` | yes (session tool order + mtime) | **yes** |

Oracle. Durable `how.md` / `why.md` / `teach.md` / `done.txt` on each side. Re-read settled screens and the Pi session JSONL. Not skill-load chrome alone.

Pi session tool order. `bash` → `read(how/SKILL.md)` → `read(why/SKILL.md)` → `task` ×2 → `read_agent` ×2 → `bash` (marker write). Screen-02 shows `[skill] teach`.

Cursor. `how.md` carries Overview / Key Concepts / How It Works. `why.md` carries Sources Consulted and Confidence Summary with Direct/Inferred hedges. `teach.md` weaves both. mtimes are how < why < teach. Settled screen shows the woven explanation (including flow diagrams).

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Trusted fixture cwd in `/tmp/pi-ref-agent/trust.json`.
3. Planted `parity/evidence/teach/fixture-app` (`src/clamp.js` + README) and wrote `parity/scripts/capture-teach-how-why.mjs`.
4. `node parity/scripts/capture-teach-how-why.mjs --self-test` (ordering scorer pass/fail cases).
5. `node parity/scripts/capture-teach-how-why.mjs --cursor-only` (~219s).
6. `node parity/scripts/capture-teach-how-why.mjs --pi-only` (~82s).
7. Re-read both marker sets, Cursor settled screen, Pi session (`read how/SKILL.md` and `why/SKILL.md` before marker write), product digests.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Harness `howSkill`/`whySkill` flags also match `/how.md` and `/why.md` path tokens in the typed prompt. Authoritative proof is artifact content, mtimes, and the Pi session tool order.
3. Cursor PTY on this run did not show `Used how` / `Used why` chrome strings. How/why follow-through is evidenced by artifact shapes and write order.
4. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or scenario stubs.
5. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge `teach-how-why-1` into `cmd-teach-how-why` evidence and close PSTACK-CMD-TEACH-HOW-WHY-001 when ready.
2. Optional harness tweak. Score skill chrome from session/PTY without treating marker path tokens as `/how` or `/why` slash hits.
3. Optional. Copy side-root screens into attempt dirs inside the capture script (this run copied them after the fact for durable re-verify).
