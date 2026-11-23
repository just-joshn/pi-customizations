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
- Ordered transcripts with prompt, assistant text, tool arguments, tool output, and error flags, persisted up to 50 items per run and 4,000 characters per item.
- `/subagent:<name>` command per discovered agent, plus `--bg` on both invocation forms.
- Configured nesting depth, with nested runs scoped to the runs a child started.
- End-to-end script that drives the real `pi` binary.

### Changed

- A `task` call without `subagent_type` selects an agent by description match, then falls back to `general-purpose`.
- Project agent directories and the project `subagents.json` load only for a trusted project, matching Pi's gate on project skills and MCP configuration.
- Child sessions inherit the parent's active tool loadout when the definition lists no `tools`.
- The tasks pager and task renderer show retries, failure ids, and worktrees.
- `/agents` prints the effective config and config errors.

### Fixed

- An explicit empty `tools` list grants no tools. Omitting `tools` still inherits the parent's active tools.
- A resume keeps the existing run's foreground or background mode, and its background reason, when `run_in_background` is omitted. The agent file's background default applies only to a new run. An explicit `run_in_background` still wins.
- A broad negation no longer swallows a later change. `Don't just read the code, update the parser.` stays a write. Filler between a negation and a write verb still counts, including `under any circumstances` and `should you`.
- `/subagent bash` selects the built-in `shell` agent. A discovered agent named `bash` still wins.
- A resume keeps call-level read-only mode when a later call passes `readonly: false`. Read-only mode from the agent definition, the call, or the existing run is a floor.
- Automatic selection treats make, address, improve, rework, get, and ensure as write intent. A verb after a determiner or subject pronoun, inside `how to`, or inside a discovered agent name is not write intent.
- A change request does not select a read-only agent when no writable agent is available. The selection is `general-purpose`, and the call fails with `type-unknown`.
- A discovered agent whose name matches a built-in alias, such as `bash`, resolves to that agent. The alias applies only when no discovered agent has that name.
- Negated write lists cover slashes, dashes, parentheses, and `under no circumstances`, including a negation split by extra words in the same sentence.
- A completion save keeps transcript bodies for the three most recently updated finished runs. Success, error, and cancelled runs are eligible. Mid-run snapshots keep metadata and transcript paths only.
- Read-only bash on macOS runs under `sandbox-exec`. The profile is built after the per-command temp directory is created and allows filesystem writes only inside that directory and `/dev/null`, not the shared `/tmp/pi-subagents-readonly` root. The wrapper sets `TMPDIR` to that directory, runs the command with `/bin/ksh`, and removes the directory after the command. `core.fsmonitor` is forced off, `diff.external` and `GIT_EXTERNAL_DIFF` are cleared, and `core.pager` is `cat`. `git grep -O` and `--open-files-in-pager` stay blocked.
- `/tasks abort` cancels a foreground launch during `git worktree add` and discards the worktree and branch.
- Automatic selection treats changing, splitting, moving, optimizing, porting, formatting, extracting, converting, replacing, setting, inserting, applying, generating, simplifying, cleaning up, swapping, dropping, and stripping as write intent, and prefers the longest overlapping agent name. A negation covers a coordinated verb list such as `do not edit, add, or delete`. `what to change` is not write intent. Description keywords are counted once. Agent names that differ only by case collapse to one definition.
- Restoring an in-flight run marks it cancelled and stores a failure id. The status widget header keeps completed-run counts while another run is active.
- A background worktree launch returns before `git worktree add` finishes. Aborting during creation removes the worktree and branch, and an already-aborted call does not start the child.
- `session_shutdown` stores a failure id on every cancelled run. A completion that finishes after shutdown stays cancelled and does not wake the next session.
- A worktree child whose parent directory is untracked uses the nearest existing directory inside the worktree.
- A multi-word agent name in the task text is selected when the whole name appears, and a longer name such as a plural does not match.
- The tasks list shows a failure id on the row that has one.
- A restored run that only has a transcript path says the live transcript is no longer retained and shows that path.
- Built-in `browser` tools are limited to the matched MCP server (`mcp__<server>__*`) instead of every `mcp__` tool.
- Failed child model requests (`stopReason: "error"`) return `status: "error"` with a failure id and trigger `max_attempts` retries.
- Exiting or replacing a session while a background subagent is in flight no longer throws on a stale UI context.
- Read-only shell enforcement blocks `git reflog expire`/`delete`, non-slash `sed` execute flags, and mutating `date` and `hostname` invocations.
- Negated write phrases no longer divert an explicitly named read-only agent to a writable one.
- Per-agent slash commands require `--bg` to be a whole token, so `--bg-color` stays in the foreground prompt.
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
- A mid-run snapshot keeps metadata and the transcript path for every run, including a finished run, and omits transcript bodies.
- `model-params` sampling reaches the provider request for every adapter, including Anthropic and Google.
- A failed worktree run emits `subagents:run_end`.
- Read-only shell enforcement blocks `>&` and `<>` redirects, backslash-escaped redirects, and `sort --compress-program`.
- Sampling is left out of Anthropic adaptive thinking requests, as it already was for enabled thinking.
- `max-tokens` and `context-window` survive the provider refresh that follows inherited provider registration.
- One invalid persisted record no longer drops the other restored runs.
- Automatic selection skips read-only agents when the task asks for a change, and two named agents fall back to `general-purpose`.
- The documented `bash` alias resolves to `shell` again.
- Children inherit parent tools outside Pi's default set, such as `grep`, `find`, and `ls`.
- Cancelling during child-session creation no longer prompts the child.
- Multiple thinking blocks in one message are recorded once.
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
- Read-only mode blocks `sed -i` and `sed --in-place` anywhere in the command, and `tree -o` or `tree --output` output files.
- A quoted `>` in a read-only command is not a redirect. Unquoted `>` and `>>` stay blocked, and `>&` stays allowed.
- `model-params` writes Google sampling into `config` and Bedrock sampling into `inferenceConfig`. An Anthropic request with extended thinking enabled is left unchanged. `top_k` is no longer copied onto OpenAI sampling parameters.
- Configured agent directories come after the workspace directories and before user directories, so a configured project agent wins over a user agent of the same name.
- Every discovered agent gets a slash command. Colliding slugs are suffixed `-2` and `-3`. `/subagent` accepts a multi-word name, and `/subagent <name> --bg` with no prompt prints usage and sends nothing.
- A per-agent command resolves the agent at invocation. A removed agent warns `Unknown subagent "<name>"` and sends nothing.
- A nested child receives the agent catalog in its system prompt.
- A read-only resume with an empty prompt validates the id, lineage, worktree, and transcript before waiting.
- Read-only shell enforcement rejects a lone `&`, command substitution, and unclosed quotes. It allows `git grep`, quoted pipes, `|&`, and redirects to `/dev/null` such as `2>/dev/null`. `date -d` and `date --date` stay allowed; `date -s` stays blocked.
- Unknown `subagents.json` sections and unknown keys inside a section are reported instead of ignored.
- A mid-run snapshot keeps metadata and transcript paths only. A completion save keeps transcript bodies for the three most recently updated finished runs, including success, error, and cancelled runs. Older finished runs keep metadata, the transcript path, and checkpoints.
- A worktree run started in a repository subdirectory uses that subdirectory inside the worktree.
- Resuming a run that never recorded a transcript fails with `resume-unavailable`. Retry still starts a fresh session.
- A resume keeps background mode when the caller omits `run_in_background`.
- A child session prepends the agent prompt and still inherits project and user `APPEND_SYSTEM.md`.
- The tasks pager `k` aborts a foreground run as well as a background run. `b` still backgrounds only a foreground run.
- Read-only sandbox writes are allowed only in the per-command temp directory and `/dev/null`. The shared temp root and sibling directories stay denied. `awk` programs that pipe into another program, and `git --ext-diff` and `git --textconv`, are blocked.
- A `tools` list is an allowlist passed to the child session. Entries that start with `-` are dropped, a leading `+` is removed, and entries that contain `*` are dropped except a scoped `mcp__<server>__*` pattern. A list that sanitizes to empty grants no tools instead of editing the default tool set. Claude names are still mapped, and the result is deduplicated.
- Retry backoff and `await_subagent` timeouts stay referenced, so `pi -p` waits for a retried child instead of exiting 0 with no result.
- Checkpoints stay in memory and on `subagents:checkpoint` during a run. The parent session persists them at the next run boundary and on shutdown when a run was still active, not on every tool call. A crash can lose the latest mid-run checkpoint. Shutdown does not append another state entry when nothing was active.
- Read-only Git disables diff drivers, textconv, external diffs, SSH commands, and credential helpers. `git diff`, `git log`, `git show`, and `git blame` receive `--no-ext-diff --no-textconv`. `GIT_SSH_COMMAND`, `GIT_SSH`, `GIT_ASKPASS`, and `SSH_ASKPASS` are `/usr/bin/false`, `GIT_TERMINAL_PROMPT` is `0`, and `credential.helper` is empty.

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
