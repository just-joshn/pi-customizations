## Implementation summary

`pi-xai-oauth` registers the `grok-build` provider. Login offers the captured Grok 1.0.50 browser flow and a device-code flow, both with the captured scope. Pi stores the credential and still refreshes it. Requests go to `https://cli-chat-proxy.grok.com/v1` through Pi's OpenAI Responses stream, with the headers the proxy requires. The client version sent is `1.0.50`.

## Artifact map

| File | Responsibility |
|---|---|
| `extensions/pi-xai-oauth/src/login.ts` | Browser and device-code login |
| `extensions/pi-xai-oauth/src/index.ts` | Provider registration and catalog fetch |
| `extensions/pi-xai-oauth/src/request.ts` | Proxy headers |
| `extensions/pi-xai-oauth/src/catalog.ts` | Catalog parse and prices |
| `parity/pi-xai-oauth/ledger.json` | Parity source of truth |

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

- `bun run test` in `extensions/pi-xai-oauth`: 91 passed.
- `bun run typecheck`: passed.
- `bun run prove:list`: real `pi --list-models grok-build` listed 8 ids.
- `node scripts/prove-install.mjs`: isolated install listed the provider; remove cleared it.
- `validate-ledger.mjs`: exit 0, verdict VERIFIED, 16 verified, 7 not applicable.

## Parity status

VERIFIED 16 · NOT VERIFIED 0 · INCONCLUSIVE 0 · NOT APPLICABLE 7

Critical gaps: none in the scoped contract. XAI-013 is not applicable because a package-level 401 retry would be a second recovery path.

## Security and maintenance

Pi `AuthStorage` owns credentials. The login adapter does not log tokens, refuses a non-HTTPS device URI, and refuses catalog redirects. Delete `src/login.ts` when Pi's xAI login offers this browser URL and scope. The client-version constant will drift from the next Grok release; `models.json` headers can override it.

## Remaining gaps

A 401 before the local refresh window is not retried. Customer OIDC, external auth commands, and Grok agent metadata headers are out of scope.

## Final verdict

**VERIFIED**, the verdict derived by the validator. This is not a claim that Pi retries a 401 the way Grok's user guide describes.
