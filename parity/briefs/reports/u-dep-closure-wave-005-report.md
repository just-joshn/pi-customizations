# u-dep-closure-wave-005 report

Status: complete (proposal published, ledgers untouched)

## Summary

Wave-005 closed four wave-004 npm/tree status strings that already had path+hash evidence, recorded a 416/416 structural typescript body-contract audit with deep compiler semantics still open, re-probed the Bun binary pin (still unresolved), and restated computer-use/enterprise host edges as environment-bound with re-hashed public docs. Ledgers were not edited. `completeDependencyClosure` must stay false.

throughput checkpoint: n/a, read-only investigation

## Done predicate (measured)

| Check | Result |
| --- | --- |
| Each targeted edge/ref listed resolved or blocked | See Edge dispositions and Reference dispositions |
| Merge payload for coordinator | `parity/research/dep-closure-wave-005/merge-proposal.json` (also inlined below) |
| Hash verify for new captures | `VERIFIED` via `verify_inventory_shasum.py` / `verify-hashes.json` |
| No ledger edits | Wave writes only under owned research/report paths |
| No invented Bun pin | pinStatus `unresolved` after engines/packageManager/volta/.bun-version/bunfig probe |

## Counts

| Class | Count |
| --- | --- |
| Resolved references (this wave) | 4 |
| Unresolved targeted blockers (post-apply refs) | 7 |
| Typescript files structural body-audited | 416/416 |
| Typescript deep-internal files still open | 136 |

Resolved refs: platform-matrix status string, registry-custody status string, runtime-prerequisites status string, node-builtin-compatibility status string.

Still open: Bun pin, typescript deep compiler-behavior semantics, host computer-use edge, host enterprise edge, plus keep-open live/recursive/create-skill/consumer-journey items. Journey edges team-kit and cli-host stay unverified.

## Overview

Dependency closure tracks nodes, edges, and open references for the poteto-mode tools subtree and linked Cursor host contracts. Wave-004 cleared tools-lock audit refs but left Bun pin, host edges, and typescript body semantics open, and left four completed audit notes inside `unresolvedReferences`. Wave-005 removes those completed notes, advances typescript body audit with a rerunnable lever, and refreshes Bun/host evidence without fabricating pins or runtime grants.

## Key concepts

- Edge resolved means the graph relationship is established with custody evidence. It does not mean journey or Pi lifecycle acceptance.
- Official Bun pin means a declared exact Bun binary version in the tools subtree (engines, packageManager, volta, `.bun-version`, bunfig, or equivalent lock binding). Local `bun --version` and `bun-types` lock resolves are not pins.
- Environment-bound means the contract requires live helpers, desktops, or org policy surfaces this worker must not fabricate or broadly reconfigure.
- Structural body-contract audit means per-file hash/size verify, role classification, and body-contract fact extraction. It is not a proof of TypeScript compiler behavior.

## How it works

`package.json` still pins only `commander@14.0.0` as a runtime dependency. DevDependencies still declare `bun-types` and `typescript` as `latest`. `bun.lock` still freezes `bun-types@1.3.14` and `typescript@7.0.2`. No tools file declares engines, packageManager, volta, `.bun-version`, or bunfig. Official Bun docs describe host install of a specific version. Computer-use and enterprise docs name macOS helper grants, Linux desktop services, and team/org policy surfaces that were not exercised here. The typescript lever walked all 416 inventoried files under the wave-002 unpack, matched inventory hashes, and extracted body-contract facts.

## Where things live

| Artifact | Path |
| --- | --- |
| Inventory | `parity/research/dep-closure-wave-005/read-inventory.json` |
| Merge proposal | `parity/research/dep-closure-wave-005/merge-proposal.json` |
| Hash verify | `parity/research/dep-closure-wave-005/verify-hashes.json` |
| Bun capture | `parity/research/dep-closure-wave-005/bun/official-capture.json` |
| Typescript body audit | `parity/research/dep-closure-wave-005/npm/typescript-body-audit.json` |
| Host disposition | `parity/research/dep-closure-wave-005/host-edge-disposition.json` |
| Decision log | `parity/research/dep-closure-wave-005/decisions.tsv` |
| Lever | `parity/research/dep-closure-wave-005/build_wave.py` |

## Gotchas

- `closureAudited: true` already records the independent audit. This wave must not treat audit completion as source closure.
- Closing wave-004 npm/tree status strings does not re-run registry signature authentication.
- Structural typescript body audit is not deep compiler-behavior closure for 136 internal dist files.
- Host computer-use and enterprise edges cannot be resolved from Markdown alone.

## Edge dispositions

### Resolved (0 new graph edges)

No new edge status changes. Wave-003 tools-chain resolutions stand.

### Still unresolved / unverified (4)

1. `cursor-cli-host` → `cursor-self-hosted-computer-use` (unresolved, environment-bound)
   - Blocker: public docs only. macOS helper identity/privacy grants, Linux display/desktop services, and sharing transport were not exercised.
   - Evidence: `parity/research/dep-closure-wave-005/host-edge-disposition.json` sha256 `02e027ecc31ddd1a4e26ab47321bac56c33bf07225ecd16aa30eef72955473c6`; doc sha256 `a9ceb020282d7c61ad99ccd13de0c8831dd57499ac32af31b5f4afc9e9e186d0`.

2. `cursor-cli-host` → `cursor-enterprise-integration-policy` (unresolved, environment-bound)
   - Blocker: public docs only. Live team/org policy enforcement and CLI applicability were not observed. Standing orders forbid broad allowlist or authorization changes.
   - Evidence: same host disposition file; doc sha256 `2606b4bd74d43bd579c59945506ab691cd49de8da3386556e265c854f6c9d205`.

3. `cursor-pstack` → `cursor-team-kit` (unverified)
   - Blocker: distribution custody exists; complete source and paired journey closure for the full skill set is not shown.

4. `cursor-pstack` → `cursor-cli-host` (unverified)
   - Blocker: persistent-mode editor actions (Option/Alt+Enter) and later-turn behavior still need paired Cursor+Pi runtime evidence.

## Reference dispositions

### Resolved this wave (4)

1. Tools bun.lock platform-conditional branches audited (wave-004 evidence already present).
   - Evidence: `parity/research/dep-closure-wave-004/platform-matrix.json`.
   - Proposal action: remove status string from `unresolvedReferences`.

2. Tools bun.lock registry/tarball custody verified for all 25 packages (wave-004 evidence already present).
   - Evidence: `parity/research/dep-closure-wave-004/registry-custody.json`.
   - Proposal action: remove status string from `unresolvedReferences`.

3. Runtime/platform prerequisites recorded (wave-004 evidence already present; Bun pin remains a separate open line).
   - Evidence: `parity/research/dep-closure-wave-004/nodes/runtime-prerequisites.md`.
   - Proposal action: remove status string from `unresolvedReferences`.

4. Node-builtin compatibility note for commander (not a Bun pin; not an open dependency task).
   - Evidence: wave-004 Bun docs captures under `parity/research/dep-closure-wave-004/bun`.
   - Proposal action: remove status string from `unresolvedReferences`.

### Progress, not closed

- npm:typescript@7.0.2 structural per-file body-contract audit at `parity/research/dep-closure-wave-005/npm/typescript-body-audit.json` sha256 `b8f1a9706c1991cac99336de4c945a4839bcf654df793b9d00c8f745ac587791` (416/416, 0 hash mismatches). Deep compiler-behavior semantics for 136 internal dist files remain open.

### Still unresolved (concrete)

- Official Bun runtime version pin under source-bun-runtime remains unresolved after wave-005 capture at `parity/research/dep-closure-wave-005/bun/official-capture.json` (local 1.4.2 only; no engines/packageManager/volta/.bun-version/bunfig; bun-types lock resolve `bun-types@1.3.14` is not a runtime pin). Capture sha256 `1015d861f1fe9fcfd0b67e5ff937a10aefe4a5b0af342984658b4a48da1ef09a`; version txt sha256 `8175ac22d3a200ea0c6b04e240ba440308532413d1c9f38b5603471128ce9747`.
- npm:typescript@7.0.2 deep compiler-behavior semantics remain open after structural body audit (see progress line above).
- cursor-cli-host edges to computer-use and enterprise policy remain unresolved after wave-005 environment-bound disposition.
- Required live integrations, cloud services, automation editor, models and supporting tools.
- Recursive references in inspected sources still require complete extraction and audit.
- cursor-create-skill subordinate workflows and journey audit remain open after SKILL.md capture.
- Tools package consumer binding recorded at wave-003; broader acceptance journeys remain open.

## Hash verify notes

Rerun:

```bash
python3 parity/research/dep-closure-wave-005/verify_inventory_shasum.py
```

Inventory status from this run: `VERIFIED` (19 sources).

## completeDependencyClosure

Cannot be claimed. Proposal sets `cursorPlugins.completeDependencyClosure` false. Remaining blockers are the Bun pin, four host/journey edges, typescript deep compiler-behavior semantics, and live/recursive keep-open items.

## Merge payload

Coordinator-only apply target. Worker did not edit ledgers.

Path: `parity/research/dep-closure-wave-005/merge-proposal.json`

```json
{
  "schemaVersion": 1,
  "unit": "u-dep-closure-wave-005",
  "completeDependencyClosure": false,
  "resolvedReferenceCount": 4,
  "unresolvedTargetCount": 7,
  "dependencies": {
    "edgeMutations": [],
    "nodeMutations": [
      {
        "id": "source-bun-runtime",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-005/read-inventory.json",
            "parity/research/dep-closure-wave-005/bun/official-capture.json",
            "parity/research/dep-closure-wave-005/nodes/bun-pin.md"
          ]
        }
      },
      {
        "id": "npm:typescript@7.0.2",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-005/npm/typescript-body-audit.json",
            "parity/research/dep-closure-wave-004/npm/typescript-contract-surface.json",
            "parity/research/dep-closure-wave-002/npm/typescript@7.0.2/file-inventory.json"
          ]
        }
      },
      {
        "id": "cursor-self-hosted-computer-use",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-005/host-edge-disposition.json",
            "parity/research/dep-closure-wave-005/nodes/host-edge-disposition.md"
          ]
        }
      },
      {
        "id": "cursor-enterprise-integration-policy",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-005/host-edge-disposition.json",
            "parity/research/dep-closure-wave-005/nodes/host-edge-disposition.md"
          ]
        }
      }
    ]
  },
  "sourceLock": {
    "cursorPlugins.completeDependencyClosure": { "set": false }
  },
  "fullProposal": "parity/research/dep-closure-wave-005/merge-proposal.json"
}
```

Full nodes/edges/refs mutations with evidence arrays are in `parity/research/dep-closure-wave-005/merge-proposal.json`.
