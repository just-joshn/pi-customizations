# Live results, 2026-11-11

References are grok 1.0.77 and cursor-agent 2026.11.05-86047df on this Mac. The extension is pi-x-subscription-oauth 0.3.1 at commit 903b01dc, loaded with `pi --no-extensions -e extensions/pi-x-subscription-oauth` in an isolated `PI_CODING_AGENT_DIR`. Pi is 1.5.2.

Credential handling. Pi never received a refresh token from either CLI. The Grok Build entry holds the access token that grok minted after its own refresh, with a placeholder refresh value. The Cursor entry holds the keychain JWT, which is what `/login` copies. Traffic was captured with mitmdump (`scripts/log.py`). Pi's native Cursor HTTP/2 path does not use the proxy, so its frames were read through `scripts/cursor-native.mts`, which calls the extension's own `openCursorRun`, `encodeRunFrame`, and `decodeFrame`.

The X Subscription weekly pool was at 100% for the whole run. Every inference request on both CLIs and on Pi was refused. Success paths for inference are therefore INCONCLUSIVE, not passed.

## Grok Build

| check | grok 1.0.77 | Pi extension | verdict |
|---|---|---|---|
| one-shot ask on grok-4.5 low | HTTP 402, `API error (status 402 Payment Required): Grok Build usage balance exhausted`, no retry | HTTP 402, `grok-build API error (402): 402 "Grok Build usage balance exhausted"`, no retry | 402 path MATCH, success INCONCLUSIVE |
| request headers and body | see `grok-wire.md` | see `grok-wire.md` | MISMATCH, 14 grok headers absent, 1 extra, version 1.0.70 vs 1.0.77 |
| live `/v1/models` | `models_cache.json`: grok-4.7, grok-4.7-build-fast, grok-4.6, grok-4.5, 256000 default window, 500000 optional, efforts low..xhigh (4.5 low..high), default effort high | `scripts/grok-catalog.mts` with `allowNetwork: true`: same 4 ids, 256000, same effort sets | VERIFIED |
| `/usage` | `grok usage` CLI prints "can't show your plan's usage here yet. Run /usage inside grok" | `pi -p /usage` printed `Weekly 2026-11-08T10:21:35.220+00:00 to 2026-11-15T10:21:35.220+00:00: 100% used, 0% left, resets in 3d 22h 12m`, `Cursor: 78%`, `GrokBuild: 22%`, `Prepaid: 0`, `Unified: yes` | VERIFIED against the raw billing JSON; Grok TUI rendering not compared |
| expired or invalid token | grok refreshed its expired session before the ask (auth.json `expires_at` moved from 2026-11-10T05:12Z to 2026-11-11T18:08Z) | bogus token: inference `grok-build API error (401) ... Invalid or expired credentials`; `/usage` `Grok Build rejected the session (HTTP 401). Run /login and choose Grok Build.` | MATCH on message, no in-package retry by design |

## Cursor

| check | cursor-agent | Pi extension | verdict |
|---|---|---|---|
| keychain access vs refresh item | same JWT (compared in shell, value never printed) | README says same JWT | VERIFIED |
| expired JWT refresh | 401 on GetMe, then `POST /auth/exchange_user_api_key` body `{}`, bearer API key, response `accessToken` and `refreshToken` | `scripts/cursor-refresh.mts`: same endpoint, minted a 60 minute token; bad key gives `Cursor is not logged in. Run /login and choose Cursor.` | VERIFIED |
| `/login` with a fresh keychain session | n/a | `loginCursor` returned the keychain session without spawning `cursor-agent login` | VERIFIED |
| model list | `cursor-agent --list-models`: 276 rows, first `auto` | live GetUsableModels via the provider: 276 rows; only diff is `default` (Pi) vs `auto` (CLI). Every model is 200000 context, `reasoning: false`, text only | 276/276 ids VERIFIED; `auto` alias and model metadata MISMATCH |
| catalog request | `application/proto`, `x-ghost-mode: true` (account privacy mode on), no JSON | Connect JSON, `x-ghost-mode: false` | MISMATCH on ghost mode, transport encoding differs but server accepts |
| Run host | `https://agentn.global.api5.cursor.sh/agent.v1.AgentService/Run` | `https://api2.cursor.sh/agent.v1.AgentService/Run` | MISMATCH, api2 still accepts the stream |
| Run headers | adds `connect-content-encoding: gzip`, `x-blob-encryption-key`, `traceparent`, `backend-traceparent`, `x-original-request-id` | none of those | MISMATCH |
| usage-exhausted ask | stderr `ActionRequiredError: Weekly usage limit reached. It resets in 4 days. Buy credits to keep going now, or upgrade your plan for more weekly usage.`, exit 1 | `pi -p` printed `Error`. Server end-stream JSON had `message: "Error"` with the real text in `details[0].debug.details.title` | NOT VERIFIED, README claim false |
| model id `auto` on Run | listed by CLI as `auto` (acceptance inferred, not run) | Run with `auto` returned `AI Model Not Found`; `default` accepted | MISMATCH |
| long reply | no fixed cap observed | `readAssistantText` total 120 s deadline; `scripts/turn-deadline.mts` shows a reply still streaming at the deadline throws `Cursor ask timed out.` and drops the text | NOT VERIFIED, defect |
| multi-turn prompt | per-conversation state on the server | `scripts/prompt-from.mts`: transcript flattened with no roles, thinking glued to text (`secret chain of thought4`), system prompt and images dropped, tool output inlined | MISMATCH |
| fallback flags | `--trust`, `--print`, `--output-format`, `--mode`, `--model` exist in `cursor-agent --help` | `cursorAgentArgs` uses them | VERIFIED |
