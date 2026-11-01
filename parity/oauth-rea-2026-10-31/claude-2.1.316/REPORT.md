# Claude Code 2.1.316 OAuth report

User goal. Comprehensive reverse engineering of Claude Code CLI OAuth and its oauth dependencies for installed `2.1.316`, then a concrete Pi-native parity gap list with no "impossible" rows and no runtime `claude` dependency.

## Target identity (VERIFIED)

| Field | Value |
| --- | --- |
| Path | `/Users/josh-desktop/.local/share/claude/versions/2.1.316` |
| Symlink | `/Users/josh-desktop/.local/bin/claude` |
| sha256 | `64c327e92b2c5e0f78c0a980c5a518121e1f0d140ca771ca5dd4488d1a2dcb3f` |
| Size | 310114176 bytes |
| Format | Mach-O 64-bit arm64 (Bun SEA) |
| Mach-O UUID | `4C4C448E-5555-3144-A1C7-456A93B4DC4F` |
| VERSION const | `2.1.316` |
| BUILD_TIME | `2026-10-30T23:28:13Z` |
| GIT_SHA | `cd7ceb459c6864567b16a11f60101b24421475c1` |

REA. `open_binary` matched sha256. `inspect_macho` parent `ev_1780f897cd8420a45521c14364214c664b1392075868f4db73d8dddfac312c36` (summary view `ev_311291cf1a6472290976a3eff220b454fc3d5f68a610dd5932b2e40a36abf68c`). Carved JS directory `analyze_javascript_application` parent `ev_d7c5e4394f965167dcc5503d39f1995dcec33e7691ae2adb4d26ad9f10cd4195` (summary `ev_4b4bcac5eaf854ccb73ce8eb3387be1b845c629f77268f9f14278a62a88a1815`). SEA JS is not unpacked by REA `extract_artifact`; facts below are from offline bunfs string carves under `carves/` plus selected module extracts in `extracted-js/`.

Method lever. `scripts/carve-oauth.mjs` + tight window carves. Marker index. `string-offsets.json`.

## OAuth wire facts (VERIFIED on 2.1.316)

**Authorize.** cai `https://claude.com/cai/oauth/authorize` when `loginWithClaudeAi`; else console `https://platform.claude.com/oauth/authorize`. Builder `Vto` append order. `code=true`, `client_id`, `response_type=code`, `redirect_uri`, `scope`, `code_challenge`, `code_challenge_method=S256`, `state`, optional `orgUUID` / `login_hint` / `login_method`.

**Client id.** Prod `9d1c250a-e61b-44d9-88ed-5944d1962f5e`. Design `59637612-477b-4836-a601-b0589eda7704`. Local `22422756-60c9-4084-8eb7-27705fd5cf9a`.

**Scopes.** Login `hco()` = `org:create_api_key` + `m0t()`. Refresh default `m0t()` omits org. Plugins included when `PLUGINS_SCOPE_REGISTERED` (prod true).

**Redirect.** Manual `https://platform.claude.com/oauth/code/callback`. Loopback `http://localhost:${port}/callback`. `$B` always builds manual; loopback when listener binds; exchange `useManualRedirect:!automatic`.

**PKCE.** `crypto` `createHash`/`randomBytes`. Helpers `b`/`L`/`O`/`y`. State is a second independent `b(E(32))`.

**Token.** `POST https://platform.claude.com/v1/oauth/token` JSON, 30s. Auth code body includes `state` + `code_verifier`. Refresh body includes space-joined `m0t()` scopes. Revoke `POST ${TOKEN_URL}/revoke` 5s with `token` / `token_type_hint` / `client_id`; 2xx counted only when Anthropic `request-id` present.

**Expiry.** Store `Date.now()+expires_in*1000`. Proactive `gR`: `now+300000>=expiresAt`. Refresh latch `oauthRefreshLatch.attempted` + shared forced refresh inside FE 401 (and optional 403 revoked) wrapper.

**Ambient env.** `ua()` prefers `ANTHROPIC_AUTH_TOKEN` then `CLAUDE_CODE_OAUTH_TOKEN`. `ANTHROPIC_OAUTH_TOKEN` count in binary = 0.

**Credentials.** `.credentials.json` `claudeAiOauth` fields + `oauthAccount`. Darwin keychain service `Claude Code` + suffix + optional dir hash. Mode 384 after plaintext write.

**Identity.** UA `claude-cli/2.1.316 (external, …)`. Messages `x-app` via `Fl()` = `$t()?"cli-bg":"cli"`. Billing salt `59cf53e54c78`, indices `[4,7,20]`, sample first `user && !isMeta` (not `isCompactSummary`). Beta `oauth-2025-04-20`.

**ALLOWED_OAUTH_BASE_URLS (`_Ye`).** beacon staging, fedstart, fedstart staging. Miss throws approved-endpoint error.

**Errors.** Exchange 401 string, paste `H()` messages, custom URL miss, revoked body phrases. Fixtures under `fixtures/*-2.1.316.json`.

## Dependencies ledger (every oauth dep)

| ID | Role | Status |
| --- | --- | --- |
| DEP-PKCE-CRYPTO | `crypto` PKCE helpers | VERIFIED |
| DEP-AUTHORIZE-VTO | Authorize URL builder | VERIFIED |
| DEP-SCOPES-HCO-M0T | Login/refresh scopes | VERIFIED |
| DEP-TOKEN-KSS | Auth code exchange | VERIFIED |
| DEP-TOKEN-XAE | Refresh grant | VERIFIED |
| DEP-REVOKE-XAN | Token revoke | VERIFIED |
| DEP-EXPIRY-GR | 5m proactive refresh | VERIFIED |
| DEP-STATE-PASTE-H | Paste `code#state` | VERIFIED |
| DEP-LOGIN-CLASS-$B | Manual+loopback login | VERIFIED |
| DEP-ALLOWED-_Ye | Custom URL allowlist | VERIFIED |
| DEP-UA / DEP-XAPP-Fl | Request identity | VERIFIED |
| DEP-BILLING-Lf | Fingerprint header | VERIFIED |
| DEP-ENV-UA | Ambient token precedence | VERIFIED |
| DEP-STORAGE / DEP-KEYCHAIN | Cred JSON + keychain | VERIFIED |
| DEP-LATCH / DEP-401-FE | Singleflight + 401 retry | VERIFIED |
| DEP-PROFILE-HTTP | profile/validate/roles | VERIFIED present |

## Diff vs 2.1.312

See `delta-vs-2.1.312.md`. Prod oauth config object bytes match. Wire constants match. Version/UA/billing digits and bunfs offsets change. Minified names rename.

## Pi gap

See `gap-vs-pi.md`. Remaining UNITs only, ordered by wire impact. No impossible rows. No edits under `extensions/`.
