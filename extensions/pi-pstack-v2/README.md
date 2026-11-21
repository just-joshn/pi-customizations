# pi-pstack-v2

pstack for Pi. The package ships pstack's skills, playbooks, principles, agent roles, scripts, and guide, plus the cursor-team-kit skills that pstack depends on. Use it to run `/skill:poteto-mode` and its workflow in Pi. Each Cursor mechanism is replaced with a Pi one.

- The `subagent` tool runs each delegated Pi subagent as its own `pi` process in its own tmux session.
- Pi's built-in tools (`read`, `write`, `edit`, `bash`, `ls`, `find`, `grep`) and `!` shell commands run inside a Gondolin micro-VM. The VM code is Pi's `gondolin` example extension, ported to this package.
- Tool calls raise no permission prompts. The one confirmation is `confirmProjectAgents`, which asks before `subagent` runs project-local agents from an untrusted `.pi/agents` directory.
- Plans are files, and checklists live in `TODO.md`.
- Watchers, dev servers, and heartbeat ticks run through `tmux_run`, never as background shell jobs.

Read [how pstack maps onto Pi](https://github.com/just-joshn/pi-customizations/blob/main/extensions/pi-pstack-v2/docs/pi-mechanisms.md) for the full mapping, and [the guide](https://github.com/just-joshn/pi-customizations/blob/main/extensions/pi-pstack-v2/docs/guide/README.md) to learn the workflow. Both also ship in the package under `docs/`. The subagent tool has [its own reference](https://github.com/just-joshn/pi-customizations/blob/main/extensions/pi-pstack-v2/src/subagent/README.md).

## Install

```sh
pi install npm:@justjoshn/pi-pstack-v2
```

Built and tested against Pi 1.5.2. Do not install another pstack package alongside it. Skill names collide, and Pi keeps only the first it finds.

npm 11.20 and later warn that `ssh2` and `cpu-features` have install scripts that `allowScripts` does not cover yet. Both packages come from Gondolin, through its SSH support. Their scripts only try to compile optional native speedups, which pstack does not need. The VM boots without either build. Only the root `package.json` in Pi's npm directory can hold `allowScripts`, so this package cannot set it for you. Deny both once after you install. npm keeps the entry across `pi update`.

```sh
cd ~/.pi/agent/npm && npm install-scripts deny ssh2 cpu-features
```

## Requirements

- Node 22.19.0 or later.
- tmux. Pi's `docs/tmux.md` covers the extended-keys setup.
- QEMU, for the Gondolin VM. On macOS, run `brew install qemu`. Gondolin downloads its guest image on first use.
- bun and `gh`, for the scripts some skills run, such as `watch-pr` and `statechart`.
- `jq` and `rg`, which is ripgrep, for `worktree-audit.sh` and the `pr-review-canvas` skill.

## First use

Run `/skill:setup-pstack` to choose a model and thinking level per role. It writes `pstack-v2-models.md` in your Pi agent directory, and the extension shows those role lines to the model in every session. Then start a task:

```text
/skill:poteto-mode <task>
```

If you are unsure which skill fits, type `/skill:poteto-help` with a question.

## What it adds

The package adds these tools:

| Tool | Does |
| --- | --- |
| `subagent` | Delegates to specialized agents as separate `pi` processes, each started in tmux. Runs one agent, parallel tasks, or a chain. With `wake` it returns a job id at once and wakes your session with the report. |
| `report_findings` | Records structured review findings: file, line, summary, failure scenario, verdict, and outcome. Accepts at most 32 findings per call. |
| `tmux_run` | Runs a shell command on the host in tmux. `cwd` sets the working directory, relative to the session's. `wake` wakes your session when the command exits. `repeat` restarts the command after each clean exit as a heartbeat, and it requires `wake`. |
| `tmux_jobs` | Lists, tails, waits on, or stops this session's `tmux_run` jobs. |

It also adds the Gondolin tool routing and two slash commands:

- `/skill:<name>` runs any skill.
- `/pstack-mode <skill>` keeps that skill in the system prompt every turn, which is pstack's Custom Mode. `/pstack-mode off` ends it.
- `/gondolin` shows the session's VM.

It registers one Pi CLI flag, `--gondolin-shared-build-cache`. See the Gondolin section.

## Gondolin

`src/gondolin` is Pi's [`gondolin` example extension](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/gondolin), split into modules in this package's style. This package adds the following to the example:

- Read-only mounts of the package, the skill directories, and the subagent `.output` log directory.
- A writable mount of the subagent memory directory.
- Write denial on `.git/hooks` and `.git/config`.
- An HTTP and HTTPS host allowlist.
- An opt-in shared build cache.
- A guest system prompt that names what only the host has.

### Lifecycle and paths

- Each Pi process boots one VM when its session starts and closes it when the session ends. A subagent is its own Pi process, so it gets its own VM.
- The directory Pi started in is mounted at `/workspace`. Writes there reach the host. Every other guest path is the VM's own filesystem, and changes there stay in the VM.
- The system prompt names `/workspace` as the working directory, so the model works in guest paths.
- The guest image ships `node` but not `git`, `gh`, `tmux`, or `bun`. Run commands that need them on the host through `tmux_run`.
- `tmux_run`, `tmux_jobs`, and the `pi` processes that `subagent` starts run on the host, outside the VM.

### Read-only mounts

A host path outside the working directory does not exist in the guest, except these directories. Each is mounted read-only at its host path. Missing paths and paths inside the working directory or inside an earlier mount are skipped.

- This package.
- `<agentDir>/skills`.
- `~/.agents/skills`.
- Every existing directory in the `skills` array of `<agentDir>/settings.json`. A leading `~/` expands to your home directory, and relative paths resolve against the agent directory.
- The `.output` log directory under `<agentDir>/pstack-v2/`, which holds the logs of `subagent` wake jobs. The extension creates it when the agent directory exists.

The system prompt tells the model about this boundary and which commands only the host has.

### Writable mounts

- `/workspace` is writable, except `.git/hooks` and `.git/config`. Gondolin's `ShadowProvider` denies writes to both paths, as `src/gondolin/policy.ts` sets. A guest command cannot plant a git hook or change the repository configuration.
- When `PI_SUBAGENT_MEMORY_DIR` is set to an existing directory outside the working directory, that directory is mounted writable at its host path. A subagent with `memory` set gets it, so the guest can keep notes there.
- When the shared build cache is on, `/cache` is mounted writable.

### Network allowlist

The VM can make HTTP and HTTPS requests only to hosts in `DEFAULT_ALLOWED_HOSTS` in `src/gondolin/policy.ts`. The list covers:

- GitHub: `github.com`, `*.github.com`, `*.githubusercontent.com`, `ghcr.io`, `*.ghcr.io`.
- npm and Node: `registry.npmjs.org`, `*.npmjs.org`, `nodejs.org`, `*.nodejs.org`, `registry.yarnpkg.com`, `bun.sh`, `*.bun.sh`.
- Python: `pypi.org`, `*.pypi.org`, `files.pythonhosted.org`, `*.pythonhosted.org`.
- Rust: `crates.io`, `*.crates.io`, `static.rust-lang.org`.
- Go: `proxy.golang.org`, `sum.golang.org`, `storage.googleapis.com`.
- Ruby: `rubygems.org`, `*.rubygems.org`.
- Alpine and Maven: `dl-cdn.alpinelinux.org`, `*.alpinelinux.org`, `repo1.maven.org`, `repo.maven.apache.org`.
- Docker: `registry-1.docker.io`, `auth.docker.io`, `production.cloudflare.docker.com`.

Gondolin does not match an apex domain with `*.x`, so the list names each apex domain next to its wildcard. A request to any other host fails.

### Shared build cache

`enableSharedBuildCache` is off by default. When it is on, the npm, yarn, pnpm, bun, pip, uv, cargo, go, and XDG cache variables point at one user-private host directory, `<tmpdir>/pi-gondolin-build-cache-<uid>`. The guest sees that directory writable at `/cache`. `tmux_run` jobs get the same variables, pointing at the host path, so sandboxed and unsandboxed commands share downloads.

Turn it on with one of these, in precedence order:

1. The `--gondolin-shared-build-cache` Pi CLI flag.
2. The `PI_GONDOLIN_SHARED_BUILD_CACHE` environment variable. `1` or `true` turns it on, and `0` or `false` turns it off. Any other value is ignored.
3. `{ "enableSharedBuildCache": true }` in `.pi/gondolin.json` in the working directory.
4. The same setting in `<agentDir>/gondolin.json`.

A malformed config file is an error. `/gondolin` reports the cache when it is on.

## Replaces `@justjoshn/pi-pstack`

```sh
pi install npm:@justjoshn/pi-pstack-v2
pi remove npm:@justjoshn/pi-pstack
```

## Develop

```sh
bun run --filter @justjoshn/pi-pstack-v2 test
bun run --filter @justjoshn/pi-pstack-v2 typecheck
bun run --filter @justjoshn/pi-pstack-v2 style-audit
```

`upstream.lock.json` pins the pstack and cursor-team-kit source that the package copies. MIT license, from upstream pstack.
