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
| `pi-anthropic-oauth` | 9 |
| `pi-antigravity-oauth` | 2 |
| `pi-xai-oauth` | 1 |
| **Total OPEN** | **12** |

Top 5 by wire impact (what the remote sees or how auth recovers).

1. **XAI-SURFACE-UI** (high fidelity). PR #119 sent device surface `grok-build`; deepen RE shows default surface is `ui` and `grok-build` is referrer only. Owner in flight for D1–D3.
2. **ANTH-LIVE-021** (med). Live Anthropic exchange still gated. Needed to close acceptance of authorize+exchange.
3. **ANTH-ERR-011** (low). Exchange error strings still generic versus Claude `error_strings`.
4. **ANTH-REVOKE** (low). No revoke helper; logout clears local store only.
5. **AGY-TOKENINFO** (low). Optional Google tokeninfo v3 validation after refresh/import.

---

## `pi-anthropic-oauth`

### OPEN

#### ANTH-LIVE-021

1. **ID.** ANTH-LIVE-021 (OAUTH-021)
2. **Observed CLI fact.** Live exchange was never completed in the RE brief (`claude/decisions.tsv` verify row INCONCLUSIVE).
3. **Current Pi state.** Stub token exchange covered in `test/oauth-authorize-url.test.ts`, `test/oauth-loopback.test.ts`, `test/login-method.test.ts`. No operator-gated live Anthropic receipt.
4. **Smallest Pi-native change.** Add gated live probe (env flag + `gates.md`) that runs authorize→exchange against Anthropic once, writes a redacted receipt under `parity/`, keeps CI on stubs.
5. **Verification.** `bun run test` stub path always green. Live script only behind gate; assert HTTP 200 token JSON shape matches `claude/fixtures/token-endpoints-2.1.312.json` fields.
6. **Wire impact.** med (acceptance of the grant path)

#### ANTH-ERR-011

1. **ID.** ANTH-ERR-011 (OAUTH-011 / DEP-ERROR-STRINGS)
2. **Observed CLI fact.** Exchange 401 → `Authentication failed: Invalid authorization code`; other exchange → `Token exchange failed (${status})…`; revoked SDK phrase listed (`claude/fixtures/refresh-lifecycle-2.1.312.json` `error_strings`).
3. **Current Pi state.** `auth.ts:wrapLoginErrors` / `wrapRefreshErrors` map most failures to generic Pi messages. `oauth.ts:postToken` throws `HTTP request failed. status=…`.
4. **Smallest Pi-native change.** Map known status/body pairs in `postToken` (or wrappers) to the Claude strings. Keep a generic fallback.
5. **Verification.** Unit test fake token endpoint 401/other → exact Claude strings; cancel/timeout still pass through.
6. **Wire impact.** low (operator UX only)

#### ANTH-REVOKE

1. **ID.** ANTH-REVOKE (DEP-REVOKE)
2. **Observed CLI fact.** `POST ${TOKEN_URL}/revoke` (`claude/fixtures/oauth-config-2.1.312.json`; `/revoke` still in 2.1.316 @ `132181500`).
3. **Current Pi state.** No revoke helper. Logout clears Pi `auth.json` only (`README.md`).
4. **Smallest Pi-native change.** Add `revokeAccessToken(access, signal)` posting to `https://platform.claude.com/v1/oauth/token/revoke`. Call from logout hook if Pi exposes one; otherwise export for the command path.
5. **Verification.** Fake revoke endpoint test asserts method/URL/body. Optional integration with `/logout`.
6. **Wire impact.** low (logout only)

#### ANTH-PROFILE

1. **ID.** ANTH-PROFILE (DEP-PROFILE-HTTP)
2. **Observed CLI fact.** Profile/validate/roles URLs in `claude/fixtures/oauth-config-2.1.312.json`; 2.1.316 carves `carve-oauth_profile@*`, `carve-oauth_validate@*`, `carve-roles_url@*`.
3. **Current Pi state.** No profile/validate/roles client in `src/`.
4. **Smallest Pi-native change.** Implement Bearer GET/POST helpers only if account sync is desired. Use `claude-code/${VERSION}` UA on those helpers if added (`DEP-UA-GS`).
5. **Verification.** Fake HTTP tests for each endpoint. Skip until product asks for account sync.
6. **Wire impact.** low (not on Messages inference)

#### ANTH-ALLOWLIST

1. **ID.** ANTH-ALLOWLIST (DEP-ALLOWED-BASES)
2. **Observed CLI fact.** `ALLOWED_OAUTH_BASE_URLS` three hosts for `CLAUDE_CODE_CUSTOM_OAUTH_URL` only (`claude/fixtures/allowed-oauth-bases-2.1.312.json`).
3. **Current Pi state.** No custom oauth base support.
4. **Smallest Pi-native change.** Optional allowlist gate (default off) if Pi ever reads a custom oauth URL env. Same three hosts + Claude miss error string.
5. **Verification.** Table test of allow/deny hosts. Prod cai path unchanged.
6. **Wire impact.** low (irrelevant for prod cai)

#### ANTH-FILE-LOCK

1. **ID.** ANTH-FILE-LOCK (DEP-REFRESH-LOCK)
2. **Observed CLI fact.** Cross-process refresh lock with `ELOCKED` ≤5 retries (`claude/fixtures/refresh-lifecycle-2.1.312.json`; 2.1.316 `carve-ELOCKED@*`).
3. **Current Pi state.** In-process latch only (`refresh-latch.ts` + `CredentialStore.modify`). No Claude-style lockfile.
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
| ANTH-UA-316 / OAUTH-002 / DEP-UA at 2.1.316 | `identity.ts` pin `2.1.316` + UA/billing tests | PR #115 |
| ANTH-401-403 / DEP-401 (401 + revoked 403) | `auth-recovery.ts` + `test/auth-401-refresh.test.ts` | PR #116 |
| billing-sample-isMeta-only | Billing fingerprint samples compact summaries; docs aligned | PR #117; docs #118 |
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

#### AGY-TOKEN-SECRET-WIRE

1. **ID.** AGY-TOKEN-SECRET-WIRE
2. **Observed CLI fact.** Public metadata `token_endpoint_auth_method: none` (`agy/fixtures/client-metadata.json`). Binary still embeds consumer `GOCSPX-K58…` (`agy/gap-vs-pi.md` §1, `agy/ledger.md` follow-up 1).
3. **Current Pi state.** `oauth.ts:requestToken` always appends `client_id` and `client_secret`.
4. **Smallest Pi-native change.** Capture one throwaway PKCE token exchange (live login gate) or decompile the token Config. If agy omits secret, stop sending it. If agy sends it, keep current form and document the metadata mismatch.
5. **Verification.** Redacted fixture under `agy/fixtures/` of token POST field names. Test asserts Pi form matches that set (`test/oauth.test.ts` already pins current secret-present form).
6. **Wire impact.** high (token endpoint field set)

#### AGY-TOKENINFO

1. **ID.** AGY-TOKENINFO
2. **Observed CLI fact.** Binary references Google tokeninfo v3 (`agy/protocol.md`, `agy/ledger.json` `follow.tokeninfo_optional`).
3. **Current Pi state.** No tokeninfo call. Email from userinfo v2 (`oauth.ts:fetchEmail`).
4. **Smallest Pi-native change.** Optional tokeninfo check after refresh only if a failure mode needs it.
5. **Verification.** Fake tokeninfo 200/4xx tests. Default login path unchanged.
6. **Wire impact.** low

#### AGY-SCOPE-ORDER

1. **ID.** AGY-SCOPE-ORDER
2. **Observed CLI fact.** All Pi scopes exist as binary literals; contiguous ordered slice not proven (`agy/gap-vs-pi.md` §4).
3. **Current Pi state.** `oauth.ts:SCOPES` join order used in authorize URL.
4. **Smallest Pi-native change.** Decompile AntigravityHubAuthProvider authorize Config if a server starts rejecting scope order. Otherwise leave.
5. **Verification.** Authorize URL golden test already in `test/oauth.test.ts`. Update only if decompile shows a different order.
6. **Wire impact.** low

#### AGY-EXPIRY-NUMERIC

1. **ID.** AGY-EXPIRY-NUMERIC
2. **Observed CLI fact.** `expiryDelta` from golang.org/x/oauth2. Library default 10s. Numeric next to symbol not proven (`agy/protocol.md`).
3. **Current Pi state.** `EXPIRY_DELTA_MS = 10_000` in `oauth.ts` and `keychain.ts`.
4. **Smallest Pi-native change.** Confirm via decompile or observed refresh timing. Change constant only if measured value differs.
5. **Verification.** Unit assert on `expiresAt` skew; optional timing probe receipt.
6. **Wire impact.** low

#### AGY-DEVICE-CODE

1. **ID.** AGY-DEVICE-CODE
2. **Observed CLI fact.** Binary contains `urn:ietf:params:oauth:grant-type:device_code` (`agy/protocol.md`). Primary CLI UX remains paste callback.
3. **Current Pi state.** Authorization-code + paste only (`oauth.ts:authorize`).
4. **Smallest Pi-native change.** Add device-code login method only if product wants headless parity with that binary path. Capture device start/poll shape first.
5. **Verification.** Fake device endpoint poll loop tests (same pattern as `pi-xai-oauth`).
6. **Wire impact.** low

### VERIFIED closed (do not re-do)

| ID | Evidence in Pi | Ledger / PR |
| --- | --- | --- |
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

#### XAI-SURFACE-UI

1. **ID.** XAI-SURFACE-UI (deepen UNIT-D1 / D2 / D3)
2. **Observed CLI fact.** Device start default `x-grok-client-surface: ui` (enum `ui`|`cli`|`headless`). `grok-build` is authorize + device form **referrer**, not a surface value. Device start form includes `referrer=grok-build`. Device token poll also sends version + surface headers. Evidence: `grok-deepen/fixtures/device-headers-surface-1.0.70.json`, `grok-deepen/gap-vs-pi.md`.
3. **Current Pi state.** After PR #119, `login.ts` sets `GROK_CLIENT_SURFACE = 'grok-build'` for both authorize referrer and device surface header. Device form omits `referrer`. Token poll omits version/surface headers. Stale fixture `device-start-headers-1.0.70.json` claims surface `grok-build`.
4. **Smallest Pi-native change.** Split referrer vs surface constants. Surface header `ui`. Form `referrer=grok-build`. Pass device headers on token poll. Rewrite the stale adjacency fixture.
5. **Verification.** Extend `test/login.test.ts` for surface `ui`, form referrer, poll headers. Owner: feat/xai-surface-ui-referrer-split.
6. **Wire impact.** high fidelity (IdP accepted without correct surface; wire must still match)

### VERIFIED closed (do not re-do)

| ID | Evidence in Pi | Ledger |
| --- | --- | --- |
| XAI-DEVICE-HDR | Device start sends version (+ surface) headers | PR #119 (presence only; value corrected by XAI-SURFACE-UI) |
| XAI-RESP-HDR-PROVE | Live responses ablation; Pi set accepted; no speculative headers | `grok/fixtures/responses-headers-1.0.70.json`; `test/parity-prove-closures.test.ts` |
| XAI-VERSION-FLOOR-PROVE | Responses `1.0.12` → 426, `1.0.13`/`1.0.70` → 200 | same fixture + `GROK_CLIENT_VERSION` |
| XAI-REFRESH-CAPTURE | Live refresh form `grant_type`/`client_id`/`refresh_token`; matches Pi host | `grok/fixtures/refresh-token-1.0.70.json`; same test |
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

1. Land **XAI-SURFACE-UI** (D1–D3) correcting PR #119 surface value.
2. Capture agy token POST → land **AGY-TOKEN-SECRET-WIRE**.
3. Gated **ANTH-LIVE-021**.
4. Optional fidelity pack: **ANTH-ERR-011**, **ANTH-REVOKE**, Anthropic allowlist/profile/lock, agy tokeninfo/device.
5. Remaining prove-only closures: **AGY-EXPIRY-NUMERIC**, **AGY-SCOPE-ORDER**.
6. Defer **ANTH-BILLING-SUFFIX**, **ANTH-COPY-025**, **ANTH-WINCRED**, **ANTH-PROFILE** until product or capture requires them.

## Update 2026-11-01 (claude-2.1.316 RE + landings through #119)

- ANTH-UA-316 VERIFIED closed by PR #115.
- ANTH-401-403 VERIFIED closed by PR #116.
- billing-sample-isMeta-only VERIFIED closed by PR #117; docs PR #118.
- XAI-DEVICE-HDR VERIFIED closed by PR #119 (header presence). Reopened value/form/poll gaps as **XAI-SURFACE-UI** after deepen RE.
- Main tip at refresh: `2e8866c0`. OPEN total **18** after XAI-SURFACE-UI.

## Update 2026-11-01 (xAI prove-only closures)

- XAI-RESP-HDR-PROVE, XAI-VERSION-FLOOR-PROVE, XAI-REFRESH-CAPTURE VERIFIED closed by live fixtures + `test/parity-prove-closures.test.ts`. No extension `src` drift.
- Remaining `pi-xai-oauth` OPEN unit: **XAI-SURFACE-UI** only. OPEN total **12**.
