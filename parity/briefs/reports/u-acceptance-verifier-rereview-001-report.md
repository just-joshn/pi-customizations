# Acceptance verifier independent re-review

## Overview

Decision: `supporting-verifier-safe-for-custody` must remain `FAIL`.

The repair closes defects 2, 3, and 4. It closes only the final-output form of defect 1. The write path still follows a symlinked `setup-pstack` parent and still writes through a hardlinked manifest. Both attacks changed a file outside the copied acceptance root, exited 0, and printed `structural: PASS`. Defect 1 is therefore still open under the triage requirement to repair filesystem containment before writes.

No freeze was attempted. No ledger was edited. A clean pinned verify printed `authorization: "NONE"`.

## Key concepts

The custody-safety check is narrower than acceptance authority but stronger than a single final-path symlink regression. A supporting rehash tool must confine writes to its declared acceptance root before freeze preparation can rely on it.

The repaired `rejectSymlinks` checks `MANIFEST.sha256` and `setup-pstack/record-hashes.json` with `lstatSync`. That rejects a symlink at either final pathname. It does not reject a symlink in an output parent. It also cannot distinguish an output hardlink from an unlinked regular file. The later `writeFileSync` calls follow both cases.

## Per-defect verdicts

| Defect | Verdict | Independent evidence |
| --- | --- | --- |
| 1. Output symlink escape and write containment | **STILL-OPEN** | The exact final-output symlink case exits 1 and leaves its canary unchanged. A symlinked `setup-pstack` parent exits 0, rewrites the outside `record-hashes.json`, and prints structural PASS. A hardlinked `MANIFEST.sha256` also exits 0 and changes the sibling canary. |
| 2. Actual ledger bytes not pinned | **CLOSED** | The supplied focused regression appends a newline to `record-hashes.json`. Verification exits 1 with `bytes do not match the canonical recorded hashes`. The full selftest passes the same case. |
| 3. Invalid locator accepted | **CLOSED** | The supplied focused regression adds `not-a-line` locators. Write mode exits 1 with the positive ordered integer diagnostic. The full selftest passes the same case. |
| 4. Missing pin argument downgraded | **CLOSED** | Missing, empty, and malformed pin values each make the verifier exit 1. The focused regression and full selftest both pass. |

## How the review ran

The re-review used the owner worktree verifier directly and mutated only disposable copies under `mktemp` directories.

The full selftest exited 0. All three supplied focused regression scripts exited 0 after observing verifier rejection. The independent containment replay exited 0 after reproducing the open hardlink and symlinked-parent cases.

The clean verify used the measured manifest digest `10bd005eeed47dec258b5ffc2fd61c2b6bad751092d28f6b4abe64170883627c`. It exited 0 with `structural: "PASS"`, `externalPin: "matched"`, and `authorization: "NONE"`.

## Artifact identity

| Artifact | Measured SHA-256 | Result |
| --- | --- | --- |
| `tools/verify-acceptance.mjs` | `26c5141784cba4130962a7817821e5b03d6522982dec73b6309a173c19770599` | Matches the repair claim. |
| `tools/selftest.sh` | `85814217abf06cd330f11b1e095481967cc557807da7eb975742a2d30bb065b1` | Matches the repair report. |
| `MANIFEST.sha256` | `10bd005eeed47dec258b5ffc2fd61c2b6bad751092d28f6b4abe64170883627c` | Matches the repair report. |
| `setup-pstack/definitions.json` | `e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4` | Oracle bytes unchanged. |
| `setup-pstack/configurations.json` | `3755a29140cdbf700f01eadd5e268b3abc459152c619bd0037bfe70cc355a80f` | Oracle bytes unchanged. |
| `setup-pstack/record-hashes.json` | `4a218e21d7a6264daa45552fa39abdcd4c67337f145a79e191d136375a668238` | Unchanged from the repair report. |
| Reference plugins HEAD | `ccb5507cec1546dc88135c1139c811e6c59115ba` | Matches the locked revision. |

## Where the evidence lives

- `parity/research/acceptance-verifier-rereview-001/transcript.md` contains command transcripts and exit codes.
- `parity/research/acceptance-verifier-rereview-001/replay.sh` reruns the selftest, focused regressions, clean pinned verify, and containment attacks.

## Gotchas and residual gaps

- The final-output symlink regression is closed. That result does not establish parent-path containment.
- A symlinked output parent and a hardlinked output remain proven outside-write paths.
- `listFiles` uses `statSync` and follows directory symlinks during manifest traversal. This remains a source-inspected containment gap.
- The clean verifier still reports `NO_EXTERNAL_CUSTODY`, `NO_AUTHENTICATED_TRANSITION_AUTHORITY`, `NO_REFERENCE_RUN_REGISTRY`, `DENOMINATOR_INCOMPLETE`, and `FINAL_ACCEPTANCE_GATE_ABSENT`.
- External custody remains a separate freeze blocker even after the supporting verifier is repaired.

## Flip answer

No. `supporting-verifier-safe-for-custody` may not honestly flip to `PASS` for freeze preparation. Defect 1 remains open because `--write-hashes` can still mutate outside files through a symlinked output parent or hardlinked output while reporting structural PASS.

Authorization remains `NONE`. The partition remains DRAFT. This report grants no owner, transition authority, custody, or freeze approval.
