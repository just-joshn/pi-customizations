# Claude subscription for Pi

This Pi package lets a Claude Pro or Max subscription answer in Pi. Requests identify as Claude Code. The package does not depend on `@anthropic-ai/sdk`. It sends the Messages API with `fetch` and registers a provider through `pi.registerProvider()`.

Pi's built-in Anthropic provider still uses an API key, or its own SDK-backed subscription login. This package adds a separate provider, `claude-subscription`, so the two credentials stay apart.

## Use it

From this directory:

```bash
pi -e .
```

Then run `/login` and choose Claude subscription. Pick a `claude-subscription` model with `/model`.

Install it for later sessions with `pi install` and the path to this directory, or publish the package and install that npm name.

## What Anthropic sees

Subscription requests use bearer auth, `user-agent: claude-cli/<version>`, `x-app: cli`, and the `claude-code-20250219` and `oauth-2025-04-20` beta headers. The first system block is Claude Code's preamble. The default version is `2.1.280`. Set `CLAUDE_CODE_VERSION` to send a different one.

The OAuth client, token URL, and redirect URI match Pi 0.87.1's Claude Pro/Max login. The token URL is `https://platform.claude.com/v1/oauth/token`. The callback is `http://localhost:53692/callback`. If that port is taken, paste the redirect URL at the prompt.

## What this does not do

It does not bill an API key. It does not send the SDK's `Anthropic/JS` user agent or `x-stainless-*` headers. It does not retry inside the stream. Pi retries rate limits and transient failures after the stream reports the error. Overflow text from Anthropic is left intact so Pi can compact.
