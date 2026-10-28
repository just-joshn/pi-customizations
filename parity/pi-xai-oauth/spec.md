# pi-xai-oauth behavioral specification

Source harness: Grok Build TUI `grok` 1.0.50 (`c58f321264ba`), the subscription OAuth that signs in to `auth.x.ai` and the request dependencies required for that token to be accepted by `https://cli-chat-proxy.grok.com/v1`.

Target: `extensions/pi-xai-oauth`, loaded by Pi 1.4.0.

## Sources

| Ref | Kind | Location | License or authorization |
|---|---|---|---|
| S1 | doc | `~/.grok/docs/user-guide/02-authentication.md` and `26-config-reference.md` | Published with the installed Grok Build client |
| S2 | doc | `~/.grok/README.md` section "Using auth.json for API Access" | Published with the installed client |
| S3 | observation | `grok 1.0.50` CLI help, `grok login`, `grok models`, isolated proxy capture | Authorized black-box use of the installed harness |
| S4 | observation | Public `https://auth.x.ai/.well-known/openid-configuration` and device-authorization responses | Public OAuth metadata |
| S5 | observation | Redacted credential shape and access-token claims after `grok login --device-auth` in an isolated `GROK_HOME` | Local observation; secret values were not copied |
| S6 | observation | Status-only probes of `cli-chat-proxy.grok.com` | Black-box; tokens were not written to fixtures |
| S7 | permitted source | Pi 1.4.0 `@earendil-works/pi-ai` `dist/auth/oauth/xai.js` and `dist/providers/xai.js` | MIT |
| S8 | doc | Pi 1.4.0 `docs/custom-provider.md`, `docs/providers.md`, `docs/packages.md` | Installed Pi docs |
| S9 | observation | `grok login --oauth` in an isolated `GROK_HOME`, with the process killed after it printed the authorize URL | Authorized black-box use of the installed harness; no login completed |

## Scope

- In scope: browser and device-code login for the captured `auth.x.ai` client and scope, refresh before local expiry, logout, credential hot reload, file mode, the proxy headers and catalog call required for that token, and the 500000-token window through `models.json`.
- Out of scope: Grove git credentials, MCP OAuth, customer IdP OIDC, external auth-provider binaries, named BYOK helpers, TUI, tools, doom-loop headers, telemetry, the built-in `xai` API-key provider at `api.x.ai`, and a second 401 retry loop. The retry is omitted under the native-gap gate in `decisions.md`.
- Pi replacements: Pi `OAuthAuth` refresh plus `AuthStorage` for refresh and `auth.json`; `registerProvider` for the proxy; Pi's OpenAI Responses implementation for the body; `models.json` for base URL, header, and context-window overrides. Login is the one Pi flow this package replaces, and `decisions.md` D5 records why.

## Requirements

### XAI-001: Browser login is the default
- Trigger: `grok login` or `grok login --oauth`.
- Input → expected output: Opens a loopback OIDC authorization-code flow at `https://auth.x.ai` with client `b1a00492-073a-47ea-816f-4c329264a828` and redirect `http://127.0.0.1:{port}/callback`. The authorize query carries nine parameters in this order: `response_type`, `client_id`, `redirect_uri`, `scope`, `code_challenge`, `code_challenge_method=S256`, `state`, `nonce`, `referrer=grok-build`.
- Evidence: S3 and S9, **observation**, confidence high. `extensions/pi-xai-oauth/test/fixtures/grok-1.0.50-authorize-url.json` records the URL Grok 1.0.50 printed. Four captures agreed on the parameter set and order; only the redirect port, PKCE challenge, state, and nonce differed. The query is encoded the way Grok encodes it, with `%20` between scope values rather than `+`.
- Acceptance test: `extensions/pi-xai-oauth/test/login.test.ts::the authorize URL matches the captured Grok 1.0.50 request byte for byte`

### XAI-002: Device-code login uses the same client and endpoint
- Trigger: `grok login --device-auth` or Pi `/login` for Grok Build.
- Input → expected output: Device authorization at `https://auth.x.ai/oauth2/device/code` with that client id. Verification URL host is `https://accounts.x.ai/oauth2/device`. Polls the token endpoint until approved, denied, or expired.
- Evidence: S3, S4, S7, **observation** plus permitted Pi source, confidence high.
- Acceptance test: `extensions/pi-xai-oauth/test/login.test.ts::device login polls until the token endpoint completes`

### XAI-003: Granted scopes
- Trigger: successful device login.
- Input → expected output: A Grok-minted access token carried `openid profile email offline_access grok-cli:access api:access conversations:read conversations:write workspaces:read workspaces:write`. Pi's login requests the same string without the conversations and workspaces scopes.
- Evidence: S5, S7, **observation** of the grant and **fact** of Pi's request. The package requests the full string; whether the server adds scopes, and whether the proxy requires the extra scopes, are **unknown**.
- Acceptance test: `extensions/pi-xai-oauth/test/login.test.ts::device login polls until the token endpoint completes`

### XAI-004: Refresh before expiry
- Trigger: stored refresh token, local expiry inside five minutes, or a later 401.
- Input → expected output: `grant_type=refresh_token` at `https://auth.x.ai/oauth2/token` with the same client id. Grok's documented early window is 300 seconds. A 401 refreshes and retries once.
- Evidence: S1, S7, **fact** for the endpoints and skew. The 401 retry is a documented fact, not re-observed with a revoked token.
- Acceptance test: `extensions/pi-xai-oauth/test/provider.test.ts::login is the Grok Build flow and refresh stays on the given xAI client` covers refresh delegation. `extensions/pi-xai-oauth/test/login.test.ts::a fresh login expires five minutes before the server expiry` covers the skew on a first login. The 401 retry is omitted under the native-gap gate.

### XAI-005: Logout and file mode
- Trigger: `grok logout` or Pi `/logout`.
- Input → expected output: Cached credentials are cleared. Grok writes `auth.json` mode `0600`. Pi documents `/logout` and writes `auth.json` with mode `0600` on creation.
- Evidence: S1, S3, S8, **observation** that isolated `grok logout` deleted the probe file. Pi's write mode was read from source and not re-measured after a Pi login.
- Acceptance test: `extensions/pi-xai-oauth/test/pi-owned-auth.test.ts::Pi creates auth.json owner-only, reloads an external rewrite, and logout clears it`

### XAI-006: Client version gate
- Trigger: `POST /v1/responses`.
- Input → expected output: Missing version or `1.0.12` returns HTTP 426 naming minimum `1.0.13`. `1.0.46` and `1.0.50` pass the gate. Grok 1.0.50 sends `1.0.50`. `GET /v1/models` does not enforce it.
- Evidence: S6, **observation**, confidence high.
- Acceptance test: `extensions/pi-xai-oauth/test/stream.test.ts::native streaming preserves the Grok Build identity and bearer token`

### XAI-007: CLI token-auth header
- Trigger: inference request.
- Input → expected output: Grok sends `X-XAI-Token-Auth: xai-grok-cli`. A wrong value is HTTP 401. Omitting it still passed the auth gate for a valid token on 2026-10-12.
- Evidence: S2, S3, S6, **observation**, confidence high.
- Acceptance test: `extensions/pi-xai-oauth/test/stream.test.ts::native streaming preserves the Grok Build identity and bearer token`

### XAI-008: Model override header
- Trigger: inference request.
- Input → expected output: Grok sends `x-grok-model-override` with the model id. The published README calls it required for routing. Omitting it still passed the auth gate on a malformed body.
- Evidence: S2, S3, S6, **observation**, confidence high that Grok sends it; medium that the proxy requires it for a successful generation.
- Acceptance test: `extensions/pi-xai-oauth/test/stream.test.ts::native streaming sends the requested model and effort`

### XAI-009: Conversation id
- Trigger: a request that has a session id.
- Input → expected output: Grok sends `x-grok-conv-id` once a session exists. The port sends Pi's session id in that header.
- Evidence: S3, **observation**, confidence high for the header name. Cache-affinity numbers in the package README were not re-measured.
- Acceptance test: `extensions/pi-xai-oauth/test/request.test.ts::a session id yields the five identity headers`

### XAI-010: Proxy base URL and catalog auth
- Trigger: model list.
- Input → expected output: `GET https://cli-chat-proxy.grok.com/v1/models` with `Authorization: Bearer`. A valid token returns the four model ids. Bearer alone is enough for that GET.
- Evidence: S3, S6, **observation**, confidence high.
- Acceptance test: `extensions/pi-xai-oauth/test/live-catalog.test.ts::the refresh sends the bearer token to the catalog endpoint`

### XAI-011: Responses body the token is used with
- Trigger: a chat turn.
- Input → expected output: `POST /v1/responses` with `store: false`, `stream: true`, and `include` containing `reasoning.encrypted_content` when reasoning is on. Grok 1.0.50 used this path, not `/v1/chat/completions`.
- Evidence: S3, S6, S7, **observation**, confidence high. Grok's `reasoning.summary` value was not captured exactly; Pi sends `auto`.
- Acceptance test: `extensions/pi-xai-oauth/test/stream.test.ts::native streaming sends one request to the responses endpoint`

### XAI-012: Catalog shape
- Trigger: a readable `/v1/models` body.
- Input → expected output: `grok-4.7`, `grok-4.7-build-fast`, and `grok-4.6` offer low, medium, high, and xhigh. `grok-4.5` offers low, medium, and high. `api_backend` is `responses`. Default `context_window` is 256000. Every reported effort that is one of Pi's seven thinking-level names becomes that Pi level, in Pi's order; a row that reports none of them is dropped.
- Evidence: S3, **observation**, confidence high for the four rows. The remaining level names are Pi's vocabulary, not Grok's; no capture has reported them.
- Acceptance test: `extensions/pi-xai-oauth/test/catalog.test.ts::every effort the catalog reports as a Pi level is kept`

### XAI-013: 401 refresh and retry
- Trigger: proxy returns 401 for a previously accepted token.
- Input → expected output: Grok refreshes and retries the request once.
- Evidence: S1, **fact** in the user guide. Not re-observed. Pi refreshes before local expiry and does not add a 401 retry in this package.
- Acceptance test: none. Omitted. Pi owns request recovery, and `isRetryableAssistantError` returns false for this 401.

### XAI-014: Credential hot reload
- Trigger: another process writes `auth.json`.
- Input → expected output: The next request uses the new credential without a restart.
- Evidence: S1, **fact** for Grok. Measured through `ModelRuntime.getAuth` after an external rewrite of `auth.json`.
- Acceptance test: `extensions/pi-xai-oauth/test/pi-owned-auth.test.ts::Pi creates auth.json owner-only, reloads an external rewrite, and logout clears it`

### XAI-015: Customer OIDC
- Trigger: `[auth.oidc]` or `GROK_OIDC_ISSUER`.
- Evidence: S1, **fact**. Default login log said `has_oidc=false`.
- Acceptance test: none. Excluded.

### XAI-016: External auth provider
- Trigger: `auth_provider_command`.
- Evidence: S1, **fact**. Not the subscription grant.
- Acceptance test: none. Excluded.

### XAI-017: API key fallback
- Trigger: `XAI_API_KEY` with no session token.
- Evidence: S1, **fact**, and the README contradicts the user guide on precedence.
- Acceptance test: none. Excluded. The built-in `xai` provider owns API keys.

### XAI-018: Grove and MCP OAuth
- Evidence: S1, **fact** that Grove credentials are not `grok login`.
- Acceptance test: none. Excluded.

### XAI-019: Agent metadata headers
- Trigger: inference.
- Input → expected output: Grok also sends user id, email, client mode, client identifier, agent id, turn index, doom-loop checks, and trace headers. A responses probe accepted a valid token with only bearer auth and `x-grok-client-version`.
- Evidence: S3, S6, **observation**, confidence high that they are not required for acceptance.
- Acceptance test: none. Excluded from the oauth contract.

### XAI-020: Pi CLI lists the provider
- Trigger: `pi --list-models grok-build` with the extension loaded and an OAuth credential.
- Input → expected output: The four catalog ids and four fast effort aliases are listed.
- Evidence: `bun run prove:list` on 2026-10-12, **observation**.
- Acceptance test: `extensions/pi-xai-oauth/scripts/prove-pi.ts`

### XAI-021: Package install and removal
- Trigger: `pi install <package>` and `pi remove <package>` in an isolated agent directory.
- Input → expected output: Install lists `grok-build`. Remove stops listing it. The user agent directory is not modified.
- Evidence: isolated run on 2026-10-12, **observation**.
- Acceptance test: `extensions/pi-xai-oauth/scripts/prove-install.mjs`

### XAI-022: Alternate 500k context window
- Trigger: catalog field `context_windows: [256000, 500000]`.
- Input → expected output: Pi selects 500000 with `models.json` `modelOverrides`. The port sends that window in `x-grok-context-window`. Grok's picker for the same window was not observed and is not reimplemented.
- Evidence: S3, **observation** of the field. Pi `docs/models.md` and `applyModelOverride`, **fact**.
- Acceptance test: `extensions/pi-xai-oauth/test/stream.test.ts::models.json still wins over the headers the package sends`

### XAI-023: Effort alias ids
- Trigger: a tool asks for `grok-4.7-xhigh-fast`.
- Evidence: not a Grok OAuth behavior. Grok selects effort with `--reasoning-effort`.
- Acceptance test: none. Excluded.

## Unknowns

| Question | Why it matters | How it could be resolved |
|---|---|---|
| Whether Pi's shorter scope is granted extra scopes, and whether the proxy checks them | Could make Pi-minted tokens fail for workspace features | Complete one Pi device login and compare the scope claim, without logging the token |
| Whether Grok's 401 retry still matches the user guide | Mid-session revocation | Revoke a probe token and watch one retry |
| How the 500k window is selected in Grok | Users may expect it without `models.json` | Observe the model picker or a config key |
| `reasoning.summary` value Grok sends | Pi sends `auto` | Recapture the body field, not the prompt text |
| Whether xAI accepts the captured authorize query from another client | The package sends the same request, but only Grok has approved it | Approve one browser login opened by this package, without logging the token |
