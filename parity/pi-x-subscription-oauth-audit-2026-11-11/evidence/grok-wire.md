# Grok Build wire capture, 2026-11-11

Captured with mitmdump. grok 1.0.77 `grok -p ... -m grok-4.5 --reasoning-effort low` vs `pi -p --model grok-build/grok-4.5:low` with pi-x-subscription-oauth 0.3.1. Both requests got HTTP 402 `Grok Build usage balance exhausted`. Identity values are replaced with `<present>`.

## POST /v1/responses headers

| header | grok 1.0.77 | pi extension |
|---|---|---|
| `accept` | text/event-stream | application/json |
| `accept-encoding` | gzip, br, zstd, deflate | br, gzip, deflate, zstd |
| `accept-language` | — | * |
| `authorization` | <present> | <present> |
| `content-type` | application/json | application/json |
| `sec-fetch-mode` | — | cors |
| `session-id` | — | 01a1ca83-780f-7477-ba5d-87fcd20ed396 |
| `traceparent` | <present> | — |
| `user-agent` | grok-shell/1.0.77 (macos; aarch64) | pi/1.5.2 (darwin; node/v24.22.1; arm64) |
| `x-authenticateresponse` | authenticate-response | — |
| `x-client-request-id` | — | 01a1ca83-780f-7477-ba5d-87fcd20ed396 |
| `x-compaction-at` | 204800 | — |
| `x-compactions-remaining` | 1 | — |
| `x-grok-agent-id` | <present> | — |
| `x-grok-client-identifier` | grok-shell | — |
| `x-grok-client-mode` | headless | — |
| `x-grok-client-version` | 1.0.77 | 1.0.70 |
| `x-grok-context-window` | — | 256000 |
| `x-grok-conv-group-id` | <present> | — |
| `x-grok-conv-id` | 01a1ca82-ff10-7a90-8b08-4dc0e2022bbb | 01a1ca83-780f-7477-ba5d-87fcd20ed396 |
| `x-grok-doom-loop-check` | 1024 | — |
| `x-grok-exact-repetition-check` | 64 | — |
| `x-grok-model-override` | grok-4.5 | grok-4.5 |
| `x-grok-req-id` | 8f126e9c-2210-4e31-ab51-ec843a20b104 | — |
| `x-grok-session-id` | 01a1ca82-ff10-7a90-8b08-4dc0e2022bbb | — |
| `x-grok-turn-idx` | 1 | — |
| `x-grok-user-id` | <present> | — |
| `x-stainless-arch` | — | arm64 |
| `x-stainless-lang` | — | js |
| `x-stainless-os` | — | MacOS |
| `x-stainless-package-version` | — | 7.19.0 |
| `x-stainless-retry-count` | — | 0 |
| `x-stainless-runtime` | — | node |
| `x-stainless-runtime-version` | — | v24.22.1 |
| `x-stainless-timeout` | — | 300 |
| `x-xai-token-auth` | xai-grok-cli | xai-grok-cli |

## Body top-level fields

| field | grok 1.0.77 | pi extension |
|---|---|---|
| `include` | `["reasoning.encrypted_content", "no_inline_citations"]` | `["reasoning.encrypted_content"]` |
| `input` | 4 items, roles ['system', 'user', 'user', 'user'] | 2 items, roles ['developer', 'user'] |
| `max_output_tokens` | — | `244805` |
| `model` | `"grok-4.5"` | `"grok-4.5"` |
| `prompt_cache_key` | session id | session id |
| `reasoning` | `{"effort": "low", "summary": "concise"}` | `{"effort": "low", "summary": "auto"}` |
| `store` | `false` | `false` |
| `stream` | `true` | `true` |
| `tools` | 28 tools | 4 tools |
