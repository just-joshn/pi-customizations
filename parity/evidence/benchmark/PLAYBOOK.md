# Benchmark checklist capture playbook

## Predicate

Pair JSON with Cursor and Pi attempt IDs from real PTY. Each side invokes `/benchmark-checklist` against the held-out one-run ballpark claim. Answers cite run evidence. Questions 4 and 7 are checked. The report labels itself as one run. No ledger edits. No commit.

## Fixture

`parity/evidence/benchmark/fixture-app`

- `claim.md` draft ballpark claim
- `measure.mjs` one-run timer writing `run-evidence.json`

## Lever

`parity/scripts/capture-benchmark-checklist.mjs`

Flags: `--self-test`, `--cursor-only`, `--pi-only`, `--both`

## Score

Contract holds when all are true:

1. Skill chrome or report proves checklist invocation
2. Report or done marker cites run evidence (`run-evidence.json`, measured ms, or `measure.mjs` output)
3. Question 4 (errors / output correctness) is answered from the run
4. Question 7 (work happened in the timed region) is answered from the run
5. Explicit one-run / ballpark label
6. No comparative winner shipped without those checks

## Sequence

1. `--self-test`
2. `--cursor-only`
3. `--pi-only`
4. Re-read screens, markers, digests
5. Publish pair JSON + report
