# u-dep-audit-001 report

Status: complete, audited incomplete

## Outcome

The independent recursive audit completed. It supports setting `closureAudited` to true as an audit-execution marker. It does not support complete dependency closure.

The merge proposal preserves all eight unresolved or unverified edges, all eleven unresolved references, the incomplete source-lock status, and `completeDependencyClosure: false`.

## Acceptance evidence

| Requirement | Result |
| --- | --- |
| Sampled node and edge re-hash | Passed. Ten direct samples matched. Wave 001 and Wave 002 verifiers also returned `VERIFIED`. |
| Disposition review | Completed for all eight unresolved or unverified edges and representative resolved edges. |
| Honest closure proposal | `closureAudited: true` is proposed with the audit evidence path. Complete closure stays false. |
| Ledger ownership | No ledger was edited. |

## Material finding

The ledger has one graph asymmetry. The `cursor-pstack` to `source-tools-bootstrap` edge exists, but `cursor-pstack.dependencies` does not declare `source-tools-bootstrap`. The proposal keeps the edge and asks the coordinator to reconcile the declaration later.

Eight nodes still have `dependenciesEnumerated: false`. The audit also confirms that `readingComplete` does not mean semantic or runtime closure. The TypeScript file tree is fully hashed while semantic per-file audit remains open.

## Verification

Run from the repository root:

```bash
python3 parity/research/dep-closure-wave-001/verify_inventory_shasum.py
python3 parity/research/dep-closure-wave-002/verify_inventory_shasum.py
shasum -a 256 -c parity/research/dep-audit-001/sample-sha256.txt
```

Observed results:

- Wave 001 returned `VERIFIED` for 40 recorded source entries.
- Wave 002 returned `VERIFIED` for 66 recorded source entries.
- The direct ten-file sample returned `OK` for every file.

## Artifacts

| Artifact | Path |
| --- | --- |
| Audit | `parity/research/dep-audit-001/audit.md` |
| Merge proposal | `parity/research/dep-audit-001/merge-proposal.json` |
| Sample hashes | `parity/research/dep-audit-001/sample-sha256.txt` |
| Worker report | `parity/briefs/reports/u-dep-audit-001-report.md` |
