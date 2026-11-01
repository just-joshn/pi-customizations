# agy OAuth deepen (1.4.12)

Goal. Recover remaining consumer OAuth facts from `/Users/josh-desktop/.local/bin/agy` so `extensions/pi-antigravity-oauth` can stay 100% Pi-native with no runtime `agy` dependency.

Binary. Mach-O arm64 sha256 `34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3`, version literal `1.4.12`. Prior inventory under `../agy/`.

Method. Static RE only. REA `open_binary` bound this hash. Ghidra-backed `analyze_function` / `search_strings` / `trace_feature` hit the MCP client deadline on this ~197MB image, so claims below rest on pclntab symbol strings, rodata adjacency, prior fixtures, read-only Pi sources, and upstream `golang.org/x/oauth2` linked by those symbols. No Google credentials were mutated. No extension edits.

throughput checkpoint: n/a, read-only investigation

## Overview

Consumer login is authorization-code + PKCE + paste. Token exchange goes through vendored `golang.org/x/oauth2` with Google's `AuthStyleInParams`, so a non-empty `ClientSecret` is posted as form `client_secret`. Device-code is library Endpoint baggage, not the CLI consumer path. tokeninfo v3 exists for stored-token validation. Expiry skew matches the library 10s default. Keychain import already lives in Pi.

## Key concepts

**Installed-app Config vs public metadata.** `client-metadata.json` advertises `token_endpoint_auth_method: none` with a URL-shaped client id. The installed consumer client is the numeric id + `GOCSPX-K58…`. Those are not the same client document.

**AuthStyleInParams.** Upstream Google Endpoint sets this. `internal.newTokenRequest` then puts `client_id` and `client_secret` in the `application/x-www-form-urlencoded` body when the secret is non-empty.

**Auth-code paste.** Backend symbols `SubmitAuthorizationCode`, `oauthConfigFor`, `getConsumerAuthScopes`, and the UX string `Enter the redirect URL (if redirect failed):` define the consumer interactive path Pi already mirrors.

## How it works

### 1. Token exchange POST field set

**Confidence. Strongly supported** (not live-wire verified; decompile blocked).

Field set for authorization_code (and the same client fields on refresh).

| Field | Source |
| --- | --- |
| `grant_type` | `authorization_code` or `refresh_token` (binary literals) |
| `code` / `code_verifier` / `redirect_uri` | PKCE + callback literals; Pi matches |
| `refresh_token` | refresh path |
| `client_id` | consumer id at offset 58045220 |
| `client_secret` | consumer GOCSPX at 57359941; sent when Config secret non-empty under AuthStyleInParams |

Why secret is sent.

1. Binary includes `oauth2/internal.newTokenRequest`, `RetrieveToken`, and AuthStyle cache symbols.
2. Rodata places `https://accounts.google.com/o/oauth2/auth` immediately before `https://oauth2.googleapis.com/device/code`, matching `google.Endpoint` AuthURL + DeviceAuthURL layout. That Endpoint's AuthStyle is `AuthStyleInParams`.
3. `SetOAuthClientSecretOverride` / `main.applyACPOAuthOverrides` prove ClientSecret is a live Config field.
4. Upstream `newTokenRequest` (golang/oauth2 `internal/token.go`) does `v.Set("client_secret", clientSecret)` for InParams.

Metadata `auth_method=none` does not contradict this. It describes the separate public metadata client.

Pi already posts `client_id` + `client_secret` in `requestToken`. Keep that.

Fixture. `fixtures/token-exchange-fields.json`.

### 2. Device-code grant

**Confidence. Verified unused for consumer login.**

Present as library surface.

- Grant type `urn:ietf:params:oauth:grant-type:device_code`
- Google URL `https://oauth2.googleapis.com/device/code`
- Symbols `Config.DeviceAuth`, `DeviceAccessToken`, `retrieveDeviceAuth`

Absent from jetski consumer call graph (zero `jetski…DeviceAuth` / `DeviceAccess` pclntab hits). Consumer interactive auth uses `SubmitAuthorizationCode` and redirect/paste strings instead.

`https://github.com/login/device/code` is a separate GitHub path.

Pi-native path. None. Do not add device-code for consumer parity.

Fixture. `fixtures/device-code.json`.

### 3. tokeninfo v3

**Confidence. URL and errors verified. Call timing inferred.**

URL format string.

`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=%s` (offset 57916198)

Errors.

- `failed to call tokeninfo: %w`
- `tokeninfo returned status %d`

Neighbors include `ANTIGRAVITY_AUTH_SUCCESS_APP` and CDE auth-action strings. Related symbols include `auth.ValidateStoredToken` and personal auth validators. Primary email remains userinfo v2.

Pi-native path (optional). On opaque invalid access token after refresh or keychain import, GET tokeninfo before forcing re-login. Not required for login success.

Fixture. `fixtures/tokeninfo.json`.

### 4. expiryDelta

**Confidence. Strongly supported at 10 seconds.**

Binary has `expiryDelta` and `(*Token).expired`, plus library `ReuseTokenSourceWithExpiry`. Upstream `defaultExpiryDelta = 10 * time.Second`. No jetski evidence of a custom earlyExpiry for the consumer token source.

Pi `EXPIRY_DELTA_MS = 10_000` in `oauth.ts` and `keychain.ts` matches.

Fixture. `fixtures/expiry-delta.json`.

### 5. Keychain payload vs Pi

**Confidence. Verified. Gap closed in current extension.**

agy. Keychain `gemini` / `antigravity`, `go-keyring-base64:` JSON with nested `token`, `auth_method: consumer`, `id_token_email`. No `projectId`.

Pi. `src/keychain.ts` parses that shape. `importAgyKeychainCredential` fills `projectId` via `loadCodeAssist`. `index.ts` enables the import on darwin.

Fixture. `fixtures/keychain-vs-pi.json`.

### 6. OAuth deps beyond `../agy/dependencies.md`

See `fixtures/oauth-deps-delta.json`. Material updates.

- Close client_secret FOLLOW-UP as keep-sending (strongly supported).
- Close keychain FOLLOW-UP (already in Pi).
- Record Google device/code as unused library Endpoint field.
- Record GitHub device/code as unrelated.
- Keep tokeninfo optional.
- Pin expiryDelta at 10s.

## Where things live

| Concern | agy (binary) | Pi |
| --- | --- | --- |
| Auth URL builder | `authclient.buildAuthCodeURL`, `oauthMethod.StartInteractive` | `authorizationUrl` in `oauth.ts` |
| Config | `oauthConfigFor`, `getOAuthConfig`, `getOauthParams` | `GOOGLE_OAUTH` + CLIENT_ID/SECRET |
| Code submit | `SubmitAuthorizationCode` | `interaction.prompt(manual_code)` |
| Token POST | `oauth2/internal.RetrieveToken` | `requestToken` |
| Email | userinfo v2 | `fetchEmail` |
| Token validate | tokeninfo + `ValidateStoredToken` (optional) | not implemented |
| Creds | keychain go-keyring | `auth.json` + optional keychain import |

## Gotchas

1. Do not equate metadata `auth_method=none` with "omit client_secret" for the installed app.
2. Do not implement Google device-code because the grant string exists. Consumer login does not call it.
3. Toolchain buildinfo `cl/1006921819` is not the Cloud Code UA `cl=1010700967`.
4. Ghidra deepen of Config builders remains useful if Google ever rejects InParams secrets. Until then Pi's current POST matches the library path the binary ships.
