# pi-anthropic-oauth-v2

Use Claude models in Pi through your own streaming code instead of Pi's built-in Anthropic provider. The extension is a reworked version of Pi's [`custom-provider-anthropic` example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/custom-provider-anthropic). It adds the provider `custom-anthropic`, which signs in with your Claude Pro or Max account or reads an API key from `CUSTOM_ANTHROPIC_API_KEY`.

The models and their prices come from Pi's built-in Anthropic catalog, so new Claude models appear when you update Pi. Requests go through `@anthropic-ai/sdk` 1.10.0, which uses Claude API version `2026-10-21`.

## Install

```sh
pi install npm:@justjoshn/pi-anthropic-oauth-v2
```

Built and tested against Pi 1.5.2.

## Sign in

1. Start Pi and run `/login`.
2. Choose **Custom Anthropic (Claude Pro/Max)**.
3. Open the link, sign in to Claude, and paste the code that Claude shows.
4. Run `/model` and pick a `custom-anthropic/...` model.

To use an API key instead, set `CUSTOM_ANTHROPIC_API_KEY` before you start Pi.

## How requests are sent

- **Thinking.** Models that Pi's catalog marks for adaptive thinking get `thinking: { type: "adaptive" }` with an `output_config.effort` that matches the Pi thinking level. Older models get a token budget. Both ask for summarized thinking.
- **Subscription sign-in.** Requests carry the Claude Code identity: the system prompt line, the `claude-cli` user agent, and the `claude-code-20250219` and `oauth-2025-04-20` betas. Pi tool names that match Claude Code tools are renamed on the way out and back.
- **Tool input.** Each tool sets `eager_input_streaming`, so tool arguments stream as Claude writes them.
- **Errors.** A failed request shows the SDK error name, the HTTP status, the request ID, and the API message, for example `RateLimitError 429 (request req_123): Slow down`. Every failure is also written to stderr with `console.error`.

## Develop

```sh
bun run --filter @justjoshn/pi-anthropic-oauth-v2 test
bun run --filter @justjoshn/pi-anthropic-oauth-v2 typecheck
npx tsx extensions/pi-anthropic-oauth-v2/scripts/verify-wire.ts
```

`scripts/verify-wire.ts` sends real SDK requests to a local server that answers like the Claude API. It checks the headers, the request body, and the parsed reply.
