# Background and worktrees

A run can return immediately, be awaited by id, and execute in an isolated git worktree.

## Sub-features

- `task` with `run_in_background: true`
- `await_subagent` by `agent_id`, with optional `timeout_ms`
- Background completion messages and wakeups
- `worktree: true` for a dedicated branch and path
- `/tasks bg <id>` to move a running foreground task to the background
- Clean `pi -p` exit while a background child is still running

## How to get to it (user POV)

Ask the parent for parallel work and tell it to use background tasks. The parent receives an `agent_id` and can call `await_subagent`. With `worktree: true`, the result includes `worktree_path`, `branch`, and a diff summary. `/tasks` shows the run and supports `bg`.

A worktree run needs a git repository. The branch format is `<branchPrefix>/<slug>-<3 hex>`.

## Driving it with the real harness

```bash
cd "$(git rev-parse --show-toplevel)/extensions/no-ceilings/pi-subagents"
node test/e2e/verify-delegation-fake-model.mjs
node test/e2e/verify-subagents.mjs
```

The deterministic script launches a background `task` and asserts that `pi -p` exits 0 with the child still running. The real-model script launches a background `probe` with `worktree: true`, awaits it, and asserts that `git worktree list --porcelain` contains the returned branch.

Expected real-model signals:

```text
ok background subagent ran on pi-subagents/...
ok git lists the isolated worktree
```

Run `git worktree list --porcelain` from the printed temp workspace to confirm the branch independently.

## Gotchas

- The deterministic script's background child is short-lived; its check is parent exit, not worktree isolation.
- The worktree branch remains in the temp workspace. Copy the session evidence and remove the temp root only after recording the branch.
- A background run still writes the parent state at completion. If `pi -p` exits first, inspect the session file for the completed or cancelled record.
- `await_subagent` timeout is a wait timeout, not a cancellation. A timeout returns `still_running`; abort explicitly to cancel.
- The fake model cannot drive `/tasks bg`; that is a TUI command.
