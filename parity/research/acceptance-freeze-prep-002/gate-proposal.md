# Acceptance-definition custody gate

## Question

Will the operator establish an external custodian for the live-98 DRAFT acceptance-definition bytes and authorize that custodian to freeze them?

## Current candidate (measured)

| Artifact | Path | SHA-256 |
| --- | --- | --- |
| Definitions | `parity/acceptance/setup-pstack/definitions.json` | `e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5` |
| Configurations | `parity/acceptance/setup-pstack/configurations.json` | `9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e` |

These bytes cover 98 live requirement IDs with `denominatorComplete: true` on the DRAFT documents. They replace the historical 43-definition setup partition digests from freeze-prep-001.

## Options

1. Establish external custody.
   - Place the measured definition and configuration bytes in storage the implementation owner cannot write.
   - Record an authenticated custodian identity distinct from the implementation parent.
   - Repair and independently review the supporting verifier defects in `parity/reviews/acceptance-repair-independent-triage.md` and `parity/reviews/acceptance-symlink-parent-reproduction.md`.
   - Bind reviewed reference runs to the measured digests above.
   - Ask the coordinator to rerun `parity/research/acceptance-freeze-prep-002/` before any ledger promotion.
2. Keep the gate parked.
   - Leave `acceptanceDefinitionOwner` null.
   - Leave `acceptanceDefinitionsFrozen` false.
   - Keep the live-98 bytes as DRAFT for review only.

## Default

Keep the gate parked. Bytes are present and the coverage denominator flag is true, but independent ownership, external custody, freeze authorization, and a safe supporting verifier still fail. A same-user worktree or a different model-family label does not establish custody. Naming the implementation parent as owner is forbidden.

The word `custody` selects option 1 after the operator provisions the external principal and immutable storage.
