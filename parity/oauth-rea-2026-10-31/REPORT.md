# OAuth protocol parity report

Date. 2026-10-31. Branch `feat/oauth-cli-parity-2026-10-31`.

Goal. Close remaining oauth and oauth-deps parity gaps for the three Pi packages with no runtime CLI dependency.

## Per package

### pi-anthropic-oauth

OAuth protocol is at parity for the subscription path. Native `src/oauth.ts` owns cai authorize, seven scopes, independent PKCE state, paste-code redirect, Zxt refresh scope, and absolute expiry store. Identity pins Claude Code `2.1.312`. Billing fingerprint salt, indices, and version match bunfs. Fingerprint input skips duck-typed `isMeta` and `isCompactSummary` user messages. Ambient precedence is `ANTHROPIC_AUTH_TOKEN` then `CLAUDE_CODE_OAUTH_TOKEN`. Dual Bearer plus `x-api-key` is not applicable. This provider is oauth-only and rejects API keys.

### pi-antigravity-oauth

Consumer OAuth constants, Cloud Code auth, and measured User-Agent `1.4.11` / `cl=1010154931` match agy. Authorize URL includes `access_type=offline` and `prompt=consent` (unit test asserts both). Expiry skew is 10s (`EXPIRY_DELTA_MS`, golang.org/x/oauth2 default, binary `expiryDelta`). Claude on-disk credentials are not an Antigravity oauth dependency (NOT APPLICABLE). Ledger. 27 VERIFIED, 1 NOT APPLICABLE, 0 INCONCLUSIVE.

### pi-xai-oauth

Authorize URL, client id, scopes, referrer, and `GROK_CLIENT_VERSION` `1.0.70` match. Device verification host `accounts.x.ai` / path `/oauth2/device` is VERIFIED via `grok/fixtures/device-probe-1.0.70.json`. `src/login.ts` `DEVICE_HOST` still matches. No catalog edit without a live `/v1/models` body.

## Remaining non-goals

- Keychain / `.credentials.json` sync into Pi `auth.json`
- Claude loopback OAuth callback (copy-code only)
- Live Anthropic token exchange
- Claude context estimator UTF-16 (Pi uses UTF-8)
- Case-colliding tool names (known Pi OAuth rename limit)
- Grok live model catalog capture
- Optional agy keychain import and token-endpoint secret probe
