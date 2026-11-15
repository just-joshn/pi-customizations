# pi-pstack-v2

pstack for Pi. It ships every pstack 0.15.36 skill, playbook, principle, agent role, script, and guide chapter, plus the cursor-team-kit skills and rules that pstack depends on. Each Cursor mechanism is replaced with a Pi one.

- Workers are separate Pi processes in tmux, started by `pi_spawn`. Pi has no subagents.
- Every worker and long-running command runs in a sandbox. That is Seatbelt on macOS and bubblewrap on Linux and WSL2. No permission prompts.
- Plans are files, and checklists live in `TODO.md`.
- Watchers, dev servers, and heartbeat ticks run through `tmux_run`, never as background shell jobs.

See [docs/pi-mechanisms.md](docs/pi-mechanisms.md) for the full mapping and [the guide](docs/guide/README.md) to learn the workflow.

## Requirements

- Pi 1.5 or newer.
- tmux. Pi's `docs/tmux.md` covers the extended-keys setup.
- A sandbox. macOS has Seatbelt built in. On Linux and WSL2, install bubblewrap (`bwrap`). Jobs refuse to start without one.
- bun and `gh` for the scripts some skills run, such as `watch-pr` and `statechart`.
- `jq` and `rg` (ripgrep) for `worktree-audit.sh` and the `pr-review-canvas` skill.

## Install

```bash
pi install ./extensions/pi-pstack-v2
```

Then run `/skill:setup-pstack` to choose a model and thinking level per role. Start a task with `/skill:poteto-mode <task>`.

Don't install this alongside another pstack package. Skill names collide, and Pi keeps only the first one it finds.

## What the extension adds

| Tool | Does |
| --- | --- |
| `pi_spawn` | Starts a sandboxed `pi -p` worker in its own tmux session with a standalone brief, an optional role from `agents/`, model, thinking level, git worktree, or readonly mode. Wakes the session with the worker's report when it exits. |
| `tmux_run` | Runs a sandboxed shell command in tmux. Optionally wakes the session when it exits, or repeats it as a heartbeat. |
| `tmux_jobs` | Lists, tails, waits on, or stops this session's jobs. |

It also appends the two cursor-team-kit rules (no inline imports, exhaustive switches) to the system prompt. Jobs never write your Pi agent directory. Each top-level job's Pi gets its own, with a credentials copy whose refreshed OAuth tokens pstack syncs back. When `~/.pi/agent/pstack-v2-models.md` exists, it shows those role lines to the model.

## Develop

```bash
bun run --filter @justjoshn/pi-pstack-v2 test
bun run --filter @justjoshn/pi-pstack-v2 typecheck
```

`test/port.test.ts` loads every skill through Pi's own loader and checks that every upstream file is still present. It also checks that upstream scripts and assets are byte-identical, and that no prose names a Cursor or Claude Code mechanism. `upstream.lock.json` pins the upstream source.

License: MIT, from upstream pstack.
