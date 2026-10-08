GOAL
Capture a linked Cursor+Pi pair for `PSTACK-MODE-STICKY-001` (`/poteto-mode` with Option+Enter / Alt+Enter) and publish a report with attempt IDs. Do not edit the requirement ledger.

SCOPE
May write under `parity/evidence/mode-sticky/` and `parity/briefs/reports/u-mode-sticky-report.md`.
Must not edit ledgers or product code unless a measured defect is reported separately.

CONTEXT
Requirement row in `parity/requirements.json`. Depends on knowing one-message baseline from `u-mode-one-message`. Standing orders at orch preferences path. Do not start until `u-mode-one-message` is done if both need the same PTY hosts.

ACCEPTANCE
Linked pair JSON, fixture digests match, sticky behavior across a following turn is documented with screens or transcript evidence.

VERIFY
Real PTY both sides. Confirm mode still active on the next user message after sticky activation.

TIMEBOX
90 minutes.

FORBIDDEN
No commit, no ledger edits, no gt/rebase/force-push.

REPORT
`parity/briefs/reports/u-mode-sticky-report.md`

STANDING
Obey orch preferences.md verbatim.
