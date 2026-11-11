# Grok Build static parity: pi-x-subscription-oauth vs Grok Build CLI 1.0.77

Date: 2026-11-11. Read-only, static audit. No login, no `grok` session, no token refresh, no network calls to xAI from this audit.

## Targets

| Side | Artifact |
|---|---|
| Reference | `~/.grok/bin/grok` -> `~/.grok/downloads/grok-1.0.77-macos-aarch64`, `grok 1.0.77 (50ca579fa996) [stable]`, SHA-256 `197c66a63e5ac46e07450b0ca21d141ce665050a412180f185dadfae1c7a5b2a` |
| Baseline for drift | `~/.grok/downloads/grok-1.0.70-macos-aarch64`, still on disk, used for string diffs |
| Extension | `extensions/pi-x-subscription-oauth/src/{index,login,request,catalog,usage}.ts` at audit HEAD |
| Pi pieces the extension reuses | `node_modules/@earendil-works/pi-ai@1.5.0` `dist/auth/oauth/xai.js` (refresh), `dist/api/openai-responses.js` (body), `dist/utils/retry.js` (retry policy); `pi-coding-agent` `dist/core/defaults.js` (default thinking level) |

Method. `strings -n 4` on both binaries into `/tmp/grok170.strings` and `/tmp/grok177.strings`, then `rg` for context. Rust format strings are split into literal pieces, so a builder such as the authorize URL shows as its pieces run together with the substituted values missing. Concatenated neighbours are compiler adjacency, not proof that two strings belong to one request; snippets below are read with that caveat. Embedded docs (`~/.grok/docs/user-guide`), `grok --help`, `grok login --help`, `grok models --help`, `grok usage --help`, `~/.grok/models_cache.json`, `~/.grok/auth.json` (shape only), and `~/.grok/logs/unified.jsonl` (messages and non-secret fields only).

Redaction. No token, key, refresh token, token prefix, email, name, or user id is reproduced here. `auth.json` values are shown as lengths.

## Verdict table

| # | Row | Grok 1.0.77 | Extension | Verdict |
|---|---|---|---|---|
| 1a | Client id | `b1a00492-073a-47ea-816f-4c329264a828` (auth.json key `https://auth.x.ai::<client_id>`, `oidc_client_id`; log `oidc try_refresh_pure enter {client_id: b1a00492-...}`). Not a plain literal in the binary. | `login.ts:7` same UUID | MATCH |
| 1b | Issuer | `https://auth.x.ai` (literal after `OIDC: callback server bound`; auth.json `oidc_issuer`) | `login.ts:12,15,16` hardcodes `https://auth.x.ai/oauth2/*` | MATCH (see 1d note on discovery) |
| 1c | Scope | Pieces `offline_access`, `api:access`, `grok-cli:access`, `conversations:read`, `conversations:write`, `workspaces:read`, `workspaces:write`, identical counts in 1.0.70 and 1.0.77. 1.0.70 live capture: `openid profile email offline_access grok-cli:access api:access conversations:read conversations:write workspaces:read workspaces:write`. | `login.ts:8` same string, `%20` separators | MATCH |
| 1d | Authorize URL + param order | Builder pieces `?response_type=code&client_id=&redirect_uri=&scope=&code_challenge_method=S256&state=&nonce=&audience=&principal_id=&referrer=` (plus `&code_challenge=` and `&principal_type=` stored elsewhere), byte-identical in 1.0.70 and 1.0.77. 1.0.70 live print had 9 params: response_type, client_id, redirect_uri, scope, code_challenge, code_challenge_method, state, nonce, referrer=grok-build. `audience`/`principal_type`/`principal_id` are optional (set via `GROK_OAUTH2_PRINCIPAL_*`, `GROK_OIDC_AUDIENCE`) and absent by default. Authorize/token endpoints come from OIDC discovery `{issuer}/.well-known/openid-configuration`. | `login.ts:29-42` same 9 params, same order, `referrer=grok-build`; endpoint hardcoded, no discovery | MATCH (static; byte order proven only by the 1.0.70 live print, builder unchanged in 1.0.77) |
| 1e | Redirect URI | `http://127.0.0.1:` + `/callback`, random port; docs: "Grok binds a random port at sign-in time" | `login.ts:203,210` `127.0.0.1`, port 0, `/callback` | MATCH |
| 1f | PKCE | `code_challenge_method=S256`, `code_verifier` | `login.ts:36,279-283` S256, 32-byte base64url verifier | MATCH |
| 1g | state / nonce | Both present; 1.0.70 capture shows UUIDv7-shaped values sharing a timestamp prefix | `randomUUID()` (v4) for both | MATCH (shape differs v7 vs v4; server treats both as opaque, not observable to the IdP as a contract) |
| 1h | Paste fallback | `OIDC: received code via client paste`, `OIDC: invalid client paste input` | `login.ts:76-78,248-263` paste redirect URL | MATCH |
| 1i | Default sign-in transport | Conflicting: `grok login --help` says `--oauth` "Force browser (loopback) login instead of device-code authentication"; user guide 02 says browser is the default. Binary resolves transport at runtime: `GROK_LOGIN_DEVICE_FLOW`, `login: resolved interactive transport`, remote `/login-config` fetch, `auth: device flow unavailable (404), falling back to loopback login`. Same strings in 1.0.70. | Prompts the user; labels Browser "Grok Build's default" (`login.ts:50`, README:21,68) | UNKNOWN (default is server/env-driven; README claim is unverified for 1.0.77) |
| 2a | Device endpoint + form | `/oauth2/device/code`, form names `scope`, value `grok-build` (referrer) adjacent | `login.ts:16,96` `client_id`, `scope`, `referrer=grok-build` | MATCH |
| 2b | Device headers | `/oauth2/device/code x-grok-client-version 1.0.77 x-grok-client-surface` | `login.ts:21-24` `x-grok-client-version: 1.0.70`, `x-grok-client-surface: ui` | MISMATCH (version value 1.0.70 vs 1.0.77; surface value `ui` carried from 1.0.70 work, not re-proved) |
| 2c | Verification URI | Validates scheme (`Server returned unsupported verification URI scheme`, `127.0.0.1` allowed); reads `verification_uri_complete`; builds `user_code=` link; auto-opens browser (`device auth: could not open browser automatically`). 1.0.70 live host `https://accounts.x.ai/oauth2/device`. | `login.ts:131-140` requires `https` + host `accounts.x.ai`; ignores `verification_uri_complete`; Pi shows URL + code, does not open browser | MISMATCH (minor UX: no prefilled code link, no auto-open; host pin is stricter than Grok) |
| 2d | Polling / slow_down | Grant `urn:ietf:params:oauth:grant-type:device_code`; messages for `expired`, `authorization denied`. No grok-crate literal for `authorization_pending`/`slow_down` (only AWS SDK symbols), so interval handling not visible. | `login.ts:106-116` polls immediately (no wait before first poll), +5 s on `slow_down`, 1 s floor when server sends no interval | UNKNOWN (Grok's backoff not visible statically; extension's 1 s floor is below RFC 8628's 5 s default) |
| 3a | Refresh endpoint | token_endpoint via OIDC discovery (`/.well-known/openid-configuration`, `OIDC: refreshing token`); issuer auth.x.ai | Pi `xai.js:7-8,169-178` hardcodes `https://auth.x.ai/oauth2/token` | MATCH (assuming discovery returns `/oauth2/token`, as 1.0.70 strings and the 1.0.70 refresh fixture show) |
| 3b | Refresh form | `grant_type`, refresh token, client id; `principal_type`, `principal_id` adjacent in the refresh path (`grant_typeprincipal_typeprincipal_idOIDC: token refresh HTTP error`). auth.json stores `principal_type`/`principal_id`. | Pi: `grant_type=refresh_token`, `client_id`, `refresh_token` only | UNKNOWN (Grok may add principal fields; the 1.0.70 refresh fixture shows the 3-field form succeeds) |
| 3c | Refresh headers | none adjacent in the refresh path | none (Pi `postForm`) | UNKNOWN (likely MATCH) |
| 3d | Early-refresh skew | `GROK_AUTH_EARLY_INVALIDATION_SECS` default 300 (user guide 02:243,272) | `login.ts:14,154` and Pi `xai.js:10` 5 min | MATCH |
| 3e | Rotation | Rotates: log field `idp_rotated`, `auth.refresh.success {key_changed: true}`; 1.0.70 fixture `rotated_refresh: true`; access lifetime 6 h (auth.json `expires_at - create_time` = 21600 s) | Pi stores the new `refresh_token`, keeps old only if omitted (`xai.js:100-112`) | MATCH |
| 3f | 401 on inference | Docs 02:266 "If the server returns 401 Unauthorized, Grok refreshes the credentials and retries the request." Binary: `auth recovery: tool 401, recovered, retrying`, `auth recovery: disk has a different token, accepting`, `auth: adopted sibling token ...`, `auth: refresh failed but token still valid (grace), using cached`, sleep-aware deferral. | No retry. Pi `retry.js` retryable pattern has 429/5xx, not 401; `agent-session.js:3058` uses it. README:68 states this. | MISMATCH |
| 4a | `x-grok-client-version` | `1.0.77` (11 literal `x-grok-client-version1.0.77` pieces; 1.0.70 binary had 12 of `1.0.70`) | `request.ts:4,8` `1.0.70` | MISMATCH (proxy gate is >=1.0.13, so functional today; identity drift) |
| 4b | `X-XAI-Token-Auth` | `xai-grok-cli` (embedded doc table; literal `xai-grok-cli`) | `request.ts:9` same | MATCH |
| 4c | `x-grok-model-override` | sent by sampler (`client.rs`, `x-grok-conv-id x-grok-req-id x-grok-model-override x-grok-session-id ...`) | `request.ts:10` model id after alias routing | MATCH |
| 4d | `x-grok-context-window` | sent; value follows the user-picked window (`/context-window`, `[model."<id>"] context_window`, catalog `context_windows: [256000, 500000]`) | `request.ts:11` `model.contextWindow`, always 256000 unless `models.json` overrides | MISMATCH (no 500000 option) |
| 4e | `x-grok-conv-id` | sent | `request.ts:12` Pi `sessionId` when present | MATCH |
| 4f | `x-grok-client-surface` | only adjacent to the device-code request; not in the sampler header block | not sent on inference | MATCH |
| 4g | User-Agent | Not resolvable for the sampler. Other clients: `xai-grok-build/<ver>` (media tools), `xai-grok-workspace/` (workspace tools), `grok-cli/<version>` (MCP HTTP, per docs) | Pi's OpenAI SDK UA | UNKNOWN |
| 4h | Other identity headers Grok knows, extension omits | `x-grok-client-identifier` (likely `grok-shell`), `x-grok-client-mode`, `x-grok-deployment-id`, `x-grok-user-id`, `x-grok-conv-group-id`, `x-grok-req-id`, `x-grok-session-id`, `x-grok-agent-id`, `x-grok-turn-idx`, `x-grok-transient-retry`, `x-grok-max-completion-tokens`, `x-models-etag`, `x-grok-experiments`, `x-grok-managed-config-nonce`, `x-grok-managed-gateway`, `x-email`, `traceparent`. Response-side: `x-grok-doom-loop-check`, `x-grok-exact-repetition-check`, `x-should-retry`. Header-name set identical to 1.0.70. | none of these | MISMATCH (fidelity only; 1.0.70 probes showed bearer + version suffices) |
| 5 | Responses body | Grok struct fields visible (`include`, `tools`, `stream`, `stream_options.include_usage`, `reasoning{effort,summary}`, `reasoning.encrypted_content`, `parallel_tool_calls`, `previous_response_id`, `max_output_tokens`, `prompt_cache_retention`, `service_tier`, `truncation` ...) but values per request are not visible. `prompt_cache_key` has no hit in the sampler. | Pi `openai-responses.js:257-303`: `store:false`, `stream:true`, `prompt_cache_key=sessionId`, `reasoning{effort, summary:"auto"}`, `include:["reasoning.encrypted_content"]` only when an effort is set (provider is `grok-build`, not `xai`), `max_output_tokens` when `maxTokens` set (would be 256000), tools | UNKNOWN (cannot see Grok's emitted values; `prompt_cache_key` and `max_output_tokens=256000` are Pi-only risks) |
| 6a | Catalog endpoint + headers | `origin https://cli-chat-proxy.grok.com/v1/models`, cache keeps `etag W/"4849638883941606653"`, `models etag changed, refreshing`; headers not resolvable | `index.ts:24` bearer only, no etag | UNKNOWN headers; MISMATCH minor (no etag revalidation) |
| 6b | Fields consumed | Cache row: `context_window`, `context_windows`, `reasoning_effort`, `reasoning_efforts[].default`, `hidden`, `supported_in_api`, `api_backend`, `agent_type`, `auto_compact_threshold_percent`, `compactions_remaining`, `compaction_at_tokens`, `supports_backend_search`, `laziness_detector`, `extra_headers`, `max_completion_tokens`, ... | `catalog.ts:49-74` reads `id`, `name`, `context_window`, `api_backend`, `reasoning_efforts[].value` only | MISMATCH (ignores `hidden`, `supported_in_api`, `context_windows`, default effort, compaction threshold) |
| 6c | Model set | 4 models: grok-4.7, grok-4.7-build-fast, grok-4.6, grok-4.5; all 256000 / [256000, 500000]; efforts 4.7/4.7-fast/4.6 = low..xhigh, 4.5 = low..high; none hidden; all `api_backend: responses` | `catalog.ts:27-32` same 4 ids, names, windows, efforts | MATCH (no extra models in cache) |
| 6d | Default effort | `reasoning_effort: "high"`, `default: true` on `high` for every model | Not read. Pi default thinking level `medium` (`pi-coding-agent/dist/core/defaults.js`); user's `~/.pi/agent/settings.json` also `medium` | MISMATCH |
| 7a | Billing endpoint | `/billing?format=credits` (`xai_grok_shell::extensions::billing`) | `usage.ts:142` `${PROXY_BASE_URL}/billing?format=credits` | MATCH (base URL not visible statically; extension's live fixture shows the proxy answers) |
| 7b | Billing headers | `Authorization`, `x-grok-client-version 1.0.77`, `x-grok-client-mode` | `Authorization`, `X-XAI-Token-Auth`, `Accept`, `x-grok-client-version 1.0.70` | MISMATCH (version value; extra token-auth; no client-mode) |
| 7c | Billing rendering | `BillingConfig` (11 fields): creditUsagePercent, currentPeriod, monthlyLimit, onDemandCap, onDemandUsed, prepaidBalance, isUnifiedBillingUser, billingPeriodStart/End, history ... plus `subscription_tier`, `on_demand_enabled`. No `productUsage` string in 1.0.70 or 1.0.77. Shown in the `/usage` modal ("Usage limit" tab), upsell text ("You hit your weekly limit.", "Purchase credits to keep using Grok Build"), `grok usage [--json]` via daemon. | Parses creditUsagePercent, currentPeriod, productUsage, prepaidBalance, isUnifiedBillingUser; prints one text block | MISMATCH (presentation differs; extension shows a product split Grok does not parse, omits on-demand cap/used and tier) |
| 8 | Drift 1.0.70 -> 1.0.77 | CHANGELOG 1.0.71-1.0.77 has no entry on OAuth, headers, proxy, catalog wire, or billing. Binary diff: same header-name set, same authorize builder, same scope pieces, same login-config/device strings; only the embedded version literal changed. | pins 1.0.70 | Drift = version literal only |

## Top mismatches by user impact

1. **No 401 refresh-and-retry (3f).** Grok recovers from an inference 401 (refresh, adopt a sibling's disk token, retry). Pi surfaces the 401 as a turn error. Any server-side early revocation or clock skew past the 300 s window fails the turn in Pi and is invisible in Grok.
2. **Default reasoning effort `medium` vs Grok's `high` (6d).** Same model id, different default quality, latency, and metered cost on every turn where the user never picks a level.
3. **No 500000-token context window (4d, 6b).** Grok offers `context_windows: [256000, 500000]` and sends the chosen value in `x-grok-context-window`. Pi always advertises and sends 256000 unless the user hand-edits `models.json`.
4. **Client version pinned at 1.0.70 (4a, 2b, 7b).** Works today (gate >= 1.0.13) but is not what 1.0.77 sends; a future minimum bump breaks Pi first.
5. **Catalog flags ignored (6b).** `hidden` and `supported_in_api` are not honored. No effect with today's catalog (all visible, all supported), latent if xAI hides a model.
6. **Usage rendering differs (7c).** Different fields and wording from Grok's `/usage`; not wrong, not parity.
7. **Device-code UX (2c, 2d).** No `verification_uri_complete` link, no auto-open, 1 s poll floor and no initial wait.
8. **Identity header set (4h).** Grok's turn/req/agent/session/experiments headers are absent. 1.0.70 probes show the proxy does not require them; they may matter for server-side cache affinity or abuse heuristics (unobserved).

## Raw evidence (redacted)

### Help output

```
$ grok --version
grok 1.0.77 (50ca579fa996) [stable]

$ grok login --help
      --oauth
          Force browser (loopback) login instead of device-code authentication
      --device-auth
          Use device-code authentication for headless/remote environments
          [aliases: --device-code]

$ grok --help   (excerpt)
      --oauth
          Force browser (loopback) login when the welcome screen authenticates

$ grok usage --help
Print your plan's usage limit, or a session's persisted token and cost usage
  [SESSION_ID]  Session ID. Omit for your plan's usage limit (needs Grok's background service)
      --json    Print the plan's usage limit as JSON

$ grok models --help
List available models and exit
```

### Authorize builder (identical in 1.0.70 and 1.0.77)

```
crates/codegen/xai-grok-login/src/oidc/protocol.rs:619 OIDC: state mismatch
?response_type=code&client_id=&redirect_uri=&scope=&code_challenge_method=S256&state=&nonce=&audience=&principal_id=&referrer=
... api_key_disabled&code_challenge=&principal_type=GROK_OIDC_ISSUERGROK_OIDC_SCOPESworkspaces:write ...
```

Login config and scope pieces:

```
GROK_OAUTH2_ISSUER GROK_OAUTH2_CLIENT_ID GROK_OAUTH2_PRINCIPAL_TYPE GROK_OAUTH2_PRINCIPAL_ID GROK_OAUTH2_SCOPES GROK_OAUTH2_REFERRER
grok-cli:access conversations:read conversations:write workspaces:read   (one piece)
offline_access api:access                                                 (one piece)
workspaces:write                                                          (one piece)
OIDC: starting login flow  http://127.0.0.1:  OIDC: callback server bound  https://auth.x.ai
http://127.0.0.1:/callback  Failed to get loopback port
/.well-known/openid-configuration  OIDC: fetching discovery document  OIDC: discovery complete
OIDC: exchanging code for tokens  authorization_code  code_verifier
OIDC: received code via client paste  OIDC: invalid client paste input
```

Transport resolution (also in 1.0.70):

```
GROK_LOGIN_DEVICE_FLOW  login: resolved interactive transport  device  /login-config
x-grok-agent-id x-grok-client-identifier x-grok-client-mode  login-config fetch failed
auth: device flow unavailable (404), falling back to loopback login
```

### Device code

```
/oauth2/device/code  x-grok-client-version 1.0.77  x-grok-client-surface  scope  grok-build
Device code request failed (HTTP ): Server returned invalid user_code format (expected [A-Z0-9-])
device_code user_code verification_uri_complete expires_in access_token refresh_token error error_description
device auth: could not open browser automatically
127.0.0.1 Server returned unsupported verification URI scheme  Server returned invalid verification URI
/oauth2/token  device auth token exchange failed  Device code expired. Run `grok login --device-auth` again.
Authorization denied. The user rejected the request.  grant_type urn:ietf:params:oauth:grant-type:device_code  user_code=
```

1.0.70 for comparison: `/oauth2/device/code x-grok-client-version1.0.70x-grok-client-surfacescopegrok-b...`

### Refresh and recovery

```
xai_grok_login::oidc::refresh  idp_rotated key_prefix  has_issuer has_client_id
oidc try_refresh_pure enter / discovery failed / token obtained / succeeded / terminal error / token exchange failed
OIDC: refreshing token  auth.refresh.retry_suppressed_suspend  grant_type principal_type principal_id  OIDC: token refresh HTTP error
GROK_AUTH_EARLY_INVALIDATION_SECS
auth recovery: disk token is same as rejected, skipping  auth recovery: disk has a different token, accepting
auth recovery: adopted disk token  auth recovery: refreshed from authority  auth recovery: refresh from authority failed
auth recovery: tool 401, refresh failed  auth recovery: tool 401, recovered, retrying
auth: refresh failed but token still valid (grace), using cached  refresh deferred: system sleep imminent
```

User guide `02-authentication.md`:

```
243 | `GROK_AUTH_EARLY_INVALIDATION_SECS` | Seconds before expiry to proactively refresh (default: 300) |
266 - **On auth error:** If the server returns 401 Unauthorized, Grok refreshes the credentials and retries the request.
 37 | `--oauth` | Sign in through SpaceXAI OAuth at `auth.x.ai`. This is the default, so the flag is optional. |
```

Logs (`~/.grok/logs/unified.jsonl`, prefixes removed):

```
oidc refresh enter {"reason": "PreRequest", "has_current": false, "is_expired": true}
oidc refresh attempting idp {"has_rt": true, "issuer": "https://auth.x.ai", "client_id": "b1a00492-073a-47ea-816f-4c329264a828", ...}
oidc try_refresh_pure terminal error {"error_code": "invalid_grant", "error_description": "Invalid or unknown refresh token", ...}
auth.refresh.permanent_failure {"reason": "RefreshTokenRejected"}
auth.refresh.success {"key_changed": true, ...}
```

Pi side:

```
pi-ai/dist/auth/oauth/xai.js:7-10  XAI_DEVICE_CODE_URL / XAI_TOKEN_URL https://auth.x.ai/oauth2/token, REFRESH_SKEW_MS = 5*60*1000
pi-ai/dist/auth/oauth/xai.js:169-178  refresh form {grant_type: "refresh_token", client_id, refresh_token}, no extra headers
pi-ai/dist/utils/retry.js  RETRYABLE_PROVIDER_ERROR_PATTERN: ... (?:429|500|502|503|504|520|524) ...   (no 401)
```

### auth.json shape (values redacted)

```
"https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828": {
  key: str(len=882), auth_mode: "oidc", create_time, user_id: <redacted>, email/first_name/last_name: <redacted>,
  principal_type: "User", principal_id: <redacted>, team_id: <redacted>, team_zero_data_retention: bool,
  coding_data_retention_opt_out: bool, coding_data_team: str, refresh_token: str(len=86),
  expires_at (= create_time + 6 h), oidc_issuer: "https://auth.x.ai", oidc_client_id: "b1a00492-..."
}
```

### Inference headers (sampler, `crates/codegen/xai-grok-sampler/src/client.rs`)

```
api_backend auth_scheme request_compression has_api_key has_bearer_resolver has_authorization_header has_x_api_key_header
x-grok-client-version x-grok-deployment-id grok-shell x-grok-client-identifier x-grok-user-id x-grok-conv-group-id
Using HTTP/1.1 for sampling client (force_http1=true)
minimal low medium xhigh max
x-grok-conv-id x-grok-req-id x-grok-model-override x-grok-session-id x-grok-agent-id x-grok-turn-idx x-grok-transient-retry
Invalid extra header value  Invalid extra header name  stream stream_options include_usage x-should-retry
skipping env_http_header with an invalid header name or value
x-grok-context-window x-grok-max-completion-tokens x-models-etag temperature
Failed to serialize responses request: include tools
/response/usage/cost_in_usd_ticks
Sending responses API stream request  stream_tool_calls  x-grok-doom-loop-check x-grok-exact-repetition-check  responses API error
```

Elsewhere: `x-grok-experiments` ("The `x-grok-experiments` header on requests to cli-chat-proxy carries each id with its arm"), `x-grok-managed-config-nonce`, `x-grok-managed-gateway`, `x-email`, `user-agent xai-grok-workspace/`, `user-agent xai-grok-build/` (media tools).

Header-name set, 1.0.70 vs 1.0.77: identical after splitting run-together strings (`diff` shows only adjacency differences).

Embedded doc (stale; old auth.json key layout, "tokens expire after 7 days") still documents:

```
| `X-XAI-Token-Auth: xai-grok-cli` | Yes | Tells the auth middleware to validate as a CLI session token |
| `x-grok-model-override: <model>` | Yes* | The proxy uses this header (not the JSON body) to route to the correct backend. |
```

Extension:

```
request.ts:4   export const GROK_CLIENT_VERSION = '1.0.70';
request.ts:7-14  x-grok-client-version, X-XAI-Token-Auth: xai-grok-cli, x-grok-model-override: model.id,
                 x-grok-context-window: String(model.contextWindow), x-grok-conv-id: options.sessionId (when set), ...options.headers
```

### Responses body (Pi, the extension does not shape it)

```
pi-ai/dist/api/openai-responses.js:257-303
  model, input, stream: true, prompt_cache_key: sessionId (unless cacheRetention none),
  prompt_cache_retention / prompt_cache_options (compat-gated), store: false,
  max_output_tokens: max(options.maxTokens, 16) when maxTokens and compat.supportsMaxOutputTokens,
  tools, tool_choice, reasoning: {effort, summary: "auto"}, include: ["reasoning.encrypted_content"] when an effort is set
  (the unconditional include branch is for provider === "xai"; this provider is "grok-build")
```

Grok-side response struct names visible: `background billing conversation created_at completed_at incomplete_details instructions max_output_tokens model output parallel_tool_calls previous_response_id prompt prompt_cache_retention reasoning safety_identifier service_tier temperature tool_choice top_logprobs top_p truncation usage` (that is the Response object, not proof of what Grok sends).

### Catalog

`~/.grok/models_cache.json` top level: `fetched_at 2026-11-11T12:08:19Z, grok_version 1.0.77, auth_method session, origin https://cli-chat-proxy.grok.com/v1/models, etag W/"4849638883941606653"`, 4 models.

| id | name | ctx | windows | efforts (default) | hidden | supported_in_api | api_backend | agent_type | auto_compact % |
|---|---|---|---|---|---|---|---|---|---|
| grok-4.7 | Grok 4.7 | 256000 | 256000, 500000 | xhigh, high*, medium, low | false | true | responses | grok-build-plan | 80 |
| grok-4.7-build-fast | Grok 4.7 Fast | 256000 | 256000, 500000 | xhigh, high*, medium, low | false | true | responses | grok-build-plan | 80 |
| grok-4.6 | Grok 4.6 | 256000 | 256000, 500000 | xhigh, high*, medium, low | false | true | responses | grok-build-plan | 80 |
| grok-4.5 | Grok 4.5 | 256000 | 256000, 500000 | high*, medium, low | false | true | responses | grok-build-plan | 80 |

All rows: `reasoning_effort: "high"`, `compactions_remaining: 1`, `compaction_at_tokens: true`, `supports_backend_search: true`, `extra_headers: {}`, `max_completion_tokens: null`. Extension BASELINE (`catalog.ts:27-32`) matches ids, names, ctx and effort sets exactly. No extra models.

Pi default: `pi-coding-agent/dist/core/defaults.js: DEFAULT_THINKING_LEVEL = "medium"`; docs/settings.md: `defaultThinkingLevel` default `"medium"`.

Binary: `slug-match: inheriting context_window from sibling catalog entry`, `reasoning_effort: model does not support effort; ignoring it`, `models etag changed, refreshing`, `model catalog: fetching`, `model catalog: fetch succeeded`.

### Billing

```
crates/codegen/xai-grok-shell/src/extensions/billing.rs
Authentication required to fetch billing data  Billing data requires auth with grok.com. Run `grok login` to authenticate.
/billing?format=credits  Authorization  x-grok-client-version 1.0.77  x-grok-client-mode
billing: upstream error  Billing service error:  billing: fetched credits config  Failed to fetch billing data: HTTP
UsagePeriod start end  BillingCycle month  BillingConfig creditUsagePercent currentPeriod monthlyLimit onDemandCap onDemandUsed
prepaidBalance isUnifiedBillingUser billingPeriodStart history  BillingPeriodUsage billingCycle includedUsed totalUsed
BillingConfigResponse config on_demand_enabled subscription_tier val  struct BillingConfig with 11 elements
No billing data available.  You hit your weekly limit.  Purchase credits to keep using Grok Build
No active session.  Usage limits are managed by your team.  Couldn't load usage  Loading session usage
```

`productUsage`: 0 hits in 1.0.70 and 1.0.77. Logged config (2026-10-02, values non-secret): `currentPeriod.type USAGE_PERIOD_TYPE_WEEKLY, onDemandCap {val 0}, onDemandUsed {val 0}, prepaidBalance {val 0}, isUnifiedBillingUser true, historyLen 0, subscriptionTier "SuperGrok"`.

User guide 04: `/usage` (alias `/cost`) "opens the usage modal with the account allowance plus that session's context and token totals"; `/usage manage`.

Extension: `usage.ts:141-151` GET `${PROXY_BASE_URL}/billing?format=credits` with `Authorization`, `X-XAI-Token-Auth: xai-grok-cli`, `Accept: application/json`, `x-grok-client-version: 1.0.70`; parses `creditUsagePercent`, `currentPeriod`, `productUsage`, `prepaidBalance.val`, `isUnifiedBillingUser`.

### CHANGELOG 1.0.71 - 1.0.77, lines that touch auth, headers, catalog, billing, or the proxy

- 1.0.72: "Custom models on the Responses API with a non-xAI `base_url` no longer fail every turn with an HTTP 400 schema error for `use_tool`." (custom models only, not cli-chat-proxy)
- 1.0.73: "Startup no longer waits about 100 ms for a sign-in file when you use an API key or have not signed in yet."
- 1.0.74: "`grok logout` stays signed out when another running Grok refreshes its sign-in, instead of signing you back in on the next launch."
- 1.0.74: "Sessions with an unrecognized reasoning effort ... resume ... the session runs at the model's default effort and says so once."
- 1.0.74: "Context window: a larger window picked with `/context-window` or set with `context_window` in a `[model."<id>"]` table stays in effect, so compaction no longer starts early ..."
- 1.0.77: "Context usage shown in the footer no longer drops to zero or shows stale values after a rewind."

Nothing changes OAuth endpoints, scope, authorize parameters, device form, header names, catalog wire shape, or the billing endpoint. The only wire-visible drift found is the `x-grok-client-version` literal (1.0.70 -> 1.0.77).

## Gaps this static pass cannot close

- Grok's runtime default login transport (server `login-config` decides).
- Exact values of `x-grok-client-identifier`, `x-grok-client-mode`, sampler User-Agent, and whether Grok sends `principal_type`/`principal_id` on refresh.
- Grok's emitted Responses body values (effort per turn, `max_output_tokens`, `prompt_cache_key`, `reasoning.summary`).
- Device poll backoff on `slow_down`.
These need a captured Grok 1.0.77 request (local MITM or `--debug-file`), which this read-only slice did not run.
