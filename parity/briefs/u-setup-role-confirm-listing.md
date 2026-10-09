GOAL
Repair Pi `/setup-pstack` role confirmation so every role is shown with its model (not a uniform summary), close SETUP-ROLE-CONFIRM-LISTING, and recapture a linked pass-paired run.

SCOPE
May edit `extensions/pi-pstack` setup skill/tool/prompt paths that author the role-confirm AskQuestion (prefer skill text and/or `pstack_setup` state presentation), tests, `parity/evidence/setup-role-confirm/`, capture scripts, `parity/briefs/reports/u-setup-role-confirm-listing-report.md`.
Must not edit ledgers.

CONTEXT
Mismatch SETUP-ROLE-CONFIRM-LISTING from `parity/evidence/setup-role-confirm/pair-setup-role-confirm-1.json`: Cursor lists 17/17 Role/Model rows before accept; Pi AskQuestion says "All 17 roles are currently inherit-parent" with Accept/Change and `rolesListedWithModel: 0`. Confirm-before-write already holds on both. Requirement `PSTACK-SETUP-ROLE-CONFIRM-001`. Standing orders at orch preferences path.

ACCEPTANCE
- Pi confirm screen lists each role with its model (all roles present), plus accept/change, before write.
- Package tests green for any product change.
- Linked recapture: both `everyRoleShownWithModel` true (reuse Cursor `b72b2ad5` if fixture unchanged).
- Report for coordinator; no ledger edits.

VERIFY
Real PTY for Pi (and Cursor if needed). Re-read confirm screens against the 17-role table.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No commit. No claiming summary-only equals per-role listing.

REPORT
parity/briefs/reports/u-setup-role-confirm-listing-report.md

STANDING
Obey orch preferences.md.
