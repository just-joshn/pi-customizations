# Audited ZIP release contract

`requirements/requirements.json` keeps the legacy `tests`, `structural`, and `behavioral` sections. Its `zip` section is the separate release contract from `PSTACK_Pi_COMPLETE_AUDITED`. The five authority filenames and SHA-256 hashes identify the audited bytes. The native specification and legacy parity records do not override them.

The register contains the exact stimuli and required observations for all 23 acceptance IDs in map section 11. It also retains ten core invariants, the section 8 restrictions, eleven Pi conformance obligations, the definition of done, and Benny availability. Each entry has a source document and line span. No entry starts as PASS.

`SRC-01` and `TODO-01` remain INCONCLUSIVE after integration until reviewed current-source-bound experiment receipts establish PASS. `SANDBOX-01` and `ZIP-SECURITY` retain FAIL for known boundary contradictions, not BLOCKED merely because the work is deferred. `ZIP-BENNY` remains INCONCLUSIVE until its permitted explicit-unavailable alternative or complete integration chain is verified. Deferral does not remove a release obligation. Benny may satisfy its availability obligation through a reviewed record that explicitly marks all three dormant skills unavailable. A claim of functioning Benny needs the complete tested integration chain.

## Evidence receipt

`build-parity-manifest.mjs --zip-evidence <receipt.json>` reads explicit experiment evidence. Without it, the manifest retains unresolved verdicts. Legacy Vitest names and suite totals never produce ZIP PASS.

A receipt has these fields:

- `schemaVersion` is `1`.
- `sourceDigest` is the current `sourceDigest(root)` from `scripts/parity-lib.mjs`.
- `upstreamRevision` is `3dbd22ff12742fb28c9700b9760baa29ed41dc13`.
- `piVersion` is the version returned by the installed Pi binary selected through `PSTACK_E2E_PI`, or the existing default binary.
- `requirements` contains exactly one record for every registered obligation.

Each record has these fields:

- `id` identifies the registered requirement.
- `requirementDigest` is `zipRequirementDigest(requirement)` from `scripts/zip-contract.mjs`. It binds the exact registered contract, including its source pointer.
- `verdict` is `PASS`, `FAIL`, `INCONCLUSIVE`, or `BLOCKED`.
- `stimulus` equals the registered stimulus.
- `expected` equals the registered evidence requirement.
- `command` records the actual experiment command.
- `observed` records the actual observation, not the expected result repeated as an assertion.
- `artifacts` is a nonempty array of `{ "path": "relative/output.txt", "sha256": "<SHA-256>" }` records. Paths resolve beneath the receipt directory, including after symlink resolution. Each artifact must be a nonempty regular file with matching bytes.

Receipts and raw artifacts belong in the run's evidence directory, not in product source. The manifest records the receipt path and byte hash. The release checker rereads the receipt and artifacts, recomputes their assessment, and rejects a changed manifest assessment. It does not trust a manually inserted PASS row.

These checks establish contract binding, coverage, freshness against source and Pi version, and artifact integrity. They do not cryptographically authenticate an experiment author or prove the meaning of arbitrary output. A reviewer must inspect the recorded commands and raw observations before accepting a receipt. Synthetic receipts in `tests/parity-manifest/helpers.ts` apply only to miniature test packages and are not port acceptance evidence.

## Release result

`check-release.mjs` writes a JSON result to stdout. Its `release` field is `NOT RELEASED` unless both the existing legacy gate and the ZIP contract pass. The `legacyGate` field preserves the existing gate result. The `zip` field lists every obligation, verdict, reason, receipt reference, and integrity problem.

The checker exits with code 1 for an unresolved mandatory verdict, a missing register or receipt, missing coverage, an unknown or duplicate evidence ID, a wrong pin or Pi version, a stale source or requirement digest, or an invalid artifact. It retains all existing legacy source, result, failure, and provenance checks. The status document renders the ZIP assessment separately from legacy counts.

Local Vitest sidecars now retain their absolute execution `root`. A report imported from another checkout uses that root to interpret its absolute test paths. Existing report names are not rewritten to match current tests. A genuinely renamed or newly added test still requires fresh results.
