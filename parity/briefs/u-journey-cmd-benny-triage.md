GOAL
Capture a linked Cursor+Pi pair for PSTACK-CMD-BENNY-TRIAGE-THREAD-ONLY-001 (Benny triage stays thread-scoped as specified by the requirement).

SCOPE
May write under `parity/evidence/benny-triage/` (or similar), capture scripts, and `parity/briefs/reports/u-journey-cmd-benny-triage-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/cmd-benny-triage-thread-only.json`. Reuse benny-repro harness patterns from `parity/evidence/benny-repro/` / `parity/scripts/capture-benny-repro-fail-closed.mjs` where useful. Prefer not racing shared `pstack-models.mdc`.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations match the requirement (or honest fail/mismatch).
- Report only; coordinator merges.

VERIFY
Real PTY both sides. Re-read pair + screens.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-cmd-benny-triage-report.md

STANDING
Obey orch preferences.md.
