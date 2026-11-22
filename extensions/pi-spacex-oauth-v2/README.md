# pi-spacex-oauth-v2

Use the Grok Build and Cursor models in your X subscription from Pi. Grok Build signs in with a device code, using Grok Build's own OAuth client. Cursor models run through the official Cursor TypeScript SDK, `@cursor/sdk`.

## Install

```sh
pi install npm:@justjoshn/pi-spacex-oauth-v2
```

Built and tested against Pi 1.5.2. The package requires Node `>=22.19.0`.

## Sign in

1. Start Pi and run `/login`.
2. Choose **Sign in with an account**, then **Grok Build (X subscription)** or **Cursor (X subscription)**.
3. For Grok Build, confirm the code that Pi shows in the browser.
4. For Cursor, open the sign-in link that Pi shows and approve it. For an existing Cursor key, choose **Sign in with an API key** or set `CURSOR_API_KEY` instead.
5. Run `/model` and pick a `spacex-grok` model for Grok Build or a `spacex-cursor` model for Cursor.

Run `/login` again to add the other provider.

Cursor sign-in stores the API key and the expiry time that the Cursor SDK returns. The key cannot be refreshed. When it expires, Pi fails the request and tells you to run `/login` again.

## Models

Before the first refresh after sign-in, Pi lists these built-in models:

- Grok Build: `grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, and `grok-4.5`.
- Cursor: `composer-2.5`.

After the first refresh, each list comes from the service and is saved for offline starts. The Grok Build list keeps only models whose `api_backend` is `responses`, or is not set. The Cursor list comes from `Cursor.models.list()`.

Every model reports a cost of 0, so Pi shows no price. Every model accepts text and image input.

Pi's thinking level maps to the model's parameters. Grok Build models accept the reasoning efforts `low`, `medium`, `high`, and `xhigh` that the service lists for them. Cursor models use their `effort`, `reasoning_effort`, or `reasoning` parameter. A model with only a `thinking` parameter turns thinking on or off.

## Commands

`/spacex-usage` shows usage for the accounts you signed in to:

- **Cursor.** Shows the email, or the API key name, of the signed-in account. The SDK does not report plan usage, so open the [Cursor usage dashboard](https://cursor.com/dashboard/usage).
- **Grok Build billing.** Shows the credits used and the end date of the billing period.
- **Grok Build rate limit.** Shows `remaining/limit` for requests and for tokens. This line appears after a Grok Build response has returned rate-limit headers.

While a `spacex-grok` model is selected, Pi also shows `N req left` in the status line. It appears after a Grok Build response returns rate-limit headers.

## Notes

- **Undocumented Grok endpoints.** Grok Build sign-in and requests use endpoints that Grok Build does not document. The extension sends Grok Build's client name and version in its request headers. A change to an endpoint or client requirement can break them.
- **Cursor agents.** Each Cursor turn runs a local Cursor SDK agent in `<tmpdir>/pi-spacex-cursor`, a dedicated directory. The extension creates it and does not load a project into it. The agent has only the `mcp` tool group enabled, plus Pi's tools as custom tools. Pi sends its system prompt and history in the first message to a new agent, because Cursor's `systemPrompt` option needs per-account access.
- **Idle agents.** When a turn ends, the agent stays idle so a follow-up message in the same conversation reuses it. The extension keeps up to 16 idle agents.
- **Tool calls.** When the model calls a tool, the Cursor run waits up to 30 minutes for Pi to return the result.
- **Context size.** Cursor turns report no token usage, so Pi estimates context from the transcript.

## Replaces `@justjoshn/pi-x-subscription-oauth`

```sh
pi install npm:@justjoshn/pi-spacex-oauth-v2
pi remove npm:@justjoshn/pi-x-subscription-oauth
```

Then run `/login` again.

## Develop

```sh
bun run --filter @justjoshn/pi-spacex-oauth-v2 test
bun run --filter @justjoshn/pi-spacex-oauth-v2 typecheck
bun run --filter @justjoshn/pi-spacex-oauth-v2 test:coverage
# Live check against Cursor: tool pause, resume, follow-up, abort.
CURSOR_API_KEY=... node extensions/pi-spacex-oauth-v2/scripts/verify-live.ts
```
