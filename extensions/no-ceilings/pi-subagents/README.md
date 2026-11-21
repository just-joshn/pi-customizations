# `@justjoshn/pi-subagents`

Pi-native subagents extension providing isolated delegated execution, built-in and custom subagent discovery, foreground and background runs, session resumption, read-only enforcement, live streaming tool UI, completion wakeups, and an interactive tasks and transcript overlay.

## Features

- **Built-in subagents**: `general-purpose`, `explore` (fast, read-only), `shell` (alias `bash`), and `debug`.
- **Custom subagent discovery**: Loads `.md`, `.mdc`, and `.markdown` definitions with YAML frontmatter from `.pi/agents`, `.agents/agents`, `~/.pi/agent/agents`, and `~/.agents/agents`.
  - Frontmatter fields: `name`, `description`, `tools`, `model`, `force-default-model`, `readonly`, `permissionMode`, `background` / `is_background`.
- **Tools**:
  - `task`: Launches or resumes a subagent in foreground or background (`description`, `prompt`, `subagent_type`, `model`, `readonly`, `resume`, `run_in_background`).
  - `await_subagent`: Waits on a running background subagent by `agent_id` with optional `timeout_ms`.
- **Pi-native execution**: Runs child sessions in-process via `createAgentSession()`, inheriting credentials and model registry, persisting transcripts in the session directory, and enforcing `readonly: true` via an inline `tool_call` guard extension.
- **Visual TUI**:
  - Live `Task` tool call header (`Task <description>  <type> • [background] • <duration>`), active tool verbs, thinking/text previews, and expanded Markdown output (`Ctrl+O`).
  - Running agents footer status and status widget while subagents are active.
  - Background task completion messages (`Finished <title>` / `Finished [N background tasks]`).
  - Interactive `/tasks` overlay (`Ctrl+Alt+T`) with live elapsed durations, `Enter` to inspect live transcripts, `k` to abort background tasks, and `b` to move foreground tasks to background.
- **Commands & Shortcuts**:
  - `/tasks [list | abort <id> | bg <id>]` — open tasks pager or manage tasks
  - `/agents [reload]` — list or reload discovered subagents
  - `/subagent <name> <prompt>` — queue a delegated task for a specific subagent
  - `Ctrl+Alt+T` — open Tasks overlay
  - `Ctrl+Alt+B` — move active foreground subagent(s) to background
