## Implementation summary

`pi-xai-oauth` registers the `grok-build` provider. Login offers the captured Grok 1.0.50 browser flow and a device-code flow, both with the captured scope. Pi stores the credential and still refreshes it, and a first login expires 300 seconds before the server's expiry the way Pi's refresh does. Requests go to `https://cli-chat-proxy.grok.com/v1` through Pi's OpenAI Responses stream, with the headers the proxy requires. The client version sent is `1.0.50`.

## Artifact map

| File | Responsibility |
|---|---|
| `extensions/pi-xai-oauth/src/login.ts` | Browser and device-code login |
| `extensions/pi-xai-oauth/src/index.ts` | Provider registration and catalog fetch |
| `extensions/pi-xai-oauth/src/request.ts` | Proxy headers |
| `extensions/pi-xai-oauth/src/catalog.ts` | Catalog parse and prices |
| `parity/pi-xai-oauth/ledger.json` | Parity source of truth |
| `parity/pi-xai-oauth/fixtures/grok-1.0.50-oauth.json` | Redacted black-box observations of the CLI, proxy, and catalog |
| `extensions/pi-xai-oauth/test/fixtures/grok-1.0.50-authorize-url.json` | The authorize request `grok login --oauth` printed on 2026-10-28 |

Activation: `pi -e extensions/pi-xai-oauth`, then `/login`. Install: `pi install <path>`. Remove: `pi remove <path>`.

## Source-to-Pi mapping

| Source behavior | Pi behavior | Requirement IDs |
|---|---|---|
| Browser authorize URL at `auth.x.ai` | `loginGrokBuild` plus `AuthInteraction` | XAI-001 |
| Device code, same client | `loginGrokBuild` device branch | XAI-002, XAI-003 |
| Refresh before local expiry | Pi `oauth.refresh` | XAI-004 |
| Client version `1.0.50` and token-auth header | `grokHeaders` | XAI-006, XAI-007 |
| 401 refresh-and-retry | Omitted. Pi owns recovery and does not retry this 401 | XAI-013 |

## Verification results

Run on 2026-10-28 in `extensions/pi-xai-oauth`, with `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` pinned to `1.4.0`.

- `bun run test`: 116 passed in 10 files.
- `bun run test:coverage`: 116 passed; statements 94.40%, branches 93.05%, functions 93.42%, lines 95.61%.
- `bun run typecheck`: exit 0.
- `bun run prove:list`: real `pi` 1.4.0 `--list-models grok-build` listed 8 ids.
- `node scripts/prove-install.mjs`: isolated install listed the provider; remove cleared it.
- `./node_modules/.bin/biome ci extensions/pi-xai-oauth --error-on-warnings`: exit 0.
- `node extensions/scripts/check-vitest-conventions.mjs` (repo root): 0 violations for this package.
- `node scripts/check-pi-mechanisms.mjs` (repo root): exit 0.

There is no ledger validator script. The counts below are read from `ledger.json`, which is the source of truth, and each row's acceptance test was run in the suite above.

## Parity status

VERIFIED 15 · INCONCLUSIVE 1 · NOT VERIFIED 0 · NOT APPLICABLE 7

The INCONCLUSIVE row is XAI-003. The package sends the full captured scope string; whether the server grants or requires the conversations and workspaces scopes is still unobserved. XAI-013 (the 401 refresh and retry) is NOT APPLICABLE because a package-level retry would be a second recovery path; Pi does not treat that 401 as retryable, and `test/pi-owned-auth.test.ts` locks that.

## Security and maintenance

Pi `AuthStorage` owns credentials. The login adapter does not log tokens, refuses a non-HTTPS device URI, and refuses catalog redirects. Delete `src/login.ts` when Pi's xAI login offers this browser URL and scope. The client-version constant will drift from the next Grok release; a `models.json` header can override it. The identity headers stay in the stream wrapper rather than on `Model.headers`, because a model header beats the `models.json` provider header a user needs for that override; `decisions.md` D3 records the measurement.

## Remaining gaps

A 401 before the local refresh window is not retried. Customer OIDC, external auth commands, and Grok agent metadata headers are out of scope. Whether xAI grants the extra conversations and workspaces scopes, and whether the proxy requires them, is unobserved. `maxTokens` equals the context window on every model, and the proxy's output cap is unobserved. The provider test matrix has no tool-call, image-input, context-overflow, or cross-provider handoff case.

## Final verdict

**VERIFIED** for 15 of 23 rows, with one INCONCLUSIVE row and 7 NOT APPLICABLE rows. This is not a claim that Pi retries a 401 the way Grok's user guide describes, and not a claim that xAI accepts the captured authorize query from a client other than Grok Build.
