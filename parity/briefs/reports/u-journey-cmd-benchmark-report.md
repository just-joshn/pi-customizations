# u-journey-cmd-benchmark report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both hosts answered `/benchmark-checklist` as a one-run ballpark with Q4 and Q7 from `run-evidence.json`, not code guesses. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `fef1b56c-e1bd-4f8c-83d1-dca9487c6b44` |
| pi | `f35d81bd-a200-44fb-a673-039bdf1192ae` |

Pair. `parity/evidence/benchmark/pair-benchmark-checklist-evidence-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Contract held?

| Side | Skill invoke | Q4 from run | Q7 from run | One-run label | Verdict |
| --- | --- | --- | --- | --- | --- |
| cursor | yes (PTY `/benchmark-checklist`) | yes (`errorCount: 0`) | yes (`workHappened: true`) | yes | **yes** |
| pi | yes (PTY + settled prose) | yes (`errorCount: 0`) | yes (timed sorts verified) | yes | **yes** |

Oracle. Durable `checklist-report.md` / `done.txt` / `run-evidence.json` under `parity/evidence/benchmark/fixture-out/{cursor,pi}/`. Re-read settled screens. Not skill-load chrome alone.

Both sides rejected shipping the draft "about 25%" comparative sentence from one run (~98% gap measured). That matches the forbidden side effect (no comparative claim labeled ballpark without the required checks).

## Commands run

1. Wrote `parity/evidence/benchmark/PLAYBOOK.md`, fixture (`claim.md`, `measure.mjs`), and `parity/scripts/capture-benchmark-checklist.mjs`.
2. `node parity/scripts/capture-benchmark-checklist.mjs --self-test` (pass / missing_q4 / missing_one_run / done line cases).
3. `node parity/scripts/capture-benchmark-checklist.mjs --cursor-only` (~33s). Attempt `fef1b56c…`.
4. `node parity/scripts/capture-benchmark-checklist.mjs --pi-only` (~28s). Attempt `f35d81bd…`.
5. Re-read both marker sets, settled screens, identities, locked models.mdc digest.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Settled-screen skill chrome scrolled off on both hosts. PTY stream and artifacts are the proof.
3. Path exercised is the skill's one-run ballpark branch (Q4+Q7), not the full seven-question comparative harness.
4. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or the scenario stub `pairId`.
5. Did not commit.

## Honest product gaps

1. Full multi-run comparative path (questions 1–3, 5, 6, limiter profiling) remains unverified by this pair.
2. Acceptance text stays DRAFT / not frozen.
3. Host report shapes differ (sectioned vs bullets). Behavior matches.
4. Fixture input is deterministic modulo arithmetic, not random ints as the draft claim says. Pi called that out; Cursor focused on the 25% mismatch.
5. `run-evidence.json` in the live fixture cwd is cleared between sides by the harness restore. Snapshots under `fixture-out/` and attempt `fixture-snapshot/` keep the numbers.

## Suggested follow-ups for the coordinator

1. Link `benchmark-checklist-evidence-1` into `cmd-benchmark-checklist-evidence` and close `PSTACK-CMD-BENCHMARK-CHECKLIST-EVIDENCE-001` when ready, or keep it open until a full-checklist comparative pair exists if the oracle requires that breadth.
2. Optional. Capture a negative path that tries to ship a comparative "winner" without Q4/Q7.
