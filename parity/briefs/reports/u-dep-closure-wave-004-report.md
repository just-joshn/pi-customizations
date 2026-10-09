# u-dep-closure-wave-004 report

Status: complete (proposal published, ledgers untouched)

## Summary

This unit closed three tools-lock reference gaps with path+hash evidence: platform-conditional `cpu`/`os` audit (including literal `none`), registry/tarball custody for all 25 lock packages, and runtime/platform prerequisites from official Bun docs plus tools contracts. The official Bun binary pin stays unresolved. Computer-use and enterprise host edges stay unresolved as environment-bound. Typescript per-file body semantics stay open after a contract-surface pass. Ledgers were not edited. `completeDependencyClosure` must stay false.

## Done predicate (measured)

| Check | Result |
| --- | --- |
| Each targeted edge/ref listed resolved or blocked | See Edge dispositions and Reference dispositions |
| Merge payload for coordinator | `parity/research/dep-closure-wave-004/merge-proposal.json` (also inlined below) |
| Hash verify for new captures | `VERIFIED` via `verify_inventory_shasum.py` / `verify-hashes.json` |
| No ledger edits | Wave writes only under owned research/report paths |
| No invented Bun pin | pinStatus `unresolved` after engines/packageManager/.bun-version probe |

## Counts

| Class | Count |
| --- | --- |
| Resolved references (this wave) | 3 |
| Unresolved targeted blockers | 7 |

Resolved: platform matrix, tools-lock registry custody, runtime/platform prerequisites.

Unresolved blockers: Bun pin, typescript per-file body semantics, computer-use edge, enterprise edge, team-kit journey edge, cli-host journey edge, live/recursive integration keep-open bucket.

## Overview

Dependency closure for the poteto-mode tools subtree is a ledger of nodes, edges, and open references. Wave-003 resolved the bootstrap → manifest → commander → bun graph edges without inventing a Bun pin. Wave-004 re-reads the lock and official Bun docs to clear npm/tree audit refs that existing custody can support, and records why the Bun pin and host edges still cannot close.

## Key concepts

- Edge resolved means the graph relationship is established with custody evidence. It does not mean journey or Pi lifecycle acceptance.
- Official Bun pin means a declared exact Bun binary version in the tools subtree (engines, packageManager, `.bun-version`, or equivalent lock binding). Local `bun --version` and `bun-types` lock resolves are not pins.
- Environment-bound means the contract requires live helpers, desktops, or org policy surfaces this worker must not fabricate or broadly reconfigure.
- Literal `cpu`/`os` `none` in bun.lock is typescript optional native package metadata as recorded by the lock, not a missing field.

## How it works

`package.json` pins only `commander@14.0.0` as a runtime dependency. DevDependencies declare `bun-types` and `typescript` as `latest`; `bun.lock` freezes them to `bun-types@1.3.14` and `typescript@7.0.2` plus twenty optional `@typescript/typescript-*` platform packages. Bootstrap runs `bun install --frozen-lockfile` via `Bun.spawnSync` and requires commander on disk. No tools file declares an engines or packageManager Bun binary version. Official Bun install docs describe host install of a specific version via the install script. That is outside the tools lock.

## Where things live

| Artifact | Path |
| --- | --- |
| Inventory | `parity/research/dep-closure-wave-004/read-inventory.json` |
| Merge proposal | `parity/research/dep-closure-wave-004/merge-proposal.json` |
| Hash verify | `parity/research/dep-closure-wave-004/verify-hashes.json` |
| Platform matrix | `parity/research/dep-closure-wave-004/platform-matrix.json` |
| Registry custody | `parity/research/dep-closure-wave-004/registry-custody.json` |
| Bun capture | `parity/research/dep-closure-wave-004/bun/official-capture.json` |
| Typescript contract surface | `parity/research/dep-closure-wave-004/npm/typescript-contract-surface.json` |
| Host disposition | `parity/research/dep-closure-wave-004/host-edge-disposition.json` |
| Decision log | `parity/research/dep-closure-wave-004/decisions.tsv` |
| Lever | `parity/research/dep-closure-wave-004/build_wave.py` |

## Gotchas

- `closureAudited: true` already records the independent audit. This wave must not treat audit completion as source closure.
- Closing tools-lock registry custody does not perform npm registry signature authentication.
- `bun-types@1.3.14` in the lock with local bun `1.4.2` is evidence against treating bun-types as a runtime pin.
- Host computer-use and enterprise edges cannot be resolved from Markdown alone.

## Edge dispositions

### Resolved (0 new graph edges)

No new edge status changes. Wave-003 tools-chain resolutions stand.

### Still unresolved / unverified (4)

1. `cursor-cli-host` → `cursor-self-hosted-computer-use` (unresolved)
   - Blocker: public docs only (`computer-use.md` sha256 `a9ceb020282d7c61ad99ccd13de0c8831dd57499ac32af31b5f4afc9e9e186d0`). macOS helper identity/privacy grants, Linux display/desktop services, and sharing transport are environment-bound and were not exercised.
   - Evidence: `parity/research/dep-closure-wave-004/host-edge-disposition.json` sha256 `f90cfaf1c5308d81976c6eb6785463c251bc0de45915cd3f25de1becfcc87a46`.

2. `cursor-cli-host` → `cursor-enterprise-integration-policy` (unresolved)
   - Blocker: public docs only (`model-management.md` sha256 `2606b4bd74d43bd579c59945506ab691cd49de8da3386556e265c854f6c9d205`). Live team/org policy enforcement and CLI applicability were not observed. Standing orders forbid broad allowlist or authorization changes.

3. `cursor-pstack` → `cursor-team-kit` (unverified)
   - Blocker: distribution custody exists; complete source and paired journey closure for the full skill set is not shown.

4. `cursor-pstack` → `cursor-cli-host` (unverified)
   - Blocker: persistent-mode editor actions (Option/Alt+Enter) and later-turn behavior still need paired Cursor+Pi runtime evidence.

## Reference dispositions

### Resolved this wave (3)

1. Audit all platform-conditional branches, including literal cpu/os none entries in this lock.
   - Evidence: `parity/research/dep-closure-wave-004/platform-matrix.json` sha256 `2542e07fb4690e256dd5c7dfb9a8d59de155962cab9e7a40fca45e360ef72dc4`; lock sha256 `667d9cf7222e9aae3fa42a4be383e657784216e9df115da02227fbc5ac7bbe46`.
   - Literal `cpu` none: `@typescript/typescript-linux-loong64`, `@typescript/typescript-linux-mips64el`, `@typescript/typescript-linux-riscv64`.
   - Literal `os` none: `@typescript/typescript-netbsd-arm64`, `@typescript/typescript-netbsd-x64`.
   - Platform-filtered packages: 20 of 25.

2. Fetch exact registry metadata and tarballs, verify integrity and licenses, inspect relevant contracts and transitive dependencies (tools bun.lock scope).
   - Evidence: `parity/research/dep-closure-wave-004/registry-custody.json` sha256 `dba7f5a1e1e26c4265840b05b78687ae37b1abf8ce04f5491ceb8ddc5e822d5a`.
   - Result: 25/25 packages have prior retrieval or commander inventory evidence; lock integrity matches retrieval integrity where compared. Registry signature authentication was not performed.

3. Determine runtime/platform prerequisites from official Bun and package contracts.
   - Evidence: `parity/research/dep-closure-wave-004/nodes/runtime-prerequisites.md`; Bun install docs sha256 `b893d34cdf3a1ce7c5cf649eee0f08a1d168f6a52e73977af764c8ee08b7d525`; lockfile docs sha256 `e16a0321c03bc7a6122fe14a918faff052058aeff9158f1f48118388696d274a`; nodejs-compat sha256 `5ee498723663e81c9be95b25e3396d991276c8b1388a6a798f68b446e5833b27`.
   - Tools require a Bun binary on PATH for shebang and `Bun.spawnSync` install. Optional typescript natives are platform-filtered in the lock.

### Cleared or replaced

| Prior reference | Disposition |
| --- | --- |
| Official Bun runtime version pin under source-bun-runtime remains unresolved after wave-003 capture... | Replaced by wave-004 pin line pointing at wave-004 capture (still unresolved). |
| npm:typescript@7.0.2 full tree file hashes... semantic per-file contract audit still open. | Replaced. Contract-surface recorded; body audit still open. |
| Duplicate computer-use/enterprise unresolved lines from waves 002/003. | Deduped into one wave-004 host line. |

### Still unresolved (concrete)

- Official Bun runtime version pin under source-bun-runtime remains unresolved after wave-004 capture at `parity/research/dep-closure-wave-004/bun/official-capture.json` (local 1.4.2 only; no engines/packageManager/.bun-version; bun-types lock resolve `bun-types@1.3.14` is not a runtime pin). Capture sha256 `758c2af03fa1ccec3b846cecf96de23b06911ebb82b2dc3cb2f175315109e0b2`; version txt sha256 `b99b4c7cdf236f59bc9f65d963deaecae3b16a7dad87939cacb9057f7664daee`.
- npm:typescript@7.0.2 contract-surface recorded at `parity/research/dep-closure-wave-004/npm/typescript-contract-surface.json` (416 inventoried files, Apache-2.0, engines node>=16.20.0); semantic per-file body audit still open. Surface sha256 `53484fd897b898221d9b643d438f4b0ed5afdfe60ab909ca46f66149bfd59f60`.
- cursor-cli-host edges to computer-use and enterprise policy remain unresolved after wave-004 public-doc re-hash; runtime services closed or environment-bound.
- Required live integrations, cloud services, automation editor, models and supporting tools.
- Recursive references in inspected sources still require complete extraction and audit.
- cursor-create-skill subordinate workflows and journey audit remain open after SKILL.md capture.
- Tools package consumer binding recorded at wave-003; broader acceptance journeys remain open.
- Node-builtin compatibility for commander evidenced under local bun 1.4.2 and official docs; not a substitute for an official Bun version pin.

## Hash verify notes

Rerun:

```bash
python3 parity/research/dep-closure-wave-004/verify_inventory_shasum.py
```

Inventory status from this run: `VERIFIED` (14 sources).

## completeDependencyClosure

Cannot be claimed. Proposal sets `cursorPlugins.completeDependencyClosure` false. Remaining blockers are the Bun pin, four host/journey edges, typescript body semantics, and live/recursive keep-open items.

## Merge payload

Coordinator-only apply target. Worker did not edit ledgers.

```json
{
  "schemaVersion": 1,
  "unit": "u-dep-closure-wave-004",
  "completeDependencyClosure": false,
  "resolvedReferenceCount": 3,
  "unresolvedTargetCount": 7,
  "dependencies": {
    "edgeMutations": [],
    "nodeMutations": [
      {
        "id": "source-bun-runtime",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-004/read-inventory.json",
            "parity/research/dep-closure-wave-004/bun/official-capture.json",
            "parity/research/dep-closure-wave-004/nodes/bun-pin.md",
            "parity/research/dep-closure-wave-004/nodes/runtime-prerequisites.md"
          ]
        }
      },
      {
        "id": "source-tools-manifest",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-004/read-inventory.json",
            "parity/research/dep-closure-wave-004/platform-matrix.json",
            "parity/research/dep-closure-wave-004/registry-custody.json"
          ]
        }
      },
      {
        "id": "npm:typescript@7.0.2",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-004/npm/typescript-contract-surface.json",
            "parity/research/dep-closure-wave-002/npm/typescript@7.0.2/file-inventory.json"
          ]
        }
      }
    ]
  },
  "sourceLock": {
    "cursorPlugins.completeDependencyClosure": { "set": false }
  },
  "fullProposal": "parity/research/dep-closure-wave-004/merge-proposal.json"
}
```

Full nodes/edges/refs mutations with evidence arrays are in `parity/research/dep-closure-wave-004/merge-proposal.json`.
