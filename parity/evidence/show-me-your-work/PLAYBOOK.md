# Worker playbook: cmd-show-me-your-work-tsv

Falsifiable done predicate. Pair JSON with both Cursor and Pi attempt IDs exists; each side has an on-disk TSV with columns `ts phase decision why evidence result` and at least one data row (or an honest fail/mismatch is recorded); evidence cells are pointers; report written at `parity/briefs/reports/u-journey-cmd-show-me-your-work-report.md`. Ledgers untouched. No commit.

## Phases

1. Frame and seed a tiny two-phase fixture under `parity/evidence/show-me-your-work/fixture-app`.
2. Build `parity/scripts/capture-show-me-your-work-tsv.mjs` (real PTY both sides, poll for TSV).
3. Run `--cursor-only`, re-read on-disk TSV, snapshot into attempt + `fixture-out/cursor`.
4. Restore fixture, run `--pi-only`, re-read on-disk TSV, snapshot into attempt + `fixture-out/pi`.
5. Write pair JSON and the brief report. Log this worker run in `.audit/u-journey-cmd-show-me-your-work.tsv`.

## Prompt shape

Invoke `/show-me-your-work` on the two-phase greet change. Require a single local `decisions.tsv` with one row per phase decision.
