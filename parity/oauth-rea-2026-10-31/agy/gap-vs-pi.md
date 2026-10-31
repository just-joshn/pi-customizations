# Gaps versus `extensions/pi-antigravity-oauth`

Goal. 100% pi-native parity with agy's consumer OAuth and oauth-dependent Cloud Code auth, without spawning agy at runtime.

Pi baseline read. `src/oauth.ts`, `src/cloudcode.ts`, `src/models.ts`, `src/stream.ts`, `docs/native-gap.md`, tests under `test/oauth.test.ts`.

## Already matching (no code change required for protocol identity)

| Item | Evidence |
| --- | --- |
| Auth URL / token URL / userinfo v2 | Binary literals equal Pi `GOOGLE_OAUTH` |
| Redirect `https://antigravity.google/oauth-callback` | Binary + client-metadata |
| Client id `1071006060591-tmhssin2h21lcre235vtolojh4g403ep…` | Binary |
| Client secret `<google-oauth-client-secret>` | Binary |
| Scopes Pi lists | All present as literals |
| PKCE S256 + verifier/challenge names | Binary |
| `authorization_code` / `refresh_token` | Binary |
| Cloud Code host `daily-cloudcode-pa` + `CLOUD_CODE_URL` | Binary |
| `loadCodeAssist` / `cloudaicompanionProject` / `ideType` | Binary |
| `fetchAvailableModels` and `streamGenerateContent` | Binary |
| Bearer auth | Binary + keychain `token_type` |
| Consumer auth method label | Keychain `auth_method: consumer` |

## Deltas that matter for parity

### 1. User-Agent version and changelist are stale in Pi

Pi hardcodes `antigravity/cli/1.3.1` and `cl=994719654`. This agy binary's changelog head is `1.4.12`. Neither `1.3.1` nor `994719654` appear as literals. `aidev_client` and `auth_method=%s` / `os_type=%s` do.

Impact. Server-side allowlists or telemetry may treat Pi as an old CLI. Unknown whether requests fail.

Parity work. Capture one real agy Cloud Code request User-Agent (black-box proxy or local MITM on a throwaway session), then update `userAgent()` to match. Do not guess the cl= value.

### 2. Credential store shapes differ (expected)

agy. Keychain `gemini`/`antigravity` with nested `token` object and `id_token_email`. No project id.

Pi. `auth.json` oauth credential with top-level `access`/`refresh`/`expires`/`projectId`/`email`.

Impact. Pi cannot reuse agy's keychain without a reader. For pi-native login this is fine. Optional enhancement. Import path that reads go-keyring payload and runs `loadCodeAssist` to fill `projectId`.

### 3. Client metadata says public client (`token_endpoint_auth_method: none`)

Pi always posts `client_secret`. Metadata document does not require it. Binary still embeds the secret.

Impact. Likely still accepted for installed apps. Risk if Google starts rejecting secret on this client or requires auth method none only.

Parity work. Optional. Probe token endpoint with a throwaway PKCE exchange (still a live login. out of scope here) or confirm via decompile that agy omits the secret. Until then keep sending the secret (current Pi behavior matches the embedded GOCSPX).

### 4. Extra OAuth clients and secrets unused by Pi

Binary has two other Google OAuth client ids and two other GOCSPX secrets, plus `auth.cloud.google/authorize` and STS/WIF.

Impact. Not needed for consumer Antigravity subscription parity. Needed only if Pi must support enterprise WIF or alternate Cloud authorize.

### 5. Tokeninfo v3

agy strings call Google tokeninfo. Pi does not.

Impact. Low for login. Possibly used for validation after refresh. Optional parity.

### 6. Device code grant

Binary contains device-code grant type. Pi uses authorization-code + paste only.

Impact. None for current UX parity unless agy primary login moved to device code (no evidence it did. callback paste strings remain).

### 7. Expiry skew

Pi subtracts 10s. Binary has `expiryDelta` symbol from x/oauth2. Numeric not proven.

Impact. Negligible if library default is 10s. Verify once via decompile or observed refresh timing.

### 8. loadCodeAssist body

Pi sends `{ metadata: { ideType: 'ANTIGRAVITY' } }`. Binary has IdeType enum and ANTIGRAVITY / NUX_CLIENT_ANTIGRAVITY. Exact wire JSON not captured.

Impact. If server requires more ClientMetadata fields (`ideVersion`, platform, pluginVersion), project discovery could fail for some accounts. Pi already works for the measured account (`projectId: aicode-consumers`). Residual risk for other tiers.

### 9. Streaming / catalog envelope beyond auth

Auth for catalog and stream is bearer + UA + project in body. Envelope fields (`requestType`, `userAgent: antigravity`, request id shape) live in Pi stream code and were not re-validated against this binary beyond method name presence. Treat as separate wire-parity work if stream bugs appear. Not an oauth-protocol gap.

## Not gaps

- Depending on agy at runtime. Neither side requires the other once Pi completes its own login.
- Reading `~/.gemini/antigravity-cli/settings.json` for tokens. Tokens are not there.
- Matching Claude Code credential files. Unrelated store.

## Suggested parity checklist (implementation later, not this write)

1. Capture agy User-Agent from a real Cloud Code call. Update Pi.
2. Optionally add keychain import for existing agy sessions.
3. Confirm whether token POST includes `client_secret` under auth method none.
4. Optionally align tokeninfo validation.
5. Leave WIF/STS until an enterprise requirement appears.
