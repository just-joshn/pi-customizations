# Claude Code 2.1.312 OAuth dependency ledger

Every row is either **VERIFIED** against bunfs/REA evidence for binary sha256 `6b5ec691195e551b02c41df9f7d723f4ea61eaa03c2df90acefe3736f1aeb620`, or names a concrete **pi-native implementation unit** (no runtime claude/agy/grok dependency).

REA receipts. Mach-O `ev_a0dbfded35ee358702abf318c766830ab52646626260ef56f4a2422fb4e81a59`. Carved JS graph summary `ev_06a800b189d56b1b0f44ad163095500cc968f12b88a268c4cae061317b08878a`. `extract_artifact` unsupported for Mach-O SEA; modules carved to `extracted-js/` under `/$bunfs/` naming.

## Ledger

| Dep ID | Surface | Status | Measured fact | Evidence | Pi-native path |
| --- | --- | --- | --- | --- | --- |
| DEP-PKCE-CRYPTO | PKCE lib | VERIFIED | `import{createHash as T,randomBytes as E}from"crypto"`; helpers `b`/`L`/`O`/`y` at `221657206` | `carves/tight-pkce_helpers@221657206.txt`; `fixtures/pkce-2.1.312.json`; module sha `586516f2…` | Extension already uses `node:crypto` `randomBytes`+`createHash`+base64url in `src/oauth.ts` |
| DEP-AUTHORIZE-Y9R | Authorize builder | VERIFIED | `Y9r` append order + cai/console URL pick + optional orgUUID/login_hint/login_method | `carves/tight-Y9r_full@220544799.txt`; `fixtures/authorize-url-2.1.312.json` | `buildAuthorizeUrl` in `src/oauth.ts` owns cai path + order |
| DEP-SCOPES-GTO-ZXT | Scope sets | VERIFIED | `gto` login = org:create_api_key + Zxt; Zxt omits org; plugins gated by `PLUGINS_SCOPE_REGISTERED` | `carves/tight-bu_beta_scopes@217349591.txt` | `CLAUDE_LOGIN_SCOPES` / `CLAUDE_REFRESH_SCOPES` constants |
| DEP-TOKEN-EXCHANGE | Auth code POST | VERIFIED | JSON body fields + 30s timeout + 401 string | `carves/tight-tXo_exchange@220545650.txt` | `postToken` in `src/oauth.ts` |
| DEP-TOKEN-REFRESH | Refresh POST | VERIFIED | refresh_token grant + Zxt scope + absolute expiry store + refreshTokenExpiresAt via `q9r` | `carves/tight-eie_refresh@220546563.txt`; `fixtures/refresh-lifecycle-2.1.312.json` | Extension refresh POST includes Zxt scope; stores `Date.now()+expires_in*1000` |
| DEP-EXPIRY-AA | Proactive refresh | VERIFIED | `AA`: `now+300000>=expiresAt` | `carves/tight-AA_body@220551392.txt` | Pi credential resolver refresh window (~5m); keep absolute store |
| DEP-STATE-PASTE | Paste parser | VERIFIED | TTY `H()` requires `code#state`; rejects mismatch | `carves/tight-paste-H-fn.txt`; `fixtures/paste-code-parser-2.1.312.json` | Extension accepts URL/`code#state`/raw (superset). Unit: optional strict mode matching `H()` only |
| DEP-LOOPBACK | Local callback | VERIFIED (Claude) | Builds loopback authorize URL when listener binds; exchange flips `useManualRedirect` | `o$` / `waitForAuthorizationCode` in pkce module | Pi unit `oauth-loopback-listener`: optional `http://localhost:${port}/callback` beside copy-code |
| DEP-BETA-HEADER | oauth beta | VERIFIED | `bu="oauth-2025-04-20"` on Bearer oauth requests | offset `217349827`; fixture identity headers | Extension / Messages path already sends `oauth-2025-04-20` in beta list |
| DEP-UA-U$ | API User-Agent | VERIFIED | `claude-cli/${VERSION} (external, ${entrypoint}…)` version `2.1.312` | `carves/dep-u$_ua@220484240.txt`; capture fixture | `CLAUDE_USER_AGENT` pinned `sdk-cli` in `src/identity.ts` |
| DEP-UA-GS | Alt UA | VERIFIED | `Gs()` = `claude-code/${VERSION}` for some non-Messages oauth HTTP | offset `217008561` | Pi unit `oauth-profile-ua`: use `claude-code/2.1.312` only on profile/validate/revoke helpers if those calls are added |
| DEP-X-APP | x-app header | VERIFIED | Literal `"x-app":"cli"` at `257862762`; Messages capture has `x-app: cli` for 2.1.312 | `fixtures/identity-headers-2.1.312.json`; extension fixture `claude-code-2.1.312.json` | Already set on subscription Messages path |
| DEP-BILLING | Billing header | VERIFIED | salt `59cf53e54c78`, indices `[4,7,20]`, skip meta/compact; short form `cc_version`+`cc_entrypoint` | fingerprint `225802147`; `U9o` `221569559` | `billingBlock` in `src/identity.ts`. Optional suffixes are Claude-only; wire-core form matches |
| DEP-ENV-PRECEDENCE | Ambient auth | VERIFIED | `ha()`: AUTH_TOKEN before CLAUDE_CODE_OAUTH_TOKEN; no `ANTHROPIC_OAUTH_TOKEN` string in bunfs | `carves/dep-ha_auth_source@217380443.txt`; prior fact carves | `subscriptionAuth` ambient order matches; alias absent |
| DEP-ENV-CONFIG | Config/env knobs | VERIFIED | `CLAUDE_CONFIG_DIR`, `CLAUDE_SECURESTORAGE_CONFIG_DIR`, `CLAUDE_CODE_ENTRYPOINT*`, `CLAUDE_CODE_CUSTOM_OAUTH_URL`, `CLAUDE_CODE_OAUTH_CLIENT_ID`, `CLAUDE_LOCAL_OAUTH_*`, `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` | config module carve sha `8b63c367…` | Pi reads only the ambient token vars today. Unit `oauth-env-parity`: document/ignore Claude-local override envs (not required for prod cai) |
| DEP-ALLOWED-BASES | Custom URL allowlist | VERIFIED | `P5e` three staging/fedstart URLs; gates `CLAUDE_CODE_CUSTOM_OAUTH_URL` | `fixtures/allowed-oauth-bases-2.1.312.json` | Unit `oauth-custom-url-allowlist`: same three hosts if Pi ever supports custom oauth URL (default off) |
| DEP-STORAGE-PATHS | Cred paths | VERIFIED | `dN`/`Le`; plaintext `join(dN(),".credentials.json")` mode `384`; warning string | `carves/tight-credentials_store_fields@220061486.txt`; `fixtures/credentials-layout-2.1.312.json` | Pi `auth.json` stays authoritative. Unit `claude-credentials-import` (optional) |
| DEP-KEYCHAIN | macOS keychain | VERIFIED | Service `Claude Code${suffix}${optional -sha256(dir)[0:8]}`; account sanitized USER; `security find/add/delete-generic-password` | `carves/tight-keychain_HW_iO@220051483.txt` | Same import unit; darwin-only subprocess, never required at runtime for Pi store |
| DEP-CRED-JSON | JSON layout | VERIFIED | Root `claudeAiOauth` via `TA`: accessToken, refreshToken, expiresAt, refreshTokenExpiresAt?, scopes, subscriptionType*, rateLimitTier, clientId; sibling `oauthAccount` | `carves/tight-TA-merge@220790005.txt` | Import maps `claudeAiOauth.{accessToken,refreshToken,expiresAt}` into Pi `OAuthCredential` |
| DEP-REFRESH-LATCH | In-process latch | VERIFIED | `oauthRefreshLatch.attempted` + `Nqt` shared forced refresh inside `FE` 401 wrapper | `carves/dep-oauthRefreshLatch@220844698.txt`; `carves/tight-Nqt_latch@220843922.txt` | Unit `oauth-refresh-singleflight`: Promise latch per credential key around `refresh()` so concurrent 401s share one POST |
| DEP-REFRESH-LOCK | File lock | VERIFIED | Contended `ELOCKED` retries ≤5 with `1000+random*1000` ms; tengu lock telemetry names | `carves/dep-ELOCKED@218973584.txt`; lock strings at `95608436` | Unit `oauth-refresh-file-lock` optional for multi-process Pi; singleflight covers in-process |
| DEP-401-FE | 401 recovery | VERIFIED | `FE` retries once after `ck` forced refresh on 401 (and 403 revoked body when enabled) | `carves/tight-FE_401@220842900.txt`; `carves/tight-ck_forced_refresh@220802281.txt` | Pi provider stream/error path: on HTTP 401 with oauth cred, call `refresh` once and retry request |
| DEP-ERROR-STRINGS | Error text | VERIFIED | Exchange 401 / refresh invalid_grant metrics / revoked phrases recovered | carves listed above | Unit `oauth-error-text`: optional map to Claude strings; current generic wrappers remain safe default |
| DEP-PROFILE-HTTP | Profile/validate/roles | VERIFIED | URLs present; Bearer + sometimes `Gs()` UA | `carves/tight-profile_validate@220541816.txt`; oauth-config fixture | Unit `oauth-adjacent-http`: implement only if Pi needs account/profile sync; not required for Messages inference |
| DEP-REVOKE | Token revoke | VERIFIED | `POST ${TOKEN_URL}/revoke` | near `220548305` | Unit `oauth-revoke`: call on `/logout` if product wants server-side revoke |
| DEP-SETUP-TOKEN | Setup token | VERIFIED | Ambient `CLAUDE_CODE_OAUTH_TOKEN` + `SETUP_TOKEN_DEFAULT_EXPIRY_DAYS` export | export `244131897` region | Already handled as ambient apiKey-shaped oauth access token |
| DEP-VERSION-STAMP | Version | VERIFIED | `VERSION: "2.1.312"`, `BUILD_TIME: "2026-10-27T16:53:02Z"`, `GIT_SHA: "f375cd85…"` | identity / billing region | Pin `CLAUDE_CODE_VERSION` |

## Request identity headers (detail)

**User-Agent (API).** `u$` builds `claude-cli/${VERSION} (external, ${entrypoint}${…})`. Default entrypoint `cli`; SDK captures use `sdk-cli`.

**Billing.** `U9o` system text `x-anthropic-billing-header: cc_version=${VERSION}.${fingerprint}; cc_entrypoint=${entrypoint};` plus optional Claude-only suffixes. Fingerprint `qf`/`dH` with salt `59cf53e54c78`, indices `[4,7,20]`.

**OAuth beta.** `bu = "oauth-2025-04-20"` as `anthropic-beta` member on Bearer oauth traffic.

**x-app.** `"cli"` on Messages path (fixture + bunfs literal).

## Credential precedence (detail)

`ha()` subscription source order:

1. Special `cW()` / apiKeyHelper gate
2. `ANTHROPIC_AUTH_TOKEN` (unless blocked)
3. `CLAUDE_CODE_OAUTH_TOKEN` or fd helper
4. CCR / fd oauth file sources
5. `apiKeyHelper`
6. profile
7. stored `claudeAiOauth` (`Fn()` with inference scope + accessToken)
8. none

Dual Bearer + `x-api-key` exists on API-key mode paths. Subscription oauth-only Pi provider rejects API keys (NOT APPLICABLE for wire oauth mode).

## Token storage (detail)

- Config dir `Le()` = `(CLAUDE_CONFIG_DIR ?? ~/.claude).normalize("NFC")`
- Secure dir `dN()` prefers `CLAUDE_SECURESTORAGE_CONFIG_DIR`
- Plaintext fallback `.credentials.json` mode `0o600`
- Keychain service `HW()` = `Claude Code${OAUTH_FILE_SUFFIX}${e}${optional -sha256(dir)[0:8]}` with default suffix const `KPe="-credentials"`
- Account `iO()` sanitized username

## Refresh concurrency (detail)

1. Cross-process lockfile under config dir (ELOCKED backoff).
2. In-process `oauthRefreshLatch` for forced 401 refresh singleflight.
3. CAS-style save into `claudeAiOauth` with sibling-adoption telemetry (`tengu_oauth_refresh_*`).

Pi needs (1) optional, (2) for parity under concurrent requests, (3) replaced by Pi store atomic write.
