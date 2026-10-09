# u-journey-cmd-tdd report

## Status

**pass** for the capture brief (linked Cursor+Pi pair on real PTY, honest host deltas). Red-before-green held on both hosts for the cheap unit path. Ledgers untouched. No commit. Scenario action 2 (impractical-skip) was not captured in this pair.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `168c3046-79db-4405-b8d3-1f6385608d65` |
| pi | `852f2c23-5efc-43ba-b2ea-d8b4f9ee5670` |

Pair. `parity/evidence/tdd/pair-tdd-explicit-gate-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Red before green?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | FS poll. `test/clamp.test.js` at `2026-10-08T19:32:32.749Z`; first product `src/clamp.js` at `2026-10-08T19:33:02.379Z`. PTY stream shows `Red confirmed (10 !== 5). Fixing production code next.` before `Editing clamp.js`. |
| pi | **yes** | FS poll. test at `2026-10-08T19:34:37.357Z`; product at `2026-10-08T19:34:39.873Z`. Session `01a11d02…` bash wrote `test/clamp.test.js` and ran `node --test` (fail `10 !== 5`) before the next bash rewrote `src/clamp.js` and reran green. |

Worker capture playbook. `parity/evidence/tdd/PLAYBOOK.md` was written before the capture script run.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths.
2. Wrote worker `PLAYBOOK.md`, fixture-app (`src/clamp.js` upper-bound bug), then `parity/scripts/capture-tdd-explicit-gate.mjs`.
3. `node parity/scripts/capture-tdd-explicit-gate.mjs --cursor-only` (~150s).
4. `node parity/scripts/capture-tdd-explicit-gate.mjs --pi-only` (~21s).
5. Re-read screens, poll logs, Cursor PTY decode, Pi session tool order.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Pi wrote `done.txt` via relative `../../fixture-out/pi` from the fixture cwd, landing at `parity/evidence/fixture-out/pi/done.txt` instead of the prompted absolute `parity/evidence/tdd/fixture-out/pi/done.txt`. Copy kept under the Pi attempt dir as `done-wrong-relative-path.txt`.
3. Pi skill collision. Screen selected `~/.agents/skills/tdd/SKILL.md` and skipped the package skill under `extensions/pi-pstack/skills/tdd`.
4. Did not exercise scenario action 2 (impractical / skip TDD). This pair covers the cheap-unit red-first path only.
5. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or the family-05 stub.
6. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-05 / `cmd-tdd-explicit-gate` evidence when ready.
2. Optionally capture a second pair for the impractical-skip action.
3. Optionally tighten Pi prompt or post-check so `done.txt` must land under the prompted absolute path.
