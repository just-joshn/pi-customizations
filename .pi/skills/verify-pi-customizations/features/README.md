# pi-customizations verification map

This directory is the maintained source for verifying the user-facing behavior of `pi-customizations` packages, extensions, and skills. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Ensure Node.js `>= 22.19.0` and `pi` CLI `>= 0.87.1` are installed and available on `PATH`.
- Run `./.pi/skills/verify-pi-customizations/bin/control-pi doctor` to verify environment readiness.
- Set `PI_CODING_AGENT_DIR` to a disposable temporary directory per run to prevent mutating user session state or configuration.
- Never drive an instance not started by the verification run.

## Driving conventions

- Drive verification actions through `./.pi/skills/verify-pi-customizations/bin/control-pi`.
- Capture both the command input and the observable outputs (stdout, stderr, custom RPC messages, notifications, state entries).
- Write evidence artifacts under `artifacts/verify-pi-customizations/<feature>/`.
- Do not remove proof artifacts during cleanup; remove only temporary scratch directories and child processes.

## Proof and skip reporting

- Proof for CLI commands includes exit code, stdout, and stderr.
- Proof for RPC prompts includes custom messages (`pstack-status`), UI notifications (`notify`), and appended branch entries (`pstack-state`).
- Proof for model providers includes table listing of available models.
- Record the feature ID and entry point used with every artifact.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order:

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-pi` starts with `Preconditions:` and pairs each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [pstack status and todos](./pstack-status.md) covers `/pstack status`, `/pstack todos`, version info, skill counts, and prompt templates.
- [Poteto mode](./poteto-mode.md) covers toggling persistent poteto mode off, UI notifications, and branch state persistence.
- [Standalone skills](./standalone-skills.md) covers discovery of repository skills (`doctor`, `simplify`, `run`, `reverse-engineer-cli`, `implement-cli-from-contract`).
- [OAuth providers](./oauth-providers.md) covers subscription model provider registration for Claude and Antigravity.
