# pi-customizations verification map

This directory is the maintained source for verifying the user-facing behavior of `pi-customizations` packages, extensions, and skills. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Ensure Node.js `>= 22.19.0` and `pi` CLI `>= 0.87.1` are installed and available on `PATH`.
- Run `./.pi/skills/verify-pi-customizations/bin/control-pi doctor` to verify environment readiness.
- `control-pi` creates a disposable scratch directory and sets `PI_CODING_AGENT_DIR` for each Pi process it starts. Do not set it manually for driver runs.
- Never drive an instance not started by the verification run.

## Driving conventions

- Use `./.pi/skills/verify-pi-customizations/bin/control-pi` for mapped RPC drives. Run manual CLI checks only when a feature recipe lists them.
- Capture both the command input and the observable outputs (stdout, stderr, custom RPC messages, notifications, state entries).
- `control-pi drive <name>` loads `scenarios/<name>.mjs`; adding a scenario is adding a file, and an unknown name lists the available scenarios.
- Write one receipt per asserted surface under `artifacts/user-perspective/<scenario>/<surface_id>.json`, with the raw capture it was asserted against under `artifacts/user-perspective/<scenario>/raw/`. The receipt contract lives in `docs/user-perspective-testing/README.md`.
- Do not remove proof artifacts during cleanup; remove only temporary scratch directories and child processes.

## Proof and skip reporting

- Proof for CLI commands includes exit code, stdout, and stderr.
- Proof for RPC prompts includes custom messages (`pstack-status`), UI notifications (`notify`), and appended branch entries (`pstack-state`).
- Proof for model providers includes table listing of available models.
- A drive exits nonzero when any receipt it wrote has verdict `failed`.
- Record the feature ID and entry point used with every artifact.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order:

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-pi` starts with `Preconditions:` and pairs each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [pstack status and todos](./pstack-status.md) covers `/pstack status`, `/pstack todos`, direct `TodoWrite` replacement and merge, and the TUI todo widget.
- [Poteto mode](./poteto-mode.md) covers command and direct-tool mode changes, UI notifications, and branch state persistence.
- [Standalone skills](./standalone-skills.md) covers discovery of repository skills (`doctor`, `simplify`, `run`, `reverse-engineer-cli`, `implement-cli-from-contract`).
- [OAuth providers](./oauth-providers.md) covers subscription model provider registration for Claude and Antigravity.
