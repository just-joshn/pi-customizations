# Grok Build 1.0.70 OAuth protocol

Target binary: `/Users/josh-desktop/.grok/downloads/grok-1.0.70-macos-aarch64` (same bytes as `~/.grok/bin/grok`).
Version string measured: `grok 1.0.70 (f50904eaee6c) [stable]`.
SHA-256 measured: `5c8a688251bf61e35370b828b6a353b0a20fcc3f64000de8a91d426039f29cec`.
REA `open_binary` observed the same path, format `mach-o`, arch `arm64`, same digest.
Live OAuth was not completed. Browser authorize URL comes from `login-probe.txt` and `authorize-url.json` for a killed `grok login --oauth` run.

## Browser (loopback) flow

1. CLI binds `http://127.0.0.1:{ephemeral}/callback`.
2. CLI prints an authorize URL and waits for the redirect (or equivalent completion). Probe was killed after the URL print.
3. User approves at `https://auth.x.ai/oauth2/authorize`.
4. IdP redirects to the loopback callback with `code` and `state`.
5. CLI exchanges the code at `https://auth.x.ai/oauth2/token` with `grant_type=authorization_code` plus PKCE verifier. Token path is string-evident in the binary (`/oauth2/token`, `authorization_code`, `code_verifier` length assert). Exact browser token POST body was not captured on 1.0.70 (GUESS that fields match 1.0.50 and Pi `exchangeCode`).

### Authorize query (measured, 1.0.70)

Source: `login-probe.txt` / `authorize-url.json`.

Byte order of query names:

1. `response_type`
2. `client_id`
3. `redirect_uri`
4. `scope`
5. `code_challenge`
6. `code_challenge_method`
7. `state`
8. `nonce`
9. `referrer`

Stable values (identical to the 1.0.50 capture):

| name | value |
|---|---|
| `response_type` | `code` |
| `client_id` | `b1a00492-073a-47ea-816f-4c329264a828` |
| `scope` | `openid profile email offline_access grok-cli:access api:access conversations:read conversations:write workspaces:read workspaces:write` |
| `code_challenge_method` | `S256` |
| `referrer` | `grok-build` |

Encoding notes (measured):

- Scope separators are `%20`, not `+`.
- `redirect_uri` is `http://127.0.0.1:{port}/callback` with percent-encoded `:` `/`.
- `state` and `nonce` are UUID-shaped and share a timestamp prefix within one run.

Compared to `extensions/pi-xai-oauth/test/fixtures/grok-1.0.50-authorize-url.json`: same parameter order and same stable values. Only per-run fields differ.

Help text still says `--oauth` is the default SpaceXAI OAuth path. `--oauth` help also says it forces browser instead of device-code. Default when neither flag is set was not re-probed on 1.0.70 beyond the existing `--oauth` capture (GUESS: browser remains default).

### Client id in the binary

The UUID string and its raw 16-byte forms were not found in the image. Login probe still emits that client id. Binary env/config names include `GROK_OAUTH2_CLIENT_ID`. GUESS: default client id is assembled or loaded outside a plain literal.

## Device-code flow

Help (measured): `grok login --device-auth` (alias `--device-code`).

String evidence in the binary:

- Path `/oauth2/device/code`
- Path `/oauth2/token`
- Grant `urn:ietf:params:oauth:grant-type:device_code`
- Fields `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`, `expires_in`
- Source path `crates/codegen/xai-grok-login/src/device_code.rs`
- User-code format check `[A-Z0-9-]`

Verification host measured on 1.0.70 live device start: `https://accounts.x.ai/oauth2/device` (`fixtures/device-code-request-1.0.70.json`, also `fixtures/device-probe-1.0.70.json`).

Device request sits next to header name fragments `x-grok-client-version` / `1.0.70` / `x-grok-client-surface` in one concatenated blob. Live IdP accepts Pi-style `client_id` + `scope` without those headers (HTTP 200). Exact Grok CLI surface header value remains unknown (GUESS until wire or decompile).

## Token response and refresh skew

Prior 1.0.50 device login observed `expires_in` 21600 seconds and stored `refresh_token`. Not re-observed on 1.0.70 (no live completion).

Early invalidation (measured in embedded docs):

- Env `GROK_AUTH_EARLY_INVALIDATION_SECS`
- Default `300`
- Section title `Automatic Credential Refresh`

Pi `src/login.ts` still subtracts `REFRESH_SKEW_MS = 300000` on first login. That still matches the documented Grok default.

## Hot reload and logout (oauth dependency, protocol-adjacent)

Embedded docs still describe Hot Reload of `~/.grok/auth.json` without restart. Prior 1.0.50 work verified mode `0600` and logout clearing. Not re-run on 1.0.70.

## What did not change versus 1.0.50 (authorize)

Authorize endpoint, client id, full scope string, referrer, PKCE S256, query byte order, and `%20` scope encoding are unchanged on the 1.0.70 probe.
