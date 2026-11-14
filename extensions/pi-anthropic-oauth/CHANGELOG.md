# Changelog

## [0.1.10] - 2026-11-14

- A 401 is retried only for a token this provider issued from its OAuth credential. A rejected ambient token or explicit API key is no longer resent as the stored or logged-out account.
- A leftover 0.1.5 share file is followed only when that version's claim on the current refresh token predates it, so a share file written while nothing had claimed the stored token can no longer replace the stored account. A share file carries no account, so one written by another login after such a claim, as when `auth.json` is restored from a backup, is still followed.
- Requests after a 401 recovery send the recovered token recorded in the rotation log instead of failing first with the stale one. Pi still persists it at its next expiry refresh; Pi 1.5 gives extensions no writable credential store.
- With no stored credential, the rotation log and any 0.1.5 share file are deleted the next time Pi resolves ambient auth, so tokens no longer stay on disk after `/logout`. Logging out or switching accounts also ends the 401-recovery lineage, so an old token is never retried as the logged-out or newly stored account. A request in flight when the logout or switch lands is not retried: recovery drops the retry, and skips the refresh, when the credential Pi stores in `auth.json` changed to a logout or another login after the request was sent. A host that keeps credentials elsewhere still recovers, and binding no store, it ends the lineage at its next auth resolution.
- With a bound credential store, a 401 recovery that finds another login stored no longer retries the request with that login's token. A stored token that replaced the rejected one is used only when the rotation log records it as that token's successor.
- A rotation log that cannot be read no longer fails requests; the stored token is sent.
- A refresh response that keeps the refresh token is recognized as a successor: later requests use it, a second process reuses it instead of failing with `ELOCKED`, and that successor can be refreshed again at once instead of waiting 30 seconds for its finished claim to go stale.
- The `cch` attestation anchors on the request's top-level `system` array, so a tool input with its own `system` array no longer leaves `cch=00000` in the body.
- When a single prompt's tool loop outgrows the window, fitting drops its oldest complete tool exchanges and keeps the prompt.
- Request fitting keeps the `tool_addition` and `tool_removal` blocks of a dropped prefix, so tools added mid-conversation stay defined.
- Only Pi's summarization prompt, recognized by its opening sentence, triggers single-prompt summarization fitting. A system prompt that merely mentions a summarization assistant no longer truncates the user's first prompt.
- Summarization fitting measures the text's cost under the calibrated bias, so it fits at the maximum bias of 2.
- `typebox` is now a peer dependency, as in the other packages here. Token responses, Claude Code credentials, account responses, the rotation log, and request tools are parsed with TypeBox schemas instead of casts. A roles response with a non-string role, or a token response whose `refresh_token` is neither a string nor null, is now rejected as malformed.
- Source-level API: `resolveClaudeOAuthEndpoints`, `rotateRefreshToken`, `tokenEndpointHttpError`, and `ClaudeCredentialReaders.readKeychain` take one object argument, and `assertTokenJsonShape` no longer takes a shape. `subscriptionAuth` returns both auth methods in its type, and `createAuthRecovery` takes `refresh`, a `recorded` lookup into the rotation log, and a `stored` reader of the host's stored credential. `subscriptionAuth`'s `rotation` takes that `stored` reader in place of `claimOptions.liveCredential`. `fetchOAuthProfile` reports `hasRequestId` instead of `stamped`.

## [0.1.9] - 2026-11-03

- Follow the repository Vitest rules in the test suite and unbind the refresh lock in the cancellation test. Source changes are formatting and import order only.
- Correct stale documentation against the current code, including versions, counts, paths and host requirements.

## [0.1.8] - 2026-11-02

- Document the Pi 1.5.0 upgrade target without relabeling Pi 1.4.0 runtime receipts as new evidence.
- Retain the provider-local identity and tool-name compatibility adapters. Public request events still do not name the physical receiving provider. Fresh request-path probes remain necessary to verify compaction hooks and static-header delivery.
- Do not claim complete Claude Code parity or live subscription acceptance from this documentation audit.
- Ship a versioned package-root changelog entry for Pi 1.5.0's extension update notices.

## [0.1.7]

- `pi` bearer token export no longer fails after a 401 recovery. A recorded successor credential needs 30 minutes left, the window the export asks for, or the refresh hook rotates it.
- A refresh whose successor cannot be written to the claim log still returns the new credential, so Pi persists it instead of losing the only valid token.

## [0.1.6]

- Every refresh, Pi's own expiry refresh included, now goes through the claim log in `claude-subscription-refresh.claims`. A finished claim records the credential that replaced its refresh token, so a caller holding a rotated token gets the newest credential instead of sending the old one, and Pi writes that credential to `auth.json`. `auth.json` no longer keeps a rotated refresh token for Pi to resend.
- A caller whose token was rotated by another session refreshes the newest token when that one has expired, not its own. A refresh that has started keeps its own 15 s timeout, so a claim wait or a cancelled request cannot abort it after the token endpoint has rotated the token.

## [0.1.5]

- A failed 401 refresh no longer ends the Pi process. The in-process refresh latch left an unhandled rejection whenever a refresh failed.
- With no credential store, cross-process 401 refresh now claims the refresh token instead of taking `claude-subscription-refresh.lock`. A claim is a file `<hash>.<generation>` in `claude-subscription-refresh.claims`, created exclusively, named by a hash of the refresh token, and never removed by another process. A stale claim is taken over by creating the next generation, so a crashed refresher can no longer let two recoveries send the same refresh token. Contended `ELOCKED` still stops after 5 retries.

## [0.1.4]

- Write the `cch` body attestation Claude Code 2.1.316's native HTTP layer adds to first-party `/v1/messages` requests: XXH64 (seed `0x4D659218E32A3268`, low 20 bits, five hex digits) over the body with the `model` value, `max_tokens`, `fallbacks` and `fallback_credit_token` removed. It runs in Pi's `fetch` seam. Reproduces both bodies captured from the real binary.
- Billing block now carries `cch`, `cc_prev_req` (previous response `request-id`), `cc_prompt_id`, `cc_turn_origin`, `cc_prompt_index` and `cc_turn_index`, and requests send `x-claude-code-prompt-id`, `x-claude-code-request-class` and a per-request `x-client-request-id`.
- `anthropic-beta` carries Claude's first-party beta set in Claude's order; Pi-only betas follow.
- `CLAUDE_CODE_OAUTH_CLIENT_ID` overrides the client id and drops the plugins scope. A custom OAuth base revokes at its own `/v1/oauth/token/revoke` and selects the `-custom-oauth` keychain service. `revokeAccessToken` and `revokeRefreshToken` resolve to Claude's acknowledgement (2xx with a `request-id`).
- Paste-code login uses Claude's prompt and rejection strings and requires `code#state`.
- Credential import reads `.credentials.json` as Claude does (no symlink, regular file, at most 1 MiB) and gives the keychain read Claude's 2 s timeout.
- Add `fetchOAuthProfile`, `validateOAuthToken`, `fetchOAuthRoles` and `createOAuthApiKey` for Claude's account endpoints.

## [0.1.3]

- Cross-process 401 refresh uses the bound credential store when one exists, so it does not lock `auth.json.lock` under Pi `AuthStorage`. With no store, waiters share `claude-subscription-refresh.lock`, re-read the rotated token before posting again, and replace a lock directory whose mtime is stale. Contended `ELOCKED` still stops after 5 retries, matching the 2.1.312 refresh-lifecycle fixture. The in-process latch is unchanged.
- Gate `CLAUDE_CODE_CUSTOM_OAUTH_URL` with Claude's three-host `ALLOWED_OAUTH_BASE_URLS` allowlist. Unset keeps prod cai endpoints.
- Pin request identity to Claude Code `2.1.316` (user agent and billing fingerprint version).

## [0.1.2]

- Add an opt-in `/login` choice that imports Claude Code `claudeAiOauth` from the macOS Keychain or `.credentials.json` into Pi `auth.json`.

## [0.1.1]

- Add an optional localhost browser-callback login beside the default paste-code path. Authorize and token exchange use the same `redirect_uri`.
- Replace the Pi builtin Anthropic OAuth wrap with a Pi-native Claude OAuth client (cai authorize, independent state, plugins login scope, Zxt refresh scope, copy-code).
- Stop accepting ambient `ANTHROPIC_OAUTH_TOKEN`. Keep `ANTHROPIC_AUTH_TOKEN` then `CLAUDE_CODE_OAUTH_TOKEN`.
- Add repository, homepage, and bugs metadata and a changelog to the npm package.
