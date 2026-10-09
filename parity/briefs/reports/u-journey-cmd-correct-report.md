# u-journey-cmd-correct report

## Status

**pass** for the capture brief (linked Cursor+Pi pair on real PTY, honest host deltas). Both hosts activated `/correct` on the store-boundary fixture, encoded the recurring `src/db.js` import mistake at lint level (above the pre-existing docs-only `AGENTS.md` rule), and proved the check fails on `history/past-mistake-1.js` with exit code 1. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `e05d5254-aa98-4533-b9e7-be0a6092eb3a` |
| pi | `694910a7-666d-48cf-96ee-312a10d94927` |

Pair. `parity/evidence/correct/pair-correct-encode-1.json`

Fixture rule digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Highest-level encoding + fail-on-past-mistake on both hosts?

| Side | Encoding level | Above docs | Proof on past-mistake-1 | done.txt | Verdict |
| --- | --- | --- | --- | --- | --- |
| cursor | **lint** (`scripts/check-store-boundary.js`, `npm run lint:store-boundary`, test) | **yes** | exit **1** (harness + fixture-after rerun) | `correct=yes` | **yes** |
| pi | **lint** (`scripts/check-store-boundary.js` via `npm test`) | **yes** | exit **1** (harness + fixture-after rerun) | `correct=yes` | **yes** |

Oracle. Re-read `cursor/screen-04-settled.txt` and `pi/screen-04-settled.txt`, both encoding notes, both proof markers, both `fixture-after/` check scripts, and Pi session `01a11d7b…` (skill+prompt injected). Not skill-load alone.

Both hosts rejected pure architecture for this plain-JS fixture (relative imports cannot hide `db.js` without a bundler or restructure) and rejected stopping at docs. That matches the skill ladder when architecture is not workable.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Wrote worker `PLAYBOOK.md`, `fixture-baseline/`, then `parity/scripts/capture-correct-encode.mjs`.
3. `node parity/scripts/capture-correct-encode.mjs --cursor-only` (~145s).
4. Tightened encoding-level classifier (prose mentioning rejected architecture was mislabeled).
5. `node parity/scripts/capture-correct-encode.mjs --pi-only` (~35s).
6. Re-ran each side's `fixture-after` check on `history/past-mistake-1.js` (both exit 1).
7. Re-read settled screens, markers, identities, events.jsonl line counts, Pi session path.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Cursor observations.json initially said `architecture`; rescored to `lint` after classifier fix. Pair and this report use lint from disk + encoding notes.
3. Pi `proof.txt` prefixes a repo-relative `cd`; extracted command still fails correctly from fixture cwd.
4. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or family stubs.
5. Did not commit.

## Honest product gaps

1. Neither host chose architecture-level encoding. For this fixture that is expected (and both explained why). A separate fixture would be needed if the oracle must show architecture specifically, not merely "highest working level."
2. Model chrome differs (Cursor Auto vs Pi claude-sonnet-5-5 medium). Unreconciled, same as other journey pairs.
3. Check script stderr wording differs across hosts; both name `src/store.js` and fail the past specimen.

## Suggested follow-ups for the coordinator

1. Merge `correct-encode-1` into `cmd-correct-encode` evidence and close PSTACK-CMD-CORRECT-ENCODE-001 when ready.
2. Optional later pair where architecture is the workable highest level (for example package export boundaries that make the bad import fail at resolve time).
