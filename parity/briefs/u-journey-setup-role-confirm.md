GOAL
Capture a linked Cursor+Pi pair proving setup role confirmation shows every role with its model and asks accept/change before write (PSTACK-SETUP-ROLE-CONFIRM-001).

SCOPE
May write under `parity/evidence/setup-role-confirm/`, capture scripts, `parity/briefs/reports/u-journey-setup-role-confirm-report.md`, and a tiny fixture.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/setup-role-confirm.json`. Prefer a first-run or rerun that surfaces the role table / AskQuestion before write. Standing orders: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations: role table shown with models; write only after confirm (or honest fail/mismatch).
- Honest host deltas recorded.

VERIFY
Real PTY both sides. Re-read screens for role listing and ordering vs write.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-setup-role-confirm-report.md

STANDING
Obey orch preferences.md.
