# pstack for Pi (pi-pstack)

pi-pstack is pstack 0.15.36 as a native Pi package. It has three parts:

- pstack's skills and playbooks, compiled from a pinned upstream commit into Pi skills (`generated/skills/`) and `/name` prompt templates (`generated/prompts/`). The upstream text is kept unchanged in `vendor/`.
- One small extension (`src/extension.ts`) that adds the `/pstack` command and two model tools, `pstack_worker` and `pstack_evidence`.
- Workers. Each worker is an ordinary `pi --mode rpc` process inside its own tmux session, so you can attach to it, watch it, and steer it.

Pi's own features stay in charge of everything else: models, sessions, MCP, Codemode, and skill loading. The package adds no subagent tool, no todo tool, no plan mode, and no permission prompts. Plans and checklists are Markdown files.

The upstream pin is `github.com/cursor/plugins` at `a5539b15a3d56e04992565aafee2b37051329ce3` (`generated/upstream-lock.json`). Pi loads 62 skills and 62 prompts from this package: pstack's 58 skills and the team-kit skills they call (`tests/integration/pi-load.test.ts`).

## Install

pi-pstack needs Node 22.21 or newer and tmux.

To install from a checkout, run:

```sh
git clone https://github.com/just-joshn/pi-customizations.git
cd pi-customizations
bun install
pi install ./extensions/pi-pstack
```

Pi loads a local package in place and installs no dependencies for it. The extension loads without `node_modules` (`tests/integration/pi-load.test.ts`, "pi install of a copy without node_modules"). `bun install` adds `@anthropic-ai/sandbox-runtime`, which the macOS read-only shell needs, and `yaml`, which the Benny automation config reader needs.

To install the published package, run `pi install npm:@justjoshn/pi-pstack`.

To remove it, run `pi remove ./extensions/pi-pstack`. Model configuration lives in `~/.pi/agent/pstack/`. Each project keeps its runs in `<project>/.pi/pstack/`.

## Configure models with /setup-pstack

Run `/setup-pstack` once. It lists the models your Pi can use, asks for a reasoning budget, maps a model to each pstack role, and writes `~/.pi/agent/pstack/models.json`. When a worker starts, `pstack_worker` resolves its model from that file. `models.json` is the only model file pi-pstack reads. A `pstack-models.md` written by an earlier pstack host is ignored. `/setup-pstack` takes its role lines as the starting choices and writes `models.json`, and `/pstack doctor` tells you when that file exists and `models.json` does not. A role set to `inherit-parent` or `auto` runs on the parent session's model (`tests/model-routing/models.test.ts`, `tests/integration/extension.test.ts`).

## Start work

Type a skill name with your task:

```text
/poteto-mode Fix the intermittent export failure.
```

Every skill has a `/name` prompt and Pi's own `/skill:<name>` form. If another command already owns a name, use `/pstack:<name>`. `/pstack doctor` lists those conflicts (`tests/skill-parity/slash-routing.test.ts`).

A `/name` only works at the start of a message. Inside an active pstack workflow, a `/name` later in the message attaches a loaded skill through Pi's `/skill:<name>` form. Outside a pstack workflow, Pi keeps its native behavior.

## Use /pstack

| Command | What it does |
| --- | --- |
| `/pstack on`, `/pstack off` | Turns the persistent style on or off. While it is on, each new task gets the `poteto-mode` skill once. The choice is a session entry, so resume and fork keep it. |
| `/pstack status` | Shows the style and this project's runs. |
| `/pstack doctor` | Checks tmux, Pi, a container engine, `models.json`, MCP servers, the loaded skills, the upstream pin, hard-link support, and slash-name conflicts. |
| `/pstack workers` | Lists every run and worker with its state and its tmux attach command. |
| `/pstack pause <runId>`, `/pstack resume <runId>` | Stops a run's live workers and keeps their worktrees, or reconciles the run and hands it to the Session pickup playbook. Only the session that owns the run can do this. |
| `/pstack audit <runId>` | Checks each done step in the run's `TODO.md` against its recorded evidence. |
| `/pstack automation start\|stop\|status <name>` | Runs a Benny automation or a webhook routine as an event source. |

`tests/integration/commands.test.ts` covers each subcommand.

## Watch and steer workers

A playbook starts a worker with `pstack_worker` and an assignment file. The tool returns the worker's tmux attach command:

```sh
tmux -L pstack attach -t pstack_<runId>_<workerId>_<hash>
```

Workers run on their own tmux server (`-L pstack`), so they never mix with your tmux sessions. Detach with the usual tmux key. Detaching does not stop the worker. When a worker settles, the parent session gets one `pstack-worker` message and starts a turn unless the parent already collected that result. Wakes wait until the parent is idle or reaches `agent_before_settle`. A restarted parent finds its live workers again and still gets each result once (`tests/recovery/recovery.test.ts`).

A writable worker gets its own git worktree and branch, `pstack-run/<runId>/<workerId>`. A readonly worker runs in the project directory with the tools `read`, `grep`, `find`, `ls`, and `bash_readonly`. It reaches MCP only through the tools you list in `<agent dir>/pstack/readonly-mcp.json` (`{ "tools": ["mcp__<server>__<tool>"] }`, exact names, read at spawn); with no file it reaches none. A server's `readOnlyHint` is the server's own claim and is not used. Benny's trackers other than GitHub run a trusted worker that gets those tools plus the exact MCP write tools you list in `<agent dir>/pstack/tracker-mcp.json` (same shape; read from the agent dir only, so no project file adds to it). Without a valid, non-empty file the tracker is blocked with a setup error. The filter is by tool name: it does not limit arguments or target resources, so team, project, and issue authority is your MCP server's credentials. Give that server a narrowly scoped credential. A worker gets `pstack_evidence`, and only a sub-coordinator also gets `pstack_worker` (`tests/worker-lifecycle/`).

## Read the run files

Each run lives in `<project>/.pi/pstack/runs/<runId>/`:

| File | Contents |
| --- | --- |
| `run.json` | The run's identity, playbook, upstream revision, and owning session. |
| `TODO.md` | The playbook's steps, copied in order by `scripts/start-run.mjs`, then the task's own steps (`tests/todo/start-run.test.ts`). |
| `decisions.tsv` | The decision log. |
| `events.jsonl` | An append-only record of spawns, settles, pauses, and aborts. |
| `workers/<workerId>/` | The worker's assignment, brief, state, report, evidence, Pi session, and worktree. |
| `verification/receipts/` | One evidence receipt per file, written by `pstack_evidence record`. |

Plans live in `<project>/.pi/pstack/plans/<slug>.md`.

Receipt ids are unique across the run. A container worker records receipts in its own inbox, and the parent imports them into the run. Save container artifacts under `evidence/`, because only `evidence/`, `session/`, and `report.md` are visible to host verification. Verification rechecks artifact hashes and returns `pass`, `fail`, or `inconclusive`. An expected-fail receipt must name the failing tests, explain the expected failure, and include output that confirms both.

## Limits

- Every worker's assignment limits its Pi tools, MCP, and launch environment. These limits are not a filesystem boundary.
- A local worker runs as your user and can read any file your user can read, including 0600 credential files. A `readonly` assignment is not a read-only operating-system environment. Local workers also retain your network authority.
- Use `workspace.mode: "container"` for untrusted input, such as reviewing someone else's pull request. Container workers clone the pushed remote and cannot read unmounted host files. The package mount is read-only. Container-private writable paths, output mounts, and a configured local Git remote remain writable. Containers retain network access and any credentials explicitly assigned to them, so use narrowly scoped credentials.
- Cursor-hosted services are replaced, not copied. Cursor Automations become `/pstack automation` event sources, Cursor webhooks become a local routine receiver (`scripts/routine-setup.mjs`), and container workers replace cloud agents. Bugbot has no replacement. The Benny pack in `generated/automations/benny/` (compiled from the pinned upstream pack by `adapters/benny-pack.ts`) is set up with `scripts/benny-setup.mjs` and run with `/pstack automation start <name>`.
- The readonly worker shell, `bash_readonly`, is OS-sandboxed against writes (`src/readonly-shell.ts`, `tests/security/`). This sandbox applies to shell commands, not the worker's Pi process. A local readonly worker can still read files available to your user. Container mode provides file isolation (`CONTAINER-FILE-ISOLATION`) and is recommended for untrusted input.
- A container worker's OAuth access token is not refreshed during its life. Providers registered by a `git:` package or only in Pi's `models.json` are not discovered automatically. A forge token carries the full scope of your `gh` login unless `PSTACK_CONTAINER_FORGE_TOKEN` supplies a narrower token.

[`docs/architecture.md`](docs/architecture.md) explains the design. [`docs/parity-status.md`](docs/parity-status.md) lists what is proven and what is not.

## Maintain it

Never edit `generated/` by hand. Change a rule in `adapters/` or the pinned source, then rebuild:

```sh
sh ../../parity/pi-native-tmux-2026-11-11/regen.sh      # compile skills, check dependencies and parity, rebuild dist/
sh ../../parity/pi-native-tmux-2026-11-11/merge-gate.sh # typecheck and the full test suite
bun run test:statechart                                 # the statechart compiler suite
node scripts/build-parity-manifest.mjs --save parity-results/local/vitest-darwin.json --results parity-results/ci/linux-all.json  # on a clean commit: rerun Vitest, record its identity, rebuild the manifest
```

`dist/` holds bundles built by Bun 1.4.4 from `src/` and `generated/`. `npm pack` runs `build-helpers.mjs --check` and fails on a stale bundle.

## Licenses

The port's own code is MIT (`LICENSE`). pstack's files keep their MIT notice in `licenses/pstack.LICENSE` (© 2026 Lauren Tan). The vendored team-kit skills keep theirs in `licenses/cursor-team-kit.LICENSE`. The standalone `dist/` bundles inline `yaml` (ISC, `licenses/yaml.LICENSE`) and `typebox` (MIT, `licenses/typebox.LICENSE`).
