GOAL
Capture a linked Cursor+Pi pair proving the generated verify skill’s live prove step (PSTACK-SETUP-CREATE-VERIFY-PROVE-001) after generate, without claiming maintain unless observed.

SCOPE
May write under `parity/evidence/create-verify/`, extend capture scripts, `parity/briefs/reports/u-create-verify-prove-report.md`.
Must not edit ledgers.

CONTEXT
Family-13 partial; GENERATE closed on `create-verify-helpers-1`. Scenario: `parity/scenarios/setup-create-verify-prove.json`. Prefer smallest prove path on the hello-cli fixture (run Drive/Evidence to a pass). Standing orders at orch preferences path.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations: live prove ran (artifacts or screen oracle) on both hosts, or honest fail/mismatch.
- Honest host deltas recorded.

VERIFY
Real PTY both sides.

TIMEBOX
120 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. Do not mark maintain unless offer observed.

REPORT
parity/briefs/reports/u-create-verify-prove-report.md

STANDING
Obey orch preferences.md.
