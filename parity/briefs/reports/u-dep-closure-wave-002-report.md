# u-dep-closure-wave-002 report

Status: complete (proposal published, ledgers untouched)

## Summary

This unit inventoried all 14 remaining incomplete `@typescript/*` platform packages, completed a full-tree file-hash inventory of `npm:typescript@7.0.2` (416 files), captured Bun official docs and local version without inventing a pin, and published a coordinator merge proposal. Computer-use and enterprise host edges stay unresolved. Ledgers were not edited. `closureAudited` stays false.

## Done predicate (measured)

| Check | Result |
| --- | --- |
| Inventory covers ≥8 previously incomplete nodes with hashes | 15 incomplete nodes in `parity/research/dep-closure-wave-002/read-inventory.json` |
| Proposal lists exact field mutations for `dependencies.json` and `source-lock.json` | `parity/research/dep-closure-wave-002/merge-proposal.json` |
| `closureAudited` remains false | Proposal sets false; no audit artifact |
| VERIFY: `shasum -a 256` matches inventory | `VERIFIED` via `verify_inventory_shasum.py` and `verify-hashes.json` |
| No ledger edits by this unit | Wave-002 lever only reads ledgers; writes stay under owned paths |

## Nodes read

Previously incomplete nodes with inventory entries:

1. `npm:@typescript/typescript-aix-ppc64@7.0.2`
2. `npm:@typescript/typescript-freebsd-arm64@7.0.2`
3. `npm:@typescript/typescript-freebsd-x64@7.0.2`
4. `npm:@typescript/typescript-linux-arm@7.0.2`
5. `npm:@typescript/typescript-linux-loong64@7.0.2`
6. `npm:@typescript/typescript-linux-mips64el@7.0.2`
7. `npm:@typescript/typescript-linux-ppc64@7.0.2`
8. `npm:@typescript/typescript-linux-riscv64@7.0.2`
9. `npm:@typescript/typescript-linux-s390x@7.0.2`
10. `npm:@typescript/typescript-netbsd-arm64@7.0.2`
11. `npm:@typescript/typescript-netbsd-x64@7.0.2`
12. `npm:@typescript/typescript-openbsd-arm64@7.0.2`
13. `npm:@typescript/typescript-openbsd-x64@7.0.2`
14. `npm:@typescript/typescript-sunos-x64@7.0.2`
15. `npm:typescript@7.0.2` (full tree hashed; propose `readingComplete: true`)

Supporting inventories (not incomplete-node flips):

- `host-edge-disposition:computer-use-enterprise`
- `bun-official-contracts-capture`

## Key findings

**Remaining platforms.** Registry metadata, tarballs, package.json, and file inventories match ledger integrity for all 14 remaining optional platform packages. Proposal sets `readingComplete` and `dependenciesEnumerated` true and resolves the matching `npm:typescript@7.0.2` → platform edges.

**TypeScript full tree.** The wave-001 tarball was reused, unpacked, and every file sha256-hashed (416 files). Proposal clears the prior "full tree unread" unresolved-reference line and sets `readingComplete: true`. Semantic per-file contract audit remains open.

**Host computer-use / enterprise.** Public Markdown contracts were re-hashed. Runtime helpers and live policy enforcement stay closed or environment-bound. Edges stay unresolved with honest notes in the proposal.

**Bun official contracts.** Local `bun --version` and bun.com docs were captured under `parity/research/dep-closure-wave-002/bun/`. No tools lock pin exists. Official version pin stays unresolved.

## Proposal path

`parity/research/dep-closure-wave-002/merge-proposal.json`

Included mutations (counts):

- 15 node field sets
- 14 edge status sets (remaining typescript → platform edges)
- 3 honest-unresolved edge notes (computer-use, enterprise, commander→bun)
- unresolvedReferences remove typescript full-tree-incomplete line; add semantic-audit / host / bun-pin lines
- `closureAudited: false`

## Remaining gaps (honest)

- `cursor-cli-host` `dependenciesEnumerated` still false; computer-use and enterprise edges unresolved
- Official Bun version pin under `source-bun-runtime` still unresolved
- typescript semantic per-file audit still open after hash inventory
- Non-platform edges still unresolved (bootstrap/manifest/commander/team-kit)
- Independent dependency closure audit not started

## How to re-verify

```bash
python3 parity/research/dep-closure-wave-002/verify_inventory_shasum.py
```

Rebuild artifacts (network required for npm fetch):

```bash
python3 parity/research/dep-closure-wave-002/build_wave.py
```

## Artifacts

| Artifact | Path |
| --- | --- |
| Selection | `parity/research/dep-closure-wave-002/selection.json` |
| Inventory | `parity/research/dep-closure-wave-002/read-inventory.json` |
| Merge proposal | `parity/research/dep-closure-wave-002/merge-proposal.json` |
| Hash verify | `parity/research/dep-closure-wave-002/verify-hashes.json` |
| Bun capture | `parity/research/dep-closure-wave-002/bun/official-capture.json` |
| Decision log | `parity/research/dep-closure-wave-002/decisions.tsv` |
| Lever | `parity/research/dep-closure-wave-002/build_wave.py` |
