# Tool calls

On a Claude subscription model, Pi's tools are declared with Claude Code casing (`Read`, `Bash`, `Edit`, `Write`). The model's `tool_use` replies dispatch back to Pi's real `read` and `bash` tools, and their results return as `tool_result` blocks in the next request.

## Sub-features

- `tools-casing` declares `Read`, `Bash`, `Edit`, and `Write` in the request `tools`.
- `tools-read` runs Pi's `read` tool for `tool_use Read {"path":"probe.txt"}` and returns the file contents.
- `tools-bash` runs Pi's `bash` tool for `tool_use Bash {"command":"printf BASH_OK"}` and returns its stdout.
- `tools-result-roundtrip` puts a `tool_result` with the same `tool_use_id` in the follow-up request.

## How to get to it (user POV)

- Ask a `claude-subscription` model to read a file or run a command in any Pi mode.

## Driving it with control-claude-oauth

Preconditions:

- `doctor` passes. The drive writes `probe.txt` (`LOCAL_FILE`) into the scratch cwd and queues the peer's replies.

- **Run.** `./.pi/skills/verify-pi-anthropic-oauth/bin/control-claude-oauth drive tool-calls`. Over RPC the drive sends `Read probe.txt.` and then `Run the bash probe.`. The peer answers each with a `tool_use` and then `LOCAL_OK`.
- **Observe.** Four requests reach the peer. `get_messages` shows tool results `read: LOCAL_FILE` and `bash: BASH_OK`, neither an error. Requests 2 and 4 carry `toolu_read_probe` and `toolu_bash_probe` results.
- **Proof.** `artifacts/verify-pi-anthropic-oauth/tool-calls/tool-calls.json`.

## Gotchas

- Tool names that differ only in case (for example an extension's `task` and a `Task`) fold together. The extension keeps the first one. This drive loads no extra tools, so it does not cover the collision path. The `tool-name-collision` vitest covers it.
- The Bash probe runs a real shell command in the scratch cwd. Keep it harmless.
