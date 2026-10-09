GOAL
Capture a linked Cursor+Pi pair proving existing rule budget/role values load as current choices (else skill defaults), and retired role lines are dropped and listed later (PSTACK-SETUP-LOAD-STATE-001).

SCOPE
May write under `parity/evidence/setup-load-state/`, capture scripts, `parity/briefs/reports/u-journey-setup-load-state-report.md`, and a tiny fixture with an existing rule (include a retired line if feasible).
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/setup-load-state.json`. Standing orders: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations: load-from-existing-rule (or defaults) + retired-line handling on both hosts (or honest fail/mismatch).
- Honest host deltas recorded.

VERIFY
Real PTY both sides. Diff fixture rule vs on-screen current choices.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-setup-load-state-report.md

STANDING
Obey orch preferences.md.
