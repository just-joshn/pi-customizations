# u-dep-closure-wave-001 report

Status: **complete (proposal published, ledgers untouched)**

## Summary

This unit read 13 previously incomplete dependency nodes, captured a redacted Cursor CLI working-env configuration snapshot, and published a coordinator merge proposal. Ledgers were not edited. `closureAudited` stays false.

## Done predicate (measured)

| Check | Result |
| --- | --- |
| Inventory covers ≥10 previously incomplete nodes with hashes and quotes | 13 nodes in `parity/research/dep-closure-wave-001/read-inventory.json` |
| Proposal lists exact field mutations for `dependencies.json` and `source-lock.json` | `parity/research/dep-closure-wave-001/merge-proposal.json` |
| `referenceConfigurationCaptured` includes a real artifact path | `parity/research/dep-closure-wave-001/refcfg/cli-config.redacted.json` |
| `closureAudited` remains false | Proposal sets false; no audit artifact |
| VERIFY: `shasum -a 256` matches inventory | `VERIFIED` via `verify_inventory_shasum.py` and `verify-hashes.json` |
| No ledger edits | `parity/dependencies.json` and `parity/source-lock.json` unchanged by this unit |

## Nodes read

Previously incomplete nodes with inventory entries:

1. `cursor-cli-host`
2. `cursor-create-skill`
3. `source-bun-runtime`
4. `npm:typescript@7.0.2` (deps enumerated; `readingComplete` stays false)
5. `npm:bun-types@1.3.14`
6. `npm:@types/node@26.1.2`
7. `npm:undici-types@8.3.0`
8. `npm:@typescript/typescript-darwin-arm64@7.0.2`
9. `npm:@typescript/typescript-darwin-x64@7.0.2`
10. `npm:@typescript/typescript-linux-x64@7.0.2`
11. `npm:@typescript/typescript-linux-arm64@7.0.2`
12. `npm:@typescript/typescript-win32-x64@7.0.2`
13. `npm:@typescript/typescript-win32-arm64@7.0.2`

## Key findings

**create-skill exact resource.** The working CLI install exposes `~/.cursor/skills-cursor/create-skill/SKILL.md`. The body was copied to `parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md` and hashed. The proposal sets `readingComplete` and `source.exactResource` to that copy. Journey audit of subordinate workflows remains open.

**Bun runtime.** `watch-pr` shebang and `bootstrap.ts` `Bun.spawnSync` contracts were read and hashed. Official Bun version pin and Node-builtin compatibility remain open.

**TypeScript lock chain.** Registry metadata and tarballs were fetched under `parity/research/dep-closure-wave-001/npm/`. Integrity values matched the ledger. Six representative platform optional packages were unpacked and inventoried. `npm:typescript@7.0.2` keeps `readingComplete: false` because the full distribution tree was not read.

**Reference configuration.** Redacted `~/.cursor/cli-config.json` plus `cursor-agent about` and `status` captures live under `parity/research/dep-closure-wave-001/refcfg/`. The proposal sets `cursorCli.referenceConfigurationCaptured` to true for this working-env snapshot only. The full multi-integration matrix in `contract.md` is still incomplete. No `openWork` rows are proposed for removal.

## Proposal path

`parity/research/dep-closure-wave-001/merge-proposal.json`

Included mutations (counts):

- 13 node field sets
- 12 edge status sets (lock/manifest/create-skill edges with evidence)
- unresolvedReferences narrow create-skill exact-resource wording; broader gaps stay
- `closureAudited: false`

## Remaining gaps (honest)

- Remaining `@typescript/*` platform packages outside the six representatives still incomplete
- `cursor-cli-host` `dependenciesEnumerated` still false; computer-use and enterprise edges unresolved
- `npm:typescript@7.0.2` full tree unread
- Official Bun contracts unresolved under `source-bun-runtime`
- Full reference-configuration matrix and optional integrations still open
- Independent dependency closure audit not started

## How to re-verify

```bash
python3 parity/research/dep-closure-wave-001/verify_inventory_shasum.py
```

Rebuild artifacts (network required for npm fetch):

```bash
python3 parity/research/dep-closure-wave-001/build_wave.py
```

## Artifacts

| Artifact | Path |
| --- | --- |
| Selection | `parity/research/dep-closure-wave-001/selection.json` |
| Inventory | `parity/research/dep-closure-wave-001/read-inventory.json` |
| Merge proposal | `parity/research/dep-closure-wave-001/merge-proposal.json` |
| Hash verify | `parity/research/dep-closure-wave-001/verify-hashes.json` |
| Working-env snapshot | `parity/research/dep-closure-wave-001/refcfg/working-env-snapshot.json` |
| Decision log | `parity/research/dep-closure-wave-001/decisions.tsv` |
| Lever | `parity/research/dep-closure-wave-001/build_wave.py` |
