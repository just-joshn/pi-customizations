# Grok Build 1.0.70 oauth dependencies

Dependencies here are the proxy, catalog, credential identity, and header behaviors that make a Grok OAuth token usable. Evidence is REA `open_binary` identity, host byte scans of the same image, the 1.0.70 login/device probes, and live bearer HTTP against `cli-chat-proxy` using the stored Pi `grok-build` credential (no interactive login).

## Proxy base

Measured string: `https://cli-chat-proxy.grok.com/v1` (7 hits).
Override env still documented: `GROK_CLI_CHAT_PROXY_BASE_URL`.
Pi `PROXY_BASE_URL` matches.

## OAuth client id and secret

| Fact | Evidence | Pi |
|---|---|---|
| Client id `b1a00492-073a-47ea-816f-4c329264a828` | `authorize-url.json` / login probe | `GROK_OAUTH_CLIENT_ID` |
| Client id ASCII / UUID bytes absent from binary | host byte scan count 0 | N/A (constant in source is fine) |
| Config override names | `GROK_OAUTH2_CLIENT_ID`, `auth.oauth2.client_id` | unused for default SpaceXAI path |
| `GROK_OAUTH2_CLIENT_SECRET` / `auth.oauth2.client_secret` | **absent** | Pi omits secret |
| Token exchange fields near OIDC | `authorization_code`, `code_verifier`; PKCE len 43..128 assert | `exchangeCode` public PKCE form |

Conclusion (measured): SpaceXAI subscription OAuth is a **public PKCE client**. `client_secret` substrings in the image belong to AWS/GCP/MCP/oauth2-crate tables, not the SpaceXAI login config surface. Fixture: `fixtures/client-oauth-identity-1.0.70.json`.

## Authorize param order

Measured probe order (byte order of query names): `response_type`, `client_id`, `redirect_uri`, `scope`, `code_challenge`, `code_challenge_method`, `state`, `nonce`, `referrer`. Scope uses `%20`. Referrer `grok-build`. Matches Pi `authorizeUrl()` and `test/fixtures/grok-1.0.70-authorize-url.json`.

## Device flow

| Fact | Evidence |
|---|---|
| Help flags | `--device-auth` / `--device-code` |
| Device path | `https://auth.x.ai/oauth2/device/code` (Pi `DEVICE_URL`) |
| Verification host/path | `https://accounts.x.ai/oauth2/device` (live start + prior killed prompt) |
| Start form that works | `client_id` + `scope` only → HTTP 200 |
| Binary adjacent names | `x-grok-client-version` `1.0.70` `x-grok-client-surface` next to `/oauth2/device/code` |
| Extra headers required by IdP? | **No.** Pi-style POST without them succeeds. Surface value still unknown. |

Fixtures: `fixtures/device-probe-1.0.70.json`, `fixtures/device-code-request-1.0.70.json`.

## Refresh skew 300s

Embedded docs: `GROK_AUTH_EARLY_INVALIDATION_SECS` default **300**.
Pi `REFRESH_SKEW_MS = 300000` on first credential write. Match.
Live refresh POST body not re-captured this pass (token still valid ~5h). Binary names `grant_type` / `refresh_token` near OIDC refresh. Pi host refresh remains the lifecycle owner.

## Identity headers that gate auth

### Catalog `GET /v1/models` (live, stored bearer)

Fixture: `fixtures/models-1.0.70.json`.

| Probe | Result |
|---|---|
| Bearer only | **200** |
| Bearer + `x-grok-client-version: 1.0.70` | 200 |
| Bearer + `X-XAI-Token-Auth: xai-grok-cli` | 200 |
| Full (bearer + version + token-auth) | 200 |
| Bearer + version + `X-XAI-Token-Auth: wrong` | **401** (`x_xai_token_auth=unknown`) |
| Bearer + `x-grok-client-version: 1.0.12` + token-auth | **200** (no 426 on models) |
| No Authorization | **401** |

So for **models**, a correct bearer is enough. If `X-XAI-Token-Auth` is sent, it must be `xai-grok-cli`. Client-version floor is **not** enforced on this endpoint (unlike the historical 426 on inference below 1.0.13).

### Inference (docs in binary; not re-POSTed this pass)

Embedded required-header table still lists:

1. `Authorization: Bearer <token>`
2. `X-XAI-Token-Auth: xai-grok-cli`
3. `x-grok-model-override: <model>` (optional only for default `grok-build` route)

Pi `grokHeaders()` also sends `x-grok-context-window` and optional `x-grok-conv-id`. Those remain non-blocking for oauth dependency parity until a 1.0.70 responses probe rejects without them.

### Header inventory (string counts)

| Header | Hits | Auth-gate for models? |
|---|---|---|
| `x-grok-client-version` | 18 | No (models accepts 1.0.12) |
| `X-XAI-Token-Auth` / `xai-grok-cli` | 3 / 12 | Yes **if present** (wrong → 401) |
| `x-grok-model-override` | 3 | Inference docs say yes |
| `x-grok-conv-id` | 1 | Not for models |
| `x-grok-context-window` | 1 | Not for models; sampler sibling of max-completion-tokens |
| `x-grok-client-surface` | 1 | Device-adjacent; IdP does not require |
| `x-grok-deployment-id` | 1 | Sampler table; unknown |
| `x-grok-max-completion-tokens` | 1 | Sampler; unknown |
| `x-models-etag` | 1 | Catalog caching GUESS; response `ETag` observed |
| `x-grok-managed-config-nonce` | 4 | Managed path |
| `x-grok-managed-gateway` | 1 | Managed path |
| `x-grok-experiments` | 5 | Optional telemetry GUESS |
| `x-grok-transient-retry` | 1 | Unknown |

## Catalog

Live `GET https://cli-chat-proxy.grok.com/v1/models` with Pi `~/.pi/agent/auth.json` `grok-build` bearer:

| id | api_backend | context_window | efforts |
|---|---|---|---|
| `grok-4.7` | responses | 256000 | xhigh, high, medium, low |
| `grok-4.7-build-fast` | responses | 256000 | xhigh, high, medium, low |
| `grok-4.6` | responses | 256000 | xhigh, high, medium, low |
| `grok-4.5` | responses | 256000 | high, medium, low |

Response `ETag`: `"4849638883941606653"`.
Binary still lacks the ASCII string `grok-4.7-build-fast` and still mentions `grok-4.7-high-fast` in docs. **Live catalog keeps `grok-4.7-build-fast`.** Do not invent or rename ids from binary-only evidence. Pi `BASELINE` matches the live body.

## 401 retry

Embedded docs still describe Automatic Credential Refresh via `GROK_AUTH_EARLY_INVALIDATION_SECS` (default 300). Pi still omits package-level 401 retry (ledger XAI-013 NOT APPLICABLE). No change forced by 1.0.70 evidence.

## auth.json hot reload

Embedded `## Hot Reload` text still says Grok picks up `~/.grok/auth.json` changes automatically. Prior Pi mapping via `AuthStorage` revision reload remains the right analogue. Not re-tested on 1.0.70.

## OAuth config knobs still named

`GROK_OAUTH2_ISSUER`, `GROK_OAUTH2_CLIENT_ID`, `GROK_OAUTH2_SCOPES`, `GROK_OAUTH2_REFERRER`, `GROK_OAUTH2_PRINCIPAL_TYPE`, `GROK_OAUTH2_PRINCIPAL_ID`, plus customer OIDC and external auth-provider docs. Default subscription login remains auth.x.ai (probe). Enterprise paths stay out of Pi scope.

## Inference API shape

Sampler strings still mention Responses streaming and also `chat/completions`. Live catalog rows use `api_backend: responses`. Pi still uses Responses.
