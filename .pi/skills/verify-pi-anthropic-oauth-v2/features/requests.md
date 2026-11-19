# Requests and errors

The extension sends requests through `@anthropic-ai/sdk` 1.10.0. Subscription logins carry the Claude Code identity headers and betas, and API keys go out as `x-api-key`. A failed request shows the SDK error name, HTTP status, request ID, and API message, for example `AuthenticationError 401 (request req_…): invalid x-api-key`.

## Sub-features

- `request-no-credentials`: a prompt with no login or key stops in Pi before any network call.
- `request-error`: an API error reaches the user in the extension's format.
- `request-api-key`: `CUSTOM_ANTHROPIC_API_KEY` supplies the key for this provider.
- `request-wire`: headers, body, and parsed reply against an Anthropic-shaped local server.

## How to get to it (user POV)

- Send a prompt with a `custom-anthropic/...` model selected.
- Start Pi with `CUSTOM_ANTHROPIC_API_KEY` set.

## Driving it with verify.py and tmux

Preconditions: fresh `init` and passing doctor per journey.

- **No credentials (zero network).** `"$V" print "$E" --feature request-no-credentials`. `print.json` must show exit 1 and `No API key found for custom-anthropic.` on stderr, with only `observer-loaded` rows in `network.jsonl`.
- **Error rendering (live, fake key).** `"$V" print "$E" --feature request-error --fake-api-key`. Require exit 1 and a stderr line matching `AuthenticationError 401 (request req_…): invalid x-api-key`, plus non-observer rows in `network.jsonl`. This sends one request with an obviously fake key to `api.anthropic.com`. It proves the API-key path reaches Anthropic and the error format. It does not prove a successful request.
- **Real API key.** The helper never forwards a real key. Use the login menu's API-key option with user consent (see [login](login.md)), or report `request-api-key` success as NOT VERIFIED.
- **Wire (supporting).** `npx tsx extensions/pi-anthropic-oauth-v2/scripts/verify-wire.ts` runs the real SDK against a local server and prints the captured request plus a rejected case such as `BadRequestError 400 (request req_wire_400): bad request`. It is not live Anthropic evidence.

## Gotchas

- stderr also holds the full SDK error dump from `console.error`, including response headers. The extension does this on purpose. Match the final formatted line.
- Print mode exits 1 for both the missing-credentials and the API-error case. Check the stream contents, not only the code.
- Never use a real API key as a canary, and never commit `print.json` from a real-key run.
