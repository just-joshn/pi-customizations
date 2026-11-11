# pi-x-subscription-oauth parity audit, 2026-11-11

Goal. Check that `pi-x-subscription-oauth` 0.3.1 (commit 903b01dc) behaves like the real Grok Build CLI (grok 1.0.77) and Cursor CLI (cursor-agent 2026.11.05-86047df) on this Mac, with Pi 1.5.2.

Done predicate. Every parity row below is VERIFIED or MATCH, and the package's own gates pass. Result: **the predicate fails.** The package is not at 100% parity with either CLI. Seven rows are confirmed defects, and many more differ by design or by omission.

Limit on this audit. The shared X Subscription weekly pool was at 100% for the whole run. Every inference request from grok, cursor-agent and Pi was refused. A successful answer was never observed on any side, so every "answer content" row is INCONCLUSIVE.

Evidence:
- `evidence/gates-head.txt` holds the package gates.
- `evidence/grok-wire.md` and `evidence/live-results.md` hold the live captures.
- `evidence/grok-static.md` and `evidence/cursor-static.md` hold the binary and bundle analysis.
- `scripts/` holds the rerunnable probes.
- `decisions.tsv` is the decision trail.

Method disclosure. The real CLIs and Pi ran through a local mitmproxy with its CA trusted (`SSL_CERT_FILE` for grok, `NODE_EXTRA_CA_CERTS` for Node). grok's own session refresh and cursor-agent's `exchange_user_api_key` mint happened under that interception. Pi received only access tokens in an isolated `PI_CODING_AGENT_DIR`, never a refresh token. That directory and the raw flow logs were deleted after the run. The probes in `scripts/` read `/tmp/xaudit/piagent/auth.json`, so a rerun needs that file seeded again, and each rerun sends real traffic.

## Confirmed defects

| id | defect | evidence |
|---|---|---|
| D1 | `biome ci` fails at HEAD, so `make verify` is red. The cause is redundant parentheses at `src/usage.ts:133` (`(100 * 10)`). | `evidence/gates-head.txt`, `evidence/biome-usage-133.txt` |
| D2 | When Cursor refuses an ask for usage, Pi prints `Error`. cursor-agent prints `Weekly usage limit reached. It resets in 4 days. Buy credits...`. The server's end-stream JSON has `message: "Error"`, and the real text is in `details[0].debug.details.title`. `wire.ts:171-173` reads only `message`. This makes README line 37 ("Pi shows that error") false. | `scripts/cursor-native.mts`, `evidence/cursor-native-usage-limit-frames.json`, `live-results.md` |
| D3 | The 120 s Cursor limit counts the whole turn, not just the wait for the first output. A reply still streaming at the deadline throws `Cursor ask timed out.` and discards its text (`turn.ts:9,42`). CHANGELOG 0.3.0 says "a run with no assistant text stops after 120 seconds", and that is false. | `scripts/turn-deadline.mts` |
| D4 | CHANGELOG 0.3.0 says "Text that arrives after a 1.5 second gap stays in the reply". No 1.5 s logic exists in `src/`. | `grep 1500\|1.5 src/cursor/native` (empty) |
| D5 | The Cursor native transcript is flattened with no roles, assistant thinking is glued to the text, and Pi's system prompt and images are dropped. Every turn gets a new random conversation id. | `scripts/prompt-from.mts` |
| D6 | The Cursor native path always reports 0 tokens (`stream.ts:163` publishes `ZERO_USAGE`). The bundle shows that the server sends token counts at turn end and that cursor-agent reports them. This is static evidence only. No native turn completed during the run. | `cursor-static.md` row 9 |
| D7 | Cursor's `auto` model id is not accepted. The CLI lists `auto`; Pi lists `default`. A Pi-side Run with `auto` returns `AI Model Not Found`. That cursor-agent accepts `auto` is inferred from its listing and bundle, not from a run. | `live-results.md` |

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
| Identity and telemetry headers | MISMATCH | 14 headers that grok sends are absent from Pi's requests: client-identifier, client-mode, conv-group-id, req-id, session-id, agent-id, turn-idx, user-id, compaction-at, compactions-remaining, doom-loop-check, exact-repetition-check, traceparent, `x-authenticateresponse`. The user agent also differs. |
| Responses body | MISMATCH | Pi uses `summary: auto` where grok uses `concise`. Pi omits `no_inline_citations`. Pi sends `max_output_tokens: 244805`, which grok doesn't send. `store`, `stream`, `prompt_cache_key`, `model` and effort match. |
| Model catalog (live) | VERIFIED | 4 ids, 256000 window, same effort sets. |
| Default effort | MISMATCH | Grok uses `high`; Pi's default is `medium`. |
| 500000 context window | MISMATCH | Selectable in grok; in Pi it needs a `models.json` override. |
| `/usage` | VERIFIED against the raw billing JSON | Different fields from grok's own `/usage` rendering. Grok shows the on-demand cap and tier. Pi shows the product split. The billing request also differs: Pi sends version 1.0.70 and adds `X-XAI-Token-Auth`. |
| 402 balance exhausted | MATCH | Both make one request, no retry, and show an equivalent message. |
| Successful answer, cost meter (0.34 ratio) | INCONCLUSIVE | The pool was exhausted. |

## Cursor parity

| area | verdict | detail |
|---|---|---|
| macOS keychain names, access equals refresh JWT | VERIFIED | |
| Linux and Windows credentials, `CURSOR_API_KEY` | MISMATCH | The extension reads only the macOS keychain. |
| Refresh via `exchange_user_api_key` | VERIFIED | Live: same endpoint as cursor-agent, and the minted token lasted 60 min. |
| `/login` reuses a fresh keychain session | VERIFIED | |
| Model ids (276) | VERIFIED except D7 | |
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

`typecheck` exit 0. 215 tests passed. Coverage 89.74% statements, 81.63% branches. `prove:list` listed 8 ids. `biome ci` failed (D1).

## What would close the open rows

1. Rerun `scripts/` and the two `-p` asks after the pool resets on 2026-11-15T10:21Z. That closes the success, cost and stall rows.
2. Decide which parity this package targets. Header and transport identity is cheap to match. Full agent-mode parity with Cursor would mean answering exec requests and Pi tool calls, which is a redesign of the adapter.
