# Fact-check review

## Method and result

`fact-check.mjs` independently re-reads recorded artifacts, current reference files, the installed plugin cache, the inspected Pi API files, the installed regex dependency, and tracked change names. The scoped identity checks pass. The result is `.audit/pstack-full-parity-2026-11-04/fact-check.json`.

This is a separate deterministic review pass by the same assistant. It is not an independent external review and does not certify whole-plugin parity.

## Claims retained

- The target is the installed pstack 0.15.36 revision, not the older local source checkout. Every captured pstack file matches the installed cache at that revision.
- The recorded archive hash and captured source-file hashes match the current evidence files.
- The inspected Pi 1.5.0 API files match the hashes recorded before implementation.
- The native and reference regex dependencies resolve to the same identified CommonJS bytes. The downloaded archive matches its recorded SHA-256 and npm SHA-512 integrity.
- The inventories contain 613 source-file records, 545 dependency-reference candidates, and 75 captured host factories. These are inventory counts, not behavioral coverage.
- The monitor fixture has 22 distinct stable behavior IDs. It is an incomplete behavior inventory.
- Tracked changes stay within pi-pstack, its root lockfile, and this audit.

## Correction made during review

The first fact-check found that two references on one source line received the same dependency ID. The source capture now records the column, and the ID includes that column. The uniqueness check passes without weakening the assertion.

## Claims rejected

- All direct and transitive dependencies have been behaviorally reconstructed.
- All Cursor workflows have run against the native implementation.
- A local worktree is equivalent to a remote cloud VM.
- A loopback webhook with local supervision proves hosted automation equivalence.
- The installed lifecycle probe reproduces or fixes a cancellation hang.
- Passing repository tests establishes 100% Cursor parity.
- The reviews were performed by independent reviewers.
- This run complied with the operator's no-other-LLM restriction.

The last claim is false because `cursor agent status` mistakenly launched another LLM. The operator was informed. That response is excluded from the evidence and the reviews.

## Verdict

The bounded artifact-identity claims pass. The requested full behavioral and functional parity remains `NOT VERIFIED`.
