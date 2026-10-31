# Gaps: extensions/pi-xai-oauth versus Grok 1.0.70

Goal for 100% oauth and oauth-dependency parity without depending on the grok binary. Extension `src` was not edited in this pass. The tree was re-read at report time.

## Already closed in the tree (observed, not re-tested here)

1. **`GROK_CLIENT_VERSION` is already `1.0.70`.**
   File: `extensions/pi-xai-oauth/src/request.ts`.
   Tests and README already expect `1.0.70` on the wire.
   Matches binary string evidence binding `x-grok-client-version` to `1.0.70`.

2. **Authorize fixture already points at 1.0.70.**
   `test/fixtures/grok-1.0.70-authorize-url.json` and `login.test.ts` compare against the 1.0.70 probe.
   Stable query fields match this pass's `login-probe.txt`.
   `src/login.ts` comments already say 1.0.70.
   Historical `grok-1.0.50-authorize-url.json` remains.

## Remaining gaps for 100% 1.0.70 parity

1. **Live catalog not re-fetched for 1.0.70.**
   Pi baseline still lists physical id `grok-4.7-build-fast` with suffix `-build-fast`.
   That exact string is absent from the 1.0.70 binary.
   Embedded docs mention flat id example `grok-4.7-high-fast` (Pi also uses that name as a virtual alias targeting `build-fast`).
   Label: INCONCLUSIVE. A bearer `GET /v1/models` settles whether the physical fast id renamed.
   No extension edit until that capture.

2. **New header names are string-only.**
   Candidates: `x-grok-client-surface`, `x-grok-deployment-id`, `x-grok-max-completion-tokens`, `x-models-etag`, `x-grok-experiments`, managed-config headers.
   Prior 1.0.50 responses probe accepted bearer plus client version alone.
   Not required for oauth parity until a 1.0.70 wire probe shows a reject.

3. **Device verification URI.** VERIFIED for 1.0.70.
   Fixture `parity/oauth-rea-2026-10-31/grok/fixtures/device-probe-1.0.70.json`.
   Host `accounts.x.ai`, path `/oauth2/device`.
   Pi `src/login.ts` `DEVICE_HOST` still matches.

4. **Package-level 401 retry still omitted.**
   Unchanged intentional gap (XAI-013). Pi owns recovery.

## Already aligned (measured)

| Area | Pi (tree) | 1.0.70 evidence |
|---|---|---|
| Client version | `1.0.70` | binary + request.ts |
| Client id | `b1a00492-…` | login probe |
| Full scope | conversations + workspaces | login probe |
| Referrer | `grok-build` | login probe |
| Authorize order / `%20` | `authorizeUrl()` | probe vs 1.0.70 fixture |
| Refresh skew | 300s | `GROK_AUTH_EARLY_INVALIDATION_SECS` default 300 |
| Token-auth | `xai-grok-cli` | binary |
| Proxy base | `cli-chat-proxy.grok.com/v1` | binary |

## Smallest remaining work

1. Live `GET /v1/models` with a stored bearer. Record ids. No catalog change without that body.
2. Optional responses header capture if catalog or auth gate misbehaves.
3. Only then change `catalog.ts` if the physical fast id moved.
