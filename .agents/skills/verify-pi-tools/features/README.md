# pi-tools verification map

This directory is the maintained source for verifying the user-facing behavior of the pi-tools
extension. Read the index before driving the tool layer, then use the matching feature file as the
recipe.

## Baseline preconditions

- Run from the repository root.
- `pi` and `bun` are on `PATH`.
- Dependencies are installed in `extensions/no-ceilings/pi-tools` (`bun install`).
- `bun .agents/skills/verify-pi-tools/scripts/verify.ts doctor` prints `doctor: ok`.
- Each run gets a fresh temp workspace and a fresh Pi profile. Never drive the user's real profile.

## Driving conventions

- Drive through `bun .agents/skills/verify-pi-tools/scripts/verify.ts run --feature <id>`.
- Use the feature IDs below. They are the mapped entry points, not examples.
- The model is scripted. A tool call happens only because a scenario `turns` entry asks for it.
- Start every recipe from the baseline state; a scenario seeds its own files.
- Treat the commands in a feature file as literal.

## Proof and skip reporting

- Capture the tool event (`tool_execution_end`, `isError`, result text) and the file state.
- `summary.txt` must say PASS; `events.json` and `files.json` must agree.
- A missing tool call, a changed prompt, or a failed check is a failure, not a skip.
- Report an unreachable path with the feature ID, the command, and the unmet precondition.
- Do not report a skipped entry point as verified through a different feature.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the behavior. It then uses
exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with verify.ts` starts with `Preconditions:` and pairs each action with an exact
   command and an observable result.
4. `Gotchas` lists traps that waste or invalidate a run.

## Index

- [files](files.md) - write, read, and edit with real bytes and read metadata.
- [search](search.md) - grep, find, and ls with an ignore file.
- [policy](policy.md) - deny rules and the outside-workspace refusal without a UI.
- [shell](shell.md) - bash output and an exec deny rule.
