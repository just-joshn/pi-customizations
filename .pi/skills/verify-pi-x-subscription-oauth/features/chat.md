# Grok Build chat

A prompt on a `grok-build` model goes to `POST https://cli-chat-proxy.grok.com/v1/responses` as Pi's standard OpenAI Responses request. The request carries the bearer token and the Grok Build identity headers. A thinking level becomes `reasoning.effort`. The four `grok-4.7-<effort>-fast` ids are Pi virtual models: each sends `grok-4.7-build-fast` with a fixed effort. `models.json` can override headers and the context window. An exhausted balance surfaces the proxy's 402 text.

## Sub-features

- `chat-headers`: `Authorization: Bearer <access>`, `x-grok-client-version: 1.0.70`, `X-XAI-Token-Auth: xai-grok-cli`, `x-grok-model-override: <model id>`, `x-grok-context-window: <context window>`, and `x-grok-conv-id`.
- `chat-body`: `model`, `reasoning.effort` equal to the thinking level, `store: false`, and an `include` list containing `reasoning.encrypted_content`.
- `chat-alias`: `grok-build/grok-4.7-xhigh-fast` sends `grok-4.7-build-fast` with effort `xhigh`. `grok-4.7-low-fast --thinking high` still sends `low`.
- `chat-models-json`: `providers.grok-build.headers["x-grok-client-version"]` wins over `1.0.70`. `modelOverrides["grok-4.7-build-fast"].contextWindow: 500000` makes `x-grok-context-window: 500000`.
- `chat-402`: a 402 `{"error":"Grok Build usage balance exhausted"}` prints `grok-build API error (402): 402 "Grok Build usage balance exhausted"`, exits 1, and is sent once with no retry.
- `chat-no-credential`: with no `grok-build` credential, Pi prints `No API key found for grok-build.` and sends nothing.
- `chat-conv-id`: in RPC, `x-grok-conv-id` equals `get_state.sessionId` on every turn of the session.

## How to get to it (user POV)

- `pi --model grok-build/grok-4.7 --thinking high -p "…"`, or `--model grok-build/grok-4.7-xhigh-fast`.
- Interactive: pick the model with `/model` and the effort with `/thinking`.
- RPC: `pi --mode rpc --provider grok-build --model grok-4.7`.

## Driving it with control-x-subscription-oauth

Preconditions:

- `doctor` passes. The peer answers `/v1/responses` with an SSE stream whose text is `LOCAL_OK`.

Steps:

- **Run.** Run `./.pi/skills/verify-pi-x-subscription-oauth/bin/control-x-subscription-oauth drive chat`. Every print-mode case runs `pi --offline -p 'Reply LOCAL_OK.' …`. The conv-id case uses RPC.
- **No credential.** The drive runs with `--provider grok-build --model grok-4.7` and an empty `auth.json`. Pi exits 1 and the peer gets 0 requests.
- **Headers and body.** With the credential stored, the drive runs `--thinking high`. Stdout is `LOCAL_OK`, and the request matches `chat-headers` and `chat-body`.
- **Aliases.** The drive runs `--model grok-build/grok-4.7-xhigh-fast`, then `--model grok-build/grok-4.7-low-fast --thinking high`.
- **models.json.** The drive writes `agent/models.json` with the header and context overrides and runs `--model grok-build/grok-4.7-build-fast --thinking medium`. The request shows client `1.0.60` and context `500000`.
- **402.** The drive switches the route to 402. Pi exits 1 with the 402 line, and the peer saw exactly one request.
- **Conv id.** The drive starts RPC, reads `get_state`, and sends two prompts. Both requests carry that `sessionId`.
- **Proof.** `steps.json` records each case with its summary, command output, requests, and stored credentials (scrubbed), and `egress.json` holds the refused tunnels and the guard log, which the harness checks after every drive.

## Gotchas

- `--no-session` still gives the RPC process a session id, and it is stable for the life of the process. A new process gets a new id, so compare ids within one RPC run only.
- The 402 body shape matters. Pi's OpenAI client prints `402 status code (no body)` unless the JSON body has an `error` field. The drive uses the shape the README quotes.
- If the effort for a virtual model is not offered, the error comes from the route at request time (`… no longer offers …`), not from `--list-models`.
- Pi does not fail on an unregistered model id. It warns `Using custom model id` and sends the request anyway, with the id in `body.model`. The alias cases therefore assert `body.model` is `grok-4.7-build-fast`, so a missing alias still fails the drive.
