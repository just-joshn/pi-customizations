# Changelog

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
