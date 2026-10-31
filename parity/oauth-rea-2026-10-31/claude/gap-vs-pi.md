# Gaps versus Pi anthropic oauth

Compared to `parity/pi-anthropic-oauth/ledger.json` and `extensions/pi-anthropic-oauth/src/{auth,identity}.ts` plus Pi builtin `dist/auth/oauth/anthropic.js` (copied as `pi-anthropic-oauth-builtin.js`). Goal. 100% pi-native parity without depending on the claude binary at runtime.

Claude reference. installed `2.1.312`. Extension identity pins `2.1.312`.

## Ledger rows

| ID | Ledger status | Claude 2.1.312 fact | Pi / extension delta for 100% |
| --- | --- | --- | --- |
| OAUTH-001 | VERIFIED | OAuth path sends Bearer + `anthropic-beta: oauth-2025-04-20`, no x-api-key when `kt()` oauth mode | Keep. Dual-header API-key case stays OAUTH-010. |
| OAUTH-002 | VERIFIED | UA template `claude-cli/${VERSION} (external, ${entrypoint})`. Version in binary is `2.1.312` | Extension pins `2.1.312` with captured fixture `claude-code-2.1.312.json`. |
| OAUTH-003 | VERIFIED | Fingerprint salt `59cf53e54c78`, indices `[4,7,20]`, bunfs `qf`/`dH`. First user skips `isMeta` | Extension matches salt/indices/version. Skips duck-typed `isMeta` and `isCompactSummary` user messages. Optional suffixes (`cc_prev_req`, gateway, project) stay Claude-only. |
| OAUTH-004 | VERIFIED | Not re-checked this session | No new oauth delta. |
| OAUTH-005 | VERIFIED (local stub) | Copy-code authorize + PKCE + exchange recovered. State is independent of verifier | Extension `src/oauth.ts` uses independent `state`. Exchange posts that state. Persistence stays Pi store (OAUTH-020). |
| OAUTH-006 | NATIVE DIFFERENCE | Claude builds both manual and loopback URLs. Subscription probe printed manual redirect | Extension copy-code only. Loopback remains optional Claude path, not required for `--claudeai` print parity. |
| OAUTH-007 | VERIFIED (local) | cai authorize + seven scopes including `user:plugins` confirmed on 2.1.312 probe and bunfs | Extension owns cai URL + plugins scope in `src/oauth.ts`. No longer depends on rewriting Pi builtin authorize. |
| OAUTH-008 | VERIFIED (local stub) | Refresh posts `scope: Zxt().join(" ")` (no `org:create_api_key`). Store expiry without skew. Refresh when `now+300000>=expiresAt` | Extension refresh POST includes Zxt scopes. Stores absolute expiry; Pi resolver still refreshes ~5m early. |
| OAUTH-009 | VERIFIED | Ambient setup token path still present | Keep. |
| OAUTH-010 ambient | VERIFIED | `ha` prefers `ANTHROPIC_AUTH_TOKEN` over `CLAUDE_CODE_OAUTH_TOKEN`. `ANTHROPIC_OAUTH_TOKEN` absent in bunfs | Extension order matches. Alias removed. |
| OAUTH-010 dual-header | NOT APPLICABLE | Dual Bearer+x-api-key is Claude API-key mode | This provider is oauth-only and rejects API keys. |
| OAUTH-011 | INCONCLUSIVE | Exchange 401 message and refresh error strings recovered | Extension wraps errors into generic messages. Claude wording differs. |
| OAUTH-012 | NOT VERIFIED | Tool collision outside oauth protocol | Unchanged known Pi limitation. |
| OAUTH-013..015 | VERIFIED | Streaming / paths | No oauth protocol delta. |
| OAUTH-016..017 | NOT VERIFIED | Context accounting | Outside oauth protocol. |
| OAUTH-018..019 | NOT VERIFIED | Prompt / catalog | Outside oauth protocol. |
| OAUTH-020 | NOT VERIFIED | Keychain + `.credentials.json` under config dir | Deliberate. Pi `auth.json` stays authoritative. Documented non-goal unless sync is requested. |
| OAUTH-021 | INCONCLUSIVE | No live exchange | Still blocked by policy. |
| OAUTH-022 | VERIFIED | Package lifecycle | N/A. |
| OAUTH-023 | INCONCLUSIVE | macOS RE only | Linux/Windows storage still unknown. |
| OAUTH-024 | N/A | Telemetry / plugins | Keep out of scope. |
| OAUTH-025 | INCONCLUSIVE | Terms | Unchanged. |
| OAUTH-026 | VERIFIED | Auth token outranks setup token in `ha` | Extension order already matches. |

## Exact deltas in `extensions/pi-anthropic-oauth/src`

### `src/auth.ts` / `src/oauth.ts`

1. **Authorize.** Extension owns cai authorize, seven login scopes, and copy-code redirect in `src/oauth.ts`.
2. **State vs PKCE.** Independent `state` and exchange body match Claude.
3. **Refresh `scope`.** Refresh POST includes Zxt scopes. Absolute expiry store; Pi refresh window supplies the 5m buffer.
4. **`ANTHROPIC_OAUTH_TOKEN`.** Removed from ambient resolution.
5. **API key dual-header / API-key preference.** Not applicable. This subscription provider is oauth-only and rejects API keys. Claude's dual Bearer+x-api-key path is API-key mode.
6. **Error text.** Extension sanitizes. Claude returns more specific exchange/refresh strings.
7. **Storage.** Extension never reads Keychain / `.credentials.json`. Deliberate.
8. **Loopback callback.** Not implemented. Copy-code only.

### `src/identity.ts`

1. **Version.** `2.1.312` matches binary and capture.
2. **Fingerprint core.** Salt and indices match bunfs. Good.
3. **`isMeta` skip.** Extension skips duck-typed `isMeta` and `isCompactSummary` user messages, matching Claude `dH` plus Elt compact skip.
4. **Billing suffixes.** Claude may append first-party / gateway / project fields. Extension emits the short `cc_version` + `cc_entrypoint` form only.
5. **UA entrypoint.** Fixture assumes `sdk-cli`. Extension hardcodes that UA string. Claude derives entrypoint from env. Fine for Pi SDK-shaped traffic if left pinned.

### Pi builtin `anthropic.js` (not used by this package for OAuth)

The extension no longer wraps builtin Anthropic OAuth. Upstream Pi still differs on cai URL, plugins scope, independent state, refresh `scope`, and store-time skew. Those gaps matter only for Pi's own `anthropic` provider, not `claude-subscription`.

## Top gaps for pi-anthropic-oauth (priority)

1. Optional. Keychain / `.credentials.json` import (only if sharing is desired).
2. Optional. Loopback callback alongside copy-code.
3. Live exchange / 401 recovery still unverified against Anthropic (policy).
4. Closed this unit. `isMeta`/`isCompactSummary` billing skip, OAUTH-010 ambient VERIFIED, dual-header NOT APPLICABLE, independent OAuth `state`, Zxt refresh scope, cai authorize + plugins, drop `ANTHROPIC_OAUTH_TOKEN`, absolute expiry store.
