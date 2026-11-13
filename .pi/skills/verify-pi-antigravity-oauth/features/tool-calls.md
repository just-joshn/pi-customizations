# Tool calls

On an Antigravity model, Pi's tools are declared to Cloud Code as function declarations with OpenAPI `parameters` and upper-case type names. A `functionCall` in the reply dispatches to Pi's real tool. The result goes back as a `functionResponse` in the next request: in a `model` turn for Gemini models, and in a `user` turn for every other model, matching `agy`.

## Sub-features

- `tools-declare`: `read`, `bash`, `edit`, and `write` are declared with `parameters.type: "OBJECT"` and upper-case property types (`STRING`, `NUMBER`).
- `tools-read-gemini`: on `gemini-3.8-flash`, `functionCall read {"path":"probe.txt"}` runs Pi's `read` tool. The follow-up request carries a `model`-role `functionResponse` with name `read` and id `call_read_probe`.
- `tools-bash-claude`: on `claude-sonnet-5-5`, `functionCall bash {"command":"printf BASH_OK"}` runs Pi's `bash` tool. The follow-up carries a `user`-role `functionResponse`.
- `tools-step`: the follow-up request id ends in `/3`, because each tool round trip adds two steps within the turn.

## How to get to it (user POV)

- Ask an Antigravity model to read a file or run a command, in any Pi mode.

## Driving it with control-antigravity-oauth

Preconditions:

- `doctor` passes. The drive writes `probe.txt` (`LOCAL_FILE`) into the scratch cwd, stores a credential, and queues the peer's replies.

Steps:

- **Run.** Run `./.pi/skills/verify-pi-antigravity-oauth/bin/control-antigravity-oauth drive tool-calls`.
- **Act.** The drive starts an RPC Pi on each model at thinking `low`. It prompts once and receives a `functionCall` reply, then the text `LOCAL_OK`.
- **Observe.**
  - Each model sends exactly two requests.
  - `get_messages` shows one non-error tool result: `read: LOCAL_FILE` and `bash: BASH_OK`.
  - The follow-up turn's role is `model` for Gemini and `user` for Claude.
  - The egress log is empty.
- **Proof.** `artifacts/verify-pi-antigravity-oauth/tool-calls/tool-calls.json` holds `declaration` and `followUpTurn` for each model.

## Gotchas

- The bash probe runs a real shell command in the scratch cwd. Keep it harmless.
- When a `functionCall` has no `id`, or repeats an id, the extension synthesizes one (`<name>_<ms>_<n>`). The drive always sends ids, so this path is covered only by `stream.test.ts`.
- The role rule keys off a `gemini-` prefix on the Pi model id. A future Gemini model whose id lacks that prefix would silently get `user` turns.
