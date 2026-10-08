# Independent supporting-tool review triage

Readonly review task cd26c2a8-d502-4883-8ff7-9fc58691aff6 concluded the narrow counterfeit-freeze guard is sound by source inspection and recorded parent execution. It did not execute the tool or authenticate its physical backend. It reported four supporting-tool defects, not acceptance authority or a freeze bypass.

The parent reproduced all four against disposable copies.

1. Output symlink escape. --write-hashes exited 0 and changed an owned sibling canary outside the acceptance root. Evidence is acceptance-symlink-* and the separate parent reproduction note.
2. Actual ledger bytes not pinned. A trailing newline was appended to the copied record-hashes.json. Verification against the unchanged original manifest pin exited 0. Evidence is `../evidence/acceptance-ledger-byte-replay.json`.
3. Invalid locator accepted. An otherwise valid DRAFT record was cloned under a new id with its source locators set to not-a-line. --write-hashes exited 0. Evidence is `../evidence/acceptance-invalid-locator-replay.json`.
4. Missing pin argument downgraded. A trailing --expect-manifest-sha256 with no value exited 0 and reported externalPin absent. Evidence is `../evidence/acceptance-missing-pin-replay.json`.

All four findings are accepted for supporting-tool repair. The source review also found test helpers overwrite a write attempt's result with a subsequent verification result before asserting it. Both operations need independent assertions.

A fresh repair owner must preserve the original definition and configuration bytes, all original record expectations, and authorization NONE. Repair filesystem containment before writes; hash actual stored ledger bytes during verification; validate positive ordered integer locators; reject missing/empty/malformed pin arguments; and add focused failing-before regressions. Preserve every failed attempt's evidence. Do not change source expectations, add authority, or assert external custody.

No original acceptance artifact was modified by these reproductions. No production parity verdict changed. The reviewer report remains in the exact owned task transcript and the parent triage records its claims as source findings with separate reproduction evidence.
