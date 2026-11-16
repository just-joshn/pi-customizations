# Changelog

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
