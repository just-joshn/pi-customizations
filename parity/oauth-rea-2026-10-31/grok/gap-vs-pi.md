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

### 2. Inference header set beyond models gate

**Gap.** Models accepts bearer alone. Inference docs still require bearer + `X-XAI-Token-Auth` + `x-grok-model-override`. Pi also sends `x-grok-context-window` and optional `x-grok-conv-id`. New 1.0.70 names (`x-grok-max-completion-tokens`, `x-models-etag`, `x-grok-deployment-id`, …) are string-only.

**Pi-native fix path.** Keep current `grokHeaders()` for known required inference headers. Prove any addition with a responses POST fixture (fake or live) that shows 401/400 without it. Do not add speculative headers. Optional: one live `POST /v1/responses` with stored bearer to confirm 1.0.70 still accepts Pi’s current set (same pattern as models probes).

### 3. Client-version floor on inference (not models)

**Gap.** Models accepts `1.0.12`. Historical gate was HTTP 426 below `1.0.13` on inference. Not re-probed on responses this pass.

**Pi-native fix path.** Keep sending `1.0.70`. Optional prove: responses POST with `1.0.12` expecting 426 vs `1.0.70` expecting stream start. Constant already correct.

### 4. Package-level 401 retry (intentional)

**Gap.** Grok docs describe early invalidation / refresh. Pi omits package-level 401 retry (XAI-013 NOT APPLICABLE); Pi auth refresh owns lifecycle.

**Pi-native fix path.** None required for oauth wire parity. If product wants CLI-like auto retry, implement in Pi auth/provider layer with tests, not by shelling to grok.

### 5. Live refresh POST body (low risk)

**Gap.** Refresh grant fields not wire-captured on 1.0.70 (token not near expiry). Binary names `grant_type` / `refresh_token` near OIDC refresh. Pi host performs refresh.

**Pi-native fix path.** When a stored token is near expiry, capture one refresh form (redacted) under `parity/…/fixtures/` and assert Pi host fields match. No extension change unless host form drifts.

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

1. Optional device headers once surface value is measured.
2. Optional responses header acceptance probe.
3. No catalog edit. Live ids match.
