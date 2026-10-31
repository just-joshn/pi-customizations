# OAuth-dependent Cloud Code auth (agy)

Covers how a bearer token from the OAuth flow is applied to Cloud Code Assist and related surfaces. Evidence from the same agy Mach-O and from on-disk / keychain state. No live authenticated Cloud Code calls were made.

## Request auth encoding

### HTTP Authorization

Cloud Code RPCs use bearer access tokens.

- Literal `Bearer ` is present.
- Pi encodes `Authorization: Bearer ${token}` in `cloudCodeHeaders`.
- agy keychain stores `token.token_type` as `Bearer`.

### Pi-native apiKey bridge (not agy)

Pi does not read the macOS keychain. After login, `toAuth` packs.

```json
{ "token": "<access_token>", "projectId": "<cloudaicompanion project>" }
```

`parseApiKey` reverses that into stream / catalog callers. This encoding is Pi-only. agy's keychain payload has no `projectId`. Project is kept elsewhere in hub auth provider state (`SetProjectID`) and in Cloud Code request bodies.

### Content type

JSON RPCs. `Content-Type: application/json` (Pi). Binary has extensive JSON and protobuf clients for `v1internal`.

Token endpoint uses `application/x-www-form-urlencoded` (binary literal).

## Headers

### User-Agent

Binary contains `aidev_client`, format pieces `os_type=%s`, `auth_method=%s`, and `User-Agent`. No contiguous literal matching the full string was found in the Mach-O. Live sink capture supplies the wire value.

Measured agy 1.4.12 (sha256 `34423fc9…`) and Pi both send.

`antigravity/cli/1.4.12 (aidev_client; os_type=<go-os>; arch=<go-arch>; cl=1010700967; auth_method=consumer)`

Evidence. `fixtures/captured-user-agent-1.4.12.json`. Keychain `auth_method` is `consumer`, matching the template.

### Authorization

`Authorization: Bearer <access_token>` for Cloud Code `v1internal:*` methods.

### Other

No evidence gathered this session for custom Cloud Code auth headers beyond User-Agent and Bearer. Streaming uses the same headers with SSE (`alt=sse` on `streamGenerateContent` in Pi).

## Model catalog auth

Method. `POST /v1internal:fetchAvailableModels`

Binary references.

- `/v1internal:fetchAvailableModels`
- `CodeAssistClient.fetchAvailableModels` / `fetchAvailableModelsFromBAIC`
- Failure strings `FetchAvailableModels failed: %v`, `Failed to poll FetchAvailableModels`
- Skip path when auth mode unspecified. Returns empty response.

Pi body. `{ project: <projectId> }` with bearer token. Matches the need for a project id discovered via `loadCodeAssist`.

Auth dependency. Valid consumer access token plus known project. Refresh via Google token endpoint when expired.

## Streaming auth

Method. `POST /v1internal:streamGenerateContent?alt=sse`

Binary has `streamGenerateContent` and related generate/chat stream methods.

Pi envelope fields (from extension, not re-proven in binary this pass).

- `project`, `requestId`, `request`, `model`
- `userAgent: "antigravity"`
- `requestType: "agent"`

Auth. Same bearer + User-Agent as catalog. Empty-stream retries keep the transcript and salt `requestId`.

## STS / WIF (oauth dependency branch)

Present in binary.

- `https://sts.googleapis.com/v1/oauthtoken`
- `external_account`, `subject_token`, `urn:ietf:params:oauth:token-type:jwt`
- `workforcePools`
- Hub methods `SetWIFProvider` / `GetSavedWIFProvider`
- String `m stored for WIF credential` near client-metadata URL

Guess. Enterprise / workforce identity federation path, not required for consumer Google login that Pi implements. Consumer keychain payload uses `auth_method: consumer` with a normal Google refresh token, not an STS subject token.

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

Pi owns persistence. agy keychain is not read at runtime by the extension.

### Claude credential files

Acceptance asked for Claude/agy on-disk formats if present.

- Under `~/.claude/` no oauth token JSON analogous to agy's keychain blob was found this pass (settings, sessions, policy files only).
- Pi stores a separate `claude-subscription` oauth entry in `auth.json` (`access`, `refresh`, `expires` only). That is Pi's Claude path, not agy's Google path.
- agy changelog mentions `agy plugin import claude` for plugin import. Not an oauth credential store.

## Cloud Code host selection

Default host Pi uses. `https://daily-cloudcode-pa.googleapis.com`.

agy. Same host string present. Override via `CLOUD_CODE_URL` with log `Overriding CloudCodeServerURL via CLOUD_CODE_URL environment variable: %q`.

Prod and sandbox hosts also embedded for other channels.
