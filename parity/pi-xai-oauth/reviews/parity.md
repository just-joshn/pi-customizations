The parity suite locks the 1.0.50 string and a local Responses body, but several VERIFIED rows cite tests that never exercise the behavior they name. No test reads `parity/pi-xai-oauth/fixtures/grok-1.0.50-oauth.json`.

## Confirmed defects

- **XAI-002 and XAI-004 are marked VERIFIED on reference equality only.** `provider.test.ts:44-48` compares `login`, `refresh`, and `toAuth` to `builtinXai()`, which is the same `builtinProviders()` singleton (`test/support/builtin-xai.ts:4-7`). An implementation that ignored the argument and looked up that singleton would still pass. Nothing calls `login` or `refresh`, so the client id, the device URL, the verification host, the `refresh_token` grant, and the 300-second skew (`spec.md:34-48`) are untested. `live-catalog.test.ts:63-70` does prove a replaced `toAuth` is used, but that is not the cited test.

- **XAI-006's cited test does not lock the wire header.** `request.test.ts:10-11` only expects `GROK_CLIENT_VERSION === '1.0.50'`. It would pass if `grokHeaders` (`request.ts:7-8`) sent `1.0.46`. Sibling header tests hardcode `1.0.50` and do not load the fixture's `clientVersion`. Both `1.0.46` and `1.0.50` clear the gate (`fixtures/grok-1.0.50-oauth.json` `proxyProbes`), and `prove-pi.ts:54-62` treats any non-unknown-model outcome as success, so the live 401 does not prove the version bump.

- **XAI-008's cited test never reads headers.** `stream.test.ts:57-58` asserts the body `model`, the effort, `store: false`, and `include[0]`. It passes if `x-grok-model-override` is omitted. The header is checked only in the previous test, and only for the physical id. The alias `grok-4.7-xhigh-fast` is routed in `provider.test.ts:68-75` and resolved by `prove-pi.ts`, but no test checks that the override after routing is `grok-4.7-build-fast`.

- **XAI-011's cited test is path-only.** `stream.test.ts:41-44` checks `/v1/responses` and a count of one. `stream: true` (`spec.md:82`, fixture `inferenceHeaders.stream`) is never asserted. The stub answers with server-sent events regardless of the body, so a missing `stream` still passes. `toMatchObject` on `include` only constrains the first element, not the fixture's length of 27.

## Suspicions

- `stubCatalogEndpoint` (`catalog-endpoint.ts:20-21`) records only the URL and the bearer token. A wrong `X-XAI-Token-Auth` on `GET /models` would not fail XAI-010.
- The `models.json` 500000-window path in the README is not exercised. `request.test.ts:32-33` only passes a model object.
- The inference 401 retry (XAI-013) and browser login (XAI-001) remain correctly unverified. Catalog 401 is a different path.

## Findings

1. The identity test can pass without using the given login or refresh functions.
2. The version test can pass without sending `1.0.50`, and it does not bind to the fixture.
3. The XAI-008 and XAI-011 acceptance tests omit the header and `stream: true` they are cited for.
4. The alias-to-physical override, and the full `include` list, are untested combinations.
