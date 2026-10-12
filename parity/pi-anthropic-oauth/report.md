## Implementation summary

`pi-anthropic-oauth` is a project-local Pi package that registers `claude-subscription` on Pi's native Anthropic provider. It does not have 100% parity with Claude Code 2.1.296 OAuth or with the request, credential, and context behavior that OAuth depends on.

This audit kept Pi's login, credential store, refresh lock, and Messages stream. It corrected the ambient subscription-token order to the measured Claude print-mode order, preserved Pi's exact `Login cancelled` error, and pinned the selected SDK identity to the reconfirmed `2.1.296` capture. It did not add a second OAuth client.

## Artifact map

| File | Responsibility |
| --- | --- |
| `extensions/pi-anthropic-oauth/src/index.ts` | Registers the provider and composes native `stream` / `streamSimple` |
| `extensions/pi-anthropic-oauth/src/auth.ts` | Ambient token resolution and bounded login/refresh errors |
| `extensions/pi-anthropic-oauth/src/identity.ts` | Request-local user agent and billing block |
| `extensions/pi-anthropic-oauth/src/context/` | Local compaction timing and request fit, not source accounting |
| `parity/pi-anthropic-oauth/ledger.json` | Source of truth for the verdict |

Activation: `pi -e extensions/pi-anthropic-oauth` or `pi install --local <package>`. Removal: `pi remove --local --approve <package>`.

## Source-to-Pi mapping

| Source behavior | Pi behavior | Requirement IDs |
| --- | --- | --- |
| OAuth-only bearer request, no `x-api-key` | Native OAuth token as bearer | OAUTH-001 |
| SDK user agent and selected billing block | `src/identity.ts` on the native stream | OAUTH-002, OAUTH-003 |
| Authorize URL, scopes, client id | Native Pi OAuth, unchanged | OAUTH-005, OAUTH-006, OAUTH-007 |
| Ambient token selection | Extension resolver; store still wins | OAUTH-009, OAUTH-010, OAUTH-026 |
| Streaming, tools, compaction, reload | Native stream plus provider-local hooks | OAUTH-012 through OAUTH-018 |
| Install and removal | Pi package manifest | OAUTH-022, OAUTH-023 |

## Verification results

Commands actually run:

- Fresh sandboxed `capture-claude.py`: exit 0. User agent and billing matched `test/fixtures/claude-code-2.1.296.json`.
- Isolated `claude auth login --claudeai`: printed `https://claude.com/cai/oauth/authorize` and scope `user:plugins`. Client id matched Pi. Fake-code exchange returned HTTP 400; the token path was not isolated.
- Isolated print-mode and `auth status` precedence matrix: `ANTHROPIC_AUTH_TOKEN` beats `CLAUDE_CODE_OAUTH_TOKEN`. `ANTHROPIC_OAUTH_TOKEN` alone is not logged in. API key can win or be sent beside a bearer token.
- `bunx vitest run` in the package: 19 files, 238 tests passed.
- `npm run prove:paths`, `prove:context-guard`, and `prove:native` on Pi 1.1.0: exit 0. Reload now checks billing, user agent, and no `x-api-key`.
- Isolated `pi install --local`, list, `--list-models`, and `pi remove --local --approve`: exit 0. Disposable HOME only.
- `node .../validate-ledger.mjs parity/pi-anthropic-oauth/ledger.json --root .`: exit 0, verdict `NOT VERIFIED`.
- Three fresh `pi -p --no-session` reviews. Reconciliation is in `reviews/reconciliation.md`.

No live login, no live inference, and no global Pi settings change.

## Parity status

VERIFIED 9 · NOT VERIFIED 8 · INCONCLUSIVE 8 · NOT APPLICABLE 1

Critical gaps:

- OAUTH-007: Claude's authorize URL and `user:plugins` scope differ from Pi's native login. A second client was not built because the token path was not isolated and no live exchange was authorized.
- OAUTH-010: API-key precedence, dual `x-api-key` plus bearer, the extra `ANTHROPIC_OAUTH_TOKEN` alias, and stored-versus-environment order are not equivalent.
- OAUTH-012: case-colliding tools are dropped.
- OAUTH-016 and OAUTH-017: context accounting and request omission are local mitigations, not Claude's accounting.
- OAUTH-018, OAUTH-019, OAUTH-020: prompt, betas, catalog, and credential files differ on purpose.
- OAUTH-021 and OAUTH-025: live entitlement, billing, cache acceptance, and subscription permission were not observed.

Each VERIFIED row names a test or script that was run. Those rows are local or selected-capture contracts, not a claim that the whole OAuth ecosystem matches.

## Security and maintenance

Pi owns `auth.json`, refresh locking, and the Messages client. The extension owns request-local identity, ambient token order, and error wrapping. Abort reasons and `Login cancelled` pass through. Other login and refresh errors are fixed strings. Fixtures use synthetic tokens only. The public OAuth client id is recorded; PKCE verifiers are not.

Maintenance: recapture identity when Claude Code changes; do not read its binary. Do not replace Pi's authorize URL without a completed exchange test. A session reset during an in-flight compaction, and a system prompt containing `summarization assistant`, remain residual risks.

## Remaining gaps

Browser callback completion, refresh timing, interactive TUI precedence, stored Claude credentials, other operating systems, and service acceptance are unproven. Public docs fetches were not used as evidence. The fingerprint rule matches the captured text vectors and is not proven for arbitrary input.

## Final verdict

**NOT VERIFIED**

The validator derives that verdict. This is not 100% parity.
