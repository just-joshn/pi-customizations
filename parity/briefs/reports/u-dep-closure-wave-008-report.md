# u-dep-closure-wave-008 report

Status: complete (proposal published, ledgers untouched)

## Summary

Wave-008 resolves one graph edge. `cursor-pstack` → `cursor-team-kit` is proposed `resolved` on 29/29 locked distribution path+hash custody at revision `ccb5507cec1546dc88135c1139c811e6c59115ba`. Per-skill paired journeys stay open as a new unresolvedReference. The `cursor-pstack` → `cursor-cli-host` persistent-mode edge stays `unverified` and is now environment-bound with measured Custom Mode harness evidence (`glass_custom_modes` off; attempts `6977eeec…` / `9857dda0…`). Host computer-use and enterprise edges stay unresolved and environment-bound. Bun pin, typescript deep semantics, create-skill journeys, live exercise, recursive runtime audit, and consumer paired journeys remain open with refreshed wave-008 path+hash pointers. Ledgers were not edited. `completeDependencyClosure` must stay false.

throughput checkpoint: n/a, read-only investigation

## Done predicate (measured)

| Check | Result |
| --- | --- |
| Each targeted edge/ref listed resolved or blocked | See Edge dispositions and Reference dispositions |
| Merge payload for coordinator | `parity/research/dep-closure-wave-008/merge-proposal.json` (also inlined below) |
| Hash verify for new captures | `VERIFIED` via `verify_inventory_shasum.py` / `verify-hashes.json` |
| No ledger edits | Wave writes only under owned research/report paths |
| No invented Bun pin | pinStatus `unresolved` after pin-file/shebang/mise probe |

## Counts

| Class | Count |
| --- | --- |
| Newly resolvable edges | 1 (`cursor-pstack` → `cursor-team-kit`) |
| Newly resolvable references | 0 |
| Unresolved targeted blockers (post-apply refs) | 8 |
| Team-kit files re-verified vs distribution-sha256 | 29 (lockMatchCount=29) |
| Typescript deep-internal files re-verified | 136 (catalogHashDriftCount=0) |

Still open after apply. Bun pin, typescript deep compiler-behavior semantics, host computer-use, host enterprise, cli-host persistent-mode, create-skill paired journeys, team-kit skill-set paired journeys, live exercise, recursive runtime audit, consumer paired journeys.

## Overview

Dependency closure tracks nodes, edges, and open references for the poteto-mode tools subtree and linked Cursor host contracts. Wave-007 left two unverified journey edges (team-kit, cli-host), two environment-bound host edges, and seven unresolvedReferences. Wave-008 advances those leftovers with a rerunnable lever. It does not invent pins, runtime grants, compiler-oracle results, or paired journeys.

## Key concepts

- Edge resolved means the graph install/custody relationship is established with path+hash evidence. It does not mean journey or Pi lifecycle acceptance.
- Team-kit custody resolve follows the create-skill pattern. Resource/install evidence closes the edge. Journey audit stays as an unresolvedReference.
- Environment-bound means the contract requires live helpers, desktops, org policy surfaces, or account feature gates this worker must not fabricate.
- Official Bun pin means a declared exact Bun binary version in the tools subtree. Local `bun --version`, host mise `bun/latest`, and `bun-types` lock resolves are not pins.
- Deep compiler-behavior semantics means proof of TypeScript@7.0.2 internal AST/enum/helper behavior under a compiler-test oracle. Consumer `tsc --version` and `bun run typecheck` are activation evidence only.

## How it works

The wave-008 lever re-hashes all 29 locked `cursor-team-kit` files against `parity/reference/distribution-sha256.txt`, quotes the pstack README install contract, and probes live plugin-cache presence (pstack cache present at locked revision; team-kit cache absent). It binds the cli-host persistent-mode edge to the existing Custom Mode path report and probe summary (Statsig `glass_custom_modes` off). It re-hashes continuation docs for computer-use and enterprise policy, runs `mdfind` for the computer-use helper bundle (no matches), re-probes Bun pin files and docs, re-verifies the 136 typescript deep catalog with zero drift, re-checks create-skill capture vs live install, and carries forward live/recursive/consumer inventories with fresh sha256 pointers plus local orch/typecheck smoke exits of 0.

## Where things live

| Artifact | Path |
| --- | --- |
| Inventory | `parity/research/dep-closure-wave-008/read-inventory.json` |
| Merge proposal | `parity/research/dep-closure-wave-008/merge-proposal.json` |
| Hash verify | `parity/research/dep-closure-wave-008/verify-hashes.json` |
| Team-kit custody | `parity/research/dep-closure-wave-008/team-kit/custody-disposition.json` |
| Cli-host persistent mode | `parity/research/dep-closure-wave-008/cli-host/persistent-mode-disposition.json` |
| Host disposition | `parity/research/dep-closure-wave-008/host/host-edge-disposition.json` |
| Bun capture | `parity/research/dep-closure-wave-008/bun/official-capture.json` |
| Typescript deep disposition | `parity/research/dep-closure-wave-008/npm/typescript-deep-semantics-disposition.json` |
| create-skill journey audit | `parity/research/dep-closure-wave-008/create-skill/journey-audit.json` |
| Live carryforward | `parity/research/dep-closure-wave-008/live/integrations-carryforward.json` |
| Recursive carryforward | `parity/research/dep-closure-wave-008/recursive/extraction-carryforward.json` |
| Consumer carryforward | `parity/research/dep-closure-wave-008/consumer/journey-carryforward.json` |
| Decision log | `parity/research/dep-closure-wave-008/decisions.tsv` |
| Lever | `parity/research/dep-closure-wave-008/build_wave.py` |

## Gotchas

- `closureAudited: true` already records the independent audit. This wave must not treat audit completion as source closure.
- Resolving team-kit install custody does not close per-skill paired journeys.
- Host computer-use and enterprise edges cannot be resolved from Markdown alone.
- Passing `bun run typecheck` does not close deep compiler-behavior semantics for 136 internal dist files.
- Custom Mode exhaustive-negative probes are not a success path. They tighten the blocker. They do not resolve the cli-host edge.
- Do not invent a Bun pin from local 1.4.2, mise latest, or bun-types.
- Live team-kit plugin-cache absence is consumer evidence, not a reason to drop the locked distribution edge.

## Edge dispositions

### Resolved this wave (1)

1. `cursor-pstack` → `cursor-team-kit` (proposed `resolved`)
   - Evidence: `parity/research/dep-closure-wave-008/team-kit/custody-disposition.json` (29/29 lock matches; manifest sha256 `9c8622d0577205959b6469a5454cbe2787ad3c6412439759328e92dc0115584d`; version `1.2.0`; README contract line present).
   - Note: full skill-set paired journeys remain open as a separate unresolvedReference.

### Still unresolved / unverified (3)

1. `cursor-cli-host` → `cursor-self-hosted-computer-use` (unresolved, environment-bound)
   - Blocker: public docs only. Helper bundle `mdfind` returned no matches. macOS grants / Linux desktop / sharing transport not exercised.
   - Evidence: `parity/research/dep-closure-wave-008/host/host-edge-disposition.json`; doc sha256 `a9ceb020282d7c61ad99ccd13de0c8831dd57499ac32af31b5f4afc9e9e186d0`.

2. `cursor-cli-host` → `cursor-enterprise-integration-policy` (unresolved, environment-bound)
   - Blocker: public docs only. Live team/org policy enforcement and CLI applicability not observed.
   - Evidence: same host disposition file; doc sha256 `2606b4bd74d43bd579c59945506ab691cd49de8da3386556e265c854f6c9d205`.

3. `cursor-pstack` → `cursor-cli-host` (unverified, environment-bound)
   - Blocker: persistent-mode Option/Alt+Enter Custom Mode path blocked by Statsig `glass_custom_modes` off on locked cursor-agent `2026.10.01-e373342`. Attempts `6977eeec-08bd-4829-810c-11d526d9f9fb` and `9857dda0-a74d-4546-b69e-1ff3528bdf3e`. No success attempt ID. Operator gate remains.
   - Evidence: `parity/research/dep-closure-wave-008/cli-host/persistent-mode-disposition.json`; `parity/briefs/reports/u-cursor-custom-mode-path-report.md`.

## Reference dispositions

### Resolved this wave (0)

No vague keep-open reference strings were closed. Wave-007 already inventoried live/recursive/consumer.

### Progress, not closed

- npm:typescript@7.0.2 deep-internal catalog re-verified (136 files, drift 0) with consumer typecheck exit 0.
- Bun pin probe refreshed. pinStatus remains `unresolved`.
- create-skill capture still matches live install sha256 `255a3d3be7bac8984a13279f754f091a1de6f72c82bdf73e6b3c868e77e7ee82`. Four phase journeys still `not_run`.
- Live, recursive, and consumer artifacts carried forward with wave-008 sha256 pointers. Local orch `--help` and typecheck smokes exit 0.

### Still unresolved (concrete)

- Official Bun runtime version pin under source-bun-runtime.
- npm:typescript@7.0.2 deep compiler-behavior semantics.
- cursor-cli-host edges to computer-use and enterprise policy.
- cursor-create-skill paired journeys.
- cursor-team-kit full skill-set paired journeys (new line after custody resolve).
- Inventoried live integrations live exercise / automation-editor runtime.
- Recursive extracted external targets live/runtime audit.
- Tools consumer paired Cursor+Pi acceptance journeys.
- cursor-pstack → cursor-cli-host persistent-mode environment-bound gate (also kept as edge status `unverified`).

## Hash verify notes

Rerun:

```bash
python3 parity/research/dep-closure-wave-008/verify_inventory_shasum.py
```

Inventory status from this run: `VERIFIED`.

## completeDependencyClosure

Cannot be claimed. Proposal sets `cursorPlugins.completeDependencyClosure` false. Remaining blockers are the Bun pin, three host/journey edges, typescript deep compiler-behavior semantics, create-skill/team-kit/consumer paired journeys, and live/runtime follow-ups on inventoried integrations and extracted recursive refs.

## Merge payload

Coordinator-only apply target. Worker did not edit ledgers.

Path: `parity/research/dep-closure-wave-008/merge-proposal.json`

```json
{
  "schemaVersion": 1,
  "unit": "u-dep-closure-wave-008",
  "completeDependencyClosure": false,
  "resolvedEdgeCount": 1,
  "resolvedReferenceCount": 0,
  "unresolvedTargetCount": 8,
  "dependencies": {
    "edgeMutations": [
      {
        "from": "cursor-pstack",
        "to": "cursor-team-kit",
        "set": {
          "status": "resolved",
          "blocker": null,
          "evidence": [
            "parity/research/dep-closure-wave-008/team-kit/custody-disposition.json",
            "parity/research/dep-closure-wave-008/nodes/team-kit-custody.md",
            "parity/reference/distribution-sha256.txt",
            "parity/reviews/source-discovery.md"
          ],
          "note": "Locked distribution custody for cursor-team-kit@1.2.0 at revision ccb5507cec1546dc88135c1139c811e6c59115ba re-verified (29/29 files match parity/reference/distribution-sha256.txt). pstack README install contract quoted. Source readingComplete already true. Per-skill paired Cursor+Pi journeys for the full team-kit skill set remain open as a separate unresolvedReference (same pattern as create-skill edge vs journey ref)."
        }
      },
      {
        "from": "cursor-pstack",
        "to": "cursor-cli-host",
        "set": {
          "status": "unverified",
          "disposition": "environment-bound",
          "blocker": "Persistent-mode Option/Alt+Enter Custom Mode path is environment-bound. Measured exhaustive-negative on locked cursor-agent 2026.10.01-e373342: glass_custom_modes off; attempts 6977eeec-08bd-4829-810c-11d526d9f9fb and 9857dda0-a74d-4546-b69e-1ff3528bdf3e; no success attempt ID. Operator must enable Custom Modes (or capture via Agents Window/IDE path), then recapture paired Cursor+Pi sticky evidence.",
          "evidence": [
            "parity/briefs/reports/u-cursor-custom-mode-path-report.md",
            "parity/evidence/mode-sticky/probes/probe-custom-mode-path-summary.json",
            "parity/mismatches.json",
            "parity/requirements.json",
            "parity/research/dep-closure-wave-008/cli-host/persistent-mode-disposition.json",
            "parity/research/dep-closure-wave-008/nodes/cli-host-persistent-mode.md"
          ]
        }
      }
    ],
    "nodeMutations": [
      {
        "id": "cursor-team-kit",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-008/team-kit/custody-disposition.json",
            "parity/research/dep-closure-wave-008/nodes/team-kit-custody.md",
            "parity/reviews/source-discovery.md",
            "parity/reference/distribution-sha256.txt"
          ]
        }
      },
      {
        "id": "cursor-cli-host",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-008/cli-host/persistent-mode-disposition.json",
            "parity/research/dep-closure-wave-008/host/host-edge-disposition.json",
            "parity/research/dep-closure-wave-008/nodes/cli-host-persistent-mode.md",
            "parity/research/dep-closure-wave-007/live/integrations-inventory.json"
          ]
        }
      },
      {
        "id": "source-bun-runtime",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-008/bun/official-capture.json",
            "parity/research/dep-closure-wave-008/nodes/bun-pin.md"
          ]
        }
      },
      {
        "id": "npm:typescript@7.0.2",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-008/npm/typescript-deep-semantics-disposition.json",
            "parity/research/dep-closure-wave-007/npm/typescript-deep-semantics-disposition.json",
            "parity/research/dep-closure-wave-005/npm/typescript-body-audit.json"
          ]
        }
      },
      {
        "id": "cursor-create-skill",
        "set": {
          "readingEvidence": [
            "parity/research/dep-closure-wave-008/create-skill/journey-audit.json",
            "parity/research/dep-closure-wave-007/create-skill/journey-matrix.json",
            "parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md"
          ]
        }
      }
    ]
  },
  "sourceLock": {
    "cursorPlugins.completeDependencyClosure": { "set": false }
  },
  "fullProposal": "parity/research/dep-closure-wave-008/merge-proposal.json"
}
```

Full nodes/edges/refs mutations with evidence arrays are in `parity/research/dep-closure-wave-008/merge-proposal.json`.
