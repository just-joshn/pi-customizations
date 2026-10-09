# Report: Computer Use live exercise

## Status

VERDICT `live-yes-attempt-ids-no`. Live desktop control proved via Agent Helper MCP (before/after screenshots and typed marker). Cloud-agent attempt IDs missing. Merge recommendation is **do not** set `cursor-cli-host` → `cursor-self-hosted-computer-use` to `resolved`. Ledgers not edited.

throughput checkpoint: worker started → MCP exercise green → cloud claim blocked → report

## Overview

Desktop share and helper TCC were already Ready=yes. This unit started `cursor-agent worker --computer-use --share-desktop view_and_control`, ran a rerunnable Agent Helper MCP exercise against TextEdit, and tried to obtain a claimed cloud-agent attempt ID. Local control worked. The Cloud Agents API rejected the keychain session token as an invalid User API Key. Dashboard create was not used because spending needs an account-owner grant.

## Key findings

| Check | Result |
| --- | --- |
| Helper Accessibility / Screen Recording | true / true after exercise |
| Desktop share `view_and_control` ready | true |
| Worker start (`--computer-use --share-desktop view_and_control`) | yes, workerId `0400ae0d-aa5c-4949-a4b8-88e40cd9611a` |
| Live type + screenshot before/after | yes |
| Cloud attempt IDs | none |
| Edge may become `resolved` | no |

## Live exercise

Path. `cursor-agent-helper spawn-disclaimed -- mcp` via `parity/research/dep-computer-use-exercise-001/exercise-helper-mcp.mjs`.

Target. TextEdit.

Marker. `CU_LIVE_001_177e3351` (typed into the focused AXTextArea).

Artifacts.

| File | Role |
| --- | --- |
| `parity/evidence/computer-use/live-001/before-0.png` | empty Untitled document |
| `parity/evidence/computer-use/live-001/after-0.png` | same window showing the marker |
| `parity/evidence/computer-use/live-001/exercise-summary.json` | machine-readable pass (`liveExercise: true`) |
| `parity/evidence/computer-use/live-001/after-text.txt` | accessibility tree with marker value |

Screenshot sha256 differs (`08484b31…` vs `c7e19cb8…`). Visual read of after-0.png shows the marker string.

Worker log confirms Computer Use registered (`MacRemoteComputerUseExecutor`, `computerUseEnabled: true`) and desktop-share listener ready with `input: session`.

## Cloud claim blocker (measured)

1. `CURSOR_API_KEY` unset in the process environment.
2. Keychain `cursor-access-token` POSTed/GETed to `https://api.cursor.com/v0/agents` → HTTP 401 `Invalid User API Key` (Bearer and Basic). Probe. `parity/research/dep-computer-use-exercise-001/cloud-claim-probe.json`.
3. Creating a cloud agent from the dashboard was not done. Standing preference 6 forbids spending without account-owner action.

Without a claimed cloud-agent run, there is no agents-chat attempt ID for the MacRemoteComputerUseExecutor path the docs use as the permission proof.

## Merge payload

`parity/research/dep-computer-use-exercise-001/merge-payload.json`

- `mergePayloadReady`: false
- `edgeMutations`: []
- `setStatusResolved`: false
- `liveExercise`: true
- `attemptIds`: []

Coordinator keeps the edge unresolved until a claimed run publishes attempt IDs. Local Helper MCP evidence is real and should stay attached as progress, not as a silent status flip.

## Operator next

1. Mint a User API Key (Dashboard → API Keys), or authorize one dashboard claim against `https://cursor.com/agents#workerId=0400ae0d-aa5c-4949-a4b8-88e40cd9611a` that asks for a computer-use screenshot/click.
2. Capture that attempt ID and chat screenshot.
3. Coordinator sets the edge to `resolved` with those IDs.

## Verify

```bash
HELPER="$HOME/.cursor/agent-helper/Cursor Agent Helper.app/Contents/MacOS/cursor-agent-helper"
"$HELPER" check-permissions
"$HELPER" desktop-share-status --mode view_and_control
test -f parity/evidence/computer-use/live-001/before-0.png
test -f parity/evidence/computer-use/live-001/after-0.png
rg -n 'CU_LIVE_001_177e3351' parity/evidence/computer-use/live-001/after-text.txt
python3 -c "import json; print(json.load(open('parity/research/dep-computer-use-exercise-001/merge-payload.json'))['recommendation']['setStatusResolved'])"
```

Expected. Both permissions true. Desktop share ready true. Marker line present. `setStatusResolved` prints `False`.

## Artifacts

| Artifact | Path |
| --- | --- |
| Disposition | `parity/research/dep-computer-use-exercise-001/disposition-live-001.json` |
| Merge payload | `parity/research/dep-computer-use-exercise-001/merge-payload.json` |
| Worker stdout | `parity/research/dep-computer-use-exercise-001/stdout-live-001-worker-start.txt` |
| Exercise harness | `parity/research/dep-computer-use-exercise-001/exercise-helper-mcp.mjs` |
| Decision log | `parity/research/dep-computer-use-exercise-001/decisions.tsv` |
| Evidence dir | `parity/evidence/computer-use/live-001/` |
