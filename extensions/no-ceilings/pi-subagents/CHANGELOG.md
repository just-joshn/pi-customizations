# Changelog

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
