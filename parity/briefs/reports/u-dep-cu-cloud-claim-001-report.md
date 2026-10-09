# Report: CU cloud claim probe

## Status

VERDICT `ready-yes-attempt-ids-no`. Desktop share and Helper TCC remain Ready=yes. Local live-001 evidence stays real. Fresh cloud claim probe still returns no MacRemoteComputerUseExecutor / cloud-agent attempt IDs. Merge recommendation is do not set `cursor-cli-host` → `cursor-self-hosted-computer-use` to `resolved`. Ledgers not edited.

throughput checkpoint: n/a, read-only investigation

## Overview

This unit re-checked Ready permissions, re-probed `CURSOR_API_KEY` and the keychain session token against `https://api.cursor.com/v0/agents`, and searched non-spend paths for existing claim attempt IDs. Ready stayed green. Auth stayed blocked. No account-owner spend grant was present on the machine, so paid dashboard create and `POST /v0/agents` were not used.

## Key findings

| Check | Result |
| --- | --- |
| Helper Accessibility / Screen Recording | true / true |
| Desktop share `view_and_control` ready | true |
| Worker process (`worker-server`) | alive (pid observed at probe time) |
| Persisted workerId | `0400ae0d-aa5c-4949-a4b8-88e40cd9611a` |
| Local live-001 marker | present (`CU_LIVE_001_177e3351`) |
| `CURSOR_API_KEY` env | unset |
| Keychain `cursor-access-token` | present, len 413, jwt-like |
| `GET /v0/agents` Bearer + Basic with session token | HTTP 401 `Invalid User API Key` |
| `POST /v0/agents` create | skipped (no owner spend grant) |
| Cloud attempt IDs | none |
| `setStatusResolved` | false |

## How the claim path works here

Cloud Agents API v0 list/create needs a User API Key (Dashboard → API Keys) via Basic auth (`-u KEY:`). A login session JWT in keychain authenticates the IDE and the local worker bridge. It is not a User API Key. Measured result matches that split. The self-hosted worker can register `MacRemoteComputerUseExecutor` and advertise `cursor.com/agents#workerId=…`. A claim that produces an agents-chat attempt ID still requires an authorized cloud-agent run against that worker.

## Where things live

| Artifact | Path |
| --- | --- |
| Probe JSON | `parity/research/dep-cu-cloud-claim-001/cloud-claim-probe.json` |
| Evidence copy | `parity/evidence/computer-use/claim-001/cloud-claim-probe.json` |
| Permissions | `parity/research/dep-cu-cloud-claim-001/permissions.json` |
| Desktop share | `parity/research/dep-cu-cloud-claim-001/desktop-share-status.json` |
| Disposition | `parity/research/dep-cu-cloud-claim-001/disposition.json` |
| Merge payload | `parity/research/dep-cu-cloud-claim-001/merge-payload.json` |
| Prior live evidence | `parity/evidence/computer-use/live-001/` |

## Non-spend paths tried

1. `GET https://api.cursor.com/v0/agents?limit=5` with keychain token as Bearer and as Basic. Both 401.
2. Local search under `~/.cursor` and prior worker stdout for `bc_*` claim IDs tied to this computer-use path. None found for a claimed MacRemoteComputerUseExecutor run.
3. Orch inbox/gates scan for a pre-existing account-owner spend or API-key grant for this unit. None.
4. Confirmed `cli-config.json` `authInfo` has account identity fields only, no User API Key.
5. Intentionally did not `POST /v0/agents` and did not open a paid dashboard create.

workerId `0400ae0d-aa5c-4949-a4b8-88e40cd9611a` is registration identity only. It is not an attempt ID.

## Gotchas

- Session token → 401 does not mean the worker is down. Ready can be fully green while claim listing stays unauthorized.
- Local Helper MCP live control is necessary but not sufficient for the docs' claimed cloud path.
- Creating a cloud agent without an owner grant would violate standing preference 6.

## Operator grant steps (exact)

Do one of the following as account owner.

### A. User API Key (preferred for re-probe)

1. Open [Cursor Dashboard → API Keys](https://cursor.com/dashboard/api).
2. Mint a User API Key.
3. In the same shell that will re-probe:

```bash
export CURSOR_API_KEY='…'   # owner-minted User API Key only
```

4. Re-probe list (non-create):

```bash
curl -sS -u "$CURSOR_API_KEY:" 'https://api.cursor.com/v0/agents?limit=5'
```

Expect JSON with an `agents` array, not `Invalid User API Key`.

5. When owner also grants one claim spend, create or dashboard-claim a run that targets worker `0400ae0d-aa5c-4949-a4b8-88e40cd9611a` and asks for a computer-use screenshot or click. Capture the agents-chat attempt ID and a chat screenshot artifact.

### B. Dashboard claim only (no API key file)

1. Confirm worker is up with computer-use and desktop share.
2. Owner opens `https://cursor.com/agents#workerId=0400ae0d-aa5c-4949-a4b8-88e40cd9611a`.
3. Owner authorizes one paid claim that exercises screenshot/click on this Mac.
4. Capture attempt ID + chat screenshot. Hand those to the coordinator.

Until A or B yields attempt IDs, the edge stays unresolved.

## Re-probe commands (after grant)

```bash
HELPER="$HOME/.cursor/agent-helper/Cursor Agent Helper.app/Contents/MacOS/cursor-agent-helper"
"$HELPER" check-permissions
"$HELPER" desktop-share-status --mode view_and_control
test -n "$CURSOR_API_KEY" && echo CURSOR_API_KEY=set || echo CURSOR_API_KEY=unset
curl -sS -u "$CURSOR_API_KEY:" 'https://api.cursor.com/v0/agents?limit=5' | head -c 500; echo
rg -n 'CU_LIVE_001_177e3351' parity/evidence/computer-use/live-001/after-text.txt
python3 -c "import json; print(json.load(open('parity/research/dep-cu-cloud-claim-001/merge-payload.json'))['recommendation']['setStatusResolved'])"
```

Expected before grant. Permissions true. Desktop share ready true. List agents 401 or unset key. `setStatusResolved` prints `False`.

## Merge payload

`parity/research/dep-cu-cloud-claim-001/merge-payload.json`

- `mergePayloadReady`: false
- `edgeMutations`: []
- `setStatusResolved`: false
- `attemptIds`: []
- `liveExercise`: true

Coordinator keeps the edge unresolved. Attach live-001 and this claim-001 probe as progress, not as a silent status flip.
