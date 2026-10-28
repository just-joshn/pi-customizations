# Design record

## D1: Whose OAuth client runs at login

**Superseded by D5.** The authorize query was captured on 2026-10-28, so the reason below for rejecting the second client no longer holds. The adapter in `src/login.ts` is the shipped login; only `refresh` and `toAuth` come from Pi.

### Options

1. Reuse Pi 1.4.0's built-in `xai` `OAuthAuth` and only rename it for provider `grok-build`.
2. Implement a second OIDC client in the extension: browser loopback plus device code, requesting the scope string found on a Grok-minted token.

### Comparison

| | Reuse Pi | Second client |
|---|---|---|
| Coverage | Device code, refresh, cancellation, and the same client id and endpoints. Misses the default browser flow and may request fewer scopes. | Could cover both login methods if the authorize query were known. |
| API fit | `registerProvider` with a native `Provider.auth.oauth`. Documented in `docs/custom-provider.md`. | Would reimplement PKCE and a loopback server. Pi's helpers are not public exports (`package.json` exports do not include `auth/oauth/pkce`). |
| Complexity | A spread of the existing object. | A second protocol implementation beside the one Pi already ships for this client. |
| Security | Pi validates the verification URI as `https` and locks refresh in `AuthStorage`. | A new callback server would be a new token-handling boundary. |
| Testability | Delegation is an identity check on the provider factory. | Browser login cannot be proven without the missing authorize query. |
| Packaging | No new dependency. | More code to keep aligned with `auth.x.ai`. |
| Maintenance | Pi owns the client. | This package would drift from both Pi and Grok. |

### Choice

Reuse Pi's client. Reject the second client. **Superseded:** D5 replaces the login half of this decision. The authorize query was not captured when D1 was written, and the first capture attempt on 2026-10-12 killed the process before it printed the URL. `extensions/pi-xai-oauth/test/fixtures/grok-1.0.50-authorize-url.json` records the query captured on 2026-10-28, so option 2 no longer invents parameters. Pi's device flow still posts to `https://auth.x.ai/oauth2/device/code` with client `b1a00492-073a-47ea-816f-4c329264a828`, which is the client id stored by Grok 1.0.50.

Evidence: `dist/auth/oauth/xai.js` lines defining `XAI_CLIENT_ID`, `XAI_DEVICE_CODE_URL`, and `XAI_TOKEN_URL`; `docs/custom-provider.md` "Provide authentication"; `package.json` exports.

## D2: Client version header

### Options

1. Keep sending `1.0.46`, which still clears the proxy gate.
2. Send `1.0.50`, the version Grok 1.0.50 sends, and keep the `models.json` header override.

### Comparison

Both pass `POST /v1/responses` today. Option 2 matches the current reference client and stays further above the `1.0.13` minimum. Option 1 leaves the package claiming a measured client that this verification replaced. Override via caller headers remains in both.

### Choice

Send `1.0.50`. Reject keeping `1.0.46`.

Evidence: fixture `fixtures/grok-1.0.50-oauth.json` `inferenceHeaders.clientVersion` and `proxyProbes`.

## Domain model

- Entity: one Pi provider, `grok-build`, distinct from `xai`.
- Credential owner: Pi `AuthStorage`, keyed by `grok-build`. The extension does not read `~/.grok/auth.json`.
- Token owner: Pi's xAI `OAuthAuth`. `toAuth` returns the access token as `apiKey`, which Pi sends as bearer.
- Catalog owner: the extension parses `/v1/models` and publishes models. Baseline rows exist before the first refresh.
- Header owner: `grokHeaders` merges version, token-auth, model override, context window, and session id under caller headers.
- Invariants: no API-key login on this provider; model ids used in headers match `^[A-Za-z0-9][A-Za-z0-9._-]*$`; refresh stays on Pi's locked path.
- Lifetime: access tokens observed at 21600 seconds. Pi subtracts five minutes from the server `expires_in` on refresh, and a first login through `src/login.ts` subtracts the same 300 seconds, so both paths expire locally 300 seconds early.
- Concurrency: Pi's credential `modify` lock. The extension does not refresh on its own.
- Idempotency: catalog refresh replaces the published list; a failed refresh leaves the previous list and surfaces the error.
- Validation: catalog rows that are not Responses, have no known effort, or have an unsafe id are dropped. A non-object body is an error, not an empty catalog.

## D3: Caller headers win

`grokHeaders` spreads `options.headers` last. That is the same precedence as Pi `models.json` provider headers, and it is how a user raises `x-grok-client-version` when the proxy minimum moves. A caller can also replace `X-XAI-Token-Auth`. That is user configuration, not catalog input. Rejected alternative: pin the auth headers so config cannot override them. That would remove the documented escape hatch.

The headers stay in the provider's stream wrapper rather than moving onto `Model.headers`, measured on Pi 1.4.0. A model header reaches the wire through `Models.getAuth`, which merges `auth.headers` and then the model's own headers, so a model-level client version beats both the provider `headers` in `models.json` and the stream wrapper. The wrapper is also the only place that sees the effective context window after `modelOverrides.contextWindow` changes it, and Pi restores a persisted catalog before any network call, so an identity header carried on the cached model would disappear for an offline start after an upgrade. `stream.test.ts::models.json still wins over the headers the package sends` locks the precedence.

## D4: Catalog fetch does not follow redirects

`fetchModels` sets `redirect: 'error'`. A redirect would otherwise send the bearer token to another URL. Rejected alternative: default fetch redirects. The catalog URL is fixed, so a redirect is not part of the contract.

## D5: Login adapter

Pi's xAI `OAuthAuth.login` is device-code only and requests a shorter scope. `AuthInteraction` can show an authorization URL, a device code, and a manual paste. It cannot pass a scope or authorize query into that client, and PKCE helpers are not exported.

The captured authorize URL makes the adapter concrete. `src/login.ts` replaces only `login`. Pi still stores the credential and still owns `refresh` and `toAuth`. Delete the adapter when Pi's xAI login offers this browser URL and scope.

The user explicitly required the gap to be fixed. `extensions/pi-xai-oauth/test/fixtures/grok-1.0.50-authorize-url.json` holds the query captured from `grok login --oauth` on 2026-10-28, including `referrer=grok-build` and `%20` between scope values, and `test/login.test.ts` compares the built URL to it byte for byte. The earlier 2026-10-12 attempt killed the process before the URL was printed.

### 401 refresh and retry

1. Required behavior: on HTTP 401, refresh the stored token and retry the request once.
2. Evaluated mechanism: `isRetryableAssistantError` and `Models.getAuth`.
3. Public API gap: 401 is not retryable. `getAuth` refreshes only inside the five-minute local window, once before the request. No extension event refreshes a credential and retries the same provider call.
4. Omitting is required: Pi owns request recovery. A stream wrapper would be a second recovery path and could refresh outside the credential lock.
5. Smallest adapter: not concrete without taking ownership of recovery.
6. Pi owns the retry policy and the credential lock.
7. `test/pi-owned-auth.test.ts` locks that a 401 assistant error is not retryable.
8. Delete this omission when Pi treats that 401 as retryable and refreshes OAuth before the retry.

## D6: Catalog discovery follows the provider base URL

`fetchModels` asks `RefreshModelsContext.baseUrl` for the model list, falling back to `PROXY_BASE_URL`. Pi composes that field from `providers['grok-build'].baseUrl` and applies the same value to every model, so chat and discovery cannot point at different endpoints. Rejected alternative: keep the constant. A gateway or local endpoint would then carry chat but leave discovery on `cli-chat-proxy.grok.com`.

## Not built

401-and-retry, customer OIDC, external auth commands, and Grok's agent metadata headers. Reasons are in `spec.md` and D5.
