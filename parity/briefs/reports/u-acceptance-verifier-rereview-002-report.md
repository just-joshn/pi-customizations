# Acceptance verifier independent re-review 002

## Overview

Decision: `supporting-verifier-safe-for-custody` **may flip to PASS**, scoped to write confinement of `--write-hashes` for the tool at digest `5a33e1d4…1aa7`. Every outside-write path that rereview-001 proved open now exits 1 and leaves its canary unchanged. Measured, not inferred.

This flip covers the supporting verifier only. Authorization is still `NONE`, the partition is still DRAFT, and the verifier still lists five open blockers. No freeze, no ledger edit, no verifier edit, no owner named.

## Checks

All runs used the owner worktree tool read-only and disposable `mktemp` copies. Transcripts are in `parity/research/acceptance-verifier-rereview-002/`.

| # | Check | Exit | Outside canary unchanged |
| --- | --- | --- | --- |
| 1 | Tool sha256 equals `5a33e1d4138283fe5d474cef5ccca575847e66e61f4a0c655ab6372106711aa7` | match | n/a |
| 1b | Oracle digests: definitions `e4e84566…05cb4`, configurations `3755a291…a80f`, record-hashes `4a218e21…8238` | match | n/a |
| 2 | Full `selftest.sh` | 0 | n/a (its hardlink and parent cases assert untouched files) |
| 3 | `replay-green.sh` | 0 | yes (its own asserts) |
| 4a | Symlinked `setup-pstack` parent, `--write-hashes` | 1 | yes |
| 4a2 | Same, verify only | 1 | n/a |
| 4b | Hardlinked `MANIFEST.sha256` | 1 | yes |
| 4b2 | Hardlinked `setup-pstack/record-hashes.json` (not in the prior harness) | 1 | yes |
| 4c | Final symlink `MANIFEST.sha256` | 1 | yes |
| 4c2 | Final symlink `record-hashes.json` (new) | 1 | yes |
| 4c3 | Dangling final symlink `MANIFEST.sha256` (new) | 1 | yes, no outside file created |
| 4d | Directory symlink inside tree (`review` to outside dir), write | 1 | yes, manifest also unchanged |
| 4d2 | Same, verify only | 1 | n/a |
| 5 | Clean pinned verify | 0 | `structural: PASS`, `authorization: "NONE"`, `externalPin: "matched"` |

The owner acceptance tree digest was identical before and after all attacks (`261dbf0c…fb020`). Owner `git status` shows only untracked `parity/`, so I did not use git to prove no tool edits. The sha256 match is the evidence.

## Why it holds

Source read of `verify-acceptance.mjs`. `rejectUnsafeOutputs` runs before any read or write in `main`. It `lstat`s every path component of both write targets and refuses symlinks, non-directory parents, non-regular finals and `nlink > 1`. `listFiles` uses `lstatSync` and throws on any symlink, and `hashArtifacts` runs before `writeFileSync`, so a directory symlink aborts before any write. The only two writes are `RECORD_HASHES` and `MANIFEST`, both guarded.

## Residual gaps

- **Symlinked or aliased `--acceptance-root` itself.** Row E: a symlink passed as the root verifies with exit 0. Components of the root path are not checked. Write mode would write through to the target the caller named. Measured only in verify mode. Low severity because the caller chooses the root, but it is not confined.
- **TOCTOU** between the check and `writeFileSync`. Source-inspected, not tested. Also bind mounts and device-boundary tricks. The containment report discloses the same.
- **Non-output hardlinks** are not checked. They are read only, so this is not a write-escape.
- **Partial-write ordering.** `record-hashes.json` is written before `MANIFEST.sha256`. If the second write fails, the tree is half updated. Untested, not a containment issue.
- **Directory-symlink refusal is an uncaught throw.** It exits 1 with a message, but it bypasses the `FAIL` reporting path. Cosmetic.
- **Rereview-001 `replay.sh` is stale.** It asserts the RED shape and now fails by design. Use `replay-green.sh` or `attacks.sh`.
- Verifier-reported blockers remain: `NO_AUTHENTICATED_TRANSITION_AUTHORITY`, `NO_REFERENCE_RUN_REGISTRY`, `NO_EXTERNAL_CUSTODY`, `DENOMINATOR_INCOMPLETE`, `FINAL_ACCEPTANCE_GATE_ABSENT`. These block freeze independent of this flip.

## Flip answer

**Yes**, flip `supporting-verifier-safe-for-custody` to PASS for tool digest `5a33e1d4…1aa7`, with the residuals above recorded. The coordinator must apply the flip. I did not edit any ledger. If the coordinator wants the root-symlink gap closed first, that is an owner repair, not a blocker I measured as an escape.

## Evidence

- `parity/research/acceptance-verifier-rereview-002/01-digests.txt`
- `parity/research/acceptance-verifier-rereview-002/02-selftest.txt`
- `parity/research/acceptance-verifier-rereview-002/03-replay-green.txt`
- `parity/research/acceptance-verifier-rereview-002/04-attacks.txt` and `attacks.sh` (rerunnable)

Principles applied: prove-it-works (ran the real tool against real attacks) and test-behavior-not-implementation (asserted refusal and canary bytes, not source shape). I did not open those leaf skills this session, so treat the names as labels only.

Playbook steps. Investigation: done, read-only, cited answer from measured evidence.
