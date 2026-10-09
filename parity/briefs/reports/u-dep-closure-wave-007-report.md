# u-dep-closure-wave-007 report

Status: complete (proposal published, ledgers untouched)

## Summary

Wave-007 refreshed Bun pin probes (still unresolved), re-verified the 136 typescript deep-internal catalog with zero hash drift and recorded a passing tools consumer typecheck (deep semantics still open), restated host computer-use/enterprise edges as environment-bound, and published a create-skill four-phase journey matrix (paired journeys still open). Three vague keep-open references were narrowed with path+hash evidence: recursive extraction (185 text files, 176 refs), live-integrations inventory (416 queue/proposal items), and tools consumer journey matrix (6 journeys, local smokes exit 0). Ledgers were not edited. `completeDependencyClosure` must stay false.

throughput checkpoint: n/a, read-only investigation

## Done predicate (measured)

| Check | Result |
| --- | --- |
| Each targeted edge/ref listed resolved or blocked | See Edge dispositions and Reference dispositions |
| Merge payload for coordinator | `parity/research/dep-closure-wave-007/merge-proposal.json` (also inlined below) |
| Hash verify for new captures | `VERIFIED` via `verify_inventory_shasum.py` / `verify-hashes.json` (38 sources) |
| No ledger edits | Wave writes only under owned research/report paths |
| No invented Bun pin | pinStatus `unresolved` after pin-file/shebang/mise probe |

## Counts

| Class | Count |
| --- | --- |
| Resolved references (this wave) | 3 (recursive extraction, live-integrations inventory, consumer journey matrix) |
| Unresolved targeted blockers (post-apply refs) | 7 |
| Typescript deep-internal files re-verified | 136 (catalogHashDriftCount=0) |
| Recursive text files scanned | 185 |
| Recursive unique refs extracted | 176 (31 absolute URLs, 145 relative-escape links) |
| Live inventory items | 416 |
| Consumer journeys in matrix | 6 |

Still open: Bun pin, typescript deep compiler-behavior semantics, host computer-use edge, host enterprise edge, create-skill paired journeys, plus narrowed live-exercise / recursive-runtime-audit / paired-consumer-journey lines. Journey edges team-kit and cli-host stay unverified.

## Overview

Dependency closure tracks nodes, edges, and open references for the poteto-mode tools subtree and linked Cursor host contracts. Wave-006 left Bun pin, host edges, typescript deep semantics, create-skill journeys, and three vague keep-open buckets (live, recursive, consumer). Wave-007 advances those leftovers with a rerunnable lever and does not invent pins, runtime grants, compiler-oracle results, or paired journeys.

## Key concepts

- Edge resolved means the graph relationship is established with custody evidence. It does not mean journey or Pi lifecycle acceptance.
- Official Bun pin means a declared exact Bun binary version in the tools subtree. Local `bun --version`, host mise `bun/latest`, shebang `#!/usr/bin/env bun`, and `bun-types` lock resolves are not pins.
- Environment-bound means the contract requires live helpers, desktops, or org policy surfaces this worker must not fabricate.
- Deep compiler-behavior semantics means proof of TypeScript@7.0.2 internal AST/enum/helper behavior under a compiler-test oracle. Consumer `tsc --version` and `bun run typecheck` are activation evidence only.
- Recursive extraction complete means every readable text file in the locked distribution inventory was scanned for absolute URLs and relative-escape links with source path+hash. It is not live audit of those targets.
- Live inventory complete means named integration/cloud/automation/MCP/model contracts were collected from prior host research artifacts. It is not live exercise.

## How it works

`package.json` still pins only `commander@14.0.0` as a runtime dependency. DevDependencies still declare `bun-types` and `typescript` as `latest`. `bun.lock` still freezes those packages. No tools or poteto-mode file declares engines, packageManager, volta, `.bun-version`, bunfig, mise, or `.tool-versions`. Shebangs invoke `env bun` without a version. Host `which bun` resolves to mise `bun/latest` at local 1.4.2. Official Bun docs were re-fetched. The legacy bun-version guide URL still returns HTTP 404. Computer-use and enterprise continuation docs keep prior sha256 values (`a9ceb020…`, `2606b4bd…`). Typescript deep catalog matches wave-006 hashes. `bun x typescript@7.0.2 tsc --version` prints `Version 7.0.2`. `bun run typecheck` exits 0. create-skill SKILL.md still matches live install hash `255a3d3be7bac8984a13279f754f091a1de6f72c82bdf73e6b3c868e77e7ee82`.

## Where things live

| Artifact | Path |
| --- | --- |
| Inventory | `parity/research/dep-closure-wave-007/read-inventory.json` |
| Merge proposal | `parity/research/dep-closure-wave-007/merge-proposal.json` |
| Hash verify | `parity/research/dep-closure-wave-007/verify-hashes.json` |
| Bun capture | `parity/research/dep-closure-wave-007/bun/official-capture.json` |
| Typescript deep disposition | `parity/research/dep-closure-wave-007/npm/typescript-deep-semantics-disposition.json` |
| Host disposition | `parity/research/dep-closure-wave-007/host-edge-disposition.json` |
| create-skill journey matrix | `parity/research/dep-closure-wave-007/create-skill/journey-matrix.json` |
| Recursive extraction | `parity/research/dep-closure-wave-007/recursive/extraction.json` |
| Live integrations inventory | `parity/research/dep-closure-wave-007/live/integrations-inventory.json` |
| Consumer journey matrix | `parity/research/dep-closure-wave-007/consumer/journey-matrix.json` |
| Decision log | `parity/research/dep-closure-wave-007/decisions.tsv` |
| Lever | `parity/research/dep-closure-wave-007/build_wave.py` |

## Gotchas

- `closureAudited: true` already records the independent audit. This wave must not treat audit completion as source closure.
- Host computer-use and enterprise edges cannot be resolved from Markdown alone.
- Passing `bun run typecheck` does not close deep compiler-behavior semantics for 136 internal dist files.
- Recursive extraction completeness does not close runtime audit of extracted URLs.
- Local orch `--help` and typecheck smokes are not paired Cursor+Pi acceptance journeys.
- Do not invent a Bun pin from local 1.4.2, mise latest, or bun-types.

## Edge dispositions

### Resolved (0 new graph edges)

No new edge status changes. Wave-003 tools-chain resolutions stand.

### Still unresolved / unverified (4)

1. `cursor-cli-host` → `cursor-self-hosted-computer-use` (unresolved, environment-bound)
   - Blocker: public docs only. macOS helper identity/privacy grants, Linux display/desktop services, and sharing transport were not exercised.
   - Evidence: `parity/research/dep-closure-wave-007/host-edge-disposition.json`; doc sha256 `a9ceb020282d7c61ad99ccd13de0c8831dd57499ac32af31b5f4afc9e9e186d0`.

2. `cursor-cli-host` → `cursor-enterprise-integration-policy` (unresolved, environment-bound)
   - Blocker: public docs only. Live team/org policy enforcement and CLI applicability were not observed. Standing orders forbid broad allowlist or authorization changes.
   - Evidence: same host disposition file; doc sha256 `2606b4bd74d43bd579c59945506ab691cd49de8da3386556e265c854f6c9d205`.

3. `cursor-pstack` → `cursor-team-kit` (unverified)
   - Blocker: distribution custody exists; complete source and paired journey closure for the full skill set is not shown.

4. `cursor-pstack` → `cursor-cli-host` (unverified)
   - Blocker: persistent-mode editor actions (Option/Alt+Enter) and later-turn behavior still need paired Cursor+Pi runtime evidence.

## Reference dispositions

### Resolved this wave (3)

1. Recursive reference extraction from locked distribution inventory.
   - Evidence: `parity/research/dep-closure-wave-007/recursive/extraction.json` sha256 `eb531640c75896c1443fd0f8c12f5a82b79c3500d6cbbe9425611222621ca323` (185 text files; 176 unique refs).
   - Proposal action: remove vague "still require complete extraction and audit" line; add narrower runtime-audit-open line pointing at wave-007 extraction.

2. Live integrations / automation / models inventory.
   - Evidence: `parity/research/dep-closure-wave-007/live/integrations-inventory.json` sha256 `63ef7f8f4c35e3918556e787f22eb308666e5e8d0b444b41584524ce13b867d4` (416 items; 9 CLI snapshot hits).
   - Proposal action: remove vague keep-open string; add inventoried + live-exercise-open line.

3. Tools consumer acceptance journey matrix.
   - Evidence: `parity/research/dep-closure-wave-007/consumer/journey-matrix.json` sha256 `0d007527cd8d70f9888776cdd5135151b8db34167af26f5820cae939fc743ed3` (6 journeys; orch-help and typecheck exit 0).
   - Proposal action: remove vague broader-journeys line; add matrix + paired-acceptance-open line.

### Progress, not closed

- npm:typescript@7.0.2 deep-internal catalog re-verified (136 files, drift 0) with consumer typecheck exit 0 at `parity/research/dep-closure-wave-007/npm/typescript-deep-semantics-disposition.json`. Deep compiler-behavior semantics remain open.
- Bun pin probe refreshed at `parity/research/dep-closure-wave-007/bun/official-capture.json`. pinStatus remains `unresolved`.
- create-skill journey matrix published at `parity/research/dep-closure-wave-007/create-skill/journey-matrix.json` (4 phases; capture matches live). Paired journeys remain open.

### Still unresolved (concrete)

- Official Bun runtime version pin under source-bun-runtime remains unresolved after wave-007 capture.
- npm:typescript@7.0.2 deep compiler-behavior semantics remain open after wave-007 disposition.
- cursor-cli-host edges to computer-use and enterprise policy remain unresolved after wave-007 environment-bound disposition.
- cursor-create-skill journey audit remains open after wave-007 journey matrix (paired journeys not run).
- Inventoried live integrations remain open for live exercise / automation-editor runtime.
- Recursive extracted external targets remain open for live/runtime audit.
- Tools consumer paired Cursor+Pi acceptance journeys remain open after matrix + local smokes.

## Hash verify notes

Rerun:

```bash
python3 parity/research/dep-closure-wave-007/verify_inventory_shasum.py
```

Inventory status from this run: `VERIFIED` (38 sources).

## completeDependencyClosure

Cannot be claimed. Proposal sets `cursorPlugins.completeDependencyClosure` false. Remaining blockers are the Bun pin, four host/journey edges, typescript deep compiler-behavior semantics, create-skill paired journeys, and live/runtime follow-ups on inventoried integrations and extracted recursive refs.

## Merge payload

Coordinator-only apply target. Worker did not edit ledgers.

Path: `parity/research/dep-closure-wave-007/merge-proposal.json`

```json
{
  "schemaVersion": 1,
  "unit": "u-dep-closure-wave-007",
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
            "parity/research/dep-closure-wave-007/read-inventory.json",
            "parity/research/dep-closure-wave-007/bun/official-capture.json",
            "parity/research/dep-closure-wave-007/nodes/bun-pin.md"
          ]
        }
      },
      {
        "id": "npm:typescript@7.0.2",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-007/npm/typescript-deep-semantics-disposition.json",
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
            "parity/research/dep-closure-wave-007/host-edge-disposition.json",
            "parity/research/dep-closure-wave-007/nodes/host-edge-disposition.md"
          ]
        }
      },
      {
        "id": "cursor-enterprise-integration-policy",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-007/host-edge-disposition.json",
            "parity/research/dep-closure-wave-007/nodes/host-edge-disposition.md"
          ]
        }
      },
      {
        "id": "cursor-create-skill",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-007/create-skill/journey-matrix.json",
            "parity/research/dep-closure-wave-007/nodes/create-skill-journey-matrix.md",
            "parity/research/dep-closure-wave-006/create-skill/subordinate-audit.json",
            "parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md"
          ]
        }
      },
      {
        "id": "cursor-cli-host",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-007/live/integrations-inventory.json",
            "parity/research/dep-closure-wave-007/nodes/live-integrations.md"
          ]
        }
      },
      {
        "id": "cursor-pstack",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-007/recursive/extraction.json",
            "parity/research/dep-closure-wave-007/nodes/recursive-extraction.md"
          ]
        }
      },
      {
        "id": "source-tools-manifest",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-007/consumer/journey-matrix.json",
            "parity/research/dep-closure-wave-007/nodes/consumer-journey-matrix.md",
            "parity/research/dep-closure-wave-003/consumer-binding.json"
          ]
        }
      }
    ]
  },
  "sourceLock": {
    "cursorPlugins.completeDependencyClosure": { "set": false }
  },
  "fullProposal": "parity/research/dep-closure-wave-007/merge-proposal.json"
}
```

Full nodes/edges/refs mutations with evidence arrays are in `parity/research/dep-closure-wave-007/merge-proposal.json`.
