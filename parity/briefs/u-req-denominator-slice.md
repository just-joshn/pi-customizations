GOAL
Promote one independently falsifiable requirement slice from the locked pstack inventory into draft requirement records under an owned path, without shrinking the denominator or freezing acceptance.

SCOPE
May write only `parity/research/requirement-slices/slice-commands-001/` (new directory tree: `proposals.json`, `read-receipts.json`, `report.md`).
Must not edit `parity/requirements.json` (coordinator merges). Must not edit product code.

CONTEXT
`parity/inventory.json` (193 items). Official lock pstack 0.15.15 @ ccb5507. Seeds include all slash commands and skill entry points. Prior host proposals must not be bulk-promoted.

ACCEPTANCE
At least 10 new atomic requirement proposals with source file, locator, content hash, trigger, expected observations, and configuration cells. Explicit unresolved queue. No status set to verified.

VERIFY
Recompute hashes for every quoted source span. List uncovered inventory items remaining in the slice topic.

TIMEBOX
60 minutes.

FORBIDDEN
No freeze, no bulk import of the 1076 host nodes, no ledger edits.

REPORT
`parity/research/requirement-slices/slice-commands-001/report.md`

STANDING
Obey orch preferences.md verbatim.
