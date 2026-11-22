# Changelog

## 0.1.4

### Added

- `task` accepts a `thinking` level and passes it to the child session, so a caller can set the child's reasoning level.
- Opt-in `nested-tasks: true` agent frontmatter: non-readonly children get `task` and `await_subagent` one level deep, scoped to their own runs, with lifecycle cancellation.

### Changed

- An explicit unknown `model` now fails with a clear error instead of silently using the parent model. An invalid agent default still inherits the parent. Pass `provider/id` when a bare id is ambiguous across providers.

### Fixed

- Persist nested child ownership (`ownerAgentId`) so a resumed owner can still await and cancel the children it launched.
- Walk the `ownerAgentId` ancestry when resolving depth, so a resumed grandchild stays inside the nesting bound.
- Record the root session id on a nested scope so nested children keep the root lineage when their owner is resumed.

## 0.1.3

### Changed

- Remove the retired `style-audit` script from `package.json`.

## 0.1.2

### Fixed

- Inherit parent extension providers in child subagent sessions so custom OAuth and extension-registered models resolve inside delegated runs.
- Remove unsafe type assertions and fix non-atomic cleanup updates.

## 0.1.1

### Added

- Add the Pi-native subagents extension with built-in (`general-purpose`, `explore`, `shell`, `debug`) and custom agent discovery from `.pi/agents`, `.agents/agents`, `~/.pi/agent/agents`, and `~/.agents/agents`.
- Register the `task` and `await_subagent` tools with foreground/background execution, session resumption, read-only `tool_call` enforcement, and transcript persistence.
- Add live streaming task TUI rendering, background completion wakeups, the interactive `/tasks` overlay (`Ctrl+Alt+T`), `/agents`, `/subagent`, and `Ctrl+Alt+B` backgrounding shortcut.
- Add behavior and regression tests covering discovery, execution, readonly guards, and overlay flows.
