GOAL
Promote atomic setup-related requirement proposals from locked setup-pstack and related sources into an owned research slice, covering rerun, validation, write, cancel, and confirmation branches already partially evidenced.

SCOPE
May write only `parity/research/requirement-slices/slice-setup-001/`.
Must not edit `parity/requirements.json` or product code.

CONTEXT
Existing verified rows `PSTACK-SETUP-*`. Closed mismatches for setup flow. Inventory under `parity/inventory.json`. Do not shrink expectations already closed by paired evidence.

ACCEPTANCE
At least 12 atomic proposals with hashes and locators. Map each to existing evidence or mark unverified. Unresolved queue explicit.

VERIFY
Recompute quoted source hashes. List inventory files in the setup topic still without a proposal.

TIMEBOX
60 minutes.

FORBIDDEN
No freeze, no ledger edits, no bulk host-node import.

REPORT
`parity/research/requirement-slices/slice-setup-001/report.md`

STANDING
Obey orch preferences.md verbatim.
