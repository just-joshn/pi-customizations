# pi-anthropic-oauth-v2

Use Claude models in Pi with a custom Anthropic provider instead of Pi's built-in one. The extension is a reworked version of Pi's [`custom-provider-anthropic` example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/custom-provider-anthropic). It registers the provider `custom-anthropic`. The provider signs in with your Claude Pro or Max account, or reads an API key from `CUSTOM_ANTHROPIC_API_KEY`.

The models and their prices come from the models in Pi's built-in `anthropic` provider that use the `anthropic-messages` API. New Claude models appear when you update Pi. If Pi has no built-in Anthropic catalog, registration throws an error. Requests use `@anthropic-ai/sdk` 1.10.0, which uses Claude API version `2026-10-21`.

## Requirements

- Node `>=22.19.0`
- Pi 1.5.2. The extension is built and tested against this version.

## Install

```sh
pi install npm:@justjoshn/pi-anthropic-oauth-v2
```

## Sign in

1. Start Pi and run `/login custom-anthropic`.
2. Choose **Sign in with an account**.
3. Open the link, sign in to Claude, and paste the code that Claude shows.
4. Run `/model` and select a `custom-anthropic/...` model. Each model name is the Claude model name plus ` (Custom)`, such as **Claude Sonnet 4.6 (Custom)**.

To use an API key instead, choose **Sign in with an API key** in step 2, or set `CUSTOM_ANTHROPIC_API_KEY` before you start Pi.

The extension stores the OAuth expiry 5 minutes before the server's expiry time, so Pi refreshes the token early.

## Upgrade from 0.1.0

Version 0.2.0 renamed the provider from `anthropic-oauth-v2` to `custom-anthropic` and removed `/claude-usage`. Sign in again with `/login custom-anthropic` and select a `custom-anthropic/...` model. If your Pi settings name `anthropic-oauth-v2` as the default provider or model, change them to `custom-anthropic`.

## Request behavior

### Thinking

The extension sends thinking only when the model is a reasoning model and Pi requests a thinking level. Otherwise it omits thinking.

- **Adaptive thinking.** When `model.compat.forceAdaptiveThinking` is `true`, the request sets `thinking: { type: "adaptive", display: "summarized" }` and `output_config.effort`.
- **Token-budget thinking.** Other reasoning models set `thinking: { type: "enabled", budget_tokens, display: "summarized" }`. The request also sends the `interleaved-thinking-2025-05-14` beta header, for both OAuth and API-key sign-in.

The effort comes from `model.thinkingLevelMap` when the map has a non-null entry for the level. Otherwise `minimal` and `low` map to `low`, `medium` maps to `medium`, and `high` and any other level map to `high`.

The default token budgets are:

| Level | Budget |
| --- | --- |
| `minimal` | 1024 |
| `low` | 4096 |
| `medium` | 10240 |
| `high` | 20480 |

Pi's `thinkingBudgets` option overrides these values. A level with no budget uses 10240.

### Sign-in modes

The extension treats a credential as an OAuth token when it contains `sk-ant-oat`. OAuth requests carry the Claude Code identity:

- The `claude-code-20250219` and `oauth-2025-04-20` beta headers.
- The `user-agent` header `claude-cli/<version> (external, cli)`.
- The headers `x-app: cli` and `anthropic-dangerous-direct-browser-access: true`.
- The system line `You are Claude Code, Anthropic's official CLI for Claude.`
- Renamed tools. Pi tool names that match Claude Code's `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`, `AskUserQuestion`, `TodoWrite`, `WebFetch`, or `WebSearch` are renamed in OAuth requests and mapped back in responses. API-key requests keep Pi's names.

Any other credential is an API key. API-key requests send none of these items.

### Other request settings

- **Max tokens.** `max_tokens` is Pi's `maxTokens` option when set. Otherwise it is `Math.floor(model.maxTokens / 3)`. With token-budget thinking on and a budget at least that large, `max_tokens` becomes the budget plus that value, because Anthropic rejects a budget that reaches `max_tokens`.
- **Prompt caching.** The request adds an ephemeral `cache_control` entry to each system block and to the last block of the final user message.
- **Replayed thinking.** Thinking blocks that have no signature are sent back as plain text blocks. Signed thinking blocks are sent back as thinking blocks.
- **Tool input.** Each tool sets `eager_input_streaming`, so Claude streams tool arguments as partial JSON deltas.
- **Errors.** A failed request shows the SDK error name, the HTTP status, the request ID, and the API message, for example `RateLimitError 429 (request req_123): Slow down`. The extension also writes every failure to stderr with `console.error`.

## Develop

Run these commands from the repository root after `bun install`:

```sh
bun run --filter @justjoshn/pi-anthropic-oauth-v2 test
bun run --filter @justjoshn/pi-anthropic-oauth-v2 test:coverage
bun run --filter @justjoshn/pi-anthropic-oauth-v2 typecheck
npx tsx extensions/pi-anthropic-oauth-v2/scripts/verify-wire.ts
```

`scripts/verify-wire.ts` sends real SDK requests to a local server that answers like the Claude API. It checks the headers, the request body, and the parsed reply.
