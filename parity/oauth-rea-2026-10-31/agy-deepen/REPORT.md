# AGY-TOKEN-SECRET-WIRE

**Goal.** Pi-native OAuth token POSTs for `pi-antigravity-oauth` must match what `agy` 1.4.12 actually sends. Metadata says `token_endpoint_auth_method: none`. Pi always posts `client_secret`. Decide from the binary whether the secret belongs on the wire.

**Verdict (measured).** `client_secret` is **present** on the consumer token POST. Public metadata `none` does not describe the installed-app Config that `agy` builds. Pi’s current `requestToken` (always `client_id` + `client_secret`) is already aligned. **No Pi code change. No PR.**

Binary under test. `/Users/josh-desktop/.local/bin/agy`, sha256 `34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3`, version `1.4.12`.

## How the token request is built

1. CLI consumer path builds an `oauth2.Config` via `auth.getOauthParams` → `auth.oauthConfigFor` → `(*oauthMethod).getOAuthConfig`.
2. Language-server path has a parallel `authclient.getOAuthConfig` that loads the same consumer id/secret pair.
3. Token exchange and refresh go through `golang.org/x/oauth2` → `internal.newTokenRequest` / `RetrieveToken`.
4. Embedded `oauth2.Endpoint` for Google uses `AuthStyle = 1` (`AuthStyleInParams`).

## Evidence

### Consumer Config includes `GOCSPX-K58…` (measured)

`auth.getOauthParams` at `0x10273e6e0` (pclntab via `__lrodata_gopcln`) ADRP+ADDs and MOVZ-lengths:

| Role | VA | Go string len |
|------|-----|---------------|
| consumer `client_id` | `0x10375b324` | 73 |
| consumer `client_secret` | `0x1036b3e45` (`GOCSPX-K58…`) | 35 |

Same pair appears in `authclient.getOAuthConfig` at `0x1021ebfe0` (cid len 73, secret len 35).

Fixture. `fixtures/token-post-auth-style.json`, `fixtures/disasm-authclient-getOAuthConfig.txt` (ADRP resolution notes).

### Google Endpoint AuthStyle is InParams (measured)

In `__DATA_CONST`, consecutive Go strings for Google’s Endpoint:

- AuthURL `https://accounts.google.com/o/oauth2/auth` (len 41)
- DeviceAuthURL `https://oauth2.googleapis.com/device/code` (len 41)
- TokenURL `https://oauth2.googleapis.com/token` (len 35)
- Next field word **`1`** = `AuthStyleInParams`

File offset of AuthStyle word. `195463856` (VA `0x10ba68ab0`).

### `newTokenRequest` posts `client_secret` when non-empty (measured + upstream)

- Symbol `internal.newTokenRequest` at `0x1003d8970` references form keys `client_id` and `client_secret` (ADRP targets in `fixtures/disasm-newTokenRequest.txt`).
- Upstream `golang.org/x/oauth2@v0.27.0/internal/token.go` under `AuthStyleInParams`:

```go
if clientSecret != "" {
    v.Set("client_secret", clientSecret)
}
```

With Config.ClientSecret set and AuthStyleInParams, both authorization_code and refresh_token POSTs include `client_secret` in the form body (not Basic auth).

### Metadata `none` does not win (measured)

`agy/fixtures/client-metadata.json` still has `"token_endpoint_auth_method": "none"`. That document describes a public-client registration surface. The Mach-O consumer Config still embeds and wires the installed-app secret. Wire behavior follows the Config, not the metadata claim alone.

## PKCE / refresh body (related, measured)

- Binary embeds `code_challenge`, `code_challenge_method`, `code_verifier`, `S256`, and `oauth2.GenerateVerifier` at `0x1003dca30`.
- Refresh path. `(*tokenRefresher).Token` at `0x1003dc3c0` → same `retrieveToken` / `newTokenRequest` with `grant_type=refresh_token` and the same Config credentials.

## Pi comparison

`extensions/pi-antigravity-oauth/src/oauth.ts` `requestToken` always appends `client_id` and `client_secret` (`GOCSPX-K58…`). That matches agy’s consumer Config + AuthStyleInParams. **ALIGNED.**

## Limitations

- Full Ghidra pseudocode of `newTokenRequest` timed out at the 330s startup deadline on this ~198MB image (`fixtures/decompile-newTokenRequest.json`). Finding rests on pclntab addresses, ADRP string/len loads, Endpoint AuthStyle word, and the published oauth2 source that this binary links (`google3/third_party/golang/oauth2/...` symbols).
- No live HTTPS capture of a token round-trip this unit. Static proof that ClientSecret is non-empty and AuthStyle is InParams is sufficient for the form-field question under oauth2’s documented `newTokenRequest`.

## Decision

Close **AGY-TOKEN-SECRET-WIRE** as evidence-only. Do not omit `client_secret` in Pi.
