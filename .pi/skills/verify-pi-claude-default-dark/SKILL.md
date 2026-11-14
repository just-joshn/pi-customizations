---
name: verify-pi-claude-default-dark
description: "Verify the pi-claude-default-dark package (extensions/pi-claude-default-dark: the claude-default-dark theme and the /claude-theme status|use|verify command) through the installed pi CLI and its TUI in a private tmux server: pi install and the /settings theme picker, theme selection by --use-theme and settings.json, /claude-theme status (installed and theme-missing), /claude-theme use, /claude-theme verify and its usage warning, and that an explicit theme choice survives startup and /reload. Use after changing the package's manifest, extension, or theme, before releasing it, or when a user reports an install, selection, or command regression. Its tool-row and working-indicator adapters need a model running tools, so they are covered by the package's adapter tests and parity gates, not here. Color parity against Claude Code is a separate check (extensions/pi-claude-default-dark/development, make verify-claude-default-dark)."
---

# Verify pi-claude-default-dark

Drive `extensions/pi-claude-default-dark` the way a user does. Each drive installs the package with the real `pi install <path>` into a scratch agent dir, then starts the real Pi TUI in a private tmux server and types commands. There is no model and no network. What these drives cover needs neither: the theme is a resource, and `/claude-theme` reads theme state, compares colors, or calls `ctx.ui.setTheme`. The package's tool-row and working-indicator adapters only show while a model runs tools, so they are out of scope here (see "Not mapped yet"). Wherever a drive claims a rendered theme, it proves it by color, not by name: it looks for the theme's `muted` foreground (`colors.muted` in `themes/claude-default-dark.json`, currently `#999999`) as a 24-bit SGR sequence in `tmux capture-pane -e` output. Stock Pi `dark` never emits that sequence.

Read `features/README.md` before driving, then the feature file for the behavior you need to prove.

## Launch

Pi is a short-lived CLI, so there is no server. Nothing to build: the package has no runtime dependencies and the harness needs only Node, `pi`, `tmux`, `lsof`, and `ps`.

Each drive creates `$TMPDIR/verify-pi-cdd-*/` with:

- `agent/`: `PI_CODING_AGENT_DIR`. `pi install` writes the package into its `settings.json` `packages`. Drives that need a starting theme write `settings.json` `theme` themselves.
- `home/`: `HOME`, so nothing reads your real dotfiles.
- `cwd/`: the cwd of every Pi process.
- `tui.sh`: the exact environment and `pi` command line the tmux pane runs.
- `run.json`: the tmux socket and the PIDs this run started.

Every Pi process gets `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, `TERM=xterm-256color`, and `COLORTERM=truecolor`. The harness removes inherited `PI_CODING_AGENT_DIR`, `PI_OFFLINE`, `PI_MODEL`, `PI_PROVIDER`, `PI_REASONING_LEVEL`, `NODE_OPTIONS`, `ANTHROPIC_API_KEY`, and `OPENAI_API_KEY`. Inside a Pi chat those are often set and would leak your session into the child.

Ready means the pane shows Pi's `v1.` header. The TUI warns `No models available`. That is expected and harmless here.

Teardown happens in each drive's `finally`: the harness kills the private tmux server and the recorded PIDs, then removes the scratch dir.

## Doctor

Run this first, and again whenever a drive fails strangely:

```bash
./.pi/skills/verify-pi-claude-default-dark/bin/control-claude-default-dark doctor
```

It checks Node `>= 22.19.0`, `pi --version` (drives pass on 1.5.2), `tmux`, `lsof`, `ps`, that the package's `package.json`, `extensions/index.ts`, and `themes/claude-default-dark.json` exist, that the theme's `muted` color is a `#rrggbb` value (the drives' rendering probe needs a hex color), and that no scratch runs are left over. It prints which inherited variables the drives remove, and exits `1` on any failure.

## Drive

```bash
B=./.pi/skills/verify-pi-claude-default-dark/bin/control-claude-default-dark
$B drive install   # pi install, pi list, and the /settings theme picker
$B drive select    # --use-theme renders without saving; the /settings picker saves and renders; settings.json theme renders
$B drive status    # /claude-theme status installed, bare /claude-theme, and with the theme file removed
$B drive use       # /claude-theme use switches a session that started on dark
$B drive respect   # a saved dark choice survives startup and three /reload runs; the command still answers
$B drive verify    # /claude-theme verify on the theme and on dark; the usage warning
$B drive all       # every feature in turn; exits 1 if any fails
```

Flags: `--out <dir>` writes evidence elsewhere. `--keep` keeps the scratch dir (processes are still killed) and prints its path as `scratch`.

Each drive prints a JSON report and exits `0` or `1`: `feature`, `status` (`PASS` or `FAIL`), `evidence`, `summary` (one line per step), and `error` with the last pane when a wait times out.

To drive something by hand, copy `tui.sh` from a `--keep` run and attach with `tmux -L <tmuxSocket from run.json> attach -t pi`. Match on plain text for messages and on SGR sequences for colors. Pi shows only the latest notification, so counting copies of a message on screen proves nothing about how many times it was sent. Do not match `claude-default-dark` alone: the scratch cwd path in Pi's footer does not contain it (the prefix is `verify-pi-cdd-`), but a custom `--out` or cwd might.

## Evidence

Each drive replaces `artifacts/verify-pi-claude-default-dark/<feature>/`, which is gitignored. Every drive writes `run.json` (the report) and `steps.json` (each step's status and summary), plus `.ansi` pane captures (`tmux capture-pane -e`, colors kept) at each asserted state, and `settings.*.json` snapshots where settings matter.

Proof standards:

- Drive the real user paths: `pi install <path>`, `pi list`, the TUI, and slash commands typed into the editor. Do not load the extension with `-e`, import its module, or call `ctx` APIs directly.
- Prove rendering by the theme's own color in the captured SGR stream, and prove side effects in `settings.json`. A screen that merely contains the theme's name proves nothing.
- Never fake a model or the network. If a check seems to need one, it belongs in the package's parity gates (`extensions/pi-claude-default-dark/development`), not here.
- Scope: these drives do not prove color parity with Claude Code, every theme role, light terminals, 256-color terminals, or `pi remove`. See "Not mapped yet" in `features/README.md`.

## Cleanup

Drives clean up after themselves even when they fail. For a kept or interrupted run:

```bash
./.pi/skills/verify-pi-claude-default-dark/bin/control-claude-default-dark cleanup
```

`cleanup` reads each `$TMPDIR/verify-pi-cdd-*/run.json`, kills that run's tmux server and recorded PIDs, and removes the directory. It never kills by process name and never touches `artifacts/verify-pi-claude-default-dark/`.

## Helpers

- `bin/control-claude-default-dark` is an executable Node script on the shared harness `../_shared/verify-harness.mjs`. Subcommands: `doctor`, `drive <install|select|status|use|respect|verify|all> [--out <dir>] [--keep]`, `cleanup`. Each drive gets `ctx` with `install(source, agentDir?)`, `tui(args?, agentDir?)` (starts the TUI and returns the colored pane), `command(text, needle?)` (types a line, presses Enter, optionally waits for `needle`, and returns the colored pane), `pi(args)`, and `stop()`. To add a feature, write a `drive<Name>(ctx)` that wraps each assertion in `ctx.evidence.step(name, fn)`, register it in `drives`, and add a feature file.
