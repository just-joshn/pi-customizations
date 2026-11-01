# Gaps versus `extensions/pi-antigravity-oauth`

Goal. 100% pi-native parity with agy's consumer OAuth and oauth-dependent Cloud Code auth, without spawning agy at runtime.

Binary under study. sha256 `34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3` (drifted from `09cefed6…`).

Pi baseline read. `src/oauth.ts`, `src/cloudcode.ts`, `src/models.ts`, `src/stream.ts`, tests under `test/` (UA assert in `test/stream.test.ts`). Read-only this unit. No extension edits.

## Already matching (no code change required for protocol identity)

| Item | Evidence |
| --- | --- |
| Auth URL / token URL / userinfo v2 | Binary literals equal Pi `GOOGLE_OAUTH` |
| Redirect `https://antigravity.google/oauth-callback` | Binary + `fixtures/client-metadata.json` |
| Client id `1071006060591-tmhssin2h21lcre235vtolojh4g403ep…` | Binary offset 58045220 |
| Client secret `GOCSPX-K58…` | Binary offset 57359941 |
| Scopes Pi lists | All present as literals |
| PKCE S256 + verifier/challenge names | Binary |
| `authorization_code` / `refresh_token` | Binary |
| Cloud Code host `daily-cloudcode-pa` + `CLOUD_CODE_URL` | Binary |
| `loadCodeAssist` body `{"metadata":{"ideType":"ANTIGRAVITY"}}` | `fixtures/captured-user-agent-1.4.12.json` + Pi `LOAD_CODE_ASSIST_BODY` |
| `fetchAvailableModels` and `streamGenerateContent` method names | Binary |
| Bearer auth | Binary + keychain `token_type` + sink |
| Consumer auth method label | Keychain `auth_method: consumer` |
| User-Agent `1.4.12` / `cl=1010700967` | Sink fixture + Pi `userAgent()` + `test/stream.test.ts` |

## Ordered gaps (concrete pi-native follow-ups)

### 1. Token POST `client_secret` under metadata `auth_method=none`

Metadata document says `token_endpoint_auth_method: none`. Binary still embeds GOCSPX. Pi always posts `client_secret`.

Impact. Likely still accepted for installed apps. Risk if Google rejects secret on this client.

Parity work. Capture one throwaway PKCE token exchange (live login gate) or decompile the token Config that posts form fields. Until then keep sending the secret (matches embedded consumer GOCSPX). Do not claim impossible.

### 2. Optional keychain import for existing agy sessions

agy. Keychain `gemini`/`antigravity` with nested `token` and `id_token_email`. No project id.

Pi. `auth.json` oauth with `access`/`refresh`/`expires`/`projectId`/`email`.

Impact. Pi cannot reuse an agy session without re-login or an importer.

Parity work. Optional pi-native reader for `go-keyring-base64:` payload, then `loadCodeAssist` to fill `projectId`. Pi credential store stays authoritative. Do not read the agy binary at runtime.

### 3. Tokeninfo v3 (optional)

agy strings call Google tokeninfo. Pi does not.

Impact. Low for login. Possibly validation after refresh.

Parity work. Optional. Add tokeninfo check only if a refresh failure mode needs it.

### 4. Scope order proof (optional)

All Pi scopes exist as literals. Offsets are not one contiguous ordered slice.

Impact. None observed. Pi login works with the documented order.

Parity work. Decompile AntigravityHubAuthProvider authorize Config if a server starts rejecting scope order.

### 5. Expiry skew numeric proof (optional)

Pi subtracts 10s. Binary has `expiryDelta` from x/oauth2. Library default is 10s. Numeric next to symbol not proven.

Impact. Negligible.

Parity work. Confirm via decompile or observed refresh timing once.

### 6. Enterprise STS / WIF (out of consumer scope)

Binary has `auth.cloud.google/authorize`, STS oauthtoken, WIF hub methods, two extra client ids/secrets.

Impact. Not needed for consumer Antigravity subscription parity.

Parity work. Only when an enterprise requirement appears. Capture STS request shape then implement pi-native.

### 7. Streaming / catalog envelope beyond auth

Auth for catalog and stream is bearer + UA + project (catalog). Envelope fields (`requestType`, body `userAgent: antigravity`, request id shape) live in Pi stream code. Not re-validated as a full HAR against this hash beyond method presence and prior sink auth headers.

Impact. Treat as separate wire-parity work if stream bugs appear. Not an oauth-protocol blocker.

### 8. Device code grant

Binary contains device-code grant type. Pi uses authorization-code + paste only.

Impact. None for current UX. Callback paste strings remain.

## Closed since prior `09cefed6…` report

1. User-Agent version/cl unknown. **Closed.** Measured `1.4.12` / `cl=1010700967` in `fixtures/captured-user-agent-1.4.12.json`. Pi already matches.
2. loadCodeAssist exact JSON unknown. **Closed.** Same fixture `body_prefix`.
3. Binary drift. **Re-verified.** All consumer oauth endpoints, client id/secret, scopes, PKCE, Cloud Code hosts, hub symbols still present under hash `34423fc9…`.

## Not gaps

- Depending on agy at runtime. Neither side requires the other once Pi completes its own login.
- Reading `~/.gemini/antigravity-cli/settings.json` for tokens. Tokens are not there.
- Matching Claude Code credential files. Unrelated store.
- Equating Go toolchain `cl/1006921819` with UA `cl=1010700967`. Different changelists. Documented in `protocol.md`.

## Suggested parity checklist (implementation later, not this write)

1. Capture token POST field set (client_secret present or absent).
2. Optionally add keychain import for existing agy sessions.
3. Optionally align tokeninfo validation.
4. Leave WIF/STS until an enterprise requirement appears.
5. Keep UA pinned to measured sink when the binary drifts again (compare `cl=` literal and sink capture).
