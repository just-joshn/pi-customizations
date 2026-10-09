GOAL
Capture a linked Cursor+Pi pair proving the maintain-verification-skill offer / flow after generate+prove (PSTACK-SETUP-CREATE-VERIFY-OFFER-MAINTAIN-001 and/or PSTACK-CMD-MAINTAIN-VERIFY-OUTCOMES-001 as observed).

SCOPE
May write under `parity/evidence/create-verify/`, extend capture scripts, `parity/briefs/reports/u-create-verify-maintain-report.md`.
Must not edit ledgers.

CONTEXT
Family-13 partial; PROVE closed on `create-verify-prove-1`. Scenarios: `parity/scenarios/setup-create-verify-offer-maintain.json`, `cmd-maintain-verify-outcomes.json`. Prefer smallest offer-then-maintain path on hello-cli. Standing orders at orch preferences path.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations: maintain offer and/or maintain outcomes on both hosts, or honest fail/mismatch.
- Honest host deltas recorded.

VERIFY
Real PTY both sides.

TIMEBOX
120 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-create-verify-maintain-report.md

STANDING
Obey orch preferences.md.
