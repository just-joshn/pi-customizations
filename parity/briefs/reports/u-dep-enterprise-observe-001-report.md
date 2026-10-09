# Report: Enterprise policy live observation

## Status

`setStatusResolved: no`. Honest blocker. This signed-in Pro+ host cannot witness Enterprise team/org Model Providers or Organization Groups policy. Ledgers not edited. No allowlist changes. No commit. No secrets.

throughput checkpoint: n/a, read-only investigation

## Overview

Edge `cursor-cli-host → cursor-enterprise-integration-policy` stays unresolved. Prior host-edges terminal left it open for lack of live Enterprise observation. This unit re-probed the live signed-in account. Membership is still `pro_plus` / `active`. Storage and CLI show a personal `no-team` host, not an Enterprise team/org with Model Providers or Groups settings.

## Key concepts

- Public docs put Model Providers under Team Settings → Models (Enterprise only) and Organization → Groups → Models.
- Closing the edge needs live observation of that team/org policy plus MCP precedence and CLI applicability with attempt IDs.
- Standing prefs forbid worker-initiated allowlist widening. Observation alone is allowed when the account can see the policy.

## How it works (measured)

| Probe | Result | Evidence |
| --- | --- | --- |
| CLI auth | Signed in | `12-cli-policy-absence-dump.txt` |
| Membership | `stripeMembershipType=pro_plus`, `stripeSubscriptionStatus=active` | `04-membership-safe.txt`, `09-observation.json` |
| Team binding | Plugin install keys use `no-team` namespace only | `01-auth-key-names.txt` |
| Cached admin policy | `allowedModels=[]`, `blockedModels=[]`, `byokDisabled=false`; empty network/MCP-related allowlists | `05-admin-settings-structure.json`, `09-observation.json` |
| Server config cache | No team/org/enterprise/provider/group hits | `09-observation.json` |
| User settings | No Models / team policy keys | `07-user-settings-hits.json`, `settings.json` dump in `12-cli-policy-absence-dump.txt` |
| CLI Enterprise gate | `worker --pool` documented as Enterprise + team service account API key | `02-worker-help.txt` |
| Doc custody | `model-management.md` sha256 `2606b4bd74d43bd579c59945506ab691cd49de8da3386556e265c854f6c9d205` unchanged | `10-model-management-sha256.txt` |

No live Model Providers screen and no Organization Groups model-access settings are observable on this account. Cached `adminSettings` is not an Enterprise team Model Providers / Groups policy witness.

## Where things live

| Artifact | Path |
| --- | --- |
| Observation | `parity/research/dep-enterprise-observe-001/09-observation.json` |
| CLI absence dump | `parity/research/dep-enterprise-observe-001/12-cli-policy-absence-dump.txt` |
| Blocker + grant | `parity/research/dep-enterprise-observe-001/13-blocker-and-grant.json` |
| Prior disposition | `parity/research/dep-host-edges-terminal-001/host/enterprise-disposition.json` |
| Operator grant index | `parity/research/operator-remaining-gates-001/grant-checklist.json` (G2) |
| Doc contract | `parity/research/continuation/model-management.md` |

## Exact operator grant

From prior host-edges terminal checklist (`enterprise-disposition.json` / operator G2):

1. Provide an Enterprise team/org account with observable Model Providers / Groups model-access settings.
2. Authorize a read-only policy observation journey (no worker-initiated allowlist widening unless account owner explicitly grants it).
3. Measure MCP policy precedence and CLI applicability with attempt IDs.
4. Publish evidence and only then set edge.status to resolved.

Short form (G2): Provide Enterprise team/org with observable Model Providers / Groups settings. Authorize read-only policy observation (MCP precedence + CLI applicability). No worker-initiated allowlist widen unless you explicitly grant it.

## Recommendation

Do not set `status: resolved`. Keep docs-only / environment-bound disposition. Coordinator should leave the edge unresolved until G2 is paid and a new observation unit publishes attempt IDs.

## Gotchas

- Empty personal `adminSettings.cached` allowlists are not Enterprise Model Providers policy.
- `pro_plus` is sufficient for personal Cloud Agents / My Machines. It is not sufficient for team Self-Hosted Pool or team Model Providers / Groups.
- Doc re-hash refreshes custody. It does not close this edge.

## Verify

```bash
sqlite3 "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb" \
  "SELECT key, value FROM ItemTable WHERE key IN ('cursorAuth/stripeMembershipType','cursorAuth/stripeSubscriptionStatus');"
python3 -c "import json; print(json.load(open('parity/research/dep-enterprise-observe-001/13-blocker-and-grant.json'))['setStatusResolved'])"
```

Expected: `pro_plus` / `active`, and `setStatusResolved` false.
