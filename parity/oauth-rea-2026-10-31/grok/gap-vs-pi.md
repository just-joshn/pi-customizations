# Gaps: extensions/pi-xai-oauth versus Grok 1.0.70

Goal for 100% oauth and oauth-dependency parity without depending on the grok binary at runtime. Extension `src` was not edited in this unit. The tree was re-read at report time. Every remaining gap names a **pi-native fix path**.

## Already closed (measured this pass or already in tree)

1. **`GROK_CLIENT_VERSION` is `1.0.70`.**
   `extensions/pi-xai-oauth/src/request.ts`. Matches binary + probe.

2. **Authorize query order / `%20` / client id / full scope / referrer.**
   Probe `authorize-url.json` matches Pi `authorizeUrl()` and `test/fixtures/grok-1.0.70-authorize-url.json`.

3. **Public PKCE client (no client_secret).**
   Binary has no `GROK_OAUTH2_CLIENT_SECRET` / `auth.oauth2.client_secret`. Exchange names `authorization_code` + `code_verifier`. Pi `exchangeCode` / device forms omit secret. Fixture `fixtures/client-oauth-identity-1.0.70.json`.

4. **Refresh skew 300s.**
   Docs default `GROK_AUTH_EARLY_INVALIDATION_SECS=300`. Pi `REFRESH_SKEW_MS = 300000`.

5. **Device verification URI.**
   Live device start returns `verification_uri=https://accounts.x.ai/oauth2/device`. Pi `DEVICE_HOST` matches. Fixtures `device-probe-1.0.70.json`, `device-code-request-1.0.70.json`.

6. **Device start form.**
   IdP accepts Pi-style `client_id` + `scope` without Grok client-version/surface headers.

7. **Catalog physical ids.**
   Live bearer `GET /v1/models` returns `grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`. Matches Pi `BASELINE`. Fixture `fixtures/models-1.0.70.json`. Binary string absence of `grok-4.7-build-fast` was a false lead.

8. **`X-XAI-Token-Auth` value.**
   Wrong value → models 401. Pi sends `xai-grok-cli`.

9. **Proxy base.**
   `https://cli-chat-proxy.grok.com/v1` matches Pi `PROXY_BASE_URL`.

## Remaining gaps (ordered by oauth-deps impact)

### 1. Optional device request header fidelity

**Gap.** Binary concatenates `/oauth2/device/code`, `x-grok-client-version`, `1.0.70`, `x-grok-client-surface` in login code. Pi device POST sends only form fields (no those headers). IdP does **not** require them (live 200 without).

**Pi-native fix path.** In `login.ts` `deviceLogin` / `postForm` (or a device-only header map), send `x-grok-client-version: GROK_CLIENT_VERSION`. Add `x-grok-client-surface` only after a wire capture names the value (mitm of `grok login --device-auth`, or REA decompile of `device_code.rs` setters). Keep form as `client_id` + `scope`. Tests: extend device login fake to assert headers. No binary read at runtime.

### 2. Inference header set beyond models gate (CLOSED)

**Measured.** Live `POST /v1/responses` (`fixtures/responses-headers-1.0.70.json`). Required: bearer + `x-grok-client-version` ≥ `1.0.13`. Wrong `X-XAI-Token-Auth` → 401. Omitting token-auth, model-override, or context-window still returned 200. Pi’s current `grokHeaders()` set was accepted. No speculative headers added.

### 3. Client-version floor on inference (CLOSED)

**Measured.** Responses `1.0.12` → HTTP 426 naming minimum `1.0.13`. `1.0.13` and `1.0.70` → 200. Pi already sends `1.0.70`.

### 4. Package-level 401 retry (intentional)

**Gap.** Grok docs describe early invalidation / refresh. Pi omits package-level 401 retry (XAI-013 NOT APPLICABLE); Pi auth refresh owns lifecycle.

**Pi-native fix path.** None required for oauth wire parity. If product wants CLI-like auto retry, implement in Pi auth/provider layer with tests, not by shelling to grok.

### 5. Live refresh POST body (CLOSED)

**Measured.** Live refresh at `https://auth.x.ai/oauth2/token` (`fixtures/refresh-token-1.0.70.json`). Form fields: `grant_type=refresh_token`, `client_id`, `refresh_token`. No `client_secret`. Matches Pi host `refreshXaiToken`.

## Already aligned (summary)

| Area | Pi | 1.0.70 evidence |
|---|---|---|
| Client version | `1.0.70` | binary + request.ts |
| Client id / no secret | public PKCE | probe + binary config absences |
| Authorize order / `%20` | `authorizeUrl()` | login probe |
| Device host + start form | `accounts.x.ai` + client_id/scope | live device start |
| Refresh skew | 300s | docs default 300 |
| Token-auth value | `xai-grok-cli` | wrong → models 401 |
| Proxy + catalog ids | `BASELINE` | live models body |

## Smallest remaining work (extension unit later)

1. Device surface/referrer split tracked as **XAI-SURFACE-UI** (not reopened here).
2. No catalog edit. Live ids match.
3. Responses header and refresh prove units are closed.
