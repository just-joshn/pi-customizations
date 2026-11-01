# Ledger delta versus prior `parity/pi-xai-oauth` (Grok 1.0.50 → 1.0.70)

Prior statuses are from `parity/pi-xai-oauth/ledger.md`. This file records what changes when the reference CLI becomes 1.0.70. It does not rewrite `ledger.json`.

| ID | Prior status | 1.0.70 status | Why |
|---|---|---|---|
| XAI-001 | VERIFIED | VERIFIED (evidence refresh) | Authorize order, client, scope, referrer, `%20` match 1.0.70 probe. Update evidence pointer from 1.0.50 fixture to also cite `oauth-rea-2026-10-31/grok/login-probe.txt`. Test still passes against stable fields. |
| XAI-002 | VERIFIED | VERIFIED (re-evidence) | Live device start on 1.0.70 returns `verification_uri=https://accounts.x.ai/oauth2/device`. The IdP accepts a start without client headers. Pi sends surface `ui` on start and on poll. Cite `fixtures/device-code-request-1.0.70.json` and `../grok-deepen/fixtures/device-start-headers-1.0.70.json`. |
| XAI-003 | INCONCLUSIVE | INCONCLUSIVE | Unchanged. Full scope still requested. Server grant/require still unobserved (no live token). |
| XAI-004 | VERIFIED | VERIFIED | `GROK_AUTH_EARLY_INVALIDATION_SECS` default 300 still documented. Pi 300s skew still correct. |
| XAI-005 | VERIFIED | VERIFIED (not re-run) | Hot Reload / auth.json docs remain. Logout mode not re-probed. |
| XAI-006 | VERIFIED | **VERIFIED (tree already bumped)** | Grok sends `1.0.70`. `extensions/pi-xai-oauth/src/request.ts` already exports `GROK_CLIENT_VERSION = '1.0.70'`. Tests assert that value. Gate minimum not re-probed on 1.0.70. |
| XAI-007 | VERIFIED | VERIFIED (string-only) | `X-XAI-Token-Auth` / `xai-grok-cli` still in binary. Wrong-value 401 not re-probed. |
| XAI-008 | VERIFIED | VERIFIED (string-only) | `x-grok-model-override` still named. |
| XAI-009 | VERIFIED | VERIFIED (string-only) | `x-grok-conv-id` still named. |
| XAI-010 | VERIFIED | VERIFIED (live) | Bearer `GET /v1/models` against cli-chat-proxy with stored Pi `grok-build` credential. Cite `fixtures/models-1.0.70.json`. |
| XAI-011 | VERIFIED | VERIFIED (not re-captured) | Responses path still referenced in sampler. No new 1.0.70 wire body. |
| XAI-012 | VERIFIED | **VERIFIED (live)** | Live catalog ids are `grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`. Binary string absence of `build-fast` was a false lead. Pi `BASELINE` matches. |
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
| XAI-024? | Device start and device token poll send `x-grok-client-surface` | Measured default `ui`. Referrer is `grok-build`. Inference is outside this fixture. |
| XAI-025? | Sampler may send `x-grok-max-completion-tokens` / `x-models-etag` | UNKNOWN. String-only. |
| XAI-026? | Fast catalog id may be `grok-4.7-high-fast` | **REJECTED.** Live catalog still uses `grok-4.7-build-fast`. Docs flat-id example is not the physical catalog id. |

## Bottom line for ledger maintainers

Keep XAI-006 verified. Cite 1.0.70 binary and the bumped constant.
Restore XAI-012 verified from `fixtures/models-1.0.70.json`.
Keep authorize login rows verified with the 1.0.70 probe / `grok-1.0.70-authorize-url.json`.
Device `x-grok-client-surface` default is `ui`. Pi `DEVICE_CLIENT_HEADERS` sends it on device start and on the device token poll.
