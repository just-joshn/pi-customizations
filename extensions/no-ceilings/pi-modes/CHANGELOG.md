# Changelog

## 0.1.2

### Changed

- Remove the retired `style-audit` script from `package.json`.

## 0.1.1

### Added

- Add Pi-native **Agent**, **Ask**, **Plan**, and **Debug** execution modes with mode-scoped tool access, read-only shell guards, and live progress widgets.
- Add local NDJSON debug ingest server (`127.0.0.1:7242-7942/ingest/<uuid>`) and `<reproduction_steps>` interactive flow for Debug mode, plus `.plan.md` persistence in `~/.pi/agent/plans/` for Plan mode.
- Register the `switch_mode`, `ask_question`, and `create_plan` tools, `/mode`, `/agent`, `/plan`, `/ask`, `/debug`, and `/logs` commands, `Ctrl+Alt+M` / `Ctrl+Alt+P` shortcuts, and `--mode` / `--plan` CLI flags.
- Add user behavior tests for all four modes and regressions.
