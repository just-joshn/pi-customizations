# pi-claude-default-dark verification map

This directory is the maintained source for verifying the user-facing behavior of the `pi-claude-default-dark` package. Read this index before driving, then use the matching feature file as the recipe.

## Baseline preconditions

- `./.pi/skills/verify-pi-claude-default-dark/bin/control-claude-default-dark doctor` passes.
- Drives use the installed `pi` on `PATH` (proven on 1.5.2, macOS arm64, tmux 3.8). They install the package from the working tree with `pi install <path>` into a scratch agent dir.
- No model, no network, and no seed data. Do not pre-seed anything, and never drive `~/.pi/agent`.

## Driving conventions

- Use `control-claude-default-dark drive <feature>` for every mapped drive.
- A rendered theme is proven by its `muted` color as a 24-bit SGR sequence in the colored pane, never by the theme's name on screen.
- Messages from `/claude-theme` are matched by their exact text.

## Proof and skip reporting

- Evidence goes to `artifacts/verify-pi-claude-default-dark/<feature>/`. `run.json` holds the status, Pi version, platform, summary, and first failed assertion. `steps.json` holds each step.
- Report which entry point you drove. These drives cover the TUI and the `pi install` / `pi list` CLI. Print and RPC modes are not driven.

## Features

| Feature | Drive | File |
|---|---|---|
| Install and discovery | `install` | [install.md](install.md) |
| Theme selection | `select` | [select.md](select.md) |
| `/claude-theme status` | `status` | [status.md](status.md) |
| `/claude-theme use` | `use` | [use.md](use.md) |
| Respect the user's choice | `respect` | [respect.md](respect.md) |
| `/claude-theme verify` and usage | `verify` | [verify.md](verify.md) |

## Not mapped yet (report as unverified)

- **Tool-row restyling and the working indicator** under `claude-default-dark` (edit-diff backgrounds and syntax colors, failed bash output, collapsed titles, the orange spinner). They only appear when a model runs tools, and these drives never fake a model. The package's adapter property tests (`development/tests/adapters.property.test.ts`) and the G4/G6 parity gates, which capture scripted tool calls, cover them.
- **Color parity with Claude Code** and per-role colors. Those live in `extensions/pi-claude-default-dark/development` (`make verify-claude-default-dark`, `PARITY_REPORT.md`).
- **`pi remove`** and Pi's startup warning when a saved theme disappears. The package's G7 gate script covers it (`development/scripts/g7-lifecycle.mjs`).
- **Resume and fork** with the theme, and **256-color terminals**. G7 and G8 gate scripts cover them.
- **`/claude-theme` outside the TUI** (print and RPC modes, where it returns silently).
- **Duplicate command registration**, which the TUI does not expose (see [respect.md](respect.md)).
- **A `--use-theme` choice across `/reload`**, and saved themes other than `dark` in the respect check.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph that describes the user-visible behavior. Four H2 sections follow, in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with control-claude-default-dark`, and `Gotchas`.
