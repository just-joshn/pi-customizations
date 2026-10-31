# Antigravity CLI (agy) OAuth protocol

Target binary. `/Users/josh-desktop/.local/bin/agy` Mach-O arm64, sha256 `34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3`. Changelog and live wire User-Agent are `1.4.12` with `cl=1010700967` (fixtures/captured-user-agent-1.4.12.json). Exact embedded CLI version string was not located as a contiguous `antigravity/cli/X.Y.Z` literal; the wire value comes from a live Cloud Code sink capture.

Evidence basis. Byte scans of the Mach-O, one public HTTPS GET of client metadata, one macOS keychain metadata read of the existing `gemini`/`antigravity` item, live CLOUD_CODE_URL sink capture of User-Agent, and comparison to `extensions/pi-antigravity-oauth`. No live Google login was completed in the initial ledger pass.

## Endpoints

| Role | URL | Status |
| --- | --- | --- |
| Authorization | `https://accounts.google.com/o/oauth2/auth` | VERIFIED in binary |
| Token | `https://oauth2.googleapis.com/token` | VERIFIED in binary |
| Userinfo | `https://www.googleapis.com/oauth2/v2/userinfo` | VERIFIED in binary |
| Tokeninfo | `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=%s` | VERIFIED format string in binary |
| OAuth callback page | `https://antigravity.google/oauth-callback` | VERIFIED in binary |
| Client metadata (RFC 7591 style) | `https://antigravity.google/oauth/client-metadata.json` | VERIFIED in binary and by live GET 200 |
| Alternate authorize (non-accounts) | `https://auth.cloud.google/authorize` | VERIFIED in binary. Guess. Separate Cloud/WIF path, not the consumer installed-app flow Pi mirrors. |
| STS token exchange | `https://sts.googleapis.com/v1/oauthtoken` | VERIFIED in binary. Adjacent to WIF / external_account strings. |
| Cloud Code (default used by Pi) | `https://daily-cloudcode-pa.googleapis.com` | VERIFIED in binary. Pi and agy honor `CLOUD_CODE_URL` override (`Overriding CloudCodeServerURL via CLOUD_CODE_URL`). |
| Cloud Code (prod and sandboxes) | `https://cloudcode-pa.googleapis.com`, `https://autopush-cloudcode-pa.sandbox.googleapis.com`, `https://preprod-daily-cloudcode-pa.sandbox.googleapis.com` | VERIFIED in binary |

## Client identity

Primary installed-app client id matches `CLIENT_ID` in `extensions/pi-antigravity-oauth/src/oauth.ts`.

Additional client ids exist in the same binary for other products or flows. Literals are redacted here for GitHub push protection.

Public client metadata document (fetched 2026-10-31, no auth).

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

Note. Metadata advertises `token_endpoint_auth_method: none` (public client). The binary still embeds GOCSPX client secrets. Pi sends `client_id` and `client_secret` on token POSTs. Whether agy's consumer path still posts the secret is INCONCLUSIVE without a captured token exchange.

## Client secrets (public installed-app style)

Three installed-app client-secret literals appear in rodata. The consumer secret matches `CLIENT_SECRET` in `extensions/pi-antigravity-oauth/src/oauth.ts`. The other two sit near Cloud authorize and MCP/crash-log strings. Literals are redacted here for GitHub push protection.

## Redirect

`https://antigravity.google/oauth-callback`

Binary success string. `OAuth: authenticated successfully as %s`. Callback errors. `OAuth callback error: %s`. Flow presents a code for paste-back (same UX Pi documents). Device-code grant type string also exists (`urn:ietf:params:oauth:grant-type:device_code`). Guess. Alternate or library path, not the primary CLI paste flow.

## Scopes

These scope URLs are present as literals.

- `https://www.googleapis.com/auth/cloud-platform`
- `https://www.googleapis.com/auth/userinfo.email` (immediately after `cloud-platform` in rodata)
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/cclog`
- `https://www.googleapis.com/auth/experimentsandconfigs`
- `https://www.googleapis.com/auth/aicode`
- `openid` (present, but many false neighbors in the string table)

Drive-related `googleapis.com/auth/drive*` strings also exist. Guess. Other Google client libraries inside the binary, not the Antigravity consumer login scope set.

Exact ordered scope list for the AntigravityHubAuthProvider login Config is INCONCLUSIVE from strings alone. Pi's ordered set matches the Antigravity-relevant literals above.

## PKCE

VERIFIED literals. `code_challenge`, `code_challenge_method`, `code_verifier`, `S256`.

Authorization request also has `access_type` and `consent` nearby in the string table. Pi uses `access_type=offline`, `prompt=consent`, `response_type=code`, `code_challenge_method=S256`. That match is VERIFIED for Pi and STRONGLY SUPPORTED for agy, but the exact AuthCodeURL builder was not decompiled (REA string search timed out on this binary size).

## Token grant and refresh

Grant types present. `authorization_code`, `refresh_token`.

Token POST content type present. `application/x-www-form-urlencoded`.

`expiryDelta` appears as a golang.org/x/oauth2 Token field name. Default in that library is 10 seconds early expiry. Pi uses `EXPIRY_DELTA_MS = 10_000`. Exact agy constant not proven by a numeric literal next to the symbol. Label. INFERRED from shared library, matches Pi.

## Userinfo and email

After login, email comes from userinfo. Binary has v2 userinfo URL and success format `OAuth: authenticated successfully as %s`. Keychain payload field `id_token_email` stores the email (measured). Pi calls v2 userinfo and stores `email` on the credential.

Tokeninfo v3 is also used (`failed to call tokeninfo`, `tokeninfo returned status %d`). Guess. Validation or diagnostics, not the primary email source.

## Project discovery

Cloud Code method `loadCodeAssist` is present, including protobuf `LoadCodeAssistRequest` with `metadata` / `ClientMetadata` and response field `cloudaicompanionProject`.

Pi sends `{ metadata: { ideType: 'ANTIGRAVITY' } }` and reads `cloudaicompanionProject` as string or `{ id }`. Binary has `ANTIGRAVITY` and `ClientMetadata_IdeType` / `ideType`. Exact JSON body agy posts was not captured. Label. INFERRED match to Pi.

Related methods also present. `listCloudAICompanionProjects`, `onboardUser`, `fetchUserInfo`.

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
