# Acceptance verifier repair 001 notes

Worktree: `/private/tmp/pi-pstack-parity-acceptance-owner`
Unit: u-acceptance-verifier-repair-001

## Pre-repair oracle digests

| Artifact | sha256 |
| --- | --- |
| definitions.json | e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4 |
| configurations.json | 3755a29140cdbf700f01eadd5e268b3abc459152c619bd0037bfe70cc355a80f |
| record-hashes.json | 4a218e21d7a6264daa45552fa39abdcd4c67337f145a79e191d136375a668238 |
| verify-acceptance.mjs (pre) | af2ab7a9061a95bafb21eaed65116710158c3db4dcdca636ce3f1238514d7f0b |
| MANIFEST.sha256 (symlink-fix era) | ccc6b2a0c8e61c7dec01af5a255dbe7eaca36706ab3e749e03cb41f414feb6c5 |

## Mechanisms

1. Output symlink escape. Already closed by `rejectSymlinks()` before any write. Reproduced exit 1 with external canary unchanged. Selftest covers MANIFEST and record-hashes symlink targets.
2. Ledger byte drift. Verify rebuilt canonical `recordsJson` and hashed that for the manifest line, while `hashArtifacts` excluded the live ledger file. A trailing newline changed stored bytes and `digests.recordHashes` but left pin matching. Fix compares live ledger bytes to canonical `recordsJson` before the manifest check.
3. Invalid locator. `Number("not-a-line")` is NaN. Span comparisons against NaN never fire. Fix requires `/^([1-9]\d*)(?:-([1-9]\d*))?$/` with `to >= from`.
4. Missing pin. Trailing `--expect-manifest-sha256` set `pin` to `undefined` and reported `externalPin: absent`. Empty string was also falsy. Fix parses the pin at the CLI boundary and rejects missing, empty, flag-shaped, and non-64-hex values.

## RED / GREEN artifacts

- `red-ledger-byte-drift-run.txt`, `red-invalid-locator-run.txt`, `red-missing-pin-arg-run.txt`
- `green-ledger-byte-drift-run.txt`, `green-invalid-locator-run.txt`, `green-missing-pin-arg-run.txt`
- `green-symlink-still-closed.txt`
- `selftest-after.txt`
- `pre-repair-digests.txt`, `post-repair-digests.txt`
- `final-verify.json`

## Residual gaps (not closed here)

- Symlinked parent directories / hardlinks / `listFiles` following directory symlinks
- External custody still absent
- Local hash-ledger hand-edit still evadeable without an external pin (selftest documents this)
- supporting-verifier-safe still needs independent re-review before freeze-prep can flip it
