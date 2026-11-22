# Changelog

## 0.1.8

- Update `README.md` sign-in steps to match Pi's account-or-API-key login screen.

## 0.1.7

- Update `README.md` and `CHANGELOG.md` to document loopback login, `thinkingLevel` mapping, retries, `GOOGLE_CLOUD_PROJECT` precedence, and `verify-live.ts`, and tighten the prose.

## 0.1.6

- Fix sign-in that blamed `GOOGLE_CLOUD_PROJECT` (or silently used it) when onboarding returned an unfinished operation with no name. It now fails with an incomplete-operation error.
- Send tool call ids and nested tool result images the same way for models that are not a Gemini (Claude, gpt-oss) as for Gemini 3+. One wire profile now decides both, and only Gemini 2.x keeps the legacy shape.
- Fix retry waits that left one abort listener on the request signal per retry.
- Cancelling a sign-in now stops the onboarding poll wait at once.
- Split Code Assist calls from onboarding, extract the SSE reader, tool schema rewrite, and abortable sleep, and build the baseline models directly. Remove the loopback expiry error, unused error subclasses, and the reducer's dependency on the Code Assist client. No other behavior changes.

## 0.1.5

- Parse Code Assist responses, catalog responses, token responses, and stream chunks with zod instead of casting them.
- Fail with a clear error on a malformed response instead of passing it through.
- Pass each stream chunk to stream hooks exactly as Google sent it.

## 0.1.4

- Fix Google sign-in, which threw a `ZodError` on every login since 0.1.3 because `process.env` failed input validation.
- Rewrite every test as a user behavior test. The tests load the extension the way Pi does and drive login, refresh, model refresh, and streaming against a fake Google. They live in `test/`.

## 0.1.3

- Refactor the provider, stream reducer, request builder, and tests into small functions with immutable updates, zod input validation, and named constants.
- Keep behavior unchanged.

## 0.1.2

- Send the full current Pi instructions, including the Pi identity and documentation, in a leading user-content turn. A static system instruction gives that turn priority.
- Document that this is not equivalent to transport-level system priority, and that non-Gemini models remain unverified.
- Report Google's parsed error message and HTTP status for generic 429 responses instead of diagnosing shared capacity without evidence.
- Add offline instruction-replay tests and the `scripts/verify-live.ts` script for native Pi verification.
- List every model that the account's Code Assist catalog serves, one per family, instead of two fixed models.
- Select the per-effort model id that Google lists from Pi's thinking level.

## 0.1.1

- Fix sign-in that failed with `UNSUPPORTED_CLIENT` because Google no longer accepted Gemini CLI's OAuth client for individual plans.
- Sign in with the Antigravity OAuth client and its seven scopes.
- Use `https://antigravity.google/oauth-callback` for the pasted-code flow.
- Send Antigravity's `User-Agent` on every Code Assist request. Google rejects requests without it.
- Call `loadCodeAssist` with the `ANTIGRAVITY` `ideType`, and show Google's `UNSUPPORTED_CLIENT` message verbatim.
- Send the Antigravity generate envelope: `userAgent`, `requestType`, `requestId`, `sessionId`, and a system instruction with the `user` role.
- Put the effort in the wire model id, such as `gemini-3.8-flash-medium`, from Pi's thinking level. Set `thinkingLevel` from the same thinking level.
- Ship `gemini-4-argon` and `gemini-3.8-flash`. Remove the Gemini CLI model list.

## 0.1.0

- Add a Google AI plan OAuth provider for Pi.
