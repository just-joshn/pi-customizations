# pi-pstack-v2

pstack for Pi. The package ships pstack's skills, playbooks, principles, agent roles, scripts, and guide, plus the cursor-team-kit skills that pstack depends on. It is for people who want `/skill:poteto-mode` and its workflow in Pi. Each Cursor mechanism is replaced with a Pi one.

- Delegated Pi workers run through the packaged `subagent` tool, which starts each `pi` in its own tmux session.
- Pi's built-in tools (`read`, `write`, `edit`, `bash`, `ls`, `find`, `grep`) and `!` shell commands run inside a Gondolin micro-VM, ported from Pi's `gondolin` example extension. There are no permission prompts.
- Plans are files, and checklists live in `TODO.md`.
- Watchers, dev servers, and heartbeat ticks run through `tmux_run`, never as background shell jobs.

Read [how pstack maps onto Pi](https://github.com/just-joshn/pi-customizations/blob/main/extensions/pi-pstack-v2/docs/pi-mechanisms.md) for the full mapping, and [the guide](https://github.com/just-joshn/pi-customizations/blob/main/extensions/pi-pstack-v2/docs/guide/README.md) to learn the workflow. Both also ship in the package under `docs/`.

## Install

```sh
pi install npm:@justjoshn/pi-pstack-v2
```

Built and tested against Pi 1.5.2. Do not install another pstack package alongside it. Skill names collide, and Pi keeps only the first it finds.

npm 11.20 and later warn that `ssh2` and `cpu-features` have install scripts not yet covered by `allowScripts`. Both come from Gondolin, through its SSH support. Their scripts only try to compile optional native speedups, which pstack does not need. The VM boots without either build. Only the root `package.json` in Pi's npm directory can hold `allowScripts`, so this package cannot answer for you. After installing, deny both once. npm keeps the entry across `pi update`.

```sh
cd ~/.pi/agent/npm && npm install-scripts deny ssh2 cpu-features
```

## Requirements

- tmux. Pi's `docs/tmux.md` covers the extended-keys setup.
- QEMU, for the Gondolin VM (`brew install qemu` on macOS). Gondolin downloads its guest image on first use.
- bun and `gh`, for the scripts some skills run, such as `watch-pr` and `statechart`.
- `jq` and `rg` (ripgrep), for `worktree-audit.sh` and the `pr-review-canvas` skill.

## First use

Run `/skill:setup-pstack` to choose a model and thinking level per role. It writes `pstack-v2-models.md` in your Pi agent directory, and the extension shows those role lines to the model in every session. Then start a task:

```text
/skill:poteto-mode <task>
```

Type `/skill:poteto-help` with a question if you are unsure which skill fits.

## What it adds

The package adds the upstream `subagent` tool (tmux-backed), `tmux_run`, `tmux_jobs`, the Gondolin tool routing, and two slash commands. Every skill runs as `/skill:<name>`. `/pstack-mode <skill>` keeps a skill in the system prompt every turn, pstack's Custom Mode, until `/pstack-mode off`. `/gondolin` shows the session's VM.

| Tool | Does |
| --- | --- |
| `subagent` | Upstream subagent extension: delegates to specialized agents as separate `pi` processes, each started in tmux. |
| `tmux_run` | Runs a shell command on the host in tmux. Optionally wakes your session when it exits, or repeats it as a heartbeat. |
| `tmux_jobs` | Lists, tails, waits on, or stops this session's jobs. |

## Gondolin

`src/gondolin` is Pi's [`gondolin` example extension](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/gondolin), split into modules in this package's style. It behaves as the example does.

- Each Pi process boots one VM when its session starts and closes it when the session ends. A `subagent` worker is its own Pi process, so it gets its own VM.
- The directory Pi started in is mounted at `/workspace`. Writes there reach the host. Every other guest path is the VM's own filesystem, and changes there stay in the VM.
- The system prompt names `/workspace` as the working directory, so the model works in guest paths.
- A host path outside the working directory does not exist in the guest. That includes this package's skills when Pi runs elsewhere, so the model cannot `read` them.
- The guest image ships `node` but not `git`, `gh`, `tmux`, or `bun`. Commands that need them run on the host through `tmux_run`.
- `tmux_run`, `tmux_jobs`, and the `pi` processes `subagent` starts run on the host, outside the VM.

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
