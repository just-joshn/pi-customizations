# u-dep-commander-closure-001 report

Status: complete. Verdict: close.

## Outcome

Independent closure audit of locked `npm:commander@14.0.0` passed. Propose `closureAudited: true` on the dependencies node and source-lock externalDependency entry. Propose `signatureAuthenticated: true` after ECDSA verification against published npm v1 keys. Do not claim `completeDependencyClosure`. Do not flip source-lock `status`. Live integrations and host CU/enterprise edges stay open.

## Acceptance evidence

| Requirement | Result |
| --- | --- |
| Re-verify tarball sha256 + 14 file hashes | Passed. Tarball `eaef3a697e7173c7347ca4c1e60dd2bc1d38214d2aaecce89d70881a51d7fde7`. All 14 inventory files matched. |
| Re-verify both consumer path hashes | Passed. `orch.ts` `f091687df627a0b75fabd54af58945a9cd6c7039ef0622012ac9ed60cd8ec434`. `watch-pr/cli.ts` `89c08863089181a232be782c4b2ed90a1552f44aeecb0dcb7aac2c623620e680`. |
| Enumerate transitive runtime deps | Passed. Manifest runtime dependency fields absent. Import scan found 0 third-party runtime packages. |
| Disposition for `signatureAuthenticated` | Achieved `true`. openssl Verified OK. Keyid `SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`. Keys from registry npm v1 endpoint, not invented. |
| Merge payload | `parity/research/dep-commander-closure-001/merge-proposal.json` proposes `closureAudited: true` and `signatureAuthenticated: true`. |
| Explicit non-claims | Does not close live-integrations, host CU/enterprise edges, source-lock `status`, or `completeDependencyClosure`. |
| Ledger ownership | No ledger edited. |

## Key hashes

| Item | sha256 |
| --- | --- |
| Tarball `package.tgz` | `eaef3a697e7173c7347ca4c1e60dd2bc1d38214d2aaecce89d70881a51d7fde7` |
| Prior `read-inventory.json` | `19bfb53788883180ca7fd295b1b0c7261da478ed9b0971423cf2791906b90653` |
| `npm-v1-keys.json` | `faf23d8753d5bb79df250f10391ac89b63ecf7743e48487a544a99c847f9c8df` |
| `registry.json` | `2ac5deb9965482a387cc77a616fc75d6a619cfa7dd96f6da857f3e5f2614cd38` |
| `integrity.json` (pre-merge, still `signatureAuthenticated: false` on disk) | `d6231c485a0904f3ee9887c8f5c55ef4b42d2a6e561e37f09890d34125f183e3` |

## Verification

Run from the repository root:

```bash
python3 parity/research/dep-commander-closure-001/verify_hashes.py
python3 parity/research/dep-commander-closure-001/enumerate_runtime_deps.py
python3 parity/research/dep-commander-closure-001/verify_npm_signature.py
```

Observed: `VERIFIED`, third-party count `0`, `signatureAuthenticated: true`.

## Artifacts

| Artifact | Path |
| --- | --- |
| Audit | `parity/research/dep-commander-closure-001/audit.md` |
| Merge proposal | `parity/research/dep-commander-closure-001/merge-proposal.json` |
| Hash verify JSON | `parity/research/dep-commander-closure-001/hash-verify.json` |
| Hash shasum list | `parity/research/dep-commander-closure-001/hash-verify.shasum.txt` |
| Runtime deps | `parity/research/dep-commander-closure-001/runtime-deps.json` |
| Signature auth | `parity/research/dep-commander-closure-001/signature-auth.json` |
| npm keys | `parity/research/dep-commander-closure-001/npm-v1-keys.json` |
| npm refresh receipt | `parity/research/npm/commander-14.0.0/closure-audit-001-receipt.json` |
| Worker report | `parity/briefs/reports/u-dep-commander-closure-001-report.md` |
