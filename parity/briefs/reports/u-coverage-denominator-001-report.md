# u-coverage-denominator-001 report

Status: complete (matrix published, ledgers untouched)

throughput checkpoint: n/a, read-only investigation

## Summary

Disposition matrix covers all 193 inventory items. Counts: 59 mapped, 114 deferred, 20 out-of-scope. Unresolved count is 0. Recommend setting `coverageDenominatorComplete: true` after the coordinator applies inventory patches. Matrix sha256 `30eb94995baa329dddbb186e143cb92c508bbda9dfc1289c9e12dca86e93e661`. Ledgers were not edited.

## Done predicate (measured)

| Check | Result |
| --- | --- |
| Matrix length == inventory items | 193 == 193 (`verify-output.json` ok) |
| Every disposition cites source or rationale | citation + reason on every row |
| No invented requirement mappings | mapped IDs equal exact `requirements[].source.file` matches only |
| Unresolved queue empty | yes |
| Recommend complete true | yes, after coordinator apply |

## Overview

The coverage denominator is the set of tracked plugin source paths in `parity/inventory.json`. Completion needs an explicit disposition on every path. It does not require every deferred path to have requirements yet. Mapped rows bind to existing ledger requirements by exact source file. Deferred rows stay active for later extraction. Out-of-scope rows keep package-role items in the inventory without claiming journey coverage.

## Key concepts

- mapped. Inventory path equals a `requirements[].source.file`. `requirementIds` copied from the ledger.
- deferred. Behavioral or supporting source with no ledger source.file match. Reason required. Denominator unchanged.
- out-of-scope. License, asset, lock/config packaging, or prior non-requirement example asset. Reason and citation required. Path still counted.
- `coverageDenominatorComplete`. Flag that every inventory item has one of the three dispositions above. Not a claim that requirement extraction is finished.

## How it works

1. Load `parity/inventory.json` (193) and `parity/requirements.json` (98).
2. Index requirements by `source.file`.
3. Classify each inventory path with `build_matrix.py` rules.
4. Write `disposition-matrix.json`, `merge-payload.json`, `unresolved.json`, `decisions.tsv`.
5. Re-check with `verify_matrix.py` (length, path set, hash match, mapped IDs, citations).

## Where things live

| Artifact | Path |
| --- | --- |
| Matrix | `parity/research/coverage-denominator-001/disposition-matrix.json` |
| Merge payload | `parity/research/coverage-denominator-001/merge-payload.json` |
| Merge summary | `parity/research/coverage-denominator-001/merge-payload-summary.json` |
| Unresolved | `parity/research/coverage-denominator-001/unresolved.json` |
| Decisions | `parity/research/coverage-denominator-001/decisions.tsv` |
| Lever | `parity/research/coverage-denominator-001/build_matrix.py` |
| Verify | `parity/research/coverage-denominator-001/verify_matrix.py` |
| Verify output | `parity/research/coverage-denominator-001/verify-output.json` |
| Prior example OOS | `parity/research/requirement-slices/slice-setup-002/dispositions.json` |

## Counts

| Class | Count |
| --- | --- |
| mapped | 59 |
| deferred | 114 |
| out-of-scope | 20 |
| unresolved | 0 |
| inventory / matrix | 193 / 193 |

Deferred includes all 18 cursor-team-kit `SKILL.md` entry points, poteto-mode playbooks and scripts (minus packaging OOS), skill references under mapped parents, Benny supporting docs/templates, and guide chapters other than `01-setup.md`.

Out-of-scope paths are licenses, logos/avatars, guide images, `.gitignore`, poteto-mode scripts packaging files (`package.json`, `bun.lock`, `tsconfig.json`), Benny `*.example*` templates, and the three create-verification feature-map example files from slice-setup-002.

## Gotchas

- Deferred is not out-of-scope. Standing orders keep unsatisfied behaviors active.
- Mapping a skill `references/` file to its parent SKILL.md requirement would invent coverage. Those stay deferred.
- Setting `coverageDenominatorComplete` true does not close `openWork` extraction or journey verification.
- Worker must not edit `parity/inventory.json` or `parity/requirements.json`. Coordinator applies the merge payload.

## Verify

```bash
python3 parity/research/coverage-denominator-001/build_matrix.py
python3 parity/research/coverage-denominator-001/verify_matrix.py
```

Measured: `verify-output.json` has `"ok": true`, `matrixSha256` `30eb94995baa329dddbb186e143cb92c508bbda9dfc1289c9e12dca86e93e661`.

## Merge payload (coordinator apply)

Full patches (193) live in `parity/research/coverage-denominator-001/merge-payload.json`. Summary:

```json
{
  "schemaVersion": 1,
  "sliceId": "coverage-denominator-001",
  "coordinatorApply": true,
  "workerDidNotEditLedgers": true,
  "coverageDenominatorComplete": true,
  "matrixPath": "parity/research/coverage-denominator-001/disposition-matrix.json",
  "matrixSha256": "30eb94995baa329dddbb186e143cb92c508bbda9dfc1289c9e12dca86e93e661",
  "dispositionContentSha256": "3182ab27542fd0e26bb6aae3d30c1bd95466c5c0485dc5beb70e9788bd282852",
  "inventoryItemCount": 193,
  "matrixItemCount": 193,
  "unresolvedCount": 0,
  "counts": {
    "mapped": 59,
    "deferred": 114,
    "out-of-scope": 20
  },
  "requirementsJsonPatch": {
    "coverageDenominatorComplete": true,
    "note": "Set true only after applying inventoryPatches so every inventory item disposition.status is not unassigned. Matrix hash pins the decision set."
  },
  "inventoryJsonPatch": {
    "status": "dispositions-assigned",
    "note": "Replace each items[].disposition from inventoryPatches keyed by path+sha256."
  },
  "inventoryPatchesCount": 193,
  "inventoryPatchesPath": "parity/research/coverage-denominator-001/merge-payload.json#inventoryPatches"
}
```

Apply order:

1. Patch each `inventory.json` item disposition from `inventoryPatches` (match `path` + `sha256`).
2. Set inventory `status` to `dispositions-assigned`.
3. Set `requirements.json` `coverageDenominatorComplete` to `true`.
4. Pin matrix sha256 in the coordinator progress note.

Do not set complete true without applying the inventory patches. Preflight still flags `unassigned` until inventory updates land.
