# Gaps: `extensions/pi-xai-oauth` versus Grok 1.0.70 (deepen)

Goal: 100% Pi-native oauth plus oauth-deps parity for Grok Build into `pi-xai-oauth` with no runtime grok dependency. Extension `src` was not edited in this unit. Tree re-read at report time under `extensions/pi-xai-oauth/src/**`.

Prior ledger: `parity/oauth-rea-2026-10-31/grok/gap-vs-pi.md`.
Evidence: host byte scan plus ADRP/ADD recovery on `/Users/josh-desktop/.grok/downloads/grok-1.0.70-macos-aarch64` (sha256 `5c8a6882…`). Fixtures under `fixtures/`.

## Measured this pass

| Fact | Value | Evidence |
|---|---|---|
| Device/authorize surface header values | enum `ui` \| `cli` \| `headless` | table at `0x108365108` / `0x10a2aefd8` |
| Device **start** default `x-grok-client-surface` | `ui` | store index 0 at `0x1043dbd8c` before header insert at `0x1043dbfe4` |
| Device start also sends | `x-grok-client-version: 1.0.70` | insert at `0x1043dbf9c` |
| Device start form | `client_id`, `scope`, **`referrer=grok-build`** | form pack at `0x1043dc00c`…`0x1043dc068` |
| Device token poll headers | version + surface | site `0x1043c3370` |
| `grok-build` | referrer (query + device form), **not** a surface value | authorize probe + form pack |
| Refresh base body | `grant_type=refresh_token`, `refresh_token`, `client_id` | site `0x1042c3b8c` |
| Inference docs-required | Bearer, `X-XAI-Token-Auth: xai-grok-cli`, `x-grok-model-override` (star) | embedded proxy docs |

## Remaining UNITs (wire impact)

### UNIT-D1. Wrong device surface value (high fidelity, low IdP risk)

**Wire.** Binary default device start sends `x-grok-client-surface: ui`. Current Pi `login.ts` sets `GROK_CLIENT_SURFACE = 'grok-build'` and puts that on `DEVICE_START_HEADERS`.

**Pi-native fix.** Split constants. Keep authorize/device **referrer** as `grok-build`. Set device (and poll) surface header to `ui`. Do not reuse one constant for both.

**Verify.** Fixture `fixtures/device-headers-surface-1.0.70.json`. Extend device login fake to assert header value `ui`.

### UNIT-D2. Device start form missing `referrer` (medium fidelity)

**Wire.** Binary POSTs `referrer=grok-build` with `client_id` and `scope`. Pi `deviceLogin` form is only `client_id` + `scope`.

**Pi-native fix.** Add `referrer: 'grok-build'` to the device start `postForm` fields.

**Verify.** Form assertion in device login tests. Prior live IdP probes succeeded without it, so this is fidelity, not auth unlock.

### UNIT-D3. Device token poll omits version/surface headers (low fidelity)

**Wire.** Binary poll to `/oauth2/token` with device grant also inserts `x-grok-client-version` and `x-grok-client-surface`. Pi poll `postForm` sends no extra headers.

**Pi-native fix.** Pass the same device header map used for start into the poll `postForm`.

**Verify.** Fake token poll asserts headers.

### UNIT-I1. Inference mandatory set already covered (no extension change unless probe fails)

**Wire.** Docs-required for oauth-gated proxy traffic: Bearer, `X-XAI-Token-Auth: xai-grok-cli`, `x-grok-model-override` (omit only for default `grok-build` route). Pi `grokHeaders()` already sends those plus version, context-window, optional conv-id.

**Pi-native fix.** None for mandatory parity. Optional live `POST /v1/responses` acceptance probe for 1.0.70. Do not add sampler-only names (`x-grok-max-completion-tokens`, `x-models-etag`, `x-grok-deployment-id`, …) without a reject fixture.

**Verify.** Fixture `fixtures/inference-headers-1.0.70.json`.

### UNIT-R1. Refresh body static shape (host-owned)

**Wire.** Static refresh build: `grant_type=refresh_token`, `refresh_token`, `client_id`, optional `principal_type` / `principal_id`. No `client_secret`.

**Pi-native fix.** Confirm Pi auth host refresh form matches base three fields. Extension login path does not refresh.

**Verify.** Fixture `fixtures/refresh-body-1.0.70.json`. Capture one redacted live refresh when a token nears expiry.

## Not a remaining oauth-deps UNIT

| Item | Why |
|---|---|
| IdP requiring surface/version on device start | Prior live 200 without them (`grok/fixtures/device-code-request-1.0.70.json`) |
| Catalog ids / proxy base / client version `1.0.70` / token-auth value | Closed in prior pass |
| Package-level 401 retry | Intentional Pi omit |
| Runtime grok binary | Not required once UNITs above land in Pi |

## Smallest extension sequence later

1. UNIT-D1 surface `ui` vs referrer `grok-build` split.
2. UNIT-D2 device form `referrer`.
3. UNIT-D3 poll headers.
4. Optional UNIT-I1 responses probe; UNIT-R1 host refresh assert.
