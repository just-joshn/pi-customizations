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
- Project agent directories and the project `subagents.json` load only for a trusted project, matching Pi's gate on project skills and MCP configuration.
- Child sessions inherit the parent's active tool loadout when the definition lists no `tools`.
- The tasks pager and task renderer show retries, failure ids, worktrees, and checkpoints.
- `/agents` prints the effective config and config errors.

### Fixed

- Extension load no longer calls runtime actions, so `pi -e` and `pi -ne -e` load the extension without an initialization error.
- The agent catalog now reaches the model through the run's system prompt. Injecting it as a custom message was stripped by the extension's own context filter, so custom agent names and descriptions never arrived.
- A resumed or retried run keeps its read-only mode, model, thinking level, and foreground or background mode.
- A child session uses the parent project's trust state, so an untrusted project cannot supply its system prompt, skills, or shell prefix.
- Project agents and project config are read from the calling context, so an untrusted project cannot use them before `session_start`.
- A child never falls back to Pi's default tools when the parent has nothing to inherit.
- Read-only shell enforcement blocks attached `sed` write commands and `sort -o` output files.
- `await_subagent` reports the failure reason of a failed run.
- Claude and Codex tool names map to Pi tool names, so a Claude agent file actually activates its tools.
- `disabled: false` and `disabled: no` keep an agent enabled.
- A hyphenated agent named in the task text is selected.
- `nesting.maxDepth: 0` rejects delegation.
- The tasks pager shows live thinking.
- Top-level `max-tokens` caps the child output.
- Checkpoints, tool counts, and transcript paths persist while a run is in flight.
- A nested child inherits the calling child's tools, not the root session's tools.
- Read-only shell enforcement blocks `sed w/file`, two-operand `uniq`, `git branch` and `git tag` creation, `git remote` writes, and `date -s`.
- Read-only mode blocks the `powershell` tool, including when a child inherits tools.
- Worktree metadata survives a resume, and a resume fails clearly when the worktree or transcript file is gone or corrupt.
- Background completion and await results include the worktree diff summary.
- Mid-run state snapshots omit transcript items, so a long run no longer writes a full transcript per step.
- Disabling `general-purpose` falls back to the first available agent for an ambiguous task.
- A read-only agent stays read-only when a caller passes `readonly: false`.
- Terminal failures such as `resume-unavailable` and `worktree-failed` are not retried into a fresh run.
- Read-only shell enforcement blocks sed and awk program files, attached sed `w` forms, and awk redirection.
- YAML `yes` and `on` are read as true for `readonly`, `enabled`, `disabled`, and `nested-tasks`.
- A mid-run snapshot keeps the transcripts of completed runs and omits only the running record.
- `model-params` sampling reaches the provider request for every adapter, including Anthropic and Google.
- A failed worktree run emits `subagents:run_end`.
- Thinking from `thinking_start`, `thinking_end`, and message thinking blocks is stored once in the transcript.
- An aborted await reports `aborted` instead of `await-timeout`.
- Read-only mode allows `git branch --show-current`, `git branch --list`, `git remote show`, and `git tag -l` again.
- Configured agent directories inside an untrusted project are ignored.
- The final assistant message is trimmed, so it is not stored twice.
- `session_shutdown` marks running records cancelled and persists the state.
- An already-aborted call does not create a worktree or branch.
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
