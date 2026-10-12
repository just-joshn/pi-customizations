# Self-review (not independent)

`pi -p` for this focus was started twice and produced no output before the process was killed at 200s and 240s. This is not an independent review.

## Confirmed

- The extension uses public Pi 1.1.0 APIs: `createProvider`, `registerProvider`, and `registerVirtualModel`. It does not import `dist/auth/oauth/*`.
- Login is Pi's xAI `OAuthAuth`, not a copy of Grok's private login module. `decisions.md` records why a second browser client was rejected.
- `GROK_CLIENT_VERSION` will drift from the next Grok release. The README documents the `models.json` header override. That limitation is in the package README, not only in this ledger.

## Suspicions

- `fetchModels` depends on `oauth.toAuth` returning `{ apiKey }`. That is Pi's current xAI shape. A future Pi change that puts the token only in `headers` would send no bearer. No test locks the `apiKey` field beyond the catalog stub, which uses a fixture credential through Pi's own `toAuth`.

## Not a defect

- Effort aliases are Pi-local and marked NOT APPLICABLE in the ledger.
- Agent metadata headers were excluded with a probe, not copied from Grok's request.
