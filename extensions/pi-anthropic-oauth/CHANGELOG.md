# Changelog

## [Unreleased]

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
