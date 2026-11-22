# Changelog

## 0.2.0

### Added

- Config file `subagents.json` in the agent directory and `.pi/`, plus `--subagent-explore-model` and `--subagent-max-depth` flags.
- Configurable `explore` model (`default`, `inherit`, or an id) and `explore.enabled`.
- Built-in `browser` subagent, offered when an MCP server or `mcp__` tool matches a browser hint.
- Discovery from `.claude/agents`, `.codex/agents`, `~/.claude/agents`, and `~/.codex/agents`, with Claude and Codex frontmatter conventions.
- Agent frontmatter for `thinking`, `model-params`, `context-window`, `max-tokens`, `retry`, `worktree`, `mcp`, and `enabled`.
- `max_attempts` retries, attempt tracking, and `/tasks retry <id>`.
- Execution checkpoints per step, persisted with the run record.
- Git worktree isolation per run: own branch, diff summary, `worktree_path` and `branch` in the result, and `/tasks prune <id>`.
- Failure ids and stable failure codes on every failed or cancelled run.
- `subagents:*` hook events over `pi.events`.
- Ordered transcripts with prompt, assistant text, tool arguments, tool output, and error flags, persisted up to 50 items per run.
- `/subagent:<name>` command per discovered agent, plus `--bg` on both invocation forms.
- Configured nesting depth, with nested runs scoped to the runs a child started.
- End-to-end script that drives the real `pi` binary.

### Changed

- A `task` call without `subagent_type` selects an agent by description match, then falls back to `general-purpose`.
- Child sessions inherit the parent's active tool loadout when the definition lists no `tools`.
- The tasks pager and task renderer show retries, failure ids, worktrees, and checkpoints.
- `/agents` prints the effective config and config errors.

### Fixed

- Extension load no longer calls runtime actions, so `pi -e` and `pi -ne -e` load the extension without an initialization error.
- The agent catalog now reaches the model through the run's system prompt. Injecting it as a custom message was stripped by the extension's own context filter, so custom agent names and descriptions never arrived.
- A resumed or retried read-only run stays read-only. The record's mode now wins over the agent definition.
- One invalid config section no longer resets the valid sections.
- Restored records adopt the current parent session, so retry works after a restart.
- Unknown models, unknown agent types, and resuming another agent's child now raise typed failure codes instead of the generic code.
- Run records persist when the run starts, not only when it ends.
- `/tasks prune` refuses to delete a worktree under a running subagent and no longer forces removal of a dirty worktree.
- Per-agent command names are slugified, so an agent name with spaces is still callable.
- An awaited background run clears its wakeup suppression, and a read-only agent that inherits tools no longer receives write tools.

## 0.1.4

### Added

- `task` accepts a `thinking` level and passes it to the child session.
- Opt-in `nested-tasks: true` agent frontmatter.

### Changed

- An explicit unknown `model` fails with a clear error instead of silently using the parent model.

### Fixed

- Persist nested child ownership so a resumed owner can still await and cancel the children it launched.
- Walk the owner ancestry when resolving depth.
- Record the root session id on a nested scope.

## 0.1.3

### Changed

- Remove the retired `style-audit` script from `package.json`.

## 0.1.2

### Fixed

- Inherit parent extension providers in child subagent sessions.
- Remove unsafe type assertions and fix non-atomic cleanup updates.

## 0.1.1

### Added

- Pi-native subagents extension with built-in and custom agent discovery, foreground and background execution, session resumption, read-only enforcement, live TUI, background completion wakeups, `/tasks`, `/agents`, `/subagent`, and `Ctrl+Alt+B`.
