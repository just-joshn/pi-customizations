# pi-pstack 0.15.36: Pi-native parity port

Goal: pi-pstack reproduces pstack 0.15.36 (cursor/plugins `c742dd6`) and the three cursor-team-kit skills it uses, with
the same behavior, written for Pi. Nothing in the package reads, names, or needs the Cursor plugin or Cursor's host:
no upstream sync, no lock against a cursor/plugins checkout, no system-prompt map from Cursor names to Pi names. A Pi
user reads Pi words everywhere. Cursor-only host features get Pi equivalents where feasible (operator decision
2026-10-28: "implement").

## 1. Vocabulary: what the text says now

Skill, agent, doc, and automation text names Pi things directly. Apply this table to every shipped Markdown file.
Keep everything else (meaning, steps, order, tone, examples, numbers) the same. Do not summarize, reflow, or
"improve" text that has no Cursor term. Keep the house style: short declarative sentences, no em dashes added.

| Cursor text | Pi-native text |
| --- | --- |
| `Shell` tool | `bash` |
| `Read`, `Grep`, `Glob` tools | `read`, `grep`, `find` (`ls` for listings) |
| `StrReplace`/edit tool names | `edit`; file creation `write` |
| `Task`, `TodoWrite`, `AskQuestion` | unchanged (Pi tools of the same name) |
| "the X skill", `/X` | unchanged (pi-pstack makes `/X` work) |
| Custom Mode, Option+Enter / Alt+Enter, "Use as Mode" | `/mode <skill>` (exit with `/mode off`) |
| Cursor's Plan Mode | `/plan` (pi-pstack plan mode; see 2.6) |
| `~/.cursor/rules/pstack-models.mdc`, "always-applied rule" | `~/.pi/agent/pstack/pstack-models.md`, "the model rule" (pi-pstack adds it to every request) |
| `.cursor/rules/*.mdc`, always-applied project rules | `AGENTS.md` (Pi loads it into every session) |
| `.cursor/skills/`, `~/.cursor/skills/` | `.pi/skills/`, `~/.pi/agent/skills/` |
| `~/.cursor/plugins/...` search for pstack | the pi-pstack package directory (the system prompt names it as `<SKILLS>` / package root) |
| `.cursor-plugin/plugin.json` | pi-pstack's `package.json` (`pi` field) |
| `/add-plugin pstack`, Customize sidebar | `pi install <path-to-pi-pstack>` |
| `agent-transcripts/`, `~/.cursor/projects/<slug>/agent-transcripts/...` | "this workspace's Pi session files" (path in the system prompt) and pi-pstack subagent transcripts |
| Cursor transcript shapes (role/tool_use lines) | Pi session JSONL: one entry per line; turns have `type: "message"`; a tool call is a `toolCall` part of an assistant message; an attached skill is a `<skill name=... location=...>` block in a user message |
| cloud agent, cloud VM, `environment: "cloud"` | "isolated worker" running in its own git worktree on branch `pstack/<agent id>` (`environment: "cloud"` stays the Task field) |
| cloud agent status in the Cursor dashboard | the `agent_status` tool (2.2) |
| cloud VM as a lifetime ("assume the VM dies"), "lane VM" | the worker, a lane worktree |
| agent mode, `readonly: false` vs Ask mode | `readonly` unset (or `false`); "do not set `readonly: true`" |
| Auto (Cursor's model picker) | the chat model |
| the chat sidebar | Pi's `/resume` session list |
| automation run output | the run's final message (its Task notification) |
| repo-relative `pstack/skills/...` paths | `<SKILLS>/...` (the package root the system prompt names); for `git show`, `<pi-pstack path>` in the program repository, stated in the step that uses it |
| hard-coded `~/.pi/agent/...` paths a tool writes | the path the system prompt or tool result names (it follows `PI_CODING_AGENT_DIR`) |
| Cursor restart | Pi restart (`/reload`, `/new`, Pi's `/resume` or `/fork` command, or quitting Pi) |
| "message a worker" / send a follow-up | `Task` with `resume: <agent id>`. On a worker running in this Pi process the prompt arrives as a steer (2.8) |
| stop a worker | `stop_agent` with `agent_id` (2.8) |
| "fork" a worker | `Task` with `fork: <agent id>`, and `fork_turns: N` to copy only the first N user turns (2.1) |
| Project tracker (`notes.md`), Project store | the project folder the system prompt names: `<project>/notes.md` and `<project>/store/` (2.5) |
| PR and CI event subscriptions | `subscribe_github_pr`, `list_subscriptions`, `unsubscribe` (2.3) |
| Cursor Automations, routines, `update_state` target `routine`, routine wakes, `api2.cursor.sh/automations/webhook/<id>` | pi-pstack routines: `subscribe_timer` and `subscribe_webhook` (2.3, 2.4); the URL is the local one the tool returns |
| `SendToUser` secret-request | not needed: the routine key is generated locally into a credential file; copy it from that file without printing it (2.4) |
| Routines panel, Cmd+Shift+I | `/routines` |
| Grok Bot | "the Pi session that owns the routine" (the bot is this Pi chat) |
| `/visualize` | the `visualize` tool (2.7) |
| image generation tool | Pi codemode `models.generateImages()` when codemode is on and an image model is configured, else a Mermaid diagram |
| Cursor model slugs `claude-opus-5-5-xhigh`, `grok-4.7-xhigh-fast` | Pi model specs `claude-opus-5-5:xhigh`, `grok-4.7:xhigh`. The effort token is the `:<level>` suffix. "fast or standard speed" becomes "and fast or standard speed when the model has a `-fast` variant". `effort=<level>` inside `[...]` model parameters is also an effort token, and `fast=true` there is speed. Text keeps bare model ids (2.9) |
| `inherit-parent`, `auto` | unchanged (pi-pstack treats both as the parent model) |
| `cursor-team-kit` (where `control-ui`, `control-cli`, `deslop` come from) | "shipped with pi-pstack" |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` links | relative links inside the package |
| `https://cursor.com/docs/...` | the Pi doc or pi-pstack README section that covers it; drop the link if none does |
| "pstack is built for Cursor / also installs in Claude Code" | pi-pstack install for Pi only |
| Bugbot, Origin, `gh`, GitHub, Slack, Tailscale | unchanged: these are external services reached through `gh`, `origin`, MCP, or the shell, not Cursor host features |

Text that is about Cursor as a product a user's own repo integrates with (for example Bugbot comments on a GitHub PR,
or `CURSOR_AUTOMATION_ID` markers that watch-pr recognizes in review comments) stays: it describes outside data, not
the host.

`docs/harness/claude-code.md` is an adapter for a different host and is removed. The guide (`docs/guide/`) describes
Pi.

## 2. Host features pi-pstack adds

All tools live in the extension (`src/`), carry TypeBox schemas, and work in interactive, RPC, print, and JSON modes
unless stated.

### 2.1 Task `fork`
`fork: <agent id>` starts a NEW agent (new ID) whose transcript begins as a copy of the source agent's transcript and
that runs in the source's directory (its worktree, when the source was isolated), so it sees the built checkout and
uncommitted changes and can reach processes the source left running on this machine. The prompt is the new task. The
source must not be running (same rule as resume). `fork` and `resume` are mutually exclusive. `subagent_type`,
`readonly`, and `model` default to the source's record; a call may make the fork readonly but never lifts readonly.
The fork never shares a writer lock with the source. `fork_turns: N` (a positive integer, only with `fork`) copies only
the first N user turns of the source transcript, as Cursor's `CreateAgent.fork_turns` does.

### 2.2 `agent_status`
Read-only status of subagents in this workspace, without restarting anything: `agent_id` (optional; all recent agents
when omitted, newest first, bounded). Per agent: state (`running` while the run lock names a live pid, else `idle`,
or `missing`), type, model, readonly, directory, worktree branch, the agent it was forked from, created/updated times,
the pid while running, the transcript path, and the last assistant text (truncated). Because every agent in a tree
shares the root workspace (2.8), `agent_status` in the root chat sees every descendant, isolated workers included.

### 2.3 Subscriptions
Tools: `subscribe_github_pr`, `subscribe_timer`, `subscribe_webhook`, `list_subscriptions`, `unsubscribe`.
A subscription wakes this session with a custom message (triggers a turn; queued as a follow-up when busy).
- `subscribe_github_pr`: `{scope: "pr", prUrl}` | `{scope: "repo", repo}` | `{scope: "author", author, repo}`. Polls
  with `gh` (default every 60 s). Wakes on a change in state, head SHA, mergeability, review decision, new reviews or
  comments, or a check run concluding or changing. The wake names the PR and what changed.
- `subscribe_timer`: `name`, `prompt`, and either `cron` (5-field) or `delaySeconds`, each with optional `once` (fire
  once, then end). `sessionStrategy`:
  `wake_self` (default; wakes this session with the prompt) or `new_session` (each fire runs the prompt in a fresh
  background subagent; its result arrives as a Task notification). Re-subscribing an existing timer name does not
  update it (returns `created: false`), as Cursor does.
- `subscribe_webhook`: see 2.4.
- Subscriptions persist in the session (restored on reload/resume), expire (default 7 days, `expiresInHours` at most
  720, so 30 days; `expiresAt` in results), and stop with the Pi process. `list_subscriptions` and `unsubscribe` manage
  them. Print and JSON runs reject every subscribe tool with a clear error, `new_session` timers included: the run
  exits when the agent settles, so nothing could fire or wake it later.

### 2.4 Routines (webhook)
`subscribe_webhook`: `name`, `prompt`. Creates a routine with slug = kebab-case name, a random sender key stored at
`<pstack dir>/routines/<slug>/credentials.json` (`<pstack dir>` is `~/.pi/agent/pstack`, or `$PI_CODING_AGENT_DIR/pstack`;
mode 0600, field `key`), and a URL served by one local HTTP listener per Pi process
(`http://127.0.0.1:<port>/routines/<slug>`, port from `PSTACK_ROUTINES_PORT`, default 47913, `0` for a free port).
The result returns the URL and the credential file path, never the key. A POST with `X-Automation-Key: <key>` or
`Authorization: Bearer <key>` and a JSON body returns 200 and wakes the session with a `[routine]` turn containing the
routine prompt and a `<webhook_event>` block (`headers` content-type and user-agent, `body_digest` sha256, `body` as a
string, `timestamp_ms`). Wrong key: 401, no wake. Unknown routine: 404. A method other than POST: 405. Body over 64 KiB: 413. A body that is not
a JSON object: 400. `/routines` lists
routines with URL, credential file, and status.

### 2.5 Projects
The system prompt names `<workspace state>/projects/` and says a program's Project is `projects/<project-slug>/` with
`notes.md` (the Project tracker) and `store/` (the Project store). Subagents see the same paths, isolated workers too
(2.8). Stores keep their
existing meaning (current agent's store, root agent's store).

### 2.6 `/plan` (plan mode)
`/plan [task]` turns plan mode on: the main agent gets read-only tools (`read`, `grep`, `find`, `ls`, `bash_readonly`
(the sandboxed read-only shell, a separate tool so the user's `bash` settings stay as they are), `AskQuestion`,
`TodoWrite`, `agent_status`, and `Task`) and a system-prompt section telling it to investigate and produce a plan
without changing files. Plan mode never writes. Each `Task` launch in plan mode is forced `readonly` for that launch
only (never written into the agent's record, also when the spawn fails) and `environment: "local"` (no worktree or
branch). `fork` is allowed, because the transcript copy is pi-pstack state, not a user file, but the fork runs readonly. `/plan off` restores the previous tools. Footer badge
`plan`. State persists in the session.

### 2.7 `visualize`
`{title, kind: "bar"|"line", labels: string[], series: {name, values: number[]}[], unit?}` renders a Unicode chart in
the tool result (TUI and text) and writes an SVG to the session's artifacts folder, returning its path. Bad shapes
(length mismatch, non-finite numbers) fail with the reason.

### 2.8 Workers: steer, stop, and one shared workspace
Children run under Pi RPC mode (`pi --mode rpc`, `docs/rpc.md`) rather than `--mode json`, so the owning process can
send `steer`, `follow_up`, and `abort`.
- **Steer.** `Task` with `resume: <agent id>` on an agent running in this Pi process delivers the prompt as a steer and
  returns at once. This is Cursor's "message a worker". On an agent running in another Pi process it still refuses. On an
  idle agent it resumes as before. A resume follows the agent type's `run_in_background` setting, as a fresh call does.
- **Stop.** `stop_agent` `{ agent_id }` aborts a worker this process owns (RPC `abort`, then the existing kill grace),
  or signals the live pid in the run lock of one another Pi process of this user owns. It reports what happened. An idle
  or finished agent is a no-op with a clear message.
- **One workspace per tree.** The root chat's workspace state directory passes to children through an environment
  variable (as `PI_PSTACK_ROOT_STORE` does). Each child derives `projects/`, `subagents/`, its stores, and `artifacts/`
  from it, so an isolated worker in its own worktree sees the same Projects, records, and transcripts as the root, and
  `agent_status` in the root sees every descendant.
- **Writer lock.** One run lock per agent ID keeps out a second writer, across processes. A lock whose pid is dead is
  taken over; two processes that take over the same stale lock at the same moment can both succeed.

### 2.9 Model ids
A model value is a Pi model spec (`provider/id:level` or `id:level`) or `[effort=<level>,fast=true|false]` model
parameters on a base model. A bare id that several providers offer resolves to the parent chat's provider when that
provider offers the id, and otherwise fails with a list of the choices. Shipped text keeps bare ids such as
`claude-opus-5-5:xhigh`.

## 3. Removed
`scripts/sync-upstream.mjs`, `scripts/patches.json`, `upstream.lock.json`, the `sync:upstream`/`check:upstream`
scripts, the Cursor rule write guard, and the Cursor-to-Pi map in the system prompt. Frontmatter metadata keys
`cursor-icon`/`cursor-color` become `icon`/`color` under `metadata`. The model rule moves to
`~/.pi/agent/pstack/pstack-models.md` (plain Markdown, no frontmatter); an existing `pstack-models.mdc` there is
migrated once (body kept, frontmatter dropped). The shipped MIT notices stay in `licenses/`.
