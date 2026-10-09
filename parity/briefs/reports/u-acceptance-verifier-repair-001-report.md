# u-acceptance-verifier-repair-001 report

Owner worktree: `/private/tmp/pi-pstack-parity-acceptance-owner`
Authorization after repair: NONE. Partition stays DRAFT. No freeze claim. No external custody claim.

## Defects closed

| # | Defect | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Output symlink escape | Closed before this unit; re-verified | `review/regressions` not needed; selftest symlink cases + `research/.../green-symlink-still-closed.txt` (exit 1, canary untouched) |
| 2 | Actual ledger bytes not pinned | Closed here | RED `red-ledger-byte-drift-run.txt` (exit 0 / PASS matched). GREEN `green-ledger-byte-drift-run.txt` + selftest `trailing newline on record-hashes fails the pinned digest` |
| 3 | Invalid locator accepted | Closed here | RED `red-invalid-locator-run.txt` (exit 0). GREEN `green-invalid-locator-run.txt` + selftest `non-integer source locator is refused` |
| 4 | Missing pin argument downgraded | Closed here | RED `red-missing-pin-arg-run.txt` (missing/empty exit 0). GREEN `green-missing-pin-arg-run.txt` + selftest missing/empty/malformed pin cases |

## Tool digests

| File | Before | After |
| --- | --- | --- |
| `tools/verify-acceptance.mjs` | af2ab7a9061a95bafb21eaed65116710158c3db4dcdca636ce3f1238514d7f0b | 26c5141784cba4130962a7817821e5b03d6522982dec73b6309a173c19770599 |
| `tools/selftest.sh` | 700d1f3590d4736f4b16941b4741fd633e5475136d92398dd09c7988aee3e8fd | 85814217abf06cd330f11b1e095481967cc557807da7eb975742a2d30bb065b1 |
| `MANIFEST.sha256` | ccc6b2a0c8e61c7dec01af5a255dbe7eaca36706ab3e749e03cb41f414feb6c5 | 10bd005eeed47dec258b5ffc2fd61c2b6bad751092d28f6b4abe64170883627c |
| `setup-pstack/record-hashes.json` | 4a218e21d7a6264daa45552fa39abdcd4c67337f145a79e191d136375a668238 | 4a218e21d7a6264daa45552fa39abdcd4c67337f145a79e191d136375a668238 (unchanged) |

## Oracle bytes preserved

| File | sha256 (pre = post) |
| --- | --- |
| `setup-pstack/definitions.json` | e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4 |
| `setup-pstack/configurations.json` | 3755a29140cdbf700f01eadd5e268b3abc459152c619bd0037bfe70cc355a80f |

## What changed

Edits only under `parity/acceptance/tools/**` and `parity/acceptance/review/**` in the owner worktree.

- `verify-acceptance.mjs`: pin parse at CLI boundary; positive ordered integer locators; live `record-hashes.json` byte equality against canonical ledger text; keep existing symlink rejection.
- `selftest.sh`: four new rejection cases (ledger newline, bad locator, missing/empty/malformed pin).
- `review/regressions/{ledger-byte-drift,invalid-locator,missing-pin-arg}.sh`: focused RED-then-GREEN scripts.

## Verification run

Reference: `/Users/josh-desktop/src/experiments/plugins` @ `ccb5507cec1546dc88135c1139c811e6c59115ba`
Parity: `/Users/josh-desktop/src/personal/pi-pstack-parity-again/parity`

- `tools/selftest.sh` → `selftest passed` (`parity/research/acceptance-verifier-repair-001/selftest-after.txt`)
- Each focused regression → exit 0 after fix
- Clean verify → `structural: PASS`, `authorization: NONE`, open blockers unchanged (no auth, no registry, no custody, denominator incomplete, no final gate, pin absent)

## Residual gaps

- Filesystem containment still incomplete for symlinked parent dirs, hardlinks, and `listFiles` following directory symlinks
- Hand-edited local hash ledger without an external pin remains a documented local evasion
- External custody is still unsolved
- `supporting-verifier-safe` must not flip until an independent re-review consumes this repair evidence

## Freeze / flip eligibility

Cannot flip `supporting-verifier-safe` from this unit alone. Implementation owner cannot freeze. Independent supporting-tool re-review is the next gate.
