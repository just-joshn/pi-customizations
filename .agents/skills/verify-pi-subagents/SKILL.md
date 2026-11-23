---
name: verify-pi-subagents
description: Drive the pi-subagents Pi extension through the real `pi` CLI to verify task delegation, custom agents, background and worktree runs, read-only isolation, and persisted observability. Use when changing `extensions/no-ceilings/pi-subagents` or checking a claimed subagent behavior.
---

# Verify `pi-subagents`

This is a Pi extension, not a server. The user surface is `pi` loading `extensions/no-ceilings/pi-subagents/src/index.ts`: the `task` and `await_subagent` tools, the `/subagent` and `/agents` commands, the `/tasks` pager, and background completion messages. Headless `pi -p` is the primary harness. The TUI pager is driven through tmux.

A run is short-lived. There is no app server to keep alive. Every launch creates a fresh temp workspace, a fresh profile, and a fake OpenAI-compatible model on an ephemeral `127.0.0.1` port. The real `pi` binary loads the extension from source.

## Launch

From the repository root:

```bash
cd "$(git rev-parse --show-toplevel)/extensions/no-ceilings/pi-subagents"
node test/e2e/verify-delegation-fake-model.mjs
```

That is a complete launch and drive. It needs `pi` and `node`/`bun` on `PATH`, but no model credentials. It prints:

```text
evidence root: /tmp/pi-subagents-fake-e2e-...
...
PASS /tmp/pi-subagents-fake-e2e-...
```

The run is ready when it prints `PASS`. The `evidence root` is the workspace, profile, parent session directory, and child transcript directory for that run. The fake server closes when the script exits.

For a real-model run, use `node test/e2e/verify-subagents.mjs`. It exits `77` when no model credential is available; that is a skip, not a product failure.

Each run is isolated. The fake server binds an ephemeral port, the session directory is under the temp root, and the workspace is new. Two runs can execute side by side. Do not share a session directory or a workspace between runs.

## Doctor

Run this first whenever a drive is missing files, hangs, or fails before the parent reply:

```bash
"$(git rev-parse --show-toplevel)/.agents/skills/verify-pi-subagents/scripts/doctor.sh"
```

It is read-only. It checks `pi`, `bun`, `node`, the extension entry point, and `bun x tsc --noEmit -p tsconfig.json`, then prints `DOCTOR OK`. A failure means the checkout or toolchain is not worth driving.

## Drive

Use the scenario runner. It changes to the package and runs the repo's real harness:

```bash
"$(git rev-parse --show-toplevel)/.agents/skills/verify-pi-subagents/scripts/run-scenario.sh" delegation
"$(git rev-parse --show-toplevel)/.agents/skills/verify-pi-subagents/scripts/run-scenario.sh" custom
"$(git rev-parse --show-toplevel)/.agents/skills/verify-pi-subagents/scripts/run-scenario.sh" background
"$(git rev-parse --show-toplevel)/.agents/skills/verify-pi-subagents/scripts/run-scenario.sh" security
"$(git rev-parse --show-toplevel)/.agents/skills/verify-pi-subagents/scripts/run-scenario.sh" growth
```

| Scenario | Real path it exercises | Command it runs |
| --- | --- | --- |
| `delegation` | Parent calls `task`, custom `worker` reads a file, parent reports the child result, persisted state has a completed transcript | `node test/e2e/verify-delegation-fake-model.mjs` |
| `custom` | Custom `probe` agent, foreground result, background worktree, `await_subagent`, persisted checkpoints | `node test/e2e/verify-subagents.mjs` (real model; exit 77 if absent) |
| `background` | Background task, `await_subagent`, worktree branch, parent exit while a child runs | the delegation and custom scenarios together |
| `security` | Read-only Git helper refusal, crafted tools sanitization | `verify-git-helpers.mjs` and `verify-crafted-tools.mjs` |
| `growth` | Parent-session patch size under repeated runs | `verify-state-growth.mjs 12 50` |

The deterministic fake model is a production-boundary substitute, not an internal setter. It receives the real parent request, returns a real `task` tool call, the child session executes the real `read` tool, and the parent receives the real result. Changing the model server is appropriate only when the feature itself is the model protocol.

For a new prompt or agent, copy `test/e2e/verify-delegation-fake-model.mjs` into your evidence directory and edit the copy. Do not edit the repo test while verifying. Keep the real `pi` invocation, the temp profile, and the fake server.

For the TUI pager, start the real `pi` in tmux from the same temp workspace and profile. With a real model:

```bash
RIG=/tmp/pi-subagents-tui-$$
SESSION=pi-subagents-tui-$$
mkdir -p "$RIG/sessions"
printf 'TUI verification marker\n' > "$RIG/README.md"
tmux new-session -d -s "$SESSION" -c "$RIG" \
  "pi --session-dir $RIG/sessions -ne -e \"$(git rev-parse --show-toplevel)/extensions/no-ceilings/pi-subagents/src/index.ts\" -ns -np --no-themes --approve --model deepseek-flash"
tmux send-keys -t "$SESSION" "Use the task tool with subagent_type=\"general-purpose\" to read README.md and report one sentence." Enter
sleep 8
tmux send-keys -t "$SESSION" "/tasks" Enter
tmux capture-pane -p -t "$SESSION" -S -80 > "$RIG/tasks.txt"
tmux kill-session -t "$SESSION" 2>/dev/null || true
```

Inspect `tasks.txt` for the run row, status, transcript path, and the pager. The TUI needs a real model because the fake server is not running in that recipe.

## Evidence

Put proof under:

```text
/tmp/pi-subagents-verify-evidence/<UTC timestamp>/
```

Never put proof under the repository or inside the temp rig that cleanup removes.

Capture:

- the exact command and its complete stdout and stderr (`run.log`)
- the printed evidence root before cleanup
- the parent session `.jsonl` files from `<root>/workspace/sessions/`
- child transcripts from `<root>/workspace/sessions/subagents/`
- the persisted `pi-subagents-state` entries inside the parent session
- for the TUI, the `tmux capture-pane` text
- for `custom`, `git worktree list --porcelain` from the temp workspace

Proof standards:

- Drive the user path. Ask `pi` to delegate; do not call internal store or session functions.
- Capture the action and the resulting state. A parent reply alone is not enough; the child transcript must contain the real tool call and output, and the parent session must contain the `task` call and the result.
- Verify side effects. The worktree scenario must show the branch in `git worktree list`; the delegation scenario must show the marker file contents in the child transcript.
- Use the fake model only at the model boundary. The child still runs the real Pi session, tools, discovery, and persistence.
- Treat the e2e's `PASS` as a gate, not the proof. Read the session and transcript files and record the paths.

## Cleanup

There is no daemon to kill. Each harness owns one `pi` child and one fake server and closes both when it exits. After copying evidence, remove the temp root the harness printed:

```bash
rm -rf "$RIG_ROOT"
```

For the TUI, the cleanup is `rm -rf "$RIG"` and `tmux kill-session -t "$SESSION"`. Never kill by process name; kill only the session or process you started. Do not delete the evidence directory.

If a run is interrupted, remove only its printed temp root. Do not remove the shared `/tmp/pi-subagents-readonly` directory while another read-only drive is active.

## Helpers

- `scripts/doctor.sh` checks the checkout and toolchain. Invocation is shown under Doctor.
- `scripts/run-scenario.sh` runs a named real harness from the package. Invocation is shown under Drive.
- The package's own `test/e2e/*.mjs` scripts are the underlying harnesses. They are executable with `node`.

Feature map: [`features/README.md`](features/README.md).
