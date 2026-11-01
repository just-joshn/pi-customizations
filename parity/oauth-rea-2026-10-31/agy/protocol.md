# Antigravity CLI (agy) OAuth protocol

Target binary. `/Users/josh-desktop/.local/bin/agy` Mach-O arm64, sha256 `34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3` (197589952 bytes). Drifted from prior ledger hash `09cefed6a1d217e14ba1751dce4442b97c2797e88c297c77fda3690f92ceddcd`.

Identity.

- Changelog / version literal `1.4.12` in binary (offset near build metadata).
- REA `inspect_go_binary` (evidence `ev_0a28b636…`). `go1.28-20261025-RC00 cl/1006921819` (+a87c0aebd5; X:fieldtrack,boringcrypto,simd,nogolistexportnewformat). That toolchain changelist is **not** the User-Agent `cl=`.
- Live Cloud Code UA (fixture). `antigravity/cli/1.4.12 (aidev_client; os_type=darwin; arch=arm64; cl=1010700967; auth_method=consumer)` in `fixtures/captured-user-agent-1.4.12.json`.
- Binary contains literal `1010700967` (11 hits, google3 / SrcFS / changelist metadata). Contiguous `antigravity/cli/` product string is **absent**. UA is assembled at runtime from fragments (`aidev_client`, `os_type=%s`, `auth_method=%s`, `cl=%d`, `User-Agent`, `%s/%s (%s)`).

Evidence basis. Byte scans of this Mach-O (`fixtures/binary-oauth-strings.json`, `fixtures/binary-identity-34423fc9.json`), REA open + Go buildinfo, retained live sink captures, public client-metadata GET, macOS keychain schema, read-only compare to `extensions/pi-antigravity-oauth`. REA `search_strings` timed out on this ~197MB image (same limit as prior pass). No live Google login this unit.

## Endpoints

| Role | URL | Status |
| --- | --- | --- |
| Authorization | `https://accounts.google.com/o/oauth2/auth` | VERIFIED in binary |
| Token | `https://oauth2.googleapis.com/token` | VERIFIED in binary |
| Userinfo | `https://www.googleapis.com/oauth2/v2/userinfo` | VERIFIED in binary |
| Tokeninfo | `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=%s` | VERIFIED format string in binary |
| OAuth callback page | `https://antigravity.google/oauth-callback` | VERIFIED in binary |
| Client metadata (RFC 7591 style) | `https://antigravity.google/oauth/client-metadata.json` | VERIFIED in binary and by live GET 200 (`fixtures/client-metadata.json`) |
| Alternate authorize (non-accounts) | `https://auth.cloud.google/authorize` | VERIFIED in binary. Guess. Separate Cloud/WIF path, not the consumer installed-app flow Pi mirrors. |
| STS token exchange | `https://sts.googleapis.com/v1/oauthtoken` | VERIFIED in binary. Adjacent to WIF / external_account strings. |
| Cloud Code (default used by Pi) | `https://daily-cloudcode-pa.googleapis.com` | VERIFIED in binary. Pi and agy honor `CLOUD_CODE_URL` (`Overriding CloudCodeServerURL via CLOUD_CODE_URL`). |
| Cloud Code (prod and sandboxes) | `https://cloudcode-pa.googleapis.com`, `https://autopush-cloudcode-pa.sandbox.googleapis.com`, `https://preprod-daily-cloudcode-pa.sandbox.googleapis.com` | VERIFIED in binary |

## Client identity

Primary installed-app client id matches `CLIENT_ID` in `extensions/pi-antigravity-oauth/src/oauth.ts` (present at file offset 58045220).

Two additional `.apps.googleusercontent.com` client ids remain in the same binary for other products or flows. Literals redacted in fixtures for GitHub push protection.

Public client metadata document (`fixtures/client-metadata.json`).

```json
{
  "client_id": "https://antigravity.google/oauth/client-metadata.json",
  "client_name": "Google Antigravity",
  "client_uri": "https://antigravity.google",
  "redirect_uris": ["https://antigravity.google/oauth-callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

Note. Metadata advertises `token_endpoint_auth_method: none` (public client). The binary still embeds three GOCSPX client secrets. Pi sends `client_id` and `client_secret` on token POSTs. Whether agy's consumer path still posts the secret is a concrete follow-up (needs a captured token exchange). Not claimed impossible.

## Client secrets (public installed-app style)

Three installed-app client-secret literals appear in rodata (offsets 57359801, 57359941, 57362321). The consumer secret at 57359941 matches `CLIENT_SECRET` in `extensions/pi-antigravity-oauth/src/oauth.ts`. The other two sit near Cloud Code / MCP strings. Literals redacted in fixtures.

## Redirect

`https://antigravity.google/oauth-callback`

Binary success string. `OAuth: authenticated successfully as %s`. Callback errors. `OAuth callback error: %s`. Flow presents a code for paste-back (same UX Pi documents). Device-code grant type string also exists (`urn:ietf:params:oauth:grant-type:device_code`). Guess. Alternate or library path, not the primary CLI paste flow.

## Scopes

These scope URLs are present as literals (each count ≥1 except openid which has neighbors).

- `https://www.googleapis.com/auth/cloud-platform`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/cclog`
- `https://www.googleapis.com/auth/experimentsandconfigs`
- `https://www.googleapis.com/auth/aicode`
- `openid`

Exact ordered scope list for the AntigravityHubAuthProvider login Config is not proven by adjacency (offsets are not a single contiguous slice). Pi's ordered set matches the Antigravity-relevant literals above. Follow-up. Decompile Config builder if order must be proven.

## PKCE

VERIFIED literals. `code_challenge`, `code_challenge_method`, `code_verifier`, `S256`.

`access_type` appears (4 hits). Pi uses `access_type=offline`, `prompt=consent`, `response_type=code`, `code_challenge_method=S256`. That match is VERIFIED for Pi. STRONGLY SUPPORTED for agy from string inventory. Exact AuthCodeURL builder was not decompiled (REA string index times out on this size).

## Token grant and refresh

Grant types present. `authorization_code`, `refresh_token`.

Token POST content type present. `application/x-www-form-urlencoded`.

`expiryDelta` appears as a golang.org/x/oauth2 Token field name. Default in that library is 10 seconds early expiry. Pi uses `EXPIRY_DELTA_MS = 10_000`. Exact agy constant not proven by a numeric literal next to the symbol. Label. INFERRED from shared library, matches Pi.

## Userinfo and email

After login, email comes from userinfo. Binary has v2 userinfo URL and success format `OAuth: authenticated successfully as %s`. Keychain payload field `id_token_email` stores the email (measured). Pi calls v2 userinfo and stores `email` on the credential.

Tokeninfo v3 is also referenced (`failed to call tokeninfo`, `tokeninfo returned status %d`). Guess. Validation or diagnostics, not the primary email source.

## Project discovery

Cloud Code method `loadCodeAssist` is present, including protobuf `LoadCodeAssistRequest` with `metadata` / `ClientMetadata` and response field `cloudaicompanionProject`.

**Measured wire body** (live sink, this binary generation). Exact JSON.

```json
{"metadata":{"ideType":"ANTIGRAVITY"}}
```

Source. `fixtures/captured-user-agent-1.4.12.json` `body_prefix` on `/v1internal:loadCodeAssist`. Matches Pi `LOAD_CODE_ASSIST_BODY`.

Related methods also present. `listCloudAICompanionProjects`, `onboardUser`, `fetchUserInfo`, `listExperiments`.

## Auth provider surface inside agy

Go type `codeassistclient.AntigravityHubAuthProvider` exposes token and project plumbing.

- `SetTokenInfo` / `OAuthTokenInfo` / `GetTokenSource` / `SetTokenSource`
- `SetProjectID` / `SetLocation` / `SetUserTier` / `GetUserTier`
- `SetWIFProvider` / `GetWIFProvider` / `SetSavedWIFProvider` / `GetSavedWIFProvider`

`OAuthTokenInfo` proto fields. `access_token`, `token_type`, `refresh_token` (and related save/remove RPCs on the language-server proto).

## Credential persistence (protocol-adjacent)

On this Mac, agy stores the OAuth token in the login keychain.

- service `gemini`
- account `antigravity`
- password prefixed `go-keyring-base64:` then base64(JSON)

Payload shape (values redacted). See `dependencies.md` and `fixtures/keychain-credential.schema.json`.

No oauth JSON file was found under `~/.gemini/antigravity-cli/` for tokens. That directory holds settings, cache, conversations, and protobuf state only.
