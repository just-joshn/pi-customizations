GOAL
Produce a falsifiable coverage-denominator package that lets the coordinator set `coverageDenominatorComplete: true` only when every inventory item has an explicit disposition (mapped requirement id, deferred-with-reason, or out-of-scope-with-reason), without shrinking the denominator.

SCOPE
May write under `parity/research/coverage-denominator-001/`, `parity/briefs/reports/u-coverage-denominator-001-report.md`.
Must not edit ledgers. Publish a merge payload for coordinator apply.

CONTEXT
`parity/inventory.json` has 193 items. `parity/requirements.json` has 98 requirements and `coverageDenominatorComplete: false`. Prior slices under `parity/research/requirement-slices/`. Completion gate blocks on COVERAGE_DENOMINATOR_INCOMPLETE.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Matrix covering all 193 inventory items with disposition.
- Explicit unresolved queue if any item lacks disposition (then do NOT recommend setting complete true).
- Merge payload: either set complete true with hash of the matrix, or keep false with concrete remaining work.
- No invented mappings.

VERIFY
Assert matrix length == inventory items; every disposition cites source path or rationale.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricate complete. No commit. Do not spawn further subagents.

REPORT
parity/briefs/reports/u-coverage-denominator-001-report.md

STANDING
Obey orch preferences.md.
