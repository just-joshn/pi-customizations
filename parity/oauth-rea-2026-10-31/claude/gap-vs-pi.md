# Gaps versus Pi anthropic oauth

Compared to `extensions/pi-anthropic-oauth/src/{auth,oauth,identity}.ts` and prior ledger notes. Claude reference. installed `2.1.312` sha256 `6b5ec691195e551b02c41df9f7d723f4ea61eaa03c2df90acefe3736f1aeb620`. Goal. 100% pi-native oauth+deps parity without spawning claude at runtime.

Status vocabulary. **VERIFIED** = measured Claude fact matched by Pi behavior or deliberate documented equivalent. **UNIT** = concrete pi-native implementation description (not started or partial). No gap is marked impossible.

## Ledger rows

| ID | Status | Claude 2.1.312 fact | Pi delta / unit |
| --- | --- | --- | --- |
| OAUTH-001 | VERIFIED | Bearer + `anthropic-beta` includes `oauth-2025-04-20`; no x-api-key in oauth mode | Keep |
| OAUTH-002 | VERIFIED | UA `claude-cli/2.1.312 (external, sdk-cli)` for SDK-shaped traffic | Extension pins version+entrypoint |
| OAUTH-003 | VERIFIED | Billing salt/indices; skip isMeta/isCompactSummary | `billingBlock` matches core form |
| OAUTH-004 | VERIFIED | anthropic-version / beta list from capture fixture 2.1.312 | Capture fixture in extension tests |
| OAUTH-005 | VERIFIED | Copy-code PKCE + independent state + exchange posts state | `src/oauth.ts` |
| OAUTH-006 | UNIT | Manual + loopback authorize URLs | Unit `oauth-loopback-listener`: bind ephemeral port, build `http://localhost:${port}/callback`, exchange with matching redirect when automatic; keep copy-code default |
| OAUTH-007 | VERIFIED | cai authorize + seven scopes incl. plugins | Owned in `src/oauth.ts` |
| OAUTH-008 | VERIFIED | Refresh Zxt scopes; absolute expiry; AA 5m check | Extension refresh + Pi resolver window |
| OAUTH-009 | VERIFIED | Ambient setup token | `CLAUDE_CODE_OAUTH_TOKEN` in ambient list |
| OAUTH-010 ambient | VERIFIED | AUTH_TOKEN before CLAUDE_CODE_OAUTH_TOKEN; no ANTHROPIC_OAUTH_TOKEN | Matches |
| OAUTH-010 dual-header | NOT APPLICABLE | Dual Bearer+x-api-key is API-key mode | Oauth-only provider rejects API keys |
| OAUTH-011 | UNIT | Specific exchange/refresh/revoked strings | Unit `oauth-error-text`: map 401 exchange to `Authentication failed: Invalid authorization code`; map refresh failures to Claude metric-backed messages; keep generic wrapper as default until enabled |
| OAUTH-012 | OUT OF BAND | Tool name collision | Not oauth wire. Track under tools ledger, not this unit |
| OAUTH-013..015 | VERIFIED | Streaming / request paths | No oauth protocol delta |
| OAUTH-016..019 | OUT OF BAND | Context / prompt / catalog | Outside oauth+deps |
| OAUTH-020 | UNIT | Keychain + `.credentials.json` `claudeAiOauth` layout | Unit `claude-credentials-import`: one-shot/opt-in reader. Prefer keychain on darwin (`security find-generic-password -s HW() -a iO()`), else plaintext `join(dN(),".credentials.json")`. Map fields into Pi `auth.json` oauth credential. Never read Claude binary. Pi store remains authoritative after import |
| OAUTH-021 | UNIT (gated, lever shipped) | Live exchange acceptance | Gate + env probe shipped (`src/oauth-live-gate.ts`, `scripts/oauth-live-exchange.ts`, `claude/gates.md`). CI stays on stubs. Live Anthropic HTTP 200 receipt still needs operator `status: approved` + `PI_ANTHROPIC_OAUTH_LIVE_EXCHANGE=1`. |
| OAUTH-022 | VERIFIED | Package lifecycle | N/A |
| OAUTH-023 | UNIT | Non-macOS storage | Same import unit: plaintext path is cross-platform; wincred/libsecret are optional backends mirroring Claude when those bunfs paths are carved later |
| OAUTH-024 | OUT OF BAND | Telemetry / plugins marketplace | Keep out |
| OAUTH-025 | UNIT | Terms / legal copy | Unit `oauth-login-copy`: optional notify strings from recovered paste prompts; no legal acceptance flow required for Pi |
| OAUTH-026 | VERIFIED | Auth token outranks setup token | Matches |
| DEP-PKCE | VERIFIED | node crypto PKCE | Matches |
| DEP-ALLOWED-BASES | UNIT | Custom URL allowlist P5e | Unit `oauth-custom-url-allowlist` (default off) |
| DEP-LATCH | UNIT | oauthRefreshLatch singleflight | Unit `oauth-refresh-singleflight` around refresh+401 retry |
| DEP-401 | UNIT | FE one-shot refresh retry | Wire into provider HTTP 401 handler calling Pi `oauth.refresh` once |
| DEP-REVOKE | UNIT | `${TOKEN_URL}/revoke` | Unit `oauth-revoke` on logout |
| DEP-PROFILE | UNIT | profile/validate/roles HTTP | Only if account sync is product-desired; not required for inference |

## Exact deltas still open in `extensions/pi-anthropic-oauth` (no extension edits this unit)

Ordered by **wire impact** (what Anthropic sees on the next request):

1. **401 refresh retry + singleflight** (`DEP-401` / `DEP-LATCH`). Without this, concurrent expired-token requests can stampede refresh or fail once where Claude recovers.
2. **Loopback callback** (`OAUTH-006`). Copy-code already works; loopback changes redirect_uri on the authorize+exchange pair when automatic.
3. **Billing optional suffixes** (low). Core `cc_version`+`cc_entrypoint` already match; gateway/project suffixes are Claude-host specific.
4. **Error string mapping** (`OAUTH-011`). Does not change grant success; improves operator UX only.
5. **Credentials import** (`OAUTH-020`). Offline convenience; zero wire impact after tokens are in Pi store.
6. **Revoke / profile HTTP** (`DEP-REVOKE` / `DEP-PROFILE`). Logout and account metadata only.
7. **Custom oauth URL allowlist** (`DEP-ALLOWED-BASES`). Irrelevant for prod cai.

## Closed this deepening pass

- `ALLOWED_OAUTH_BASE_URLS` membership recovered (`P5e`).
- PKCE library and helpers recovered (`crypto` + `b`/`L`/`O`/`y`).
- Paste `H()` grammar recovered (`code#state` only).
- Credentials JSON `claudeAiOauth` / `TA` merge fields recovered.
- Keychain service/account helpers recovered (`HW`/`iO`/`KPe`/`dN`).
- Refresh latch + FE 401 path recovered.
- `x-app: cli` confirmed for 2.1.312 via capture fixture + bunfs literal.
- Revoke endpoint recovered.
- Every prior "impossible"/"won't" framing replaced with a named pi-native unit.

## Top gaps by wire impact

1. 401 refresh retry + in-process singleflight.
2. Optional loopback redirect pair.
3. Optional Claude error-string mapping (UX).
4. Optional credentials import (local only).
5. Optional revoke/profile helpers.
