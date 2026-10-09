# Benchmark checklist (ballpark, one run)

Claim under review (from `claim.md`): `sortFast is about 25% faster than sortSlow on 5000 random ints`.

Measurement: one run of `measure.mjs` → `run-evidence.json` in the fixture cwd.

**This is one run.** Quick ballpark only; questions 1–3, 5, and 6 skipped because the run does not look wrong (errors clean, timed work present).

## Verdict

Inconclusive for the draft “about 25%” sentence. The single run shows a much larger gap: `slowMs` 18.01 ms → `fastMs` 0.25 ms (`speedupPct` ≈ 98.6%) on n=5000. Do not ship “about 25%” from this evidence. Comparative wording is fine only as a one-run ballpark with Q4/Q7 checked; not a multi-run winner call.

## Question 4 — Did it error?

**Yes — checked from the run.** `errorCount: 0`, `outputsCorrect: true`. Both outputs were sorted and length N.

## Question 7 — Did it even happen?

**Yes — checked from the run.** `workHappened: true`. Timed region: `sortSlow then sortFast over the same input array`; both results length 5000 and sorted.

## Evidence

- Path: `parity/evidence/benchmark/fixture-app/run-evidence.json`
- `runCount: 1`
- `n: 5000`
- `slowMs: 18.014542000000002`
- `fastMs: 0.24783299999999997`
- `speedupPct: 98.62426144389349`
- `errorCount: 0`
- `outputsCorrect: true`
- `workHappened: true`
