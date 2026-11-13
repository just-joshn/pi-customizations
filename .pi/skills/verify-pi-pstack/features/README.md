# pi-pstack verification map

This directory is the maintained source for verifying the user-facing behavior of the `pi-pstack` extension. Read this index before driving, then use the matching feature file as the recipe.

## Baseline preconditions

- Run `bun install --frozen-lockfile` at the repo root once.
- `./.pi/skills/verify-pi-pstack/bin/control-pstack doctor` passes.
- Drives use the installed `pi` on `PATH` (proven on 1.5.2, macOS arm64) and load the package from the working tree through a scratch `settings.json` `packages` entry.
- The harness creates the scratch agent dir, HOME, and cwd, and scrubs inherited `PI_*`/`PSTACK_*` session variables. Do not pre-seed anything, and never drive `~/.pi/agent`.

## Driving conventions

- Use `control-pstack drive <feature>` for every mapped drive.
- The model is `scripted/echo`. A prompt drives it with a second line `@@script <json steps>`; see the directive list at the top of `extensions/pi-pstack/test/fixtures/scripted-model.ts`.
- In RPC, answer `select`/`confirm` dialogs with `extension_ui_response` (`value` or `confirmed`), and match notifications by their message prefix.
- pstack state for a run is under `agent/pstack/workspaces/<slug>/`, where the slug is the realpath of `work/` with `/` and `:` replaced by `-` and wrapped in `--` (macOS: `--private-var-folders-...--`).

## Proof and skip reporting

- Evidence goes to `artifacts/verify-pi-pstack/<feature>/`. `run.json` there holds the status, Pi version, platform, summary, and first failed assertion; `*.events.jsonl` is the raw Pi event stream.
- A proof includes the tool result text, the appended custom messages or UI requests, and the on-disk side effect (transcript, terminal file, plan file, unchanged code file).
- Report which entry point you drove. JSON mode and RPC mode are different entry points, and the TUI is a third that no drive covers.

## Not mapped yet (report as unverified)

- **TUI rendering**: Task cards, the todo widget as drawn, plan footer, autocomplete of skill aliases. No tmux drive exists.
- **`/loop` and the `Loop` tool**: only RPC/TUI sessions have it (JSON runs are one-shot). The vitest suites cover it.
- **Subscriptions** (`subscribe_timer`, `subscribe_webhook`, `subscribe_github_pr`, `subscribe_slack`) and the `pstack-routines-supervisor` daemon they start. A drive would need to stop that daemon by PID; it is not built.
- **Cloud agents, `/in-cloud`, Slack tools, `request_secret`, `visualize`, `AskQuestion`, `/project`.**
- **`/mode` and the pstack command surface**: no drive covers them.
- **Real-model behavior** of pstack skills: `extensions/pi-pstack/scripts/live-e2e.mjs` needs real credentials and bills them.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph that describes the user-visible behavior. Four H2 sections follow, in this order:

1. `Sub-features`: short IDs, one line per behavior.
2. `How to get to it (user POV)`: every entry point a user has.
3. `Driving it with control-pstack`: starts with `Preconditions:`, then pairs each user action with the exact command and the observable result.
4. `Gotchas`: traps that can waste a verification run or invalidate it.

## Features

- [Task subagents](./task-subagents.md): foreground `Task` result and transcript, background `Task` with its completion notice and follow-up turn, and `agent_status`.
- [Background shell](./background-shell.md): `bash_background` launch text, terminal output file with header and footer, completion notice, and the `block_until_ms` blocking path.
- [Plan mode](./plan-mode.md): `/plan` on and off, `CreatePlan` plan files, markdown-only writes, and the build dialog.
- [Todos](./todos.md): `TodoWrite` replace and merge, the `pstack-todos` widget, and `<pstack_todos>` in the next system prompt.
