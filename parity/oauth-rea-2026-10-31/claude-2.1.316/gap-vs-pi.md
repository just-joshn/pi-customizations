# Gaps versus Pi anthropic oauth (after 2.1.316 RE)

Compared read-only to current `extensions/pi-anthropic-oauth/src/**`. Claude reference. installed `2.1.316` sha256 `64c327e92b2c5e0f78c0a980c5a518121e1f0d140ca771ca5dd4488d1a2dcb3f`. Goal. 100% pi-native oauth+deps parity without spawning `claude`.

Status. **VERIFIED** = Pi already matches the measured Claude fact (or a deliberate documented equivalent). **UNIT** = concrete remaining pi-native work with file-level fix path. Zero impossible rows.

## Already matched (closed vs prior 2.1.312 gap ledger)

| ID | Claude fact | Pi location |
| --- | --- | --- |
| OAUTH-005/007 | cai PKCE + scopes + state | `src/oauth.ts` |
| OAUTH-006 | Loopback `http://localhost:${port}/callback` | `src/oauth.ts` `loginLoopback` |
| OAUTH-010 ambient | AUTH_TOKEN then CLAUDE_CODE_OAUTH_TOKEN | `src/auth.ts` |
| DEP-PKCE | node crypto PKCE | `src/oauth.ts` |
| DEP-LATCH / DEP-401 | In-process singleflight + one 401 retry | `src/refresh-latch.ts`, `src/auth-recovery.ts`, wired in `src/index.ts` |
| OAUTH-020 | Keychain / `.credentials.json` import | `src/claude-credentials.ts` + login import option |

## Remaining UNITs only (ordered by wire impact)

1. **UNIT `identity-version-2.1.316` (wire).** Pin `CLAUDE_CODE_VERSION` / UA / billing fingerprint version from `2.1.312` to `2.1.316` in `src/identity.ts` (and any test fixtures that assert the digit string). Claude now emits `claude-cli/2.1.316` and `cc_version=2.1.316.<fp>`. Highest Anthropic-visible drift today.

2. **UNIT `billing-sample-isMeta-only` (wire, conditional).** Claude `nF`/`dH` selects first `type==="user" && !isMeta` and does **not** skip `isCompactSummary`. Pi `fingerprintSample` in `src/identity.ts` also skips `isCompactSummary`. Align to Claude (`!isMeta` only) so fingerprint matches when the first user turn is a compact summary. Low frequency, still changes `cc_version` when it hits.

3. **UNIT `oauth-error-text` (UX, non-grant).** Map exchange 401 to `Authentication failed: Invalid authorization code` and refresh failures closer to Claude metric-backed strings in `src/oauth.ts` / `src/auth.ts` wrappers. Does not change successful grant bodies.

4. **UNIT `oauth-revoke` (logout only).** Implement `POST ${TOKEN_URL}/revoke` with JSON `{token, token_type_hint, client_id}`, 5s timeout, and optional request-id ack gate; call from logout path in `src/oauth.ts` or a small `src/revoke.ts`. Zero impact on inference requests.

5. **UNIT `oauth-refresh-token-expires-at` (local store).** Optionally persist Claude's `refreshTokenExpiresAt` (`zto`) alongside Pi `expires` in credential mapping (`src/oauth.ts` / `src/claude-credentials.ts`). Not sent on Messages requests.

6. **UNIT `oauth-custom-url-allowlist` (non-prod).** Gate `CLAUDE_CODE_CUSTOM_OAUTH_URL` against the three `_Ye` bases if Pi ever grows custom-base support. Irrelevant for prod cai.

7. **UNIT `oauth-paste-strict-H` (optional).** Offer a strict paste mode matching Claude `H()` (`code#state` only) beside the current URL/raw superset in `src/oauth.ts` `parseAuthorizationInput`.

8. **UNIT `oauth-adjacent-http` (optional product).** profile / validate / roles / create_api_key helpers. Not required for Messages inference.

9. **UNIT `x-app-cli-bg` (optional).** Claude Messages helper `Fl()` may emit `cli-bg` when `$t()` is true. Pi sdk-cli path correctly stays `cli`. Only needed if Pi grows a background agent entrypoint that must match Claude's bg header.

## Explicit non-gaps

- Dual Bearer+x-api-key is API-key mode. Oauth-only Pi provider correctly rejects API keys.
- File-lock `ELOCKED` multi-process refresh is optional once in-process latch exists.
- No remaining "spawn claude binary" unit. All above are pi-native.
