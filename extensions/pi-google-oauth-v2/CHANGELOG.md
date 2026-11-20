# Changelog

## [0.1.5]

- Fix every `bun lint` behavior error. Code Assist responses, catalog answers, token responses, and stream chunks are now parsed with zod at the boundary instead of cast. A malformed response now fails with a clear error instead of passing through unchecked. Stream hooks still receive each chunk exactly as Google sent it.

## 0.1.4

- Fix Google sign-in, which threw a `ZodError` on every login since 0.1.3 because `process.env` failed input validation.
- Rewrite every test as a user behavior test. Tests load the extension the way Pi does and drive login, refresh, model refresh, and streaming against a faked Google. They now live in `test/`.

## 0.1.3

- Refactor provider, pure stream reducer, request builder, and tests to adhere verbatim to `AGENTS.md` (immutable patterns, `zod` input validation, named constants, and small functions) with no behavior changes.

## 0.1.2

- Retain the full current Pi instructions, including the Pi identity and documentation, in a leading user-content turn. A static system directive delegates priority to that turn. This is not equivalent to transport-level system priority, and non-Gemini models remain unverified.
- Report Google's parsed error message and HTTP status for generic 429 responses instead of diagnosing shared capacity without evidence.
- Add offline instruction-replay coverage and a developer-only native Pi live verification script. Live verification remains a release gate.
- List every model the account's Code Assist catalog serves, one per family, instead of two fixed models. Pi's thinking levels pick the per-effort model id Google lists.

## 0.1.1

- Fix sign-in that failed with `UNSUPPORTED_CLIENT`. Google retired Gemini CLI's OAuth client for individual plans on 2026-06-18.
- Sign in with the Antigravity OAuth client and its five scopes. The paste flow uses `https://antigravity.google/oauth-callback`.
- Send Antigravity's `User-Agent` on every Code Assist request. Google gates on it.
- Call `loadCodeAssist` with the `ANTIGRAVITY` ideType, and show Google's `UNSUPPORTED_CLIENT` message verbatim.
- Send the Antigravity generate envelope: `userAgent`, `requestType`, `requestId`, `sessionId`, and a `user` system instruction role.
- Put the effort in the wire model id (`gemini-3.8-flash-medium`) from Pi's thinking level, and use the same effort for `thinkingLevel`.
- Ship `gemini-4-argon` and `gemini-3.8-flash`. Remove the Gemini CLI model list.

## 0.1.0

- Add a Google AI plan OAuth provider for Pi.
