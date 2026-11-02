# Remaining oauth+deps parity units

Date. 2026-11-01. Repo tree read against main at `2e8866c0` (PRs 105–119). No extension edits in this unit.

Goal. Bring `pi-anthropic-oauth`, `pi-antigravity-oauth`, and `pi-xai-oauth` to 100% oauth+deps parity with Claude Code / Antigravity (`agy`) / Grok Build using Pi-native code only (no runtime CLI).

Installed references at audit time.

- Claude Code `2.1.316` at `~/.local/share/claude/versions/2.1.316` (sha256 `64c327e92b2c5e0f78c0a980c5a518121e1f0d140ca771ca5dd4488d1a2dcb3f`). Pi pins `2.1.316` (PR #115).
- `agy` `1.4.12`. Pi UA already matches measured fixture.
- `grok` `1.0.70`. Pi already pins.

Status rules.

- **OPEN.** Not implemented, partial, or drifted versus the installed CLI.
- **VERIFIED closed.** Implemented in Pi and matched by ledger or post-PR tests. Do not re-do.
- **OUT OF BAND.** Product or non-consumer paths. Keep out of the oauth+deps implementation queue.

Every OPEN row has a concrete Pi-native fix path. None are marked impossible.

---

## Open counts

| Package | OPEN units |
| --- | ---: |
| `pi-anthropic-oauth` | 5 |
| `pi-antigravity-oauth` | 0 |
| `pi-xai-oauth` | 0 |
| **Total OPEN** | **5** |

Top by wire impact (what the remote sees or how auth recovers).

1. **ANTH-FILE-LOCK** (low). Cross-process refresh lockfile. PR #128.
2. Remaining anthropic fidelity: PROFILE, WINCRED, COPY-025, BILLING-SUFFIX.

---

## `pi-anthropic-oauth`

### OPEN



#### ANTH-PROFILE

1. **ID.** ANTH-PROFILE (DEP-PROFILE-HTTP)
2. **Observed CLI fact.** Profile/validate/roles URLs in `claude/fixtures/oauth-config-2.1.312.json`; 2.1.316 carves `carve-oauth_profile@*`, `carve-oauth_validate@*`, `carve-roles_url@*`.
3. **Current Pi state.** No profile/validate/roles client in `src/`.
4. **Smallest Pi-native change.** Implement Bearer GET/POST helpers only if account sync is desired. Use `claude-code/${VERSION}` UA on those helpers if added (`DEP-UA-GS`).
5. **Verification.** Fake HTTP tests for each endpoint. Skip until product asks for account sync.
6. **Wire impact.** low (not on Messages inference)

#### ANTH-FILE-LOCK

1. **ID.** ANTH-FILE-LOCK (DEP-REFRESH-LOCK)
2. **Observed CLI fact.** Cross-process refresh lock with `ELOCKED` ≤5 retries (`claude/fixtures/refresh-lifecycle-2.1.312.json`; 2.1.316 `carve-ELOCKED@*`).
3. **Current Pi state.** Closed. `refresh-claim.ts` claims each refresh token with an exclusive file and records its successor, and the provider refresh hook runs it for Pi's expiry refresh and for 401 recovery. See `DEP-REFRESH-LOCK` in `claude/dependencies.md`.
4. **Smallest Pi-native change.** Optional file lock around refresh when multiple Pi processes share one `auth.json`. Singleflight already covers one process.
5. **Verification.** Two-process (or two-store) test that contended refresh does not double-POST.
6. **Wire impact.** low (multi-process only)

#### ANTH-WINCRED

1. **ID.** ANTH-WINCRED (OAUTH-023 remainder)
2. **Observed CLI fact.** Claude has non-macOS secure storage paths; plaintext `.credentials.json` is the cross-platform fallback (`claude/fixtures/credentials-layout-2.1.312.json`, `gap-vs-pi.md` OAUTH-023).
3. **Current Pi state.** `claude-credentials.ts:importClaudeAiOauth` prefers darwin keychain, then plaintext. No wincred/libsecret readers.
4. **Smallest Pi-native change.** Add optional wincred/libsecret readers mirroring Claude when those bunfs paths are carved. Plaintext path already covers non-darwin import.
5. **Verification.** Injected reader tests per platform flag. Darwin+plaintext tests already exist (`test/claude-credentials-import.test.ts`).
6. **Wire impact.** low (local import only)

#### ANTH-COPY-025

1. **ID.** ANTH-COPY-025 (OAUTH-025)
2. **Observed CLI fact.** Paste/TTY prompt strings recovered in paste carves (`claude/fixtures/paste-code-parser-2.1.312.json`, paste carves).
3. **Current Pi state.** Pi uses its own notify/prompt copy in `oauth.ts:loginCopyCode` / `loginLoopback`.
4. **Smallest Pi-native change.** Optionally align notify strings with recovered Claude paste prompts. No legal acceptance flow.
5. **Verification.** Snapshot or exact string assert on login interaction fakes.
6. **Wire impact.** low

#### ANTH-BILLING-SUFFIX

1. **ID.** ANTH-BILLING-SUFFIX
2. **Observed CLI fact.** Core form is `cc_version` + `cc_entrypoint`. Optional Claude-host suffixes (`cc_gateway`, `cc_project`, …) appear in 2.1.316 billing region (`carve-cc_version@129464624.txt`). Ledger treats core form as VERIFIED (`claude/dependencies.md` DEP-BILLING).
3. **Current Pi state.** `identity.ts:billingBlock` emits core form only.
4. **Smallest Pi-native change.** Add a suffix only when a Messages capture proves Anthropic requires it for subscription traffic. Do not invent gateway/project values.
5. **Verification.** Capture-driven assert in `test/claude-parity.test.ts`.
6. **Wire impact.** low (unless capture proves required)

### VERIFIED closed (do not re-do)

| ID | Evidence in Pi | Ledger / PR |
| --- | --- | --- |
| ANTH-ALLOWLIST | `allowed-oauth-bases.ts` + `resolveClaudeOAuthEndpoints`; table tests | PR #127 |
| ANTH-UA-316 / OAUTH-002 / DEP-UA at 2.1.316 | `identity.ts` pin `2.1.316` + UA/billing tests | PR #115 |
| ANTH-401-403 / DEP-401 (401 + revoked 403) | `auth-recovery.ts` + `test/auth-401-refresh.test.ts` | PR #116 |
| billing-sample-isMeta-only | Billing fingerprint samples compact summaries; docs aligned | PR #117; docs #118 |
| ANTH-ERR-011 / OAUTH-011 | `postToken` + wrapper pass-through Claude exchange/refresh strings | PR #120 |
| ANTH-REVOKE access | `revokeAccessToken` POST /revoke | PR #124 |
| ANTH-REVOKE refresh | `revokeRefreshToken` hint refresh_token | PR #125 |
| ANTH-LIVE-021 | gated live authorize→exchange probe (parked) | PR #126 |
| OAUTH-001 beta Bearer | Builtin anthropic oauth betas; `test/request-identity.test.ts` | gap VERIFIED |
| OAUTH-003 billing salt/indices | `identity.ts:billingBlock` | gap VERIFIED |
| OAUTH-004 anthropic-version/beta capture | fixtures + request-identity | gap VERIFIED |
| OAUTH-005 PKCE + state + exchange | `oauth.ts:createPkcePair`, `exchangeAuthorizationCode` | gap VERIFIED |
| OAUTH-006 loopback | `oauth.ts:loginLoopback`, `test/oauth-loopback.test.ts` | PR #111 / #114 |
| OAUTH-007 seven gto scopes + plugins | `CLAUDE_LOGIN_SCOPES` (projects remain gated `hls`, not `gto`) | gap VERIFIED; 2.1.316 carve still matches `gto` shape |
| OAUTH-008 Zxt refresh + absolute expiry | `oauth.ts:refresh` + `CLAUDE_REFRESH_SCOPE` | gap VERIFIED |
| OAUTH-009 / OAUTH-010 ambient | `auth.ts` `ANTHROPIC_AUTH_TOKEN` then `CLAUDE_CODE_OAUTH_TOKEN` | gap VERIFIED |
| OAUTH-010 dual-header | NOT APPLICABLE oauth-only | gap |
| OAUTH-013..015 streaming | No oauth protocol delta | gap VERIFIED |
| OAUTH-020 / DEP-STORAGE / DEP-KEYCHAIN / DEP-CRED-JSON import | `claude-credentials.ts`, login method `import`, tests | PR #112 |
| OAUTH-022 package lifecycle | N/A | gap VERIFIED |
| OAUTH-026 auth token outranks setup | ambient order | gap VERIFIED |
| DEP-PKCE | `node:crypto` in `oauth.ts` | gap VERIFIED |
| DEP-LATCH | `refresh-latch.ts` | PR #113 |
| DEP-X-APP | Messages path `x-app: cli` via provider | fixtures |
| DEP-BETA-HEADER | `oauth-2025-04-20` | fixtures |
| DEP-AUTHORIZE-Y9R / DEP-TOKEN-* / DEP-EXPIRY-AA / DEP-ENV-PRECEDENCE | `oauth.ts` / Pi resolver | dependencies.md VERIFIED |

---

## `pi-antigravity-oauth`

### OPEN

_None. pi-antigravity-oauth oauth+deps units closed._

### VERIFIED closed (do not re-do)

| ID | Evidence in Pi | Ledger / PR |
| --- | --- | --- |
| AGY-SCOPE-ORDER | `oauth.ts:SCOPES` matches measured consumer order (5-slice + aicode + openid) | agy-deepen `fixtures/consumer-scope-order.json`; `check-consumer-scope-order.py` exit 0 |
| AGY-TOKEN-SECRET-WIRE | `requestToken` posts `client_secret`; AuthStyleInParams + GOCSPX | agy-deepen VERIFIED (keep secret; metadata none is other client) |
| AGY-TOKENINFO | `validateAccessToken` GET tokeninfo on invalid_token refresh/import | PR #123 |
| AGY-EXPIRY-NUMERIC | `EXPIRY_DELTA_MS = 10_000` | agy-deepen VERIFIED (library default 10s) |
| AGY-DEVICE-CODE | auth-code paste only | NOT APPLICABLE (zero jetski DeviceAuth callers) |
| Consumer auth/token/userinfo URLs | `GOOGLE_OAUTH` | ledger VERIFIED |
| Redirect + client id/secret K58 | `oauth.ts` constants | ledger VERIFIED |
| Scopes + PKCE S256 | `SCOPES`, authorize URL | ledger VERIFIED |
| `access_type=offline` + `prompt=consent` | `authorizationUrl` | tests |
| loadCodeAssist body + onboardUser | `LOAD_CODE_ASSIST_BODY`, `ONBOARD_USER_BODY`, `discoverProject` | PR #109 + UA fixture |
| UA `1.4.12` / `cl=1010700967` | `cloudcode.ts:userAgent` | PR #106 |
| Cloud Code host + Bearer | `CLOUD_CODE_URL`, `cloudCodeHeaders` | ledger VERIFIED |
| Keychain import `gemini`/`antigravity` | `keychain.ts`, `offerKeychainImport` on darwin in `index.ts` | PR #110 |
| Claude on-disk creds | NOT APPLICABLE | ledger |
| No runtime agy | self-contained login | ledger VERIFIED |

---

## `pi-xai-oauth`

### OPEN

_None. pi-xai-oauth oauth+deps units closed._

### VERIFIED closed (do not re-do)

| ID | Evidence in Pi | Ledger |
| --- | --- | --- |
| XAI-DEVICE-HDR | Device start sends version (+ surface) headers | PR #119 |
| XAI-SURFACE-UI | surface `ui`; referrer `grok-build`; poll headers | PR #122 |
| XAI-RESP-HDR-PROVE | Live responses ablation; Pi set accepted | PR #121; fixtures + `test/parity-prove-closures.test.ts` |
| XAI-VERSION-FLOOR-PROVE | 1.0.12→426; 1.0.13/1.0.70→200; pin 1.0.70 | PR #121 |
| XAI-REFRESH-CAPTURE | refresh form grant_type/client_id/refresh_token | PR #121 |
| XAI-001 authorize URL / scope / referrer | `login.ts:authorizeUrl`, fixture | VERIFIED |
| XAI-002 device host + start form | `DEVICE_HOST`, live device fixture | VERIFIED |
| XAI-004 refresh skew 300s | `REFRESH_SKEW_MS` | VERIFIED |
| XAI-006 client version 1.0.70 | `request.ts:GROK_CLIENT_VERSION` | VERIFIED |
| XAI-007..010 token-auth / proxy / models | `grokHeaders`, `PROXY_BASE_URL`, live models | VERIFIED |
| XAI-012 catalog ids incl. `grok-4.7-build-fast` | `catalog.ts:BASELINE` | VERIFIED |
| XAI-013 package 401 retry | intentional omit; Pi auth owns lifecycle | NOT APPLICABLE |
| Public PKCE (no client_secret) | `exchangeCode` / device forms | VERIFIED |

---

## OUT OF BAND (not in oauth+deps queue)

| Item | Why out of band | Package |
| --- | --- | --- |
| OAUTH-012 tool name collision | Tools ledger, not oauth wire | anthropic |
| OAUTH-016..019 context / prompt / catalog | Outside oauth+deps | anthropic |
| OAUTH-024 telemetry / plugins marketplace | Product / marketplace | anthropic |
| Claude UTF-16 context estimator | Documented native difference | anthropic |
| Enterprise STS / WIF / extra Google clients | Enterprise only (`agy` STS/WIF) | antigravity |
| Stream/catalog envelope beyond auth headers | Separate Cloud Code wire work if bugs appear | antigravity |
| XAI-015..018 customer OIDC / external auth / API key / Grove MCP | Non-subscription paths | xai |
| XAI-013 package-level 401 retry product flip | Ledger NOT APPLICABLE; Pi host refresh owns lifecycle | xai |
| Runtime CLI spawn / binary read | Forbidden by exit predicate | all |

---

## Suggested implementation order

1. Land **AGY-TOKENINFO** (deps validation helper).
3. Gated **ANTH-LIVE-021**.
4. Optional fidelity pack: **ANTH-REVOKE**, Anthropic allowlist/profile/lock.
5. Prove-only: **AGY-SCOPE-ORDER**.
6. Defer **ANTH-BILLING-SUFFIX**, **ANTH-COPY-025**, **ANTH-WINCRED**, **ANTH-PROFILE** until product or capture requires them.

## Update 2026-11-01 (claude-2.1.316 RE + landings through #119)

- ANTH-UA-316 VERIFIED closed by PR #115.
- ANTH-401-403 VERIFIED closed by PR #116.
- billing-sample-isMeta-only VERIFIED closed by PR #117; docs PR #118.
- XAI-DEVICE-HDR VERIFIED closed by PR #119 (header presence). Reopened value/form/poll gaps as **XAI-SURFACE-UI** after deepen RE.
- AGY-TOKEN-SECRET-WIRE / AGY-EXPIRY-NUMERIC VERIFIED closed by agy-deepen (Pi already matches; keep `client_secret`). AGY-DEVICE-CODE NOT APPLICABLE.
- ANTH-ERR-011 VERIFIED closed by PR #120.
- XAI-RESP-HDR-PROVE / XAI-VERSION-FLOOR-PROVE / XAI-REFRESH-CAPTURE VERIFIED closed by PR #121.
- XAI-SURFACE-UI VERIFIED closed by PR #122.
- Main tip after #122: `4601a4bc`. OPEN total **10**. `pi-xai-oauth` OPEN **0**.

- AGY-TOKENINFO VERIFIED closed by PR #123. Main tip after merge: `6efe382e`. OPEN total **9**.

- ANTH-REVOKE (access helper) VERIFIED closed by PR #124. Refresh-token logout path still OPEN for 100% logout parity. Main `660aec75`. OPEN **8**.

- ANTH-REVOKE-REFRESH VERIFIED closed by PR #125 (`392439d6`). OPEN **7**.

- ANTH-LIVE-021 VERIFIED closed by PR #126 (probe shipped; live acceptance still parked until operator run). OPEN **6**.
- ANTH-ALLOWLIST VERIFIED closed by PR #127 (`2f25719b`). OPEN **5**. Custom-base revoke URL and `-custom-oauth` storage suffix stay open in `notes.md`.

## Update 2026-10-31 (real first-party wire capture, Claude 2.1.316)

The "VERIFIED" Messages-wire rows above came from a gateway-mode capture (localhost base URL). A first-party capture through a local TLS proxy showed `cch` attestation, attribution fields, `x-claude-code-prompt-id`, `x-claude-code-request-class`, `x-client-request-id` and four extra betas. Closed in `pi-anthropic-oauth` by this change.

- ANTH-BILLING-SUFFIX closed. `cc_gateway` applies only to gateway providers and `cc_project` only to Claude Projects attribution. Neither occurs on first-party OAuth traffic.
- ANTH-CUSTOM-REVOKE, ANTH-CUSTOM-SUFFIX closed. `CLAUDE_CODE_OAUTH_CLIENT_ID` also closed.
- ANTH-COPY-025 closed (strings from the 2.1.316 paste handler).
- ANTH-PROFILE closed (`src/oauth-account.ts`: profile, validate, roles, create_api_key).
- ANTH-WINCRED closed as NOT APPLICABLE. Claude reads no libsecret or Windows vault. See `extensions/pi-anthropic-oauth/docs/claude-oauth-parity.md`.
- `pi-antigravity-oauth` and `pi-xai-oauth` were not re-captured on the real wire in this pass. Their ledgers stay as recorded.
