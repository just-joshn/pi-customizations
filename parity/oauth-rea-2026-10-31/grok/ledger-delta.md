# Ledger delta versus prior `parity/pi-xai-oauth` (Grok 1.0.50 → 1.0.70)

Prior statuses are from `parity/pi-xai-oauth/ledger.md`. This file records what changes when the reference CLI becomes 1.0.70. It does not rewrite `ledger.json`.

| ID | Prior status | 1.0.70 status | Why |
|---|---|---|---|
| XAI-001 | VERIFIED | VERIFIED (evidence refresh) | Authorize order, client, scope, referrer, `%20` match 1.0.70 probe. Update evidence pointer from 1.0.50 fixture to also cite `oauth-rea-2026-10-31/grok/login-probe.txt`. Test still passes against stable fields. |
| XAI-002 | VERIFIED | VERIFIED (partial re-evidence) | Device help and `/oauth2/device/code` + token grant strings remain. Verification URI not re-captured. Keep prior host as assumed. |
| XAI-003 | INCONCLUSIVE | INCONCLUSIVE | Unchanged. Full scope still requested. Server grant/require still unobserved (no live token). |
| XAI-004 | VERIFIED | VERIFIED | `GROK_AUTH_EARLY_INVALIDATION_SECS` default 300 still documented. Pi 300s skew still correct. |
| XAI-005 | VERIFIED | VERIFIED (not re-run) | Hot Reload / auth.json docs remain. Logout mode not re-probed. |
| XAI-006 | VERIFIED | **VERIFIED (tree already bumped)** | Grok sends `1.0.70`. `extensions/pi-xai-oauth/src/request.ts` already exports `GROK_CLIENT_VERSION = '1.0.70'`. Tests assert that value. Gate minimum not re-probed on 1.0.70. |
| XAI-007 | VERIFIED | VERIFIED (string-only) | `X-XAI-Token-Auth` / `xai-grok-cli` still in binary. Wrong-value 401 not re-probed. |
| XAI-008 | VERIFIED | VERIFIED (string-only) | `x-grok-model-override` still named. |
| XAI-009 | VERIFIED | VERIFIED (string-only) | `x-grok-conv-id` still named. |
| XAI-010 | VERIFIED | VERIFIED (string-only) | Proxy `/v1/models` origin unchanged. Live bearer GET not repeated. |
| XAI-011 | VERIFIED | VERIFIED (not re-captured) | Responses path still referenced in sampler. No new 1.0.70 wire body. |
| XAI-012 | VERIFIED | **INCONCLUSIVE** | Binary lacks `grok-4.7-build-fast` and mentions `grok-4.7-high-fast`. Live catalog unknown. Pi baseline may be stale. |
| XAI-013 | NOT APPLICABLE | NOT APPLICABLE | No new evidence forces a package-level 401 retry. |
| XAI-014 | VERIFIED | VERIFIED (docs only) | Hot Reload section still present. |
| XAI-015 | NOT APPLICABLE | NOT APPLICABLE | Customer OIDC still separate. |
| XAI-016 | NOT APPLICABLE | NOT APPLICABLE | External auth provider still separate. |
| XAI-017 | NOT APPLICABLE | NOT APPLICABLE | API key fallback still out of subscription OAuth scope. |
| XAI-018 | NOT APPLICABLE | NOT APPLICABLE | Grove / MCP OAuth still separate. |
| XAI-019 | NOT APPLICABLE | NOT APPLICABLE (inventory grew) | More metadata headers named (`deployment-id`, `client-surface`, `experiments`, …). Still excluded unless a probe shows the auth gate requires them. |
| XAI-020 | VERIFIED | VERIFIED (not re-run) | Prove-list not re-run against 1.0.70. Depends on catalog if fast id renamed. |
| XAI-021 | VERIFIED | VERIFIED (not re-run) | Install/remove unrelated to CLI bump. |
| XAI-022 | VERIFIED | VERIFIED (not re-run) | Context windows not re-fetched. |
| XAI-023 | NOT APPLICABLE | NOT APPLICABLE | Effort aliases still Pi-local. |

## New candidate rows (not in prior ledger)

| Candidate | Behavior | Status |
|---|---|---|
| XAI-024? | Device (and maybe inference) may send `x-grok-client-surface` | UNKNOWN. String-only. |
| XAI-025? | Sampler may send `x-grok-max-completion-tokens` / `x-models-etag` | UNKNOWN. String-only. |
| XAI-026? | Fast catalog id may be `grok-4.7-high-fast` | INCONCLUSIVE until live `GET /v1/models`. |

## Bottom line for ledger maintainers

Keep XAI-006 verified. Cite 1.0.70 binary and the bumped constant.
Park XAI-012 as inconclusive until a live catalog capture.
Keep authorize login rows verified with the 1.0.70 probe / `grok-1.0.70-authorize-url.json`.
