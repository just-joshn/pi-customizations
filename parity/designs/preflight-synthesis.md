# Parity preflight design

## Problem

The implementation owner needs reproducible diagnostics for incomplete source, requirements, scenarios, and evidence. Draft status fields and old parity scripts cannot authorize completion. The full user contract remains the acceptance specification.

## Usage

Run `node parity/scripts/check-preflight.mjs` from the repository root. An optional argument selects another parity directory for resettable tests.

The command reads artifacts and prints a JSON report. A successful diagnostic execution exits with code 2 because it is not an acceptance verdict. Invalid command arguments exit with code 1. The command never writes ledgers or `completion.json`.

## Shape

One public operation, `inspectParity(directory)`, returns a record with `kind` equal to `preflight`, `verdict` equal to `BLOCKED`, and an ordered array of diagnostics. Each diagnostic has a stable code, artifact path, locator, contract locator, and message.

The input boundary reads fixed ledger filenames, checks object shape and schema version, and validates source and scenario paths before filesystem access. Referenced paths must be relative, contain no parent traversal, and use no symlink components. Hashes are computed from read bytes. This check is not an operating-system sandbox against concurrent hostile directory replacement.

The result cannot represent acceptance. Missing external custody and the unimplemented paired acceptance verifier remain explicit blockers even if every structural diagnostic is repaired. That is truthful preflight behavior, not the final completion gate.

The final gate must use independently approved definition epochs and authenticate execution records. The runner owns append-only attempt records, including dispatches, failures, interruptions, and retries. The gate derives closure, coverage, and freshness indexes in memory. Neither manual passing status nor a selected successful subset is authoritative.

## Synthesis decision

Candidate A is the base because linked manifests permit direct diagnosis through a small interface. Candidate B contributes complete attempt retention, definition epochs, fork detection, and sealed evidence roots. A persistent event service and materialized views are not needed for this first slice.

The different-family cross-judge recommends this combination in `../reviews/gate-cross-judge.md`. Its actual runtime model identity is not established by that report, so the review does not yet satisfy verified model-diversity acceptance.

Both original candidates lacked a complete read of the user contract. The cross-judge read the extracted contract in full and identified additional obligations. They remain required, including deployment-component freshness, held-out tasks, repeat protocols, comparison rules for interaction feel, blinded review, physical model identities, Cursor-free environments, and six product-level gate fault injections.

## Tradeoffs

- Static diagnostics are useful before live reference usage is restored, but cannot establish behavioral parity.
- Separate local worktrees prevent casual shared edits, but do not establish independent external custody.
- Existing legacy scripts remain supporting checks only. They cannot waive final acceptance. Their callers must be audited before migration or deletion.
- Incomplete acceptance definitions stay unfrozen. Runtime product repairs await the required initial definition freeze.

## Next implementation step

Write failing tests for concrete preflight diagnostics, forged passing flags, malformed input, unsafe paths, deterministic output, and zero writes. Implement only those checks and verify the command against the current incomplete artifacts.
