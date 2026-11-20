# Changelog

## 0.2.5

- Update `README.md` and `CHANGELOG.md` to match the current thinking, OAuth, caching, and error behavior, and tighten the prose.

## 0.2.4

- Fix token counts dropping to zero when a stream's closing `message_delta` leaves out input or cache counts. They now keep the values from `message_start`.
- Fix every stream sharing one empty usage object. Each stream now starts with its own.
- Fix a 400 from Anthropic when the thinking budget reached `max_tokens`. `max_tokens` now rises to the budget plus the requested output limit.
- Fix prompt caching skipping a conversation whose last user message is plain text. It is now sent as a cached text block.
- Merge small source files, replace the `isOAuth` flag threaded through message, tool, and stream conversion with one name codec, and share one validation helper. No other behavior changes.

## 0.2.3

- Fix the `bun lint` behavior errors. PKCE reads `webcrypto` from `node:crypto` instead of the experimental global. The stream reducers handle every Anthropic event and block type explicitly. Behavior does not change.

## 0.2.2

- Make the tests pass `behavior-test-audit`. The tests drive the provider only through the extension that Pi loads. Behavior does not change.

## 0.2.1

- Refactor the source, the verification script, and the tests to use immutable patterns, named constants, small functions, and `zod` input validation. Behavior does not change.

## 0.2.0

- Replace the provider with a reworked version of Pi's `custom-provider-anthropic` example. The provider is now `custom-anthropic`. Remove `/claude-usage` and the OAuth-only request check. After you upgrade, sign in again with `/login custom-anthropic` and select a `custom-anthropic/...` model.
- Send requests with `@anthropic-ai/sdk` 1.10.0, which uses Claude API version `2026-10-21`.
- Offer every model in Pi's built-in Anthropic catalog that uses the Messages API. Use adaptive thinking with effort on the models that need it.
- Report API errors with the error name, HTTP status, and request ID.

## 0.1.0

- Release the first version. Register `anthropic-oauth-v2`, a provider that uses only Claude subscription OAuth. It is built on Pi's own Anthropic login, Messages API, and model catalog.
