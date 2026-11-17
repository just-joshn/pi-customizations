# pi-pstack-v2

pstack for Pi. The package ships pstack's skills, playbooks, principles, agent roles, scripts, and guide, plus the cursor-team-kit skills that pstack depends on. It is for people who want `/skill:poteto-mode` and its workflow in Pi. Each Cursor mechanism is replaced with a Pi one.

- Workers are separate Pi processes in tmux, started with `pi_spawn`. Pi has no subagents.
- Every worker and long-running command runs in a sandbox, Seatbelt on macOS and bubblewrap on Linux and WSL2. There are no permission prompts.
- Plans are files, and checklists live in `TODO.md`.
- Watchers, dev servers, and heartbeat ticks run through `tmux_run`, never as background shell jobs.

Read [how pstack maps onto Pi](https://github.com/just-joshn/pi-customizations/blob/main/extensions/pi-pstack-v2/docs/pi-mechanisms.md) for the full mapping, and [the guide](https://github.com/just-joshn/pi-customizations/blob/main/extensions/pi-pstack-v2/docs/guide/README.md) to learn the workflow. Both also ship in the package under `docs/`.

## Install

```sh
pi install npm:@justjoshn/pi-pstack-v2
```

Built and tested against Pi 1.5.2. Do not install another pstack package alongside it. Skill names collide, and Pi keeps only the first it finds.

## Requirements

- tmux. Pi's `docs/tmux.md` covers the extended-keys setup.
- A sandbox. macOS has Seatbelt built in. On Linux and WSL2, install bubblewrap (`bwrap`). Jobs refuse to start without one.
- bun and `gh`, for the scripts some skills run, such as `watch-pr` and `statechart`.
- `jq` and `rg` (ripgrep), for `worktree-audit.sh` and the `pr-review-canvas` skill.

## First use

Run `/skill:setup-pstack` to choose a model and thinking level per role. It writes `pstack-v2-models.md` in your Pi agent directory, and the extension shows those role lines to the model in every session. Then start a task:

```text
/skill:poteto-mode <task>
```

Type `/skill:poteto-help` with a question if you are unsure which skill fits.

## What it adds

The package adds three tools for the model to call and one slash command. Every skill runs as `/skill:<name>`. `/pstack-mode <skill>` keeps a skill in the system prompt every turn, pstack's Custom Mode, until `/pstack-mode off`.

| Tool | Does |
| --- | --- |
| `pi_spawn` | Starts a sandboxed `pi -p` worker in its own tmux session with a standalone brief. Takes an optional role from `agents/`, model, thinking level, git worktree, or readonly mode. Wakes your session with the worker's report when it exits. |
| `tmux_run` | Runs a sandboxed shell command in tmux. Optionally wakes your session when it exits, or repeats it as a heartbeat. |
| `tmux_jobs` | Lists, tails, waits on, or stops this session's jobs. |

## Notes

- Jobs never write your Pi agent directory. Each top-level job's Pi gets its own, with a copy of your credentials. The extension syncs refreshed OAuth tokens back to your login.
- A job may write only its own directory, its worktree or working directory, the repository's git directory, and temp directories.

## Replaces `@justjoshn/pi-pstack`

```sh
pi install npm:@justjoshn/pi-pstack-v2
pi remove npm:@justjoshn/pi-pstack
```

## Develop

```sh
bun run --filter @justjoshn/pi-pstack-v2 test
bun run --filter @justjoshn/pi-pstack-v2 typecheck
```

`upstream.lock.json` pins the pstack and cursor-team-kit source that the package copies. MIT license, from upstream pstack.
