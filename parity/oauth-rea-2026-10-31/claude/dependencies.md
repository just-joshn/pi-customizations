# Claude Code 2.1.312 OAuth dependencies

Behaviors the OAuth subscription path depends on. Evidence is bunfs file offsets unless noted.

## Request identity headers

**User-Agent (API).** `u$` builds:

`claude-cli/${VERSION} (external, ${entrypoint}${agent-sdk?}${client-app?}${workload?})`

Default entrypoint is `cli` from `CLAUDE_CODE_ENTRYPOINT` / `ine()`. SDK captures use `sdk-cli`, producing `claude-cli/2.1.312 (external, sdk-cli)`.

Evidence. `u$` at `220841200`. Version constant `2.1.312` in the same region. Fixture `fixtures/identity-headers-2.1.312.json` documents the prior `2.1.311` capture shape.

**Separate UA.** `Gs()` returns `claude-code/${VERSION}` for some non-Messages calls (profile, validate). Evidence. `217008540`.

**Billing header.** `U9o` builds a system text block:

`x-anthropic-billing-header: cc_version=${VERSION}.${fingerprint}; cc_entrypoint=${entrypoint};` plus optional first-party / gateway suffixes (`cch`, `cc_workload`, `cc_is_subagent`, `cc_prev_req`, `cc_prompt_id`, `cc_turn_origin`, indices, gateway, project).

Fingerprint. `qf(text, VERSION)` with salt `59cf53e54c78`, indices `[4,7,20]`, `sha256` hex slice first 3 chars. First non-meta user text via `dH`.

Evidence. fingerprint at `225802147`. `U9o` at `221569559`.

**OAuth beta header value.** `bu = "oauth-2025-04-20"` attached as `anthropic-beta` on Bearer oauth requests from `jX` / `kt` path.

Evidence. `217349591`, `220842900`.

**x-app.** Not recovered as a string assignment in the oauth header builders above. Prior capture fixture has `x-app: cli`. Treat fixture as measured for Messages SDK path. Label. measured historically for 2.1.311, not re-captured for 2.1.312 in this session.

## Ambient env vars

Token / auth related names recovered in bunfs:

- `ANTHROPIC_AUTH_TOKEN` (Bearer ambient)
- `CLAUDE_CODE_OAUTH_TOKEN` (setup / oauth ambient)
- `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`
- `ANTHROPIC_API_KEY`
- `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_ENTRYPOINT_ON_REQUESTS`
- `CLAUDE_AGENT_SDK_VERSION` / `CLAUDE_AGENT_SDK_CLIENT_APP`
- `CLAUDE_CONFIG_DIR` / `CLAUDE_SECURESTORAGE_CONFIG_DIR`
- Local oauth overrides. `CLAUDE_LOCAL_OAUTH_*`, `CLAUDE_CODE_CUSTOM_OAUTH_URL`
- Gateway / WIF names appear adjacent. Out of core subscription oauth scope.

`ANTHROPIC_OAUTH_TOKEN` has **no** bunfs hit in the 216MB+ JS region. Matches prior probe that Claude ignores it.

Evidence. `ha` at `220764893`. Env export cluster near `217380418`. String search for `ANTHROPIC_OAUTH_TOKEN` miss in bunfs region.

## Credential precedence (auth source)

`ha()` order (subscription token source):

1. Special `cW()` / apiKeyHelper gate
2. `ANTHROPIC_AUTH_TOKEN` (unless `Mbe()` blocks)
3. `CLAUDE_CODE_OAUTH_TOKEN` or fd helper `o0()`
4. CCR / fd oauth file sources
5. `apiKeyHelper`
6. profile
7. stored claude.ai oauth (`Fn()` with inference scope + accessToken)
8. none

`ST()` resolves API keys separately (`ANTHROPIC_API_KEY`, helpers, approved key cache).

**Dual headers.** At least one request path builds:

`{ ...(bearer && {Authorization: Bearer ...}), ...(apiKey && {"x-api-key": ...}), "anthropic-version", "User-Agent": Gs() }`

So Bearer and `x-api-key` can both be present when both values exist.

Evidence. `ha` `220764893`. Dual merge `220650343`. Prior print-mode matrix in `parity/pi-anthropic-oauth/fixtures/credential-precedence.json` (version 2.1.296) still matches this code shape. Not re-probed live on 2.1.312.

## Token storage

**Config dir.** `Le()` = `(CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")).normalize("NFC")`.

**Secure storage dir.** `dN()` prefers `CLAUDE_SECURESTORAGE_CONFIG_DIR`, else `Le()`.

**Plaintext fallback file.** `join(dN(), ".credentials.json")` with warning `"Warning: Storing credentials in plaintext."`.

**macOS Keychain.**

- Service. `Claude Code${OAUTH_FILE_SUFFIX}${suffix}${optional -sha256(configDir)[0:8]}` with default suffix `-credentials` (`KPe`).
- Account. sanitized `USER` / os username, else `claude-code-user`.
- Commands. `security find-generic-password`, `add-generic-password`, `delete-generic-password`.

Evidence. `dN`/`HW`/`iO` at `220051483`. credentials path helper at `220061486`.

Stored oauth fields referenced. `accessToken`, `refreshToken`, `expiresAt`, `scopes`, plus `oauthAccount` profile metadata.

## Refresh lock

Refresh acquires a lock under the claude config dir (`api` / lockfile). Contended lock (`ELOCKED`) retries up to 5 times with `1000 + random*1000` ms delay. Telemetry names include `tengu_oauth_token_refresh_lock_*`, race recovery, compromised lock, invalid-scope fallback.

In-process latch. `oauthRefreshLatch` gates forced 401 refresh so concurrent callers share one attempt.

Evidence. refresh body `220813447`. latch / `FE` wrapper `220844698` / `220842900`.

## 401 recovery

`FE` wraps axios calls. On HTTP 401 (or 403 with body containing `OAuth token has been revoked` when enabled):

1. If gated to session oauth credential, compare tokens, run forced refresh via `ck`, retry once.
2. Else if an access token exists, refresh and retry.

Revoked oauth detection also appears as `u9` for Anthropic SDK errors (`status===401` message contains `OAuth access token has been revoked`).

Evidence. `FE` at `220842900`. `u9` near `220066439`.

## Setup token

`setup-token` CLI surface and `SETUP_TOKEN_DEFAULT_EXPIRY_DAYS` export exist. Ambient `CLAUDE_CODE_OAUTH_TOKEN` is accepted as oauth_token without writing into storage (prior verified probe). Not re-executed this session.

Evidence. export name `98549560`. Prior `parity/pi-anthropic-oauth` OAUTH-009.

## Version stamp in binary

Embedded package metadata. `VERSION: "2.1.312"`, `BUILD_TIME: "2026-10-27T16:53:02Z"`, `GIT_SHA: "f375cd85d4f70920de17ce3a4ad646e18834e833"`.

Evidence. repeated object literal near `221569559`.
