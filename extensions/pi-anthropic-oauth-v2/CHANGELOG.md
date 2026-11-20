# Changelog

## 0.2.2

- Tests now pass `behavior-test-audit`, which allows them to drive the provider only through the extension Pi loads. No behavior changes.

## 0.2.1

- Refactor source, verification script, and tests to adhere verbatim to `AGENTS.md` (immutable patterns, named constants, small functions, and `zod` input validation) with no behavior changes.

## 0.2.0

- Replaces the provider with a reworked version of Pi's `custom-provider-anthropic` example. The provider is now `custom-anthropic`. `/claude-usage` and the OAuth-only request check are gone. After upgrading, sign in again with `/login custom-anthropic` and pick a `custom-anthropic/...` model.
- Sends requests with `@anthropic-ai/sdk` 1.10.0, which uses Claude API version `2026-10-21`.
- Offers every model in Pi's built-in Anthropic catalog, and uses adaptive thinking with effort on the models that need it.
- Reports API errors with the error name, HTTP status, and request ID.

## 0.1.0

- First release. Registers `anthropic-oauth-v2`, a provider that uses only Claude subscription OAuth and is built on Pi's own Anthropic login, Messages API, and model catalog.
