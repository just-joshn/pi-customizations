# Cursor ask

A prompt on a `cursor` model is sent by default over native HTTPS: an HTTP/2 Connect stream to `POST https://api2.cursor.sh/agent.v1.AgentService/Run`. The first frame carries the conversation as one labeled text prompt (`System:`, `User:`, `Assistant:`, `Tool result (<tool>):`), the model id, and ask mode. When Cursor asks for context, Pi replies with the exec id echoed. Text frames build the reply, and a turn-end frame carries token counts. If the native session never opens because of a transport error (connect failure, TLS failure, or no HTTP/2 settings within 10 s), Pi runs `cursor-agent` in ask mode instead. Any other error is final. Cursor's own refusal text is shown as the error.

## Sub-features

- `ask-native`: the `:path` is `/agent.v1.AgentService/Run`, with `content-type: application/connect+proto`, `authorization: Bearer <JWT>`, `x-cursor-client-type: cli`, `x-cursor-client-version: cli-2026.11.05-86047df`, `connect-protocol-version: 1`, `connect-accept-encoding: gzip`, `user-agent: connect-es/1.6.1`, `x-ghost-mode: true`, an `x-cursor-timezone`, and a UUID `x-request-id`. The Run frame has `modelId: composer-2.5` and `mode: 2`. Its prompt starts with `System:\n` and ends with `\n\nUser:\nReply LOCAL_OK.`.
- `ask-context-reply`: the context request carrying exec id `verify-exec-7` gets a reply that contains that id and a result.
- `ask-transcript`: a conversation started on `grok-build` with a `read` tool call and continued on Cursor reaches the native prompt in order: `System:`, `User:\nRead the probe.`, `Assistant:\n[called tool read]`, `Tool result (read):\nLOCAL_FILE`, `Assistant:\nLOCAL_OK`, `User:\nSummarize the probe.`.
- `ask-usage`: a reply split over two text frames comes back as `LOCAL_OK`, with `stopReason: stop` and usage `input 11, output 3, cacheRead 5, cacheWrite 0`.
- `ask-refusal`: a Connect error whose details hold `debug.details.title/detail` prints `Weekly usage limit reached. It resets in 4 days. Buy credits to keep going now, or upgrade your plan for more weekly usage.`
- `ask-not-logged-in`: `ERROR_NOT_LOGGED_IN` prints `Cursor rejected the session (HTTP 401). Run /login and choose Cursor.` and does not fall back.
- `ask-fallback`: when the native connection fails, Pi runs `cursor-agent --trust --print --output-format json --mode ask --model composer-2.5 -- <prompt>`. The prompt follows `--`, even when it starts with `-`.

## How to get to it (user POV)

- `pi --provider cursor --model composer-2.5 -p "…"` after a Cursor `/login`.
- Interactive: pick a `[cursor]` model with `/model`.

## Driving it with control-x-subscription-oauth

Preconditions:

- `doctor` passes. A `cursor` credential (a one-hour JWT) is stored.
- `net-guard.mjs` sends `http2.connect('https://api2.cursor.sh')` to the HTTP/2 peer, or to a closed port when `VERIFY_X_CURSOR_H2=refuse`.

Steps:

- **Run.** Run `./.pi/skills/verify-pi-x-subscription-oauth/bin/control-x-subscription-oauth drive cursor-ask`.
- **Native.** The drive starts RPC with `--provider cursor --model composer-2.5`, prompts `Reply LOCAL_OK.`, and reads `get_messages`. The peer recorded the headers, the decoded Run frame, and the context reply. `cursor-agent.log` is empty.
- **Transcript.** The drive starts RPC on `grok-build/grok-4.7`, whose peer answers the first prompt with a `read` call on `probe.txt` and the follow-up with `LOCAL_OK`. It then sends `set_model` with `cursor/composer-2.5` and prompts `Summarize the probe.`. The second native Run frame's prompt holds every turn in order, under its speaker label (step `transcript across providers`).
- **Refusal.** The drive switches the peer to `refusal` and runs `pi --offline -p 'Reply LOCAL_OK.' …`. Pi exits non-zero with Cursor's weekly-limit text.
- **Not logged in.** The drive switches the peer to `not-logged-in` and runs again. Pi prints the `/login` hint, and `cursor-agent.log` is still empty.
- **Fallback.** The drive runs `pi --offline --provider cursor --model composer-2.5 -p -- '-starts with a dash'` with `VERIFY_X_CURSOR_H2=refuse`. Stdout is `LOCAL_OK` from the stub, and `cursor-agent.log` holds the argv above. The guard log gains exactly one entry during this run, `h2 api2.cursor.sh`: the native attempt that was refused.
- **Proof.** `steps.json` records each step: the native headers, the decoded Run frame, the context reply, the reply and usage, the full transcript prompt, each error output, and the fallback argv with the guard entries it added. `egress.json` holds the guard log. The drive declares `egress = { 'h2 api2.cursor.sh': 5 }`, one per Cursor ask (native, transcript, refusal, not logged in, fallback), and the harness fails it on any other entry.

## Gotchas

- The native ask ignores `models.json` `baseUrl` and every proxy variable, because `openCursorRun` is called with no `baseUrl`. Only the guard's `http2.connect` redirect keeps it local. Never run a cursor ask without `NODE_OPTIONS` pointing at `net-guard.mjs`.
- Pi's own argument parser rejects `-p -starts…` as an unknown option. To send a prompt that starts with a dash, put it after `--` at the end of the command line.
- Fallback happens only when the native session never opened (`NativeTransportError`). A refusal or a 401 inside an open stream is final, so no `cursor-agent` call is expected.
- The extension fails a native run with `Cursor ask timed out.` only after 120 s without text, but the drive's RPC and print waits give up at 60 s. A peer that never ends the turn therefore fails the drive with an RPC or process timeout, not with the extension's message.
- The real `cursor-agent` is often on `PATH` (for example `~/.local/bin`). The stub must shadow it for every Cursor drive.
