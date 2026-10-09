GOAL
Capture a linked Cursor+Pi pair for PSTACK-CMD-BENNY-REPRO-FAIL-CLOSED-001: starting reproduce-and-fix-issues with missing required Benny config fails closed (no UI repro, product edits, or draft PR).

SCOPE
May write under `parity/evidence/benny-repro/` (or similar), capture scripts, and `parity/briefs/reports/u-journey-cmd-benny-repro-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/cmd-benny-repro-fail-closed.json`. Fixture: Benny pack present; external config intentionally incomplete. Does not need to mutate shared pstack-models.mdc.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations: fail-closed on both hosts (or honest mismatch).
- Report only; coordinator merges ledgers.

VERIFY
Real PTY both sides. Re-read pair + screens.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-cmd-benny-repro-report.md

STANDING
Obey orch preferences.md.
