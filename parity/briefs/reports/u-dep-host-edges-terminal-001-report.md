# Report: Host dependency edges terminal disposition

## Status

VERDICT `none-honestly-resolvable`. Merge payload is explicit none (`mergePayloadReady: false`, `resolvedEdgeCount: 0`). Ledgers not edited. No commit. No fabricated live Computer Use, Enterprise, or sticky exercise.

throughput checkpoint: n/a, read-only investigation

## Overview

Three open edges still block `parity/scripts/completion.mjs` because that gate accepts only `edge.status === 'resolved'`. Prior waves left all three environment-bound. This unit re-hashed doc custody, re-probed the Computer Use helper install, re-confirmed locked `cursor-agent` and Custom Mode probe hashes, and judged whether any edge can become `resolved` without inventing live exercise.

None can. Doc custody and exhaustive-negative probes do not satisfy the contracts. The Bun `absent-in-source` close does not apply here because these contracts are present in source and docs.

## Key concepts

- `DEPENDENCY_EDGE_UNRESOLVED` fires for every edge whose status is not exactly `resolved`, including `unverified`.
- Preference 4 keeps unsatisfied requirements active. Clearing the gate by lowering the bar is forbidden.
- `absent-in-source` is honest only when exhaustive custody proves the contracted artifact is not declared. It is dishonest when the contract exists and runtime exercise remains undone.

## How it works

| Edge | Current | Honest `resolved`? | Why |
| --- | --- | --- | --- |
| `cursor-cli-host` → `cursor-self-hosted-computer-use` | `unresolved` | No | `computer-use.md` sha256 `a9ceb020282d7c61ad99ccd13de0c8831dd57499ac32af31b5f4afc9e9e186d0` unchanged. Helper `mdfind` empty. `~/.cursor/cursor-computer-use` missing. No live attempt IDs. |
| `cursor-cli-host` → `cursor-enterprise-integration-policy` | `unresolved` | No | `model-management.md` sha256 `2606b4bd74d43bd579c59945506ab691cd49de8da3386556e265c854f6c9d205` unchanged. No live team/org policy observation. Standing orders forbid worker allowlist changes. |
| `cursor-pstack` → `cursor-cli-host` (persistent-mode) | `unverified` | No | Locked `cursor-agent` `2026.10.01-e373342`. Custom Mode path report sha256 `285b46915c829d691dac04fadc56c90a3eeb93aef5242fe0253185a6846eae21`. Attempts `6977eeec-08bd-4829-810c-11d526d9f9fb` and `9857dda0-a74d-4546-b69e-1ff3528bdf3e` are exhaustive-negative. `successAttemptId` is null. `glass_custom_modes` off. |

## Where things live

| Artifact | Path |
| --- | --- |
| Dispositions | `parity/research/dep-host-edges-terminal-001/dispositions.json` |
| Gate checklist | `parity/research/dep-host-edges-terminal-001/gate-checklist.json` |
| Merge payload (none) | `parity/research/dep-host-edges-terminal-001/merge-payload.json` |
| Helper probe | `parity/research/dep-host-edges-terminal-001/probes/helper-mdfind.json` |
| Hash verify | `parity/research/dep-host-edges-terminal-001/verify-hashes.json` |
| Prior host wave | `parity/research/dep-closure-wave-009/host/host-edge-disposition.json` |
| Prior sticky wave | `parity/research/dep-closure-wave-009/cli-host/persistent-mode-disposition.json` |
| Sticky path report | `parity/briefs/reports/u-cursor-custom-mode-path-report.md` |

## Operator grants that would close each edge

1. Computer Use. Install or allow first-run of helper `co.anysphere.cursor-computer-use` (Team ID `DCNK4UB866`), grant Accessibility and Screen Recording, exercise `agent worker --computer-use start` (plus Linux desktop sharing if in scope), publish attempt IDs, then set `resolved`.
2. Enterprise. Authorize read-only observation of Enterprise team/org model access and MCP policy with CLI applicability, publish attempt IDs, then set `resolved`. Do not widen allowlists without account-owner grant.
3. Persistent-mode. Turn on `glass_custom_modes` for the reference account (or use a build/path where Custom Mode chrome appears), recapture paired Cursor+Pi sticky with a success attempt ID, then set `resolved`.

## Gate checklist

All three edges continue to emit `DEPENDENCY_EDGE_UNRESOLVED`. Do not recommend `status: resolved` solely to clear the gate. Full machine-readable checklist: `parity/research/dep-host-edges-terminal-001/gate-checklist.json`.

## Gotchas

- Re-hashing docs refreshes custody. It does not close runtime contracts.
- Exhaustive-negative Custom Mode probes prove the gate is off. They do not prove the sticky contract is absent.
- Bun pin terminal used `absent-in-source` only after proving no pin declaration exists under poteto-mode tools. That pattern does not transfer to these edges.

## Merge payload summary

Coordinator must not apply edge status mutations. `merge-payload.json` sets `mergePayloadReady: false`, `edgeMutations: []`, and `completeDependencyClosure: false`.

## Verify

```bash
shasum -a 256 \
  parity/research/continuation/computer-use.md \
  parity/research/continuation/model-management.md \
  parity/briefs/reports/u-cursor-custom-mode-path-report.md \
  parity/evidence/mode-sticky/probes/probe-custom-mode-path-summary.json
cursor-agent --version
mdfind 'kMDItemCFBundleIdentifier == "co.anysphere.cursor-computer-use"'
python3 -c "import json; print(json.load(open('parity/research/dep-host-edges-terminal-001/merge-payload.json'))['mergePayloadReady'])"
```

Expected. Doc hashes match ledger values above. Report and probe summary hashes match wave-009. `cursor-agent` prints `2026.10.01-e373342`. `mdfind` prints nothing. `mergePayloadReady` prints `False`.
