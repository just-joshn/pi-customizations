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

Omit `subagent_type` and the harness picks the agent whose description best matches `description` and `prompt`. Repeated words in a description count once. A name mentioned in the task text wins when exactly one agent is named. Overlapping names keep the longest match. Two or more distinct names fall back to `general-purpose`, or to the first available agent when `general-purpose` is disabled. A task that asks for a change never picks a read-only agent automatically. If every available agent is read-only, the selection is `general-purpose` and the call fails as an unknown type. Make, address, improve, rework, get, and ensure count as changes. A verb does not count after a determiner or subject pronoun (`the format`, `we update`), in `how to <verb>`, or inside a discovered agent name. A negated change keeps a named read-only agent. That includes comma, slash, dash, and parenthetical lists (`do not edit, add, or delete`, `do not edit/add/delete`) and `under no circumstances`. `report what to change` is not itself a change.

Every run appends the discovered agent catalog to the system prompt, so the model sees each name and description before it decides how to delegate.

Parallel work: call `task` several times with `run_in_background: true`, then collect each result with `await_subagent`. Foreground runs are sequential by nature.

### Retries

`max_attempts` retries a failed run in a fresh session with the same prompt. The record keeps the attempt count. A run stops retrying when it completes, when it is cancelled, or when the attempts run out.

### Checkpoints

Every completed step writes a checkpoint to the run record: sequence, status, tool count, transcript item count, and the transcript path. Checkpoints persist for the `subagents:checkpoint` hook and the parent tool-result metadata. `/tasks` does not show checkpoint progress.

## Built-in subagents

| Subagent | Behaviour |
| --- | --- |
| `general-purpose` | Inherits the parent model and tools. |
| `explore` | Read-only, fast model, file and content search tools. |
| `shell` | `bash` and `read`. The name `bash` aliases to `shell` unless a discovered agent is named `bash`. |
| `debug` | Debugging prompt on an inherited model and tool set. |
| `browser` | Appears only when an MCP server or `mcp__` tool matches a browser hint. Tools are limited to that server. |

`explore` is configurable. Set `explore.model` to `default` (built-in fast pick), `inherit` (parent model), or a model id. Set `explore.enabled` to `false` to remove it.

The `browser` subagent is a delegation interface. Its tool allowlist is only the matched server (`mcp__<server>__*`), so other MCP servers stay out of reach. The server must set `"exposure": "direct"` in `mcp.json` to declare its tools to the model.

## Custom subagents

Discovery reads Markdown files with YAML frontmatter from these directories. Project directories win over user directories, and the first definition of a name wins. Names that differ only by case are the same name, so a project `Explore` replaces the built-in `explore`.

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
| `tools` | Comma or space separated tool allowlist. Omit it to inherit the parent's active tools. Claude names such as `Read`, `Grep`, and `Glob` map to Pi's `read`, `grep`, and `find`. |
| `model` | `inherit`, `fast`, a model id, or `provider/id`. Claude aliases `haiku`, `sonnet`, and `opus` map to `fast` and `inherit`. |
| `force-default-model` | Ignore `model` and any caller override. |
| `thinking`, `reasoning-effort` | Pi thinking level: `off` through `max`. |
| `model-params` | `temperature`, `top_p`, `top_k`, `max_tokens`. OpenAI and other flat adapters get `temperature` and `top_p`. Anthropic also gets `top_k`, except when extended thinking is enabled, which leaves the request unchanged. Google writes `temperature`, `topP`, and `topK` into `config`. Bedrock writes `temperature` and `topP` into `inferenceConfig` and does not send `topK`. `max_tokens` caps output. |
| `context-window` | Child context window, as a number or `200k` / `1M`. |
| `max-tokens` | Child output cap. |
| `readonly`, `permission-mode`, `sandbox_mode` | Read-only mode. Blocks writes, deletes, file redirects, mutating shell commands (bash and powershell), and MCP tools. Redirects to `/dev/null`, including `2>/dev/null`, stay allowed. On macOS, an allowed bash command runs under `sandbox-exec` with filesystem writes denied except `/dev/null`, `/tmp/pi-subagents-readonly`, and here-document files named `sh-thd-<digits>` in `/var/tmp`. The wrapper sets `TMPDIR` to a fresh directory under that root and removes the directory when the command finishes. macOS `/bin/sh` does not put here-documents in `TMPDIR`. Elsewhere, the command guard applies. |
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
- Slash command per agent: `/subagent:<slug> [--bg] <prompt>`. The slug is the lowercased name with non-alphanumeric runs turned into hyphens. Every discovered agent gets a command; when two slugs collide, the later one is suffixed `-2`, then `-3`.
- Generic form: `/subagent <name> [--bg] <prompt>`. A name may contain spaces. The longest prefix that matches a discovered agent is the target, and the rest is the prompt. After `--bg`, an empty prompt prints the usage text and sends nothing.
- A per-agent command resolves the agent again when it runs. If that agent is gone, Pi warns `Unknown subagent "<name>"` and sends nothing.

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
- The result carries `worktree_path`, `branch`, and a `git diff --stat` summary, so the parent can review and merge. Background completions and `await_subagent` results include the same summary.
- A background worktree launch returns as soon as the run is recorded. `git worktree add` happens inside the background run. An aborted launch removes that worktree and its branch and does not start the child.
- `/tasks abort` cancels a foreground launch while `git worktree add` is still running. The run ends cancelled, the worktree and branch are removed, and the child does not start.
- A child started from an untracked subdirectory uses the nearest existing directory inside the worktree, ending at the worktree root.
- A resume stays in its worktree. If the run has no transcript, or the worktree or the child transcript file is gone or unreadable, the resume fails with `resume-unavailable` instead of starting over in the shared checkout.
- `/tasks prune <id>` removes the worktree directory. It refuses while the subagent still runs and does not force a dirty worktree. The branch stays for merging.

## Observability

- Ordered transcript per run: prompt, assistant text, tool calls with arguments, tool output, and errors.
- Transcript files under `<session dir>/subagents/`.
- Persisted session state keeps transcripts for the three most recently updated finished runs. Success, error, and cancelled runs are eligible. That includes mid-run snapshots and saves when a run finishes. Older finished runs keep their metadata, transcript path, and checkpoints.
- When a restored run has no live transcript in memory, the pager says the live transcript is no longer retained and shows the stored transcript path.
- `Ctrl+Alt+T` or `/tasks` opens the pager: elapsed time, retries, failure ids, live transcripts, `k` to abort, `b` to background a foreground run, `Enter` to inspect. The pager does not render checkpoints.
- While a run is active, the status widget header counts completed and cancelled runs in the session. The widget clears when nothing is active.
- Restoring a session cancels runs that were still pending or running and assigns a failure id when the record does not already have one.
- `/tasks list | abort <id> | bg <id> | retry <id> | prune <id>`. A resume or retry keeps the run's model, thinking level, read-only mode, and foreground or background mode. Passing `readonly: false` does not clear read-only mode already set by the agent or by an earlier call.
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

A child gets `task` and `await_subagent` only when its definition sets `nested-tasks: true` and the run is above `nesting.maxDepth`. `nesting.maxDepth` of `0` rejects delegation entirely. Nested runs are scoped: a child can await or cancel only the runs it started, and its remaining children stop when it ends. Nested completions never wake the parent.

## Tests

```bash
bunx vitest run            # unit, integration, and behaviour tests
bunx vitest run --coverage # coverage gate
bunx tsc --noEmit          # types
node test/e2e/verify-delegation-fake-model.mjs # real `pi` binary, deterministic fake model
node test/e2e/verify-subagents.mjs # real `pi` binary, needs a logged-in model
```

The deterministic end-to-end script runs the real `pi` binary, config loader, parent and child `AgentSession`s, and tools against a local OpenAI-compatible server. The server always returns the same `task` and `read` calls, so the check needs no credentials and cannot flake on model output. It asserts the parent reply, the parent session trace, the child transcript, and the persisted run.

The real-model end-to-end script runs the extension from source in a throwaway profile and exercises a foreground subagent, a background subagent in its own worktree, `await_subagent`, and the persisted checkpoints and transcripts. It exits 77 when `pi` or a model credential is missing.
