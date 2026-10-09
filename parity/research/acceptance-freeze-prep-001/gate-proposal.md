# Acceptance-definition custody gate

## Question

Will the operator establish an external custodian for the acceptance-definition bytes and authorize that custodian to review a complete denominator?

## Options

1. Establish external custody.
   - Recover the exact definition and configuration bytes whose recorded SHA-256 values are listed in `freeze-prep.json`.
   - Place those bytes in storage controlled by a principal that the implementation owner cannot write.
   - Record the custodian's authenticated identity and the content hashes.
   - Repair and independently review the supporting verifier defects listed in `parity/reviews/acceptance-repair-independent-triage.md`.
   - Complete the requirement-by-configuration denominator and bind the reference runs to the reviewed bytes.
   - Ask the coordinator to rerun this package before any ledger promotion.
2. Keep the gate parked.
   - Leave the owner fields null.
   - Leave `acceptanceDefinitionsFrozen` false.
   - Keep the recorded 43 definitions and 92 configuration cells as DRAFT evidence only.

## Default

Keep the gate parked. The current checkout has no candidate definition bytes, no independent owner, no external custody, no authorization, and no complete denominator. A same-user worktree or a different model-family label does not establish custody.

The word `custody` selects option 1 after the operator provisions the external principal and immutable storage.
