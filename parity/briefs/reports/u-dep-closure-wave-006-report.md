# u-dep-closure-wave-006 report

Status: complete (proposal published, ledgers untouched)

## Summary

Wave-006 refreshed Bun pin probes (still unresolved; legacy bun-version guide URL now 404), cataloged 136 typescript deep-internal files with path+hash and kept deep semantics open, restated host computer-use/enterprise edges as environment-bound with unchanged doc hashes, and completed create-skill subordinate workflow inventory (journey audit still open). One unresolvedReference was narrowed. Ledgers were not edited. `completeDependencyClosure` must stay false.

throughput checkpoint: n/a, read-only investigation

## Done predicate (measured)

| Check | Result |
| --- | --- |
| Each targeted edge/ref listed resolved or blocked | See Edge dispositions and Reference dispositions |
| Merge payload for coordinator | `parity/research/dep-closure-wave-006/merge-proposal.json` (also inlined below) |
| Hash verify for new captures | `VERIFIED` via `verify_inventory_shasum.py` / `verify-hashes.json` |
| No ledger edits | Wave writes only under owned research/report paths |
| No invented Bun pin | pinStatus `unresolved` after expanded pin-file/shebang/mise probe |

## Counts

| Class | Count |
| --- | --- |
| Resolved references (this wave) | 1 (create-skill subordinate inventory; journey line kept) |
| Unresolved targeted blockers (post-apply refs) | 7 |
| Typescript deep-internal files cataloged | 136 |
| create-skill workflow/phase sections inventoried | 12 |
| create-skill checklist items inventoried | 25 |

Still open: Bun pin, typescript deep compiler-behavior semantics, host computer-use edge, host enterprise edge, create-skill journeys, plus keep-open live/recursive/consumer-journey items. Journey edges team-kit and cli-host stay unverified.

## Overview

Dependency closure tracks nodes, edges, and open references for the poteto-mode tools subtree and linked Cursor host contracts. Wave-005 left Bun pin, host edges, typescript deep semantics, and create-skill subordinate+journey work open. Wave-006 advances those leftovers with rerunnable evidence and does not invent pins, runtime grants, or compiler-oracle results.

## Key concepts

- Edge resolved means the graph relationship is established with custody evidence. It does not mean journey or Pi lifecycle acceptance.
- Official Bun pin means a declared exact Bun binary version in the tools subtree (engines, packageManager, volta, `.bun-version`, bunfig, or equivalent lock binding). Local `bun --version`, host mise `bun/latest`, shebang `#!/usr/bin/env bun`, and `bun-types` lock resolves are not pins.
- Environment-bound means the contract requires live helpers, desktops, or org policy surfaces this worker must not fabricate or broadly reconfigure.
- Deep compiler-behavior semantics means proof of TypeScript@7.0.2 internal AST/enum/helper behavior under a compiler-test or typecheck oracle. Structural body-contract facts and `tsc --version` activation are not that proof.
- Subordinate workflow inventory means extracting workflow/phase/pattern sections, checklists, and links from SKILL.md with path+hash. It is not a paired skill-authoring journey.

## How it works

`package.json` still pins only `commander@14.0.0` as a runtime dependency. DevDependencies still declare `bun-types` and `typescript` as `latest`. `bun.lock` still freezes those packages. No tools or poteto-mode file declares engines, packageManager, volta, `.bun-version`, bunfig, mise, or `.tool-versions`. Shebangs on `orch.ts` and `watch-pr` invoke `env bun` without a version. Host `which bun` resolves to mise `bun/latest` at local 1.4.2. Official Bun docs for installation, lockfile, nodejs-compat, package-manager, and bunfig were re-fetched. The prior bun-version guide URL returns HTTP 404; version-install guidance now lives under installation older-versions and bunfig. Computer-use and enterprise docs keep prior sha256 values. The typescript lever lists all 136 `internal_module_surface` files from the wave-005 body audit. create-skill SKILL.md still matches the live install hash `255a3d3be7bac8984a13279f754f091a1de6f72c82bdf73e6b3c868e77e7ee82`.

## Where things live

| Artifact | Path |
| --- | --- |
| Inventory | `parity/research/dep-closure-wave-006/read-inventory.json` |
| Merge proposal | `parity/research/dep-closure-wave-006/merge-proposal.json` |
| Hash verify | `parity/research/dep-closure-wave-006/verify-hashes.json` |
| Bun capture | `parity/research/dep-closure-wave-006/bun/official-capture.json` |
| Typescript deep disposition | `parity/research/dep-closure-wave-006/npm/typescript-deep-semantics-disposition.json` |
| Host disposition | `parity/research/dep-closure-wave-006/host-edge-disposition.json` |
| create-skill subordinate audit | `parity/research/dep-closure-wave-006/create-skill/subordinate-audit.json` |
| Decision log | `parity/research/dep-closure-wave-006/decisions.tsv` |
| Lever | `parity/research/dep-closure-wave-006/build_wave.py` |

## Gotchas

- `closureAudited: true` already records the independent audit. This wave must not treat audit completion as source closure.
- Host computer-use and enterprise edges cannot be resolved from Markdown alone.
- `bun x typescript@7.0.2 tsc --version` exiting 0 proves package activation only.
- Legacy `https://bun.com/docs/guides/install/bun-version` 404 is measured. Do not treat the missing guide as a pin.
- create-skill subordinate inventory does not close journey parity.

## Edge dispositions

### Resolved (0 new graph edges)

No new edge status changes. Wave-003 tools-chain resolutions stand.

### Still unresolved / unverified (4)

1. `cursor-cli-host` → `cursor-self-hosted-computer-use` (unresolved, environment-bound)
   - Blocker: public docs only. macOS helper identity/privacy grants, Linux display/desktop services, and sharing transport were not exercised.
   - Evidence: `parity/research/dep-closure-wave-006/host-edge-disposition.json` sha256 `633d051d9febc7e247a357c78811b6e01cd2465c989cf34a55755243d73885a9`; doc sha256 `a9ceb020282d7c61ad99ccd13de0c8831dd57499ac32af31b5f4afc9e9e186d0`.

2. `cursor-cli-host` → `cursor-enterprise-integration-policy` (unresolved, environment-bound)
   - Blocker: public docs only. Live team/org policy enforcement and CLI applicability were not observed. Standing orders forbid broad allowlist or authorization changes.
   - Evidence: same host disposition file; doc sha256 `2606b4bd74d43bd579c59945506ab691cd49de8da3386556e265c854f6c9d205`.

3. `cursor-pstack` → `cursor-team-kit` (unverified)
   - Blocker: distribution custody exists; complete source and paired journey closure for the full skill set is not shown.

4. `cursor-pstack` → `cursor-cli-host` (unverified)
   - Blocker: persistent-mode editor actions (Option/Alt+Enter) and later-turn behavior still need paired Cursor+Pi runtime evidence.

## Reference dispositions

### Resolved this wave (1)

1. create-skill subordinate workflow inventory (previously bundled with journey audit).
   - Evidence: `parity/research/dep-closure-wave-006/create-skill/subordinate-audit.json` sha256 `c22a17d08123243d02af84ec3ae36ecc3dade3b916b4cff9439f11e2c16e8f1a` (12 workflow/phase sections, 25 checklist items; capture matches live install).
   - Proposal action: remove combined subordinate+journey status string; add journey-only line pointing at wave-006 audit.

### Progress, not closed

- npm:typescript@7.0.2 deep-internal catalog at `parity/research/dep-closure-wave-006/npm/typescript-deep-semantics-disposition.json` sha256 `585c39276ea18a646f9ae7e99c8e303c45b48c5fcfa0756fefe9266861acfeae` (136 files; consumer `tsc --version` = 7.0.2). Deep compiler-behavior semantics remain open.
- Bun pin probe expanded (poteto-mode pin-file walk, shebangs, mise latest path, bunfig docs, legacy guide 404) at `parity/research/dep-closure-wave-006/bun/official-capture.json` sha256 `4045c0cf536a1361b1e8e2cd7da4fbc06d2560c5465f79d6a935f3fda40c17e0`. pinStatus remains `unresolved`.

### Still unresolved (concrete)

- Official Bun runtime version pin under source-bun-runtime remains unresolved after wave-006 capture (local 1.4.2 only; no engines/packageManager/volta/.bun-version/bunfig/mise/.tool-versions under tools; host mise bun/latest and bun-types are not pins). Capture sha256 `4045c0cf536a1361b1e8e2cd7da4fbc06d2560c5465f79d6a935f3fda40c17e0`; version txt sha256 from inventory.
- npm:typescript@7.0.2 deep compiler-behavior semantics remain open after wave-006 disposition (see progress line above).
- cursor-cli-host edges to computer-use and enterprise policy remain unresolved after wave-006 environment-bound disposition.
- cursor-create-skill journey audit remains open after subordinate inventory (paired authoring journeys not run).
- Required live integrations, cloud services, automation editor, models and supporting tools.
- Recursive references in inspected sources still require complete extraction and audit.
- Tools package consumer binding recorded at wave-003; broader acceptance journeys remain open.

## Hash verify notes

Rerun:

```bash
python3 parity/research/dep-closure-wave-006/verify_inventory_shasum.py
```

Inventory status from this run: `VERIFIED` (29 sources).

## completeDependencyClosure

Cannot be claimed. Proposal sets `cursorPlugins.completeDependencyClosure` false. Remaining blockers are the Bun pin, four host/journey edges, typescript deep compiler-behavior semantics, create-skill journeys, and live/recursive keep-open items.

## Merge payload

Coordinator-only apply target. Worker did not edit ledgers.

Path: `parity/research/dep-closure-wave-006/merge-proposal.json`

```json
{
  "schemaVersion": 1,
  "unit": "u-dep-closure-wave-006",
  "completeDependencyClosure": false,
  "resolvedReferenceCount": 1,
  "unresolvedTargetCount": 7,
  "dependencies": {
    "edgeMutations": [],
    "nodeMutations": [
      {
        "id": "source-bun-runtime",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-006/read-inventory.json",
            "parity/research/dep-closure-wave-006/bun/official-capture.json",
            "parity/research/dep-closure-wave-006/nodes/bun-pin.md"
          ]
        }
      },
      {
        "id": "npm:typescript@7.0.2",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-006/npm/typescript-deep-semantics-disposition.json",
            "parity/research/dep-closure-wave-005/npm/typescript-body-audit.json",
            "parity/research/dep-closure-wave-002/npm/typescript@7.0.2/file-inventory.json"
          ]
        }
      },
      {
        "id": "cursor-self-hosted-computer-use",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-006/host-edge-disposition.json",
            "parity/research/dep-closure-wave-006/nodes/host-edge-disposition.md"
          ]
        }
      },
      {
        "id": "cursor-enterprise-integration-policy",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-006/host-edge-disposition.json",
            "parity/research/dep-closure-wave-006/nodes/host-edge-disposition.md"
          ]
        }
      },
      {
        "id": "cursor-create-skill",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-006/create-skill/subordinate-audit.json",
            "parity/research/dep-closure-wave-006/nodes/create-skill-subordinate-audit.md",
            "parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md"
          ]
        }
      }
    ]
  },
  "sourceLock": {
    "cursorPlugins.completeDependencyClosure": { "set": false }
  },
  "fullProposal": "parity/research/dep-closure-wave-006/merge-proposal.json"
}
```

Full nodes/edges/refs mutations with evidence arrays are in `parity/research/dep-closure-wave-006/merge-proposal.json`.
