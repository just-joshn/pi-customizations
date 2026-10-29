# Self-review (not independent)

`pi -p` for this focus was started twice and produced no output before the process was killed at 200s and 240s. This is not an independent review.

## Confirmed

- The extension uses public Pi 1.4.0 APIs: `createProvider`, `registerProvider`, and `registerVirtualModel`. It does not import `dist/auth/oauth/*`.
- Login is the package's own OIDC adapter in `src/login.ts`, because Pi's xAI client is device-code only, requests a shorter scope, and takes no authorize query. Only `refresh` and `toAuth` come from Pi. `decisions.md` D1 is superseded by D5, and `extensions/pi-xai-oauth/test/fixtures/grok-1.0.50-authorize-url.json` holds the request the adapter reproduces.
- `GROK_CLIENT_VERSION` will drift from the next Grok release. The README documents the `models.json` header override. That limitation is in the package README, not only in this ledger.
- The five identity headers stay in the provider stream wrapper. Moving them onto `Model.headers` was measured on Pi 1.4.0 and rejected: the model header beats the `models.json` provider header, and it does not follow a `modelOverrides.contextWindow` change. `decisions.md` D3 records the measurement.

## Suspicions

- `fetchModels` depends on `oauth.toAuth` returning `{ apiKey }`. That is Pi's current xAI shape. A future Pi change that puts the token only in `headers` would send no bearer. No test locks the `apiKey` field beyond the catalog stub, which uses a fixture credential through Pi's own `toAuth`.

## Not a defect

- Effort aliases are Pi-local and marked NOT APPLICABLE in the ledger.
- Agent metadata headers were excluded with a probe, not copied from Grok's request.
- `fetchModels` reads `RefreshModelsContext.baseUrl` rather than the constant, so a configured endpoint moves discovery and chat together.
