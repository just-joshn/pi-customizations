# Changelog

## Unreleased

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
