GOAL
Capture a linked Cursor+Pi pair proving `/interrogate` does not auto-apply contested findings (PSTACK-CMD-INTERROGATE-NO-AUTOAPPLY-001).

SCOPE
May write under `parity/evidence/interrogate/`, capture scripts, `parity/briefs/reports/u-journey-cmd-interrogate-report.md`, and a tiny fixture with a contested review target.
Must not edit ledgers.

CONTEXT
Scenario: `parity/scenarios/cmd-interrogate-no-autoapply.json`. Prefer smallest adversarial review that surfaces findings without product auto-apply. Standing orders: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations: findings reported; product code not auto-applied on either host (or honest fail/mismatch).
- Honest host deltas recorded.

VERIFY
Real PTY both sides. Re-read fixture product digests before/after.

TIMEBOX
120 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-cmd-interrogate-report.md

STANDING
Obey orch preferences.md.
