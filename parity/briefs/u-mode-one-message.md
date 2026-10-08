GOAL
Capture a linked Cursor+Pi pair for `PSTACK-MODE-ONE-MESSAGE-001` (`/poteto-mode` with plain Enter) and publish a Method-ready report with attempt IDs. Do not edit the requirement ledger.

SCOPE
May write under `parity/evidence/mode-one-message/` and `parity/briefs/reports/u-mode-one-message-report.md`.
Must not edit `parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, or product code unless a measured defect blocks the capture and the report names the minimal repair separately.

CONTEXT
Requirement row in `parity/requirements.json`. Prior setup and investigate harness under `parity/scripts/`. Fixture first-run digest `sha256:2b6b4668…`. Standing orders at the orch preferences path.

ACCEPTANCE
Linked pair JSON, identical fixture digests, observed one-message vs sticky behavior documented, report with pass/fail/partial.

VERIFY
Real PTY capture both sides. Re-read screens and session for mode duration across the next user turn.

TIMEBOX
90 minutes.

FORBIDDEN
No commit, no ledger edits, no gt/rebase/force-push, no fabricating mode stickiness.

REPORT
`parity/briefs/reports/u-mode-one-message-report.md`

STANDING
Obey orch preferences.md verbatim.
