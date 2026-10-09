# Acceptance verifier write-containment repair

## Overview

Defect 1 from the independent re-review is closed in the owner worktree. Symlinked output parents and hardlinked outputs are refused before any write. Outside canaries stay unchanged. Final-path symlink rejection still holds. Full selftest passes. Oracle definition and configuration bytes are unchanged. Authorization remains `NONE`. No freeze was attempted. No ledger was edited beyond regenerating `MANIFEST.sha256` after the tool and selftest digests changed.

Independent re-review should be re-run before any honest flip of `supporting-verifier-safe-for-custody`.

## What was broken

`--write-hashes` confined only the final pathname of `MANIFEST.sha256` and `setup-pstack/record-hashes.json` via `lstatSync`. That rejected a symlink at the leaf. It did not reject a symlink in a parent path component. It did not reject a hard link (`nlink > 1`). `writeFileSync` then followed both cases and mutated files outside the copied acceptance root while printing `structural: PASS`.

`listFiles` used `statSync`, so directory symlinks were followed during manifest traversal.

## Root cause

Measured RED (tool digest `26c51417…0599`) under disposable copies:

| Attack | Exit | Outside canary |
| --- | --- | --- |
| Hardlinked `MANIFEST.sha256` | 0 | Changed |
| Symlinked `setup-pstack` parent | 0 | Outside `record-hashes.json` rewritten |
| Final-path symlink (already closed) | 1 | Unchanged |

Transcript: `parity/research/acceptance-verifier-containment-001/red-containment-attacks.txt`.

## Fix

In `tools/verify-acceptance.mjs`:

- Replaced `rejectSymlinks` with `rejectUnsafeOutputs`. Walks every path component of each write target with `lstatSync`, refuses symlinks on any component, refuses non-regular finals, and refuses `nlink > 1`.
- Hardened `listFiles` to use `lstatSync` and throw if it meets a symlink, so traversal never follows directory links.

In `tools/selftest.sh` and `review/regressions/`:

- Added hardlink and symlinked-parent cases that assert non-zero exit and untouched outside files.
- Kept existing final-path symlink and ledger/locator/pin regressions.

## Verification

GREEN on the same attacks (exit 1, canaries unchanged): `parity/research/acceptance-verifier-containment-001/green-containment-attacks.txt`.

| Check | Exit |
| --- | --- |
| Full selftest | 0 |
| `hardlinked-output.sh` | 0 (verifier exit 1, canary unchanged) |
| `symlinked-output-parent.sh` | 0 (verifier exit 1, outside unchanged) |
| `ledger-byte-drift` / `invalid-locator` / `missing-pin-arg` | 0 |
| Clean pinned verify | 0, `authorization: "NONE"`, `externalPin: "matched"` |

Replay for reviewers: `parity/research/acceptance-verifier-containment-001/replay-green.sh`.

Note: `parity/research/acceptance-verifier-rereview-001/replay.sh` still asserts the RED shape for hardlink and parent attacks. After this fix those two assertions fail by design. Use `replay-green.sh` instead.

## Artifact digests

| Artifact | Before | After |
| --- | --- | --- |
| `tools/verify-acceptance.mjs` | `26c5141784cba4130962a7817821e5b03d6522982dec73b6309a173c19770599` | `5a33e1d4138283fe5d474cef5ccca575847e66e61f4a0c655ab6372106711aa7` |
| `tools/selftest.sh` | (prior repair) | `3bd5d296a589b7c355d9e70cbd48a78a01e26267e8279d967f0eb50a10ec3b9a` |
| `setup-pstack/definitions.json` | `e4e84566…05cb4` | unchanged |
| `setup-pstack/configurations.json` | `3755a291…a80f` | unchanged |
| `setup-pstack/record-hashes.json` | `4a218e21…8238` | unchanged |
| `MANIFEST.sha256` | `10bd005e…627c` | `de2d01434531e7cad6a6f138975db44145e1d97753f27450e4dd56d26409898a` |

## Residual gaps

- External custody, authenticated transition authority, reference-run registry, denominator completeness, and final acceptance gate remain open blockers reported by the verifier itself.
- Bind mounts, device-boundary tricks, and TOCTOU between the pre-write check and `writeFileSync` are not covered.
- Non-output files under the acceptance tree are not hardlink-checked; only the two write targets are.
- This unit does not freeze, grant custody, or flip `supporting-verifier-safe-for-custody`. That flip needs a fresh independent re-review against the new tool digest.

## Flip guidance

Containment cases that kept defect 1 open are closed with runtime evidence. Re-run an independent re-review against tool digest `5a33e1d4…1aa7` before treating the supporting verifier as safe for custody preparation. Authorization remains `NONE`. The partition remains DRAFT.
