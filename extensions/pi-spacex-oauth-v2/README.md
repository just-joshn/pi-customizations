# pi-spacex-oauth-v2

Use your X subscription in Pi. The extension signs in the way Grok Build does, and runs Cursor models through the official Cursor TypeScript SDK (`@cursor/sdk`), so Pi can use the plan included with your X subscription. It is for people who already pay for X and want those models in Pi.

## Install

```sh
pi install npm:@justjoshn/pi-spacex-oauth-v2
```

Built and tested against Pi 1.5.2.

## Sign in

1. Start Pi and run `/login`.
2. Choose **Grok Build (X subscription)** or **Cursor (X subscription)** and complete the prompts. Grok Build shows a code to confirm in the browser. Cursor shows a sign-in link and mints a 90-day Cursor API key when you approve it. You can set `CURSOR_API_KEY` instead.
3. Run `/model` and pick a `spacex-grok` model if you signed in to Grok Build, or a `spacex-cursor` model if you signed in to Cursor.

Run `/login` again to add the other provider. Until the first refresh after sign-in, Pi lists `grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, and `grok-4.5` for Grok Build, and `composer-2.5` for Cursor. After that, each list comes from the service and is saved for offline starts. Cursor's list comes from `Cursor.models.list()`, and Pi's thinking level picks each model's effort.

## Commands

`/spacex-usage` shows plan usage for the accounts you signed in to:

- **Cursor.** The account the Cursor key belongs to. The SDK does not report plan usage, so check cursor.com/dashboard/usage.
- **Grok Build.** The credits used this billing period, plus the remaining requests and tokens from the rate-limit headers of your latest Grok Build response.

While a `spacex-grok` model is selected, Pi also shows the remaining Grok Build requests in the status line.

## Notes

- **Undocumented Grok endpoints.** Grok Build sign-in and requests use endpoints that Grok Build does not document, and the extension identifies itself as Grok Build. A change to an endpoint or client requirement can break them.
- **How Cursor runs.** Each Cursor turn runs a local Cursor SDK agent that sees only Pi's tools and an empty working directory. Pi's system prompt and history travel in the first message, because Cursor's `systemPrompt` option needs per-account access. When the model calls a tool, the Cursor run waits up to 30 minutes for Pi to return the result. Cursor turns report no token usage, so Pi estimates context from the transcript.
- **Your accounts only.** Use accounts you own.
- **Cost.** Subscription usage is not metered per token, so Pi shows no price.

## Replaces `@justjoshn/pi-x-subscription-oauth`

```sh
pi install npm:@justjoshn/pi-spacex-oauth-v2
pi remove npm:@justjoshn/pi-x-subscription-oauth
```

Then run `/login` again.

## Develop

```sh
bun run --filter @justjoshn/pi-spacex-oauth-v2 test
# Live check against Cursor: tool pause, resume, follow-up, abort.
CURSOR_API_KEY=... node extensions/pi-spacex-oauth-v2/scripts/verify-live.ts
```
