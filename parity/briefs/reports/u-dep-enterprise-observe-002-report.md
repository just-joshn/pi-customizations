# Report: Enterprise policy live observation (002)

## Status

`setStatusResolved: no`. Re-measured 2026-10-09T10:54Z (console locked). Membership still `pro_plus`. Storage still `no-team` plugin namespace. Cached `adminSettings` still empty allowlists — not an Enterprise Model Providers / Groups witness. Edge stays unresolved. Ledgers not resolved.

## Probe

Read-only `state.vscdb` ItemTable:

| Key | Result |
| --- | --- |
| `cursorAuth/stripeMembershipType` | `pro_plus` |
| `adminSettings.cached` | `allowedModels=[]`, `blockedModels=[]`, `byokDisabled=false`, `networkAllowlistLen=0` |
| `adminSettings.cachedAuthId` | present (same auth0 id family as observe-001) |
| `no-team` plugin keys | 2 samples (personal host) |

Artifact: `parity/research/dep-enterprise-observe-002/09-observation.json`.

## Operator grant still required (G2)

Enterprise team/org with observable Model Providers / Organization Groups settings + read-only observation authorization. No worker-initiated allowlist widening.

## Non-claims

Does not resolve `cursor-cli-host` → `cursor-enterprise-integration-policy`. Observe-001 conclusions stand; 002 is a freshness recheck only.
