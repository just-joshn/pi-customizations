No path or command injection, and no live secrets in the fixture or these tests. The catalog URL is fixed, API-key credentials are rejected before fetch, and error text includes only an HTTP status.

### Confirmed defects

1. **No 401 recovery.** `fetchModels` calls `oauth.toAuth` once, then throws on any non-OK response (`extensions/pi-xai-oauth/src/index.ts:16-21`). `withGrokHeaders` only adds headers (`extensions/pi-xai-oauth/src/request.ts:17-22`). A proxy 401 before local expiry fails the turn. Spec XAI-013 and `parity/pi-xai-oauth/ledger.json` XAI-013 require one refresh and retry. `live-catalog.test.ts:44-46` locks in the dead-end message.

2. **Identity headers are not pinned.** `options.headers` is spread last (`request.ts:8-15`), so a caller can replace `X-XAI-Token-Auth`, `x-grok-client-version`, `x-grok-model-override`, `x-grok-context-window`, and `x-grok-conv-id`. The ledger only documents a version override. That is a request-integrity break, not a token leak.

### Suspicions

- **Redirect.** Catalog `fetch` (`index.ts:19`) does not set `redirect: 'error'`. Spec-compliant fetch strips `Authorization` on cross-origin redirects, so this is not a confirmed leak. The test guard does set `redirect: 'error'` (`test/network-guard.ts:17`); production does not.
- **Catalog bounds.** `id` is header-safe (`catalog.ts:48`). `name` is any non-empty string (`catalog.ts:49`) and `context_window` has no maximum (`catalog.ts:50`). A hostile catalog could carry control characters into the UI or publish an extreme window that is sent as `x-grok-context-window`. Missing `api_backend` is still accepted (`catalog.ts:61`).
- **403 is treated as a dead login** (`catalog.ts:134`). A scope rejection (XAI-003) will not be fixed by `/login` with the same shorter scope, and there is still no refresh.
- **Test guard.** Any loopback host and port is fetched for real (`network-guard.ts:3-17`). External hosts fail closed. `url.href` in the block error would echo a query token if one were ever present.

### Not found

The fixture stores field names only (`fixtures/grok-1.0.50-oauth.json:31-36`). Tests use `randomUUID()` access tokens. This package does not write `auth.json`, so mode `0600` and hot reload are host behavior, not a bug here. No local credential cache, so no in-package refresh race.

### Findings

- Confirmed: missing 401 refresh-and-retry (`index.ts:16-21`, `request.ts:17-22`).
- Confirmed: caller headers overwrite auth and routing headers (`request.ts:8-15`).
- Suspicion: catalog redirect, unsanitized `name` / unbounded `context_window`, 403 misclassified as re-login.
