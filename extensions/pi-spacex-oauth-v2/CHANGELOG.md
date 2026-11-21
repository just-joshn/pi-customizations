# Changelog

## 0.2.5

- Update `README.md` and `CHANGELOG.md` to match the current Cursor key expiry, `/spacex-usage` output, Grok model filter, and runtime limits, and tighten the prose.

## 0.2.4

- Fix a Cursor tool call that arrives after its turn paused. It now runs in the next turn instead of being answered with "Pi returned no result".
- Fix leaked Cursor agents. A replaced idle agent is closed, `session_shutdown` closes every idle agent, and signing in with a new API key no longer reuses an agent made with the old one.
- `/spacex-usage` still shows the Cursor account when Grok billing fails, and the reverse.
- A Grok sign-in whose signal is already aborted rejects at once, and the poll wait no longer leaves an abort listener per poll.
- A Grok token endpoint reply that is not a token response reports its HTTP status.
- A failed live model refresh keeps the stored list (or the built-in one) and logs the error, instead of failing the refresh.
- Refactor: one `levelPlans` table drives both the thinking levels Pi offers and the model selection Cursor receives, one `refreshCatalog` serves both providers, and the Cursor run models its state as `streaming | batching | paused | done`.

## 0.2.3

- Fix the errors that `bun lint` reported. Stored model lists with a non-chat entry fall back to the built-in list. Cursor tool schemas are validated as JSON. An aborted login wait rejects with an `Error`.

## 0.2.2

- Rewrite every test as a user behavior test. Tests load the extension the way Pi does and drive sign-in, model lists, streaming, and `/spacex-usage` with fetch and `@cursor/sdk` faked. No behavior changes.

## 0.2.1

- Refactor the Cursor and Grok Build providers, the state cells, the API response validation with `zod`, and the tests to follow the repository's `AGENTS.md` coding rules. No behavior changes.

## 0.2.0

- Rebuild `spacex-cursor` on `@cursor/sdk` 1.4.2. Remove the private Cursor protocol client, its desktop OAuth flow, and the dashboard usage calls. Sign in to Cursor again with `/login` after you upgrade (#269).
- Create the Cursor API key through `Cursor.auth.login()` at `/login`. Store the key with the expiry time that the SDK returns. When the key expires, `/login` asks again. `CURSOR_API_KEY` also works.
- List every model from `Cursor.models.list()`. Pi's thinking level picks the model's effort value, and the context window comes from the default variant.
- Run Pi's tools inside Cursor's agent as SDK custom tools. A tool call pauses the Cursor run until Pi returns the result, and a follow-up message reuses the same Cursor agent.
- Report no token usage for Cursor turns, because the SDK reports usage per run and not per model call. Pi estimates context instead.
- Show the signed-in Cursor account in `/spacex-usage` instead of plan usage, which the SDK does not expose. Show only Grok Build in the status line.

## 0.1.2

- Fix the Cursor context size and context windows. Every assistant message carries the checkpoint `used_tokens` from Cursor as `totalTokens`, so the footer shows a percentage after a tool pause and after compaction. Context windows come from the `AvailableModels` tooltips in non-max mode. The window is 256k for Grok and Auto, and 200k for other models. A "1M" display name no longer sets a 1M window (#259).

## 0.1.1

- Rewrite the README for pi.dev. It now covers what the package is for, Install, Sign in, Commands, Notes, and how to replace `@justjoshn/pi-x-subscription-oauth` (#234).
- Shorten the package description to one sentence (#234).
- Add this changelog. The provider code is the same as in 0.1.0.

## 0.1.0

- Release the first version. Use the AI quota included with an X subscription in Pi, through two providers. Each provider has its own `/login` entry, token refresh, and live model list (#229).
- Add `spacex-grok` for Grok Build, with device-code sign-in and the models that Grok Build lists (#229).
- Add `spacex-cursor` for Cursor, with browser sign-in. Collapse the effort and fast variants of each Cursor model into one entry, and let Pi's thinking level pick the effort (#229).
- Add `/spacex-usage` and a status line. They show the included usage and reset time for Cursor, the credits for Grok Build, and the rate-limit headroom for Grok Build (#229).
- Publish the package. Make it public, declare its `repository` and its Pi peer dependencies, and ship only `src` and the README (#230).
