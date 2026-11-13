# Chat

A logged-in user picks an Antigravity model and a thinking level and sends a prompt. The extension wraps Pi's transcript in the Cloud Code envelope, sends it to `streamGenerateContent` with `agy`'s user agent, and streams the reply back. The thinking level picks the Cloud Code model id for that effort, the way `agy --model <id> --effort <level>` does.

## Sub-features

- `chat-envelope`: `POST /v1internal:streamGenerateContent?alt=sse`, with body `{project, model, userAgent:"antigravity", requestType:"agent", requestId, request}`. Pi's system prompt goes in `systemInstruction`, and the prompt is a single `user` content.
- `chat-identity`: the `User-Agent` is `antigravity/cli/1.4.12 (aidev_client; os_type=<go os>; arch=<go arch>; cl=1010700967; auth_method=consumer)`, and the request carries `Authorization: Bearer <access>`.
- `chat-request-id`: the request id is `agent/<Pi session id>/<turn start ms>/<uuid-shaped turn id>/1` on the first step.
- `chat-effort`: Claude `low`/`high` map to `claude-sonnet-5-5-low`/`-high` with `thinkingLevel` `LOW`/`HIGH`. Thinking `off` maps to the lowest effort. For `gemini-3.1-pro`, `high` maps to the deprecated alias `gemini-pro-agent` (budget 10001), `low` maps to `gemini-3.1-pro-low` (budget 1001), and `medium` is clamped up to `high`.
- `chat-no-credential`: without a credential, Pi exits non-zero with `No API key found for google-antigravity`, and nothing reaches Cloud Code.

## How to get to it (user POV)

- `pi -p "..." --provider google-antigravity --model <id> --thinking <level>`.
- Interactive or RPC: select the model with `/model`, set the thinking level, and send a message.

## Driving it with control-antigravity-oauth

Preconditions:

- `doctor` passes. The drive writes the credential itself after the no-credential case.

Steps:

- **Run.** Run `./.pi/skills/verify-pi-antigravity-oauth/bin/control-antigravity-oauth drive chat`.
- **Act.** The drive runs seven `pi --offline -p "Reply LOCAL_OK."` processes: no credential; Claude `low`, `high`, and `off`; and Gemini 3.1 Pro `high`, `low`, and `medium`.
- **Observe.**
  - Every credentialed case prints `LOCAL_OK`, and the peer receives exactly one request per case.
  - Each request has the model id and `thinkingConfig` from `chat-effort`, plus the envelope and headers from `chat-envelope` and `chat-identity`.
  - The no-credential case reaches no request.
  - The egress log is empty.
- **Proof.** `artifacts/verify-pi-antigravity-oauth/chat/cases.json` holds every request, unmasked except for the bearer token.

## Gotchas

- Claude variants send `thinkingBudget: 0` with a `thinkingLevel`. The snapshot has no budget for them, and `variantOf` defaults the budget to 0. Gemini variants send only a budget.
- `--thinking medium` on a model with only `low` and `high` moves up to `high`. This comes from Pi's `clampThinkingLevel`, which the extension relies on by declaring only the efforts each model has. The README states the same rule.
- `CLOUD_CODE_URL` is read when the extension module loads, so set it in the Pi process environment. Setting it after startup does nothing, except in the provider-scoped `env` that Pi passes per request.
- The prompt-retry and empty-stream retry paths (429/5xx, a stream that closes early) are covered only by `stream.test.ts` and `provider-retry.test.ts`. No drive covers them.
