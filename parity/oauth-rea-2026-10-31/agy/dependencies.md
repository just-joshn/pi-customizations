# OAuth-dependent Cloud Code auth (agy)

Covers how a bearer token from the OAuth flow is applied to Cloud Code Assist and related surfaces. Evidence from Mach-O sha256 `34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3`, live sink fixtures, and on-disk / keychain state. No new live authenticated Cloud Code calls were made in this unit (fixtures retained from prior capture against this generation).

## Request auth encoding

### HTTP Authorization

Cloud Code RPCs use bearer access tokens.

- Literal `Bearer ` is present (10 hits).
- Pi encodes `Authorization: Bearer ${token}` in `cloudCodeHeaders`.
- agy keychain stores `token.token_type` as `Bearer`.
- Live sink rows mark `authorization_present: true` (`fixtures/captured-user-agent-1.4.12.json`).

### Pi-native apiKey bridge (not agy)

Pi does not read the macOS keychain. After login, `toAuth` packs.

```json
{ "token": "<access_token>", "projectId": "<cloudaicompanion project>" }
```

`parseApiKey` reverses that into stream / catalog callers. This encoding is Pi-only. agy's keychain payload has no `projectId`. Project is kept elsewhere in hub auth provider state (`SetProjectID`) and in Cloud Code request bodies.

### Content type

JSON RPCs. Live sink. `content_type: application/json` on loadCodeAssist / listExperiments. Token endpoint uses `application/x-www-form-urlencoded` (binary literal).

## Headers

### User-Agent

**VERIFIED** against live sink for this binary.

```
antigravity/cli/1.4.12 (aidev_client; os_type=darwin; arch=arm64; cl=1010700967; auth_method=consumer)
```

Fixture. `fixtures/captured-user-agent-1.4.12.json` (also older `fixtures/captured-user-agent.json` for prior 1.4.11 / cl=1010154931).

Binary fragments supporting the template.

| Fragment | Count |
| --- | --- |
| `aidev_client` | 1 |
| `os_type=%s` | 1 |
| `auth_method=%s` | 1 |
| `cl=%d` | 1 |
| `User-Agent` | 8 |
| `antigravity/cli/` contiguous | 0 |
| literal `1010700967` | 11 |

Pi `userAgent()` in `extensions/pi-antigravity-oauth/src/cloudcode.ts` and `test/stream.test.ts` already pin `1.4.12` / `cl=1010700967`. Match. VERIFIED.

Do not confuse with Go toolchain buildinfo `cl/1006921819` (`fixtures/binary-identity-34423fc9.json`, REA go evidence).

Keychain `auth_method` is `consumer`, matching Pi's `auth_method=consumer`.

### Authorization

`Authorization: Bearer <access_token>` for Cloud Code `v1internal:*` methods.

### Other

No evidence gathered this session for custom Cloud Code auth headers beyond User-Agent and Bearer. Streaming uses the same headers with SSE (`alt=sse` on `streamGenerateContent` in Pi).

## Model catalog auth

Method. `POST /v1internal:fetchAvailableModels`

Binary references.

- `/v1internal:fetchAvailableModels`
- Failure strings `FetchAvailableModels failed: %v`, `Failed to poll FetchAvailableModels`

Prior sink (1.4.11 fixture) captured authenticated `fetchAvailableModels` with empty body `{}` and bearer. Pi body. `{ project: <projectId> }` with bearer token. Auth dependency. Valid consumer access token plus known project. Refresh via Google token endpoint when expired.

## Streaming auth

Method. `POST /v1internal:streamGenerateContent?alt=sse`

Binary has `streamGenerateContent` and related generate/chat stream methods.

Pi envelope fields (from extension).

- `project`, `requestId`, `request`, `model`
- `userAgent: "antigravity"`
- `requestType: "agent"`

Auth. Same bearer + User-Agent as catalog. Empty-stream retries keep the transcript and salt `requestId`. Envelope field parity beyond auth is separate wire work (see gap list).

## loadCodeAssist (oauth-adjacent project discovery)

**VERIFIED** body for this binary generation.

```json
{"metadata":{"ideType":"ANTIGRAVITY"}}
```

Measured on multiple `/v1internal:loadCodeAssist` rows in `fixtures/captured-user-agent-1.4.12.json`. Matches Pi `LOAD_CODE_ASSIST_BODY`. Response field `cloudaicompanionProject` remains the project source (binary + Pi).

Also observed on this UA. `POST /v1internal:listExperiments` with body `{}` (same UA and bearer).

## STS / WIF (oauth dependency branch)

Present in binary.

- `https://sts.googleapis.com/v1/oauthtoken`
- `external_account`, `subject_token`, `urn:ietf:params:oauth:token-type:jwt`
- `workforcePools`
- Hub methods `SetWIFProvider` / `GetSavedWIFProvider`
- String `m stored for WIF credential` near client-metadata URL

Guess. Enterprise / workforce identity federation path, not required for consumer Google login that Pi implements. Consumer keychain payload uses `auth_method: consumer` with a normal Google refresh token, not an STS subject token.

Follow-up only if Pi must support enterprise WIF. Concrete. Capture a WIF login and map STS request fields. Not required for consumer parity.

## Credential storage

### agy on macOS (measured)

| Field | Value |
| --- | --- |
| Store | Keychain generic password |
| service | `gemini` |
| account | `antigravity` |
| Encoding | `go-keyring-base64:` + base64(JSON) |
| Library hint | `zalando/go_keyring` strings in binary |

JSON schema (redacted). See `fixtures/keychain-credential.schema.json`.

```json
{
  "token": {
    "access_token": "<redacted>",
    "token_type": "Bearer",
    "refresh_token": "<redacted>",
    "expiry": "<RFC3339>",
    "expires_in": 3599
  },
  "auth_method": "consumer",
  "id_token_email": "<email>"
}
```

Notes.

- No `projectId` in this blob.
- `expires_in` observed as 3599 (Google often issues 3600).
- Paths like `ANTIGRAVITY_GEMINI_DIR/run/credentials-cache` exist as strings. On this machine no populated oauth JSON cache was found under `~/.gemini/antigravity-cli` for tokens.

### Pi (`~/.pi/agent/auth.json`)

Provider key `google-antigravity`.

```json
{
  "type": "oauth",
  "access": "<redacted>",
  "refresh": "<redacted>",
  "expires": 1793485949697,
  "projectId": "aicode-consumers",
  "email": "<redacted email>"
}
```

Pi owns persistence. agy keychain is not read at runtime by the extension. Optional follow-up. Import path that reads go-keyring payload and runs `loadCodeAssist` to fill `projectId`.

### Claude credential files

- Under `~/.claude/` no oauth token JSON analogous to agy's keychain blob was found for Antigravity.
- Pi stores a separate `claude-subscription` oauth entry in `auth.json`. That is Pi's Claude path, not agy's Google path.
- Status. NOT APPLICABLE to Antigravity oauth deps.

## Cloud Code host selection

Default host Pi uses. `https://daily-cloudcode-pa.googleapis.com`.

agy. Same host string present. Override via `CLOUD_CODE_URL` with log `Overriding CloudCodeServerURL via CLOUD_CODE_URL environment variable: %q`.

Prod and sandbox hosts also embedded for other channels.

## Dependency status matrix (this binary)

| Dep | Status | Evidence / follow-up |
| --- | --- | --- |
| Bearer Authorization | VERIFIED | binary + keychain + sink |
| User-Agent 1.4.12 / cl=1010700967 | VERIFIED | sink fixture + Pi match |
| loadCodeAssist body | VERIFIED | sink body_prefix |
| fetchAvailableModels auth | VERIFIED | method + prior sink + Pi |
| streamGenerateContent auth | VERIFIED | method + Pi headers |
| CLOUD_CODE_URL / daily host | VERIFIED | binary + Pi |
| Keychain consumer store | VERIFIED | schema fixture |
| Token POST includes client_secret | FOLLOW-UP | capture token exchange under auth_method none |
| Tokeninfo validation | FOLLOW-UP optional | Pi omits; agy has strings |
| STS/WIF consumer path | NOT REQUIRED | enterprise-only; concrete capture if needed |
| Keychain import into Pi | FOLLOW-UP optional | pi-native reader + loadCodeAssist |
