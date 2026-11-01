# Gaps versus current `extensions/pi-antigravity-oauth`

Binary. sha256 `34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3` (`agy` 1.4.12).

Pi baseline. Current tree `src/oauth.ts`, `src/keychain.ts`, `src/cloudcode.ts`, `src/index.ts`, tests. Read-only this unit.

Parent gap list was `../agy/gap-vs-pi.md`. This deepen closes most of those against evidence below. Only still-open UNITs remain.

## Closed this deepen

| Prior unit | Why closed | Pi-native status |
| --- | --- | --- |
| Token POST `client_secret` vs metadata `auth_method=none` | Installed-app path uses Google Endpoint AuthStyleInParams + embedded GOCSPX + `SetOAuthClientSecretOverride`. Metadata none is a different client document. | Already sends secret in `requestToken`. Keep. |
| Device-code grant for consumer login | Library Endpoint + DeviceAuth symbols only. Zero jetski DeviceAuth callers. Consumer uses `SubmitAuthorizationCode` / redirect paste. | No device-code work. |
| expiryDelta numeric | Library default 10s; Pi `EXPIRY_DELTA_MS = 10_000`. | Match. |
| Optional keychain import | Already implemented (`keychain.ts`, login select, darwin gate). | Match. |
| Scope presence | Unchanged. All Pi scopes exist as literals. | Match. |
| UNIT-D3 scope order | Consumer path copies a 5-string slice, then appends `aicode`, then `openid`. `AuthCodeURL` joins that slice with a space. | VERIFIED. Pi `SCOPES` join order matches. No reorder. |

### UNIT-D3. Scope order. VERIFIED

Impact. None. Pi `SCOPES` already matches the consumer authorize list.

agy. `getScopesByAuthMethod` and `acpauth.ConsumerOAuthScopes` copy the static slice at `0x10ba14c60` (len 5, cap 5), append `https://www.googleapis.com/auth/aicode` when the auth method is not `gcp`, then append `openid` when it is absent. `oauthConfigFor` feeds that same method string to `getOauthParams`. The `consumer` arm is the length-73 client id Pi already sends. `(*Config).AuthCodeURL` calls `strings.Join` with a single-space separator, so this order is the `scope` query value.

Pi today. `SCOPES` join order is that seven-element list.

Fix path. None.

Evidence. `fixtures/consumer-scope-order.json`. Re-check with `fixtures/check-consumer-scope-order.py`.

The `gcp` arm drops `aicode` and uses a different client id (length 72). That is not the consumer list.

## Still open (each with Pi-native fix path)

### UNIT-D1. Optional tokeninfo v3 validation

Impact. Low for login. Possible help for opaque invalid_token after refresh or keychain import.

agy. GET `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=%s`. Errors `failed to call tokeninfo` / `tokeninfo returned status %d`. Likely `ValidateStoredToken` / personal validator path. Not the email source.

Pi today. No tokeninfo call.

Fix path.

1. Add a small `validateAccessToken(tokeninfoUrl, access, signal)` that GETs the format URL and treats non-2xx as invalid.
2. Call it only from refresh/import failure handling, or behind a narrow diagnostic path. Do not block happy-path login.
3. Tests. Fake fetch 200 vs 400. Do not hit Google from CI.

Evidence. `fixtures/tokeninfo.json`.

### UNIT-D2. Optional live token-exchange capture (proof elevation only)

Impact. Documentation / confidence. Not a behavior change if Pi keeps sending the secret.

agy. Strongly supported InParams POST with `client_secret`. Live wire not captured this unit (login gate; decompile blocked).

Pi today. Already posts the secret.

Fix path.

1. Throwaway login against a local HTTP sink or mitm of `oauth2.googleapis.com/token` with disposable credentials.
2. Assert form keys include `client_secret` on code exchange and refresh.
3. Store a redacted fixture under parity. No extension change unless the capture contradicts InParams (unexpected).

Evidence. `fixtures/token-exchange-fields.json`.

## Out of consumer scope (unchanged)

Enterprise STS / WIF, alternate GOCSPX clients, stream envelope fields beyond bearer + UA. No Pi work for 100% consumer oauth+deps parity.

## High-impact open rollup

None blocking consumer login or Cloud Code auth.

| Priority | Unit | Why it could matter | Fix cost |
| --- | --- | --- | --- |
| Low | UNIT-D1 tokeninfo | Clearer invalid-token diagnosis after refresh/import | Small optional helper |
| Low | UNIT-D2 live token POST capture | Elevates client_secret claim to wire-verified | One disposable login capture |

## Not gaps

- Runtime dependency on `agy`. Neither side needs the other once Pi completes login or keychain import.
- Omitting `client_secret` to chase metadata `auth_method=none`. That would diverge from the installed-app library path the binary ships.
- Implementing Google device-code for consumer UX parity.
