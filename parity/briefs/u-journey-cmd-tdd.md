GOAL
Capture a linked Cursor+Pi pair proving `/tdd` follows the explicit gate (failing test first / skip only when impractical with stated reason) for PSTACK-CMD-TDD-EXPLICIT-GATE-001.

SCOPE
May write under `parity/evidence/tdd/`, capture scripts, `parity/briefs/reports/u-journey-cmd-tdd-report.md`.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/cmd-tdd-explicit-gate.json`. Family-05 stub lists this among open playbook journeys. Prefer a tiny fixture where a failing test must exist before product change. Standing orders at orch preferences path.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations: red test before green implementation (or honest skip with reason) on both hosts, or open mismatch if Pi skips.
- Honest host deltas recorded.

VERIFY
Real PTY both sides. Re-read screens/sessions for ordering.

TIMEBOX
120 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-cmd-tdd-report.md

STANDING
Obey orch preferences.md.
