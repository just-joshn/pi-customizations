# pi-x-subscription-oauth parity audit, 2026-11-11

Goal. Check that `pi-x-subscription-oauth` 0.3.1 (commit 903b01dc) behaves like the real Grok Build CLI (grok 1.0.77) and Cursor CLI (cursor-agent 2026.11.05-86047df) on this Mac, with Pi 1.5.2.

Done predicate. Every parity row below is VERIFIED or MATCH, and the package's own gates pass. Result: **the predicate fails.** The package is not at 100% parity with either CLI. Six rows are confirmed defects, and many more differ by design or by omission. An interrogation of the first version of this report (commit ec1ddc64) found ten errors in it. This version corrects them; `decisions.tsv` logs each fix.

Limit on this audit. The shared X Subscription weekly pool was at 100% for the whole run. Every inference request from grok, cursor-agent and Pi was refused. A successful answer was never observed on any side, so every "answer content" row is INCONCLUSIVE.

Evidence:
- `evidence/gates-head.txt` holds the package gates.
- `evidence/grok-wire.md` and `evidence/live-results.md` hold the live captures.
- `evidence/grok-static.md` and `evidence/cursor-static.md` hold the binary and bundle analysis.
- `evidence/billing-credits-raw.json`, `evidence/pi-usage-output.txt`, `evidence/grok-catalog-ids.json`, `evidence/cursor-catalog-ids.json` and `evidence/cursor-agent-list-models.txt` hold the raw outputs behind the `/usage` and catalog rows.
- `scripts/` holds the rerunnable probes. They import the extension relative to this folder, so a rerun tests the checked-out code. Run them from the repo root with `node --experimental-strip-types parity/pi-x-subscription-oauth-audit-2026-11-11/scripts/<name>.mts`. Typecheck them with `extensions/pi-x-subscription-oauth/node_modules/.bin/tsc -p parity/pi-x-subscription-oauth-audit-2026-11-11/scripts/tsconfig.json --noEmit`. `scripts/count-headers.sh` and `scripts/compare-cursor-ids.py` recount the committed evidence.
- `decisions.tsv` is the decision trail.

Method disclosure. The real CLIs and Pi ran through a local mitmproxy with its CA trusted (`SSL_CERT_FILE` for grok, `NODE_EXTRA_CA_CERTS` for Node). grok's own session refresh and cursor-agent's `exchange_user_api_key` mint happened under that interception. Pi received only access tokens in an isolated `PI_CODING_AGENT_DIR`, never a refresh token. That directory and the raw flow logs were deleted after the run. The live probes read `$PI_CODING_AGENT_DIR/auth.json` (default `/tmp/xaudit/piagent/auth.json`, see `scripts/audit-env.mts`, which refuses `~/.pi/agent`), so a rerun needs that file seeded again, and each rerun sends real traffic. `prompt-from.mts`, `turn-deadline.mts`, `retry-classify.mts` and `fallback-cap.mts` are offline.

## Confirmed defects

Ids stay stable across revisions. D4 is withdrawn: the CHANGELOG's 1.5 s gap sentence is true, and `test/native.test.ts` "later text still joins the reply" passes with a 1.6 s gap. D7 moved to the Cursor table as an alias mismatch, because the CLI sends the same `default` id on the wire.

| id | defect | evidence |
|---|---|---|
| D1 | The package-scoped lint check `bunx biome ci extensions/pi-x-subscription-oauth --error-on-warnings` fails at 903b01dc. Its only error is redundant parentheses at `src/usage.ts:133` (`(100 * 10)`). `make verify` was already red for other reasons: repo-wide `bun run ci` reports 10 errors at 903b01dc, and 9 of them are in `extensions/pi-pstack/**` and `parity/pi-native-parity-2026-11-09/**`. | `evidence/gates-head.txt`, `evidence/biome-usage-133.txt` |
| D2 | When Cursor refuses an ask for usage, Pi prints `Error`. cursor-agent prints `Weekly usage limit reached. It resets in 4 days. Buy credits...`. The server's end-stream JSON has `message: "Error"`, and the real text is in `details[0].debug.details.title`. `wire.ts:171-173` reads only `message`. This makes README line 37 ("Pi shows that error") false. | `scripts/cursor-native.mts`, `evidence/cursor-native-usage-limit-frames.json`, `live-results.md` |
| D3 | The 120 s Cursor limit counts the whole turn, not just the wait for the first output. CHANGELOG 0.3.0 says "a run with no assistant text stops after 120 seconds". That sentence is true, but incomplete: a run that is still streaming text also stops. The reply throws `Cursor ask timed out.` and discards its text. Pi 1.5.2 classifies that message as retryable (`scripts/retry-classify.mts`), and its default `retry.maxRetries` is 3. So one long reply becomes up to 4 server runs, about 8 minutes, each with a new conversation id, before it fails (`turn.ts:9,42`). CHANGELOG 0.3.0 says "a run with no assistant text stops after 120 seconds", and that is false. | `scripts/turn-deadline.mts` |
| D5 | The Cursor native transcript is flattened with no roles, assistant thinking is glued to the text, and Pi's system prompt and images are dropped. Every turn gets a new random conversation id. | `scripts/prompt-from.mts` |
| D6 | The Cursor native path always reports 0 tokens (`stream.ts:163` publishes `ZERO_USAGE`). The bundle shows that the server sends token counts at turn end and that cursor-agent reports them. This is static evidence only. No native turn completed during the run. | `cursor-static.md` row 9 |
| D8 | The `cursor-agent` fallback has the same hard cap. `stream.ts:99` runs `execFile` with `timeout: 120_000`. A cursor-agent that answers successfully after 130 s is killed, and Pi shows `cursor-agent exited 1.` | `scripts/fallback-cap.mts` (it puts `scripts/fakebin` first on `PATH` itself), `evidence/fallback-cap-output.txt`, and the package test "a quiet non-zero exit reports the process failure" for the message |

## Grok Build parity

| area | verdict | detail |
|---|---|---|
| OAuth client id, issuer, scope, authorize URL (9 params, order, `referrer=grok-build`), loopback `/callback`, PKCE S256 | MATCH | The 1.0.70 and 1.0.77 binaries have byte-identical builder text (`grok-static.md` row 1). |
| Default sign-in method (README says browser) | UNKNOWN | `grok login --help` says device code, the guide says browser, and the binary reads a remote `/login-config`. |
| Device code endpoint and fields | MATCH | |
| Device code UX | MISMATCH | Pi ignores `verification_uri_complete`, doesn't auto-open the browser, and has a 1 s poll floor. |
| Refresh endpoint, 300 s skew, rotated token stored | MATCH (static) | Not exercised live, because that would rotate grok's own refresh token. |
| 401 during inference | MISMATCH | Grok refreshes and retries. Pi fails the turn by design (README line 68). Pi's message for a bad token was observed live. |
| `x-grok-client-version` | MISMATCH | Pi sends 1.0.70 and grok sends 1.0.77. The server accepts both today (minimum 1.0.13). |
| `X-XAI-Token-Auth`, `x-grok-model-override`, `x-grok-conv-id` | MATCH | Observed live. |
| `x-grok-context-window` | MISMATCH | Pi always sends it. Grok 1.0.77 omitted it at the default window. |
| Identity and telemetry headers | MISMATCH | `scripts/count-headers.sh` counts 14 headers that grok sends and Pi does not: client-identifier, client-mode, conv-group-id, req-id, session-id, agent-id, turn-idx, user-id, compaction-at, compactions-remaining, doom-loop-check, exact-repetition-check, traceparent, `x-authenticateresponse`. It counts 13 that Pi sends and grok does not: the 8 `x-stainless-*` headers from the OpenAI SDK, `session-id`, `x-client-request-id`, `x-grok-context-window`, `accept-language` and `sec-fetch-mode`. `accept` also differs: Pi sends `application/json`, grok sends `text/event-stream`. The user agent also differs. |
| Responses body | MISMATCH | Pi sends the system prompt as role `developer`; grok sends role `system`. Pi uses `summary: auto` where grok uses `concise`. Pi omits `no_inline_citations`. Pi sends `max_output_tokens: 244805`, which grok doesn't send. `store`, `stream`, `prompt_cache_key`, `model` and effort match. |
| Model catalog (live) | VERIFIED | 4 ids, 256000 window, same effort sets (`evidence/grok-catalog-ids.json` vs `~/.grok/models_cache.json` in `grok-static.md`). |
| Default effort | MISMATCH | Grok uses `high`; Pi's default is `medium`. |
| 500000 context window | MISMATCH | Selectable in grok; in Pi it needs a `models.json` override. |
| `/usage` | VERIFIED against the raw billing JSON (`evidence/billing-credits-raw.json` and `evidence/pi-usage-output.txt`) | Different fields from grok's own `/usage` rendering. Grok shows the on-demand cap and tier. Pi shows the product split. The billing request also differs: Pi sends version 1.0.70 and adds `X-XAI-Token-Auth`. |
| 402 balance exhausted | MATCH | Both make one request, no retry, and show an equivalent message. |
| Successful answer, cost meter (0.34 ratio) | INCONCLUSIVE | The pool was exhausted. |

## Cursor parity

| area | verdict | detail |
|---|---|---|
| macOS keychain names, access equals refresh JWT | VERIFIED | |
| Linux and Windows credentials, `CURSOR_API_KEY` | MISMATCH | The extension reads only the macOS keychain. |
| Refresh via `exchange_user_api_key` | VERIFIED | Live: same endpoint as cursor-agent, and the minted token lasted 60 min. |
| `/login` reuses a fresh keychain session | VERIFIED | |
| Model aliases (`auto`) | MISMATCH | Pi does not accept the CLI's model aliases. `cursor-agent --list-models` shows `auto`, Pi lists `default`. On the wire the CLI also sends `default`: the bundle's `buildRequestedModel` uses `modelId`, and its alias map resolves `auto` to the `default` row. A Pi request with `default` therefore reaches the same model. The gap is that `catalog.ts` drops `displayModelId` and `aliases`, so `--model cursor/auto` cannot resolve. A raw Run with `auto` returns `AI Model Not Found` from any client. |
| Model ids (276) | VERIFIED | `scripts/compare-cursor-ids.py` on `evidence/cursor-catalog-ids.json` and `evidence/cursor-agent-list-models.txt` prints `pi 276 cli 276 only cli ['auto'] only pi ['default']`. |
| Model metadata | MISMATCH | Pi hard-codes a 200k window, no reasoning and text-only input. The CLI reads limits, thinking, images and max mode from AvailableModels. |
| Catalog `x-ghost-mode` | MISMATCH | Pi sends `false`; the CLI sends `true` for this privacy-mode account. |
| Run host | MISMATCH | Pi uses `api2.cursor.sh`; the CLI uses the server-configured `agentn.global.api5.cursor.sh`. api2 still accepted the stream. |
| Run headers | MISMATCH | Ghost mode and timezone are hard-coded. `x-blob-encryption-key`, `x-original-request-id` and the trace headers are missing. |
| Run frame field numbers, ask mode = 2 | MATCH | |
| Model parameters | MISMATCH | Pi sends `fast=false` for every model, with no effort or context parameters. |
| Exec requests other than request_context | MISMATCH | Ask mode is read-only, not tool-free, so README line 37 is wrong. Unanswered read, grep or ls requests stall the turn until D3's deadline. Not reproduced live (every ask was refused). |
| Heartbeats and pings | MISMATCH | Effect on long turns unknown. |
| RequestContext reply | MISMATCH | Pi's reply is empty; the CLI's has the environment, rules and git info. |
| Error mapping | MISMATCH | See D2. HTTP 429 is assumed to mean "credits". |
| Usage tokens | MISMATCH | See D6. |
| cursor-agent fallback flags and JSON schema | VERIFIED | |
| Pi tools with Cursor models | MISMATCH by design | The adapter runs ask mode, so Pi's tools are never offered to Cursor models. |
| Successful answer | INCONCLUSIVE | The pool was exhausted. |

## Package gates at HEAD

`typecheck` exit 0. 215 tests passed. Coverage 89.74% statements, 81.63% branches. `prove:list` listed 8 ids. Package-scoped `biome ci` failed (D1). This audit folder passes `bunx biome ci parity/pi-x-subscription-oauth-audit-2026-11-11 --error-on-warnings`, so it adds nothing to the repo-wide lint count.

## What would close the open rows

1. Rerun `scripts/` and the two `-p` asks after the pool resets on 2026-11-15T10:21Z. That closes the success, cost and stall rows.
2. Decide which parity this package targets. Header and transport identity is cheap to match. Full agent-mode parity with Cursor would mean answering exec requests and Pi tool calls, which is a redesign of the adapter.
