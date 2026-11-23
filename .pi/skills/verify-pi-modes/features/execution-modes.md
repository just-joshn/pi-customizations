# Execution modes and read-only shell

Ask and Plan keep the session read-only while preserving the investigation tools. Agent is the control: the same command that Ask blocks must run there. The fake-model journey also checks the mode guidance reaches the provider request.

## Sub-features

- `ask-guidance`: Ask mode injects `[ASK MODE ACTIVE]` guidance.
- `ask-loadout`: Ask drops `edit`, `write`, `powershell`, and writer tools.
- `ask-bash-block`: a mutating bash command is blocked at `tool_call` and does not run.
- `ask-runtime-continues`: the run continues after the block instead of ending.
- `agent-control`: Agent runs the same kind of command, proving the Ask block is mode-specific. The fake drive does not cover this; the real-model e2e does.

## How to get to it (user POV)

Start Pi with `--mode=ask` and ask a question. Ask the model to run a mutating shell command such as `rm -rf victim.txt`. Then start an Agent run and run a comparable command. For Plan, start with `--plan` or use `/mode plan`; Plan shares Ask's read-only loadout and shell guard.

## Driving it with the fake-model harness

Preconditions: `doctor` is ready; `EVIDENCE` and `HELPER` are absolute.

```sh
node "$HELPER" drive "$EVIDENCE"
```

Read `stdout.log` and require these exact `ok` lines:

- `ok ask run exits 0`
- `ok ask run sends the mode guidance`
- `ok ask loadout drops edit, write, and powershell`
- `ok the runtime blocks the mutating tool call`
- `ok the blocked command did not run`
- `ok the run continues after the block`

The fixture workspace is copied to `e2e-root/workspace/`. Require `victim.txt` with the original body. The fake drive does not run an Agent control. The repository's real-model script `extensions/no-ceilings/pi-modes/test/e2e/verify-modes.mjs` checks the Agent write only when a logged-in model is available; mark `agent-control` NOT VERIFIED without it.

## Gotchas

- The fake model exercises the provider boundary; it does not prove a real model follows Ask guidance.
- A blocked `tool_call` is not enough. Require the guard message **and** the untouched `victim.txt`.
- The mutating test command is `rm -rf victim.txt`. Do not substitute an already-removed path; the side-effect check would become meaningless.
- `git status` and worktree `git diff` are intentionally refused by the read-only shell policy. Do not treat that refusal as a regression in this feature.
