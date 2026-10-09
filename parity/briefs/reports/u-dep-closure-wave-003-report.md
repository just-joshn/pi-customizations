# u-dep-closure-wave-003 report

Status: complete (proposal published, ledgers untouched)

## Summary

This unit closed the source tools chain bootstrap → tools-manifest → commander → bun runtime for graph purposes, with path+hash evidence and a local Bun smoke. Computer-use and enterprise host edges stay unresolved as environment-bound. Journey edges to team-kit and CLI host stay unverified. Official Bun version pin stays unresolved. Ledgers were not edited. `completeDependencyClosure` must stay false.

## Done predicate (measured)

| Check | Result |
| --- | --- |
| Each unresolved edge/ref listed resolved or blocked | See Edge dispositions and Reference dispositions |
| Merge payload for coordinator | `parity/research/dep-closure-wave-003/merge-proposal.json` (also inlined below) |
| Hash verify for new captures | `VERIFIED` via `verify_inventory_shasum.py` / `verify-hashes.json` |
| No ledger edits | Wave writes only under owned research/report paths |

## Overview

Dependency closure for pstack tools scripts is a ledger of nodes and edges. Prior waves finished npm platform inventories and an independent audit that left eight edges open. This wave targets the remaining tools chain and documents host blockers that public docs cannot close.

## Key concepts

- Edge resolved means the graph relationship is established with custody evidence. It does not mean journey or Pi lifecycle acceptance.
- Official Bun pin means a declared exact Bun version in the tools subtree or an official lock the ledger can cite. Local `bun --version` is not a pin.
- Environment-bound means the contract requires live helpers, desktops, or org policy surfaces this worker must not fabricate or broadly reconfigure.

## How it works

`watch-pr` and `orch.ts` call `ensureDependenciesInstalled()` from `bootstrap.ts`. Bootstrap hashes `package.json` and `bun.lock`, runs `bun install --frozen-lockfile`, and requires `node_modules/commander/package.json`. Manifest pins `commander@14.0.0`. Consumers import commander under Bun shebangs. Wave-003 captured Bun Node.js compatibility docs, local bun 1.4.2, and a commander smoke plus orch help test.

## Where things live

| Artifact | Path |
| --- | --- |
| Inventory | `parity/research/dep-closure-wave-003/read-inventory.json` |
| Merge proposal | `parity/research/dep-closure-wave-003/merge-proposal.json` |
| Hash verify | `parity/research/dep-closure-wave-003/verify-hashes.json` |
| Consumer binding | `parity/research/dep-closure-wave-003/consumer-binding.json` |
| Bun capture | `parity/research/dep-closure-wave-003/bun/official-capture.json` |
| Decision log | `parity/research/dep-closure-wave-003/decisions.tsv` |
| Lever | `parity/research/dep-closure-wave-003/build_wave.py` |

## Gotchas

- `closureAudited: true` already records the independent audit. This wave must not treat audit completion as source closure.
- Resolving commander→bun does not invent a Bun pin. The pin reference stays.
- Host computer-use and enterprise edges cannot be resolved from Markdown alone.

## Edge dispositions

### Resolved (4)

1. `cursor-pstack` → `source-tools-bootstrap`
   - Evidence: `watch-pr` sha256 `d955603be6cc0e8b8ffcec722f635192b2261410b1f2929abea94480e47eb5d4`; `orch.ts` sha256 `f091687df627a0b75fabd54af58945a9cd6c7039ef0622012ac9ed60cd8ec434`; inventory `parity/research/dep-closure-wave-003/read-inventory.json`.
   - Note: Pi installed-lifecycle parity still unverified.

2. `source-tools-bootstrap` → `source-tools-manifest`
   - Evidence: `bootstrap.ts` sha256 `ccd2ed08fd9da9d0d942e5f2491cfc74bb92d8a08fa51755e0da1ac8de287361` (install-key over package.json + bun.lock); `package.json` sha256 `d1f815091209d49763775cc188e8e06ff32d5fec648bffd2272bc25a165e87c3`; `bun.lock` sha256 `667d9cf7222e9aae3fa42a4be383e657784216e9df115da02227fbc5ac7bbe46`.

3. `source-tools-manifest` → `npm:commander@14.0.0`
   - Evidence: manifest `dependencies.commander=14.0.0`; lock integrity; tarball sha256 `eaef3a697e7173c7347ca4c1e60dd2bc1d38214d2aaecce89d70881a51d7fde7`; installed package.json sha256 `bbf7734a336e0d67c20e5326fc9e32c1f4d4e5d6272dea41705cb5e69066da1a` matches tarball `package/package.json`; bootstrap commander presence gate.

4. `npm:commander@14.0.0` → `source-bun-runtime`
   - Evidence: consumer shebangs/imports; Bun docs `parity/research/dep-closure-wave-003/bun/nodejs-compat.html` sha256 `5ee498723663e81c9be95b25e3396d991276c8b1388a6a798f68b446e5833b27`; smoke `parity/research/dep-closure-wave-003/bun/commander-smoke.txt` sha256 `24a93bea5ae40d1246fe748e4caf5da4784cd39d5f176edd8f15498dd28a3a65` (local bun 1.4.2, smokeOk, orch help test pass).
   - Note: exact Bun version pin remains a separate open reference.

### Still unresolved / unverified (4)

1. `cursor-cli-host` → `cursor-self-hosted-computer-use` (unresolved)
   - Blocker: public docs only (`computer-use.md` sha256 `a9ceb020282d7c61ad99ccd13de0c8831dd57499ac32af31b5f4afc9e9e186d0`). macOS helper identity/privacy grants, Linux display/desktop services, and sharing transport are environment-bound and were not exercised.

2. `cursor-cli-host` → `cursor-enterprise-integration-policy` (unresolved)
   - Blocker: public docs only (`model-management.md` sha256 `2606b4bd74d43bd579c59945506ab691cd49de8da3386556e265c854f6c9d205`). Live team/org policy enforcement and CLI applicability were not observed. Standing orders forbid broad allowlist or authorization changes.

3. `cursor-pstack` → `cursor-team-kit` (unverified)
   - Blocker: distribution custody exists; complete source and paired journey closure for the full skill set is not shown.

4. `cursor-pstack` → `cursor-cli-host` (unverified)
   - Blocker: persistent-mode editor actions (Option/Alt+Enter) and later-turn behavior still need paired Cursor+Pi runtime evidence.

## Reference dispositions

### Cleared or replaced

| Prior reference | Disposition |
| --- | --- |
| Bind each package to runtime versus test/typecheck consumers before acceptance. | Cleared. Binding recorded at `consumer-binding.json` (commander runtime; bun-types/typescript test/typecheck). |
| Official Bun runtime version pin and Node-builtin compatibility under source-bun-runtime remain unresolved. | Replaced. Compatibility evidenced; pin remains. |
| Official Bun runtime version pin under source-bun-runtime remains unresolved after capture at wave-002 `official-capture.json`. | Replaced by wave-003 pin line pointing at wave-003 capture. |

### Still unresolved (concrete)

- Required live integrations, cloud services, automation editor, models and supporting tools.
- Recursive references in inspected sources still require complete extraction and audit.
- Fetch exact registry metadata and tarballs, verify integrity and licenses, inspect relevant contracts and transitive dependencies.
- Determine runtime/platform prerequisites from official Bun and package contracts.
- Audit all platform-conditional branches, including literal cpu/os none entries in this lock.
- cursor-create-skill subordinate workflows and journey audit remain open after SKILL.md capture.
- npm:typescript@7.0.2 semantic per-file contract audit still open after full-tree hashes.
- Official Bun runtime version pin under source-bun-runtime remains unresolved after wave-003 capture (local 1.4.2 only; no tools lock pin).
- cursor-cli-host edges to computer-use and enterprise policy remain unresolved; runtime services closed or environment-bound.
- Node-builtin compatibility for commander inputs evidenced under local bun 1.4.2 and official docs; not a substitute for an official Bun version pin.
- Tools package consumer binding recorded; broader acceptance journeys remain open.

## Hash verify notes

New or re-hashed captures in this wave (all `VERIFIED` by `shasum -a 256`):

| Path | sha256 |
| --- | --- |
| `parity/research/dep-closure-wave-003/bun/nodejs-compat.html` | `5ee498723663e81c9be95b25e3396d991276c8b1388a6a798f68b446e5833b27` |
| `parity/research/dep-closure-wave-003/bun/bun-version.txt` | `b99b4c7cdf236f59bc9f65d963deaecae3b16a7dad87939cacb9057f7664daee` |
| `parity/research/dep-closure-wave-003/bun/commander-smoke.txt` | `24a93bea5ae40d1246fe748e4caf5da4784cd39d5f176edd8f15498dd28a3a65` |
| `parity/research/dep-closure-wave-003/bun/official-capture.json` | (written by lever; included in inventory via related files) |

Rerun:

```bash
python3 parity/research/dep-closure-wave-003/verify_inventory_shasum.py
```

## completeDependencyClosure

Cannot be claimed. Proposal sets `cursorPlugins.completeDependencyClosure` false. Remaining blockers are the four host/journey edges above plus the Bun pin and other open references.

## Merge payload

Coordinator-only apply target. Worker did not edit ledgers.

```json
{
  "schemaVersion": 1,
  "unit": "u-dep-closure-wave-003",
  "completeDependencyClosure": false,
  "dependencies": {
    "edgeMutations": [
      {
        "from": "cursor-pstack",
        "to": "source-tools-bootstrap",
        "set": { "status": "resolved" }
      },
      {
        "from": "source-tools-bootstrap",
        "to": "source-tools-manifest",
        "set": { "status": "resolved" }
      },
      {
        "from": "source-tools-manifest",
        "to": "npm:commander@14.0.0",
        "set": { "status": "resolved" }
      },
      {
        "from": "npm:commander@14.0.0",
        "to": "source-bun-runtime",
        "set": { "status": "resolved" }
      }
    ],
    "nodeMutations": [
      {
        "id": "source-tools-bootstrap",
        "set": { "dependenciesEnumerated": true }
      },
      {
        "id": "source-tools-manifest",
        "set": { "dependenciesEnumerated": true }
      },
      {
        "id": "source-bun-runtime",
        "set": { "dependenciesEnumerated": true }
      }
    ]
  },
  "sourceLock": {
    "cursorPlugins.completeDependencyClosure": { "set": false }
  },
  "fullProposal": "parity/research/dep-closure-wave-003/merge-proposal.json"
}
```

Full nodes/edges/refs mutations with evidence arrays are in `parity/research/dep-closure-wave-003/merge-proposal.json`.
