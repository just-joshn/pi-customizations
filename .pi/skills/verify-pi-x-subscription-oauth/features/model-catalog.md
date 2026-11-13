# Model catalog

`/model` lists both providers' models. Before any refresh, `grok-build` lists four models (`grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`) plus four effort aliases (`grok-4.7-{low,medium,high,xhigh}-fast`), and `cursor` lists `composer-2.5`. Interactive Pi refreshes both catalogs at startup and when `/model` opens. Grok Build is read from `GET cli-chat-proxy.grok.com/v1/models`, and Cursor from `POST api2.cursor.sh/aiserver.v1.AiService/GetUsableModels`. Pi saves the result for later sessions. The drive proves the reuse with an offline `--list-models` only; it does not start a print or RPC session after the refresh.

## Sub-features

- `catalog-offline-baseline`: `pi --offline --list-models` shows the 8 `grok-build` ids and `cursor composer-2.5` without any request.
- `catalog-grok-refresh`: `GET /v1/models` with the bearer token. A row the proxy adds (`grok-4.9-verify`) appears. A row with `api_backend` other than `responses` is dropped.
- `catalog-grok-baseline-kept`: the four baseline models and aliases stay listed even when the refresh omits one (the peer leaves out `grok-4.6`).
- `catalog-cursor-refresh`: `POST …/GetUsableModels` with body `{}`, `Connect-Protocol-Version: 1`, `x-cursor-client-type: cli`, and `x-cursor-client-version: cli-2026.11.05-86047df`. The rows are deduplicated, and invalid ids are dropped. With `test/fixtures/cursor/usable-models.json` the result is `claude-sonnet-5`, `composer-2.5`, `default`.
- `catalog-saved`: after the TUI refresh, `pi --offline --list-models` shows the refreshed lists and sends no new requests.
- `catalog-alias-effort-dropped`: the refreshed `grok-4.7-build-fast` no longer offers `xhigh` (the peer lists only low, medium, high). `--model grok-build/grok-4.7-xhigh-fast` then fails with `grok-4.7-build-fast no longer offers xhigh reasoning. Supported: low, medium, high.` and sends no `/v1/responses` request.

## How to get to it (user POV)

- Start interactive `pi` and type `/model`. Type in the selector to filter.
- `pi --list-models grok-build` or `pi --list-models cursor`.

## Driving it with control-x-subscription-oauth

Preconditions:

- `doctor` passes, including `tmux`. Both `grok-build` and `cursor` credentials are stored.

Steps:

- **Run.** Run `./.pi/skills/verify-pi-x-subscription-oauth/bin/control-x-subscription-oauth drive model-catalog`.
- **Offline baseline.** The drive runs `pi --offline --list-models` (`list-models-offline.txt`). The peer saw 0 requests.
- **Refresh.** The drive starts the TUI without `--offline`, types `/model`, and presses Enter. It waits for both catalog requests and `Model catalogs refreshed.`.
- **Selector.** The drive types `verify` and the pane shows `grok-4.9-verify [grok-build]` (`model-selector-grok.txt`). It clears the filter and types `sonnet`, and the pane shows `claude-sonnet-5 [cursor]` (`model-selector-cursor.txt`).
- **Saved list.** The drive stops the TUI and runs `pi --offline --list-models` (`list-models-after-refresh.txt`). The output includes the refreshed ids, the 8 baseline ids, and no `grok-chat-only`. The peer request count is unchanged.
- **Dropped effort.** The drive runs `pi --offline -p 'Reply LOCAL_OK.' --model grok-build/grok-4.7-xhigh-fast`. It fails with the `no longer offers xhigh` error and sends nothing (`alias-effort-dropped.txt`).
- **Proof.** `steps.json` records the id lists and every catalog request with its summary, command output, requests, and stored credentials (scrubbed), and `egress.json` holds the refused tunnels and the guard log, which the harness checks after every drive.

## Gotchas

- Print and RPC modes never refresh. Only the interactive TUI (and only without `--offline`) calls the catalogs, so a stale `models-store.json` in the agent dir changes what print mode lists.
- The startup refresh and the `/model` refresh can both fire. The drive waits for "at least one" of each request, not an exact count.
- If the selector does not show the added model, check the requests in the `live refresh in /model` step of `steps.json` first. A request with no route gets a 404 from the peer, and the baseline stays listed.
