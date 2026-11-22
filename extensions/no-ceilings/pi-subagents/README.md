# `@justjoshn/pi-subagents`

Pi-native subagent delegation: isolated child sessions, built-in and custom agents, foreground and background runs, git worktree isolation, retries, checkpoints, and a live tasks pager. Everything runs through Pi's own extension API (`createAgentSession`, `registerTool`, `registerCommand`, `pi.events`). No external daemon and no separate protocol.

## Install

```bash
pi install npm:@justjoshn/pi-subagents
```

Load a checkout with `pi -e ./src/index.ts`.

## Delegation

The extension registers two tools.

| Tool | Purpose |
| --- | --- |
| `task` | Start or resume one subagent. Runs foreground by default. |
| `await_subagent` | Wait for a background subagent by `agent_id`, with an optional `timeout_ms`. |

`task` parameters: `description`, `prompt`, `subagent_type`, `model`, `thinking`, `readonly`, `resume`, `run_in_background`, `max_attempts`, `worktree`.

Each run gets its own `AgentSession`, so the child has a separate context window and an isolated history. Results and errors return to the parent through the tool result. Errors carry a `failure_id` and a `code` you can branch on.

Omit `subagent_type` and the harness picks the agent whose description best matches `description` and `prompt`. A name mentioned in the task text wins. An ambiguous match falls back to `general-purpose`.

Every run appends the discovered agent catalog to the system prompt, so the model sees each name and description before it decides how to delegate.

Parallel work: call `task` several times with `run_in_background: true`, then collect each result with `await_subagent`. Foreground runs are sequential by nature.

### Retries

`max_attempts` retries a failed run in a fresh session with the same prompt. The record keeps the attempt count. A run stops retrying when it completes, when it is cancelled, or when the attempts run out.

### Checkpoints

Every completed step writes a checkpoint to the run record: sequence, status, tool count, transcript item count, and the transcript path. Checkpoints persist in the session entry, so `/tasks` can show progress after a restart.

## Built-in subagents

| Subagent | Behaviour |
| --- | --- |
| `general-purpose` | Inherits the parent model and tools. |
| `explore` | Read-only, fast model, file and content search tools. |
| `shell` | `bash` and `read` (alias `bash`). |
| `debug` | Debugging prompt on an inherited model and tool set. |
| `browser` | Appears only when an MCP server or `mcp__` tool matches a browser hint. |

`explore` is configurable. Set `explore.model` to `default` (built-in fast pick), `inherit` (parent model), or a model id. Set `explore.enabled` to `false` to remove it.

The `browser` subagent is a delegation interface. It runs the MCP browser tools that the parent session already has configured, so the server must set `"exposure": "direct"` in `mcp.json` to declare its tools to the model.

## Custom subagents

Discovery reads Markdown files with YAML frontmatter from these directories. Project directories win over user directories, and the first definition of a name wins.

```
.pi/agents/
.claude/agents/
.codex/agents/
.agents/agents/

~/.pi/agent/agents/
~/.claude/agents/
~/.codex/agents/
~/.agents/agents/
```

Add more project directories with `agents.directories` in the config file. `.mdc` and `.markdown` files also load. Subdirectories are walked.

Project directories load only for a trusted project, the same gate Pi puts on project skills and MCP configuration. Approve the project with `--approve` or set `defaultProjectTrust`. User directories always load.

| Frontmatter | Meaning |
| --- | --- |
| `name`, `description` | Identity and delegation text. Missing `name` falls back to the file name. |
| `tools` | Comma or space separated tool allowlist. Omit it to inherit the parent's active tools. |
| `model` | `inherit`, `fast`, a model id, or `provider/id`. Claude aliases `haiku`, `sonnet`, and `opus` map to `fast` and `inherit`. |
| `force-default-model` | Ignore `model` and any caller override. |
| `thinking`, `reasoning-effort` | Pi thinking level: `off` through `max`. |
| `model-params` | `temperature`, `top_p`, `top_k`, `max_tokens`. Copied onto the child model. |
| `context-window` | Child context window, as a number or `200k` / `1M`. |
| `max-tokens` | Child output cap. |
| `readonly`, `permission-mode`, `sandbox_mode` | Read-only mode. Blocks writes, deletes, mutating shell commands, and MCP tools. |
| `background`, `is_background` | Start in background by default. |
| `nested-tasks` | Let this child delegate one level deeper, up to `nesting.maxDepth`. |
| `worktree` | Run in an isolated git worktree by default. |
| `mcp` | Attach the MCP extension so the child sees the configured servers. |
| `retry` | Default `max_attempts`. |
| `enabled`, `disabled` | Hide the agent without deleting the file. |

Children load project rules (`AGENTS.md`, `CLAUDE.md`) because the child resource loader keeps context files enabled. They inherit the parent's credentials and extension providers, and they carry the read-only guard when the agent or the call asks for it. Extension `tool_call` hooks from other extensions are not cloned into a child session.

### Invoking an agent

- Automatic: ask for work and let the model choose, or omit `subagent_type`.
- Explicit tool call: `task` with `subagent_type`.
- Slash command per agent: `/subagent:<name> [--bg] <prompt>`.
- Generic form: `/subagent <name> [--bg] <prompt>`.

## Configuration

The extension reads `subagents.json` from the Pi agent directory and from `<workspace>/.pi/subagents.json`. Project values win. The project file loads only for a trusted project.

```json
{
  "explore": { "enabled": true, "model": "default" },
  "browser": { "enabled": true, "serverHints": ["playwright", "browser"] },
  "agents": { "disabled": ["shell"], "directories": ["tools/agents"] },
  "nesting": { "maxDepth": 2 },
  "defaults": { "background": false },
  "retry": { "maxAttempts": 1, "delayMs": 250 },
  "worktrees": { "root": "/abs/path", "branchPrefix": "pi-subagents" }
}
```

CLI flags override the file: `--subagent-explore-model <value>` and `--subagent-max-depth <n>`.

`/agents` prints the effective config and any config errors.

## Isolation

A subagent shares the parent checkout by default. Set `worktree: true` on `task`, or `worktree` in the agent file, to run it in `git worktree add` on its own branch.

- Branch: `<branchPrefix>/<slug>-<3 hex>`.
- Path: `worktrees.root` when set, else `<session dir>/worktrees/`.
- The result carries `worktree_path`, `branch`, and a `git diff --stat` summary, so the parent can review and merge.
- `/tasks prune <id>` removes the worktree directory. It refuses while the subagent still runs and does not force a dirty worktree. The branch stays for merging.

## Observability

- Ordered transcript per run: prompt, assistant text, tool calls with arguments, tool output, and errors.
- Transcript files under `<session dir>/subagents/`.
- `Ctrl+Alt+T` or `/tasks` opens the pager: elapsed time, retries, failure ids, live transcripts, `k` to abort, `b` to background a foreground run, `Enter` to inspect.
- `/tasks list | abort <id> | bg <id> | retry <id> | prune <id>`.
- `Ctrl+Alt+B` moves running foreground subagents to the background.

### Hook events

Subscribe with `pi.events.on(channel, handler)` from another extension. Every payload includes `agentId`, `status`, `attempt`, `toolCallCount`, `transcriptPath`, and failure details when present.

| Channel | Fires |
| --- | --- |
| `subagents:run_start` | A run record is created. |
| `subagents:status` | A retry attempt starts. |
| `subagents:tool_call` | The child starts a tool call. |
| `subagents:checkpoint` | A checkpoint is written. |
| `subagents:worktree` | A worktree is created for the run. |
| `subagents:run_end` | A run reaches a terminal state. |

## Nesting

A child gets `task` and `await_subagent` only when its definition sets `nested-tasks: true` and the run is above `nesting.maxDepth`. Nested runs are scoped: a child can await or cancel only the runs it started, and its remaining children stop when it ends. Nested completions never wake the parent.

## Tests

```bash
bunx vitest run            # unit and behaviour tests
bunx vitest run --coverage # coverage gate
bunx tsc --noEmit          # types
node test/e2e/verify-subagents.mjs # real `pi` binary, needs a logged-in model
```

The end-to-end script runs the extension from source in a throwaway profile, exercises a foreground subagent, a background subagent in its own worktree, `await_subagent`, and the persisted checkpoints and transcripts. It exits 77 when `pi` or a model credential is missing.
