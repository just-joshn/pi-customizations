# Grok Build 1.0.70 oauth dependencies

Dependencies here are the proxy, catalog, credential file, and retry behaviors that make a Grok OAuth token usable. No live proxy call was made in this pass. Evidence is binary strings, embedded docs, the 1.0.70 login probe, and the prior 1.0.50 fixture where noted.

## Proxy base

Measured string: `https://cli-chat-proxy.grok.com/v1`.
Override env still documented: `GROK_CLI_CHAT_PROXY_BASE_URL`.
Pi `PROXY_BASE_URL` matches.

## Identity headers Grok still names

| Header | 1.0.70 evidence | Notes |
|---|---|---|
| `x-grok-client-version` | Literal next to `1.0.70` in multiple places | Grok 1.0.70 sends `1.0.70`. Pi `GROK_CLIENT_VERSION` is already `1.0.70` in the tree. Gate minimum was `1.0.13` on 2026-10-12. Not re-probed. |
| `X-XAI-Token-Auth` | Present | Value `xai-grok-cli` still present in docs and curl examples. |
| `x-grok-model-override` | Present | Same role as 1.0.50. |
| `x-grok-conv-id` | Present in sampler header table | Same role as 1.0.50. |
| `x-grok-context-window` | Present next to new siblings | 1.0.50 wire capture did **not** send this. Unknown whether 1.0.70 sends it. Pi still sends it. |

## Header inventory growth in 1.0.70 (string-only)

New or newly prominent names adjacent to request code (not proven required for auth):

| Name | Evidence | Required? |
|---|---|---|
| `x-grok-client-surface` | Adjacent to device `/oauth2/device/code` and `1.0.70` | Unknown. No wire capture. |
| `x-grok-deployment-id` | Header table near client-version | Unknown. |
| `x-grok-max-completion-tokens` | Next to `x-grok-context-window` | Unknown. |
| `x-models-etag` | Same table | Unknown. Catalog caching GUESS. |
| `x-grok-managed-config-nonce` | Managed-config fetch errors | Enterprise/managed path GUESS. |
| `x-grok-managed-gateway` | Name only | Unknown. |
| `x-grok-experiments` | Docs say pairs form this header to cli-chat-proxy | Optional telemetry GUESS. |
| `x-grok-transient-retry` | Near conv/model/session header run | Unknown. |

Still present from the 1.0.50 agent-metadata set: `x-grok-client-mode`, `x-grok-client-identifier`, `x-grok-user-id`, `x-grok-conv-group-id`, `x-grok-req-id`, `x-grok-session-id`, `x-grok-agent-id`, `x-grok-turn-idx`, `x-grok-doom-loop-check`, `x-grok-exact-repetition-check`, `x-authenticateresponse`, `x-email`, `traceparent`.

Prior probe accepted bearer plus client version alone for `/v1/responses`. That acceptance was not re-run on 1.0.70. Treat new headers as non-blocking for OAuth parity until a 401/426 proves otherwise (GUESS).

## Catalog

Endpoint (unchanged string): `GET https://cli-chat-proxy.grok.com/v1/models` with bearer auth.

Model id strings in the binary:

- `grok-4.7`, `grok-4.6`, `grok-4.5` present.
- `grok-4.7-build-fast` **absent**.
- `grok-4.7-high-fast` present in embedded docs as an example flat id.

Live catalog body for 1.0.70 was not fetched. Pi baseline and aliases still assume `grok-4.7-build-fast` and suffix `-build-fast`. Catalog parity with 1.0.70 is **unverified** and possibly drifted.

## 401 retry

Embedded docs still describe Automatic Credential Refresh via `GROK_AUTH_EARLY_INVALIDATION_SECS` (default 300). User-guide style 401 refresh-and-retry text from the prior ledger was not re-extracted as a distinct runtime path here. Pi still omits package-level 401 retry (ledger XAI-013 NOT APPLICABLE). No change forced by 1.0.70 evidence.

## auth.json hot reload

Embedded `## Hot Reload` text still says Grok picks up `~/.grok/auth.json` changes automatically. Prior Pi mapping via `AuthStorage` revision reload remains the right analogue. Not re-tested on 1.0.70.

## OAuth config knobs still named

`GROK_OAUTH2_ISSUER`, `GROK_OAUTH2_CLIENT_ID`, `GROK_OAUTH2_SCOPES`, `GROK_OAUTH2_REFERRER`, `GROK_OAUTH2_PRINCIPAL_TYPE`, `GROK_OAUTH2_PRINCIPAL_ID`, plus customer OIDC and external auth-provider docs. Default subscription login remains auth.x.ai (probe). Enterprise paths stay out of Pi scope.

## Inference API shape

Sampler strings still mention Responses streaming and also `chat/completions`. Prior 1.0.50 wire used `POST /v1/responses` with `store: false`. Not re-captured for 1.0.70. Pi still uses Responses. GUESS: Responses remains the subscription path.
