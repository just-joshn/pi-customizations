# Changelog

## 0.2.0

### Added

- Skill-backed **custom modes**. Any Pi skill becomes a mode through `/mode <skill>`, the mode picker, or `--mode=<skill>`, with its body attached on the entered turn and a sticky reminder on every later turn.
- `/mode off` to leave a custom mode, and a `Ctrl+Alt+M` handling that leaves the active custom mode instead of cycling execution modes.
- `/mode icon [<glyph>]` and `/mode color [<name>]` with pickers that write `icon:` and `color:` into the skill frontmatter, plus an icon and color badge in the status line.
- `/mode` argument completions covering the built-in modes, every custom mode, and the `off` / `color` / `icon` verbs.
- One-message skill invocation for prompts that mention `/<skill-name>`, alongside Pi's native `/skill:<name>` expansion.
- End-to-end script that drives the real `pi` binary.

### Changed

- `/mode` accepts an optional prompt after the mode or skill name, and opens a picker that lists both execution modes and custom modes.
- Active custom mode state persists in the session, so resuming restores the badge and the sticky reminder.
- The footer shows the execution mode in a second slot whenever a custom mode is active, so a read-only Ask or Plan constraint stays visible under the custom badge.
- Plans are written to `plans/` inside Pi's agent directory instead of a hardcoded home path, so `PI_CODING_AGENT_DIR` is honored. `PI_MODES_PLANS_DIR` still overrides.

### Fixed

- The context filter keeps guidance for the current run and removes earlier copies.
- Read-only modes now block Pi's `powershell` tool, which had no shell guard and could mutate files from Ask or Plan mode.
- A prompt that references the already-active custom mode no longer attaches a second copy of its skill body.
- Read-only modes now enforce a tool allowlist. `edit`, `write`, `powershell`, and any other tool outside the read-only set, MCP writers included, are dropped from the loadout and blocked on call. The loadout is re-asserted at every run start and when MCP servers change, so a tool registered mid-mode cannot stay offered, and leaving the mode restores it.
- The read-only shell guard was rewritten as a quote-aware lexer plus a per-command policy. Output redirection (including `1<>`), command substitution, and chained mutating segments are refused. ANSI-C quoting (`$'...'`), backslash line continuations, clustered short options (`sort -nro`, `tree -L2o`), `git remote -v remove`, and package-manager `audit fix` are refused too. `sed` is limited to its printing side, `git` allows read subcommands only, and `find`/`fd`/`sort`/`uniq`/`tree`/`rg`/`awk` reject their write or execute forms, while `git -C`, `--no-pager`, `2>&1`, `>&2`, `LANG=C ls`, `find -executable`, `git config --local --list`, `git grep`, `sed -n '/pat/p'`, and quoted `>` inside an `rg` pattern are allowed.
- Read-only shell guard closes attached `sed -e` writes, `bat --pager`/`--config-file` execution, executing `GIT_*`/`NODE_OPTIONS` environment prefixes, and `git branch` delete aliases such as `--delete-merged`, including abbreviated long options and short clusters. Attached read-only sed scripts, `uniq` value options, and `git show-ref` are allowed.
- Read-only shell guard now refuses `bat cache`, `bat --generate-config-file`, `file -C`, abbreviated deny flags such as `sort --out`, and git diff filters unless the command includes both `--no-ext-diff` and `--no-textconv`. Without a UI, `switch_mode` refuses escalation from Ask or Plan to Agent or Debug.
- Read-only shell guard refuses locale quoting, braced parameter expansion, brace expansion, `git apply --apply`, git grep option abbreviations, filter execution through `cat-file`, `blame`, and pickaxe searches, `rg --hostname-bin`, and clock-changing `date` commands. Plan completion ignores negated statements, and appearance writes handle flow-style YAML and preserve CRLF line endings.
- Read-only shell guard now also refuses unquoted pathname and bare variable expansion, `python -v`, and `git log -c` filters. Plan completion ignores negated, future, and substring `all steps` statements, and step extraction ignores negated `Done` and `Step` markers. Skill references ignore absolute filesystem paths. Appearance writes handle multi-line flow maps and quoted keys.
- User prompts and extension triggers both start runs with mode guidance. If the transcript is compacted, Pi gets the same entry, exit, and one-message skill instructions for that run.
- The mode picker disambiguates a custom row that matches a built-in row, and `/mode <title starting with a built-in name>` resolves the full title instead of the built-in.
- Resuming a custom mode no longer writes a duplicate copy of its state.
- `create_plan` writes the phases it tracks into the plan file even when `is_project` is omitted, and phases now make the plan a project plan.
- `chat`, `search`, and `default` remain compatibility aliases but now yield to a skill with that name.
- A slash command with an inline mode prompt runs to completion in print mode before Pi exits or submits the next prompt.
- `/mode icon` and `/mode color` update single-file skills and preserve valid YAML, including when replacing a folded value. An exact multi-word title wins over an appearance verb.
- An unknown `--mode=<value>` warns in the UI or on stderr in print mode.

## 0.1.3

### Changed

- Update `README.md` to describe when plan frontmatter is written and the derived debug log filename.

## 0.1.2

### Changed

- Remove the retired `style-audit` script from `package.json`.

## 0.1.1

### Added

- Add Pi-native **Agent**, **Ask**, **Plan**, and **Debug** execution modes with mode-scoped tool access, read-only shell guards, and live progress widgets.
- Add local NDJSON debug ingest server (`127.0.0.1:7242-7942/ingest/<uuid>`) and `<reproduction_steps>` interactive flow for Debug mode, plus `.plan.md` persistence in `~/.pi/agent/plans/` for Plan mode.
- Register the `switch_mode`, `ask_question`, and `create_plan` tools, `/mode`, `/agent`, `/plan`, `/ask`, `/debug`, and `/logs` commands, `Ctrl+Alt+M` / `Ctrl+Alt+P` shortcuts, and `--mode` / `--plan` CLI flags.
- Add user behavior tests for all four modes and regressions.
