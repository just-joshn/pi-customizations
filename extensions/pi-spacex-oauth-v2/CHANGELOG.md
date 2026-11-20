# Changelog

## [0.2.3]

- Fix every `bun lint` behavior error. Stored model lists with a non-chat entry fall back to the built-in list, Cursor tool schemas are validated as JSON, and an aborted login wait rejects with an `Error`.

## 0.2.2

- Rewrite every test as a user behavior test. Tests load the extension the way Pi does and drive sign-in, model lists, streaming, and `/spacex-usage` with fetch and `@cursor/sdk` faked. No behavior changes.

## 0.2.1

- Refactor Cursor/Grok providers, state cells, API response validation (`zod`), and tests to adhere verbatim to `AGENTS.md` with no behavior changes.

## 0.2.0

- Rebuilds `spacex-cursor` on `@cursor/sdk` 1.4.2, following Pi's `custom-provider-anthropic` example and the Cursor TypeScript SDK docs. The private Cursor protocol client, its desktop OAuth flow, and the dashboard usage calls are gone. Sign in to Cursor again with `/login` after upgrading (#269).
- `/login` mints a Cursor API key through `Cursor.auth.login()`. The key lasts 90 days, then `/login` asks again. `CURSOR_API_KEY` also works.
- Lists every model from `Cursor.models.list()`. Pi's thinking level picks the model's effort value, and the context window comes from the default variant.
- Runs Pi's tools inside Cursor's agent as SDK custom tools. A tool call pauses the Cursor run until Pi returns the result, and a follow-up message reuses the same Cursor agent.
- Cursor turns report no token usage, because the SDK reports usage per run rather than per model call. Pi estimates context instead.
- `/spacex-usage` shows the signed-in Cursor account instead of plan usage, which the SDK does not expose. The status line shows Grok Build only.

## 0.1.2

- Fix Cursor context size and windows. Every assistant message carries Cursor's checkpoint `used_tokens` as `totalTokens`, so the footer can show a percent after a tool pause and after compaction. Context windows come from AvailableModels tooltips (non-max mode), with 256k for Grok and Auto and 200k otherwise. A "1M" display name no longer sets a 1M window (#259).

## 0.1.1

- Rewrite the README for pi.dev: what the package is for, Install, Sign in, Commands, Notes, and how to replace `@justjoshn/pi-x-subscription-oauth` (#234).
- Shorten the package description to one sentence (#234).
- Add this changelog. The provider code is the same as 0.1.0.

## 0.1.0

- First release. Use the AI quota included with an X subscription in Pi, through two providers that each have their own `/login` entry, token refresh, and live model list (#229).
- Add `spacex-grok` for Grok Build, with device-code sign-in and the models Grok Build lists (#229).
- Add `spacex-cursor` for Cursor, with browser sign-in. Cursor's effort and fast variants collapse to one entry per model, and Pi's thinking level picks the effort (#229).
- Add `/spacex-usage` and a status line that show Cursor's included usage and reset time, Grok Build credits, and Grok Build rate-limit headroom (#229).
- Publish the package: make it public, declare its `repository` and its Pi peer dependencies, and ship only `src` and the README (#230).
