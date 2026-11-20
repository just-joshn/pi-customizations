# How pstack maps onto Pi

pstack 0.15.43 and cursor-team-kit 1.2.0 were written for Cursor. `upstream.lock.json` pins the exact upstream commit. This package keeps every skill, playbook, principle, agent, script, and guide chapter. It replaces each Cursor or Claude Code mechanism with the Pi mechanism that does the same job. The skills name Pi mechanisms directly, so no adapter runs at run time.

Pi has no built-in sub-agents, permission popups, plan mode, to-do tool, or background bash. The tables below name what pstack uses in each place.

## Pi rules this port follows

| Pi rule | What pstack does |
| --- | --- |
| Spawn Pi instances through tmux. | The packaged `subagent` tool starts each delegated `pi` in its own tmux session. It derives from the upstream subagent example, with the process launch switched from `child_process.spawn` to tmux. |
| No permission popups. Run in a sandbox. | The packaged `gondolin` extension runs `read`, `write`, `edit`, `bash`, `ls`, `find`, `grep`, and `!` shell commands inside a Gondolin micro-VM. The directory Pi started in is mounted at `/workspace`, and writes there reach the host. Every other guest path belongs to the VM. |
| No plan mode. Write plans to files. | A plan is a Markdown file, such as `plans/<slug>.md`. The human reviews the file. |
| No built-in to-dos. Use a TODO.md file. | Each checklist pstack used to keep in a todo tool lives in `TODO.md` at the root of the checkout you work in, as `- [ ]` and `- [x]` lines. It is working state, so never stage it. When the checkout already tracks a `TODO.md`, the checklist is `.pi/TODO.md`. |
| No background bash. Use tmux. | Watchers, dev servers, long builds, and heartbeat ticks run through `tmux_run`. Nothing uses `&`, `nohup`, `setsid`, or `disown`. Every job is a tmux session. Attach to it with the command that `tmux_jobs` `list` prints. Its output shows there as it is written, and Ctrl-C there stops it. A job reads no input, so run a command that needs a typed answer in the root session. |

The extensions cover only what a skill cannot do. `src/index.ts` starts tmux jobs, wakes the session when they exit, and puts the model-role lines into the system prompt. `src/subagent` starts subagents. `src/gondolin` runs Pi's tools in a VM.

## Vocabulary

In this table, "subagent" means a Pi instance that the `subagent` tool starts.

| Cursor or Claude Code | Pi |
| --- | --- |
| Subagent, `Task` call, delegate, worker | A subagent. Name it by its role when one fits, such as explorer, reviewer, or runner. |
| `subagent_type: "poteto-agent"`, `"comment-sicko"`, `"ci-watcher"`, `"thermo-nuclear-code-quality-review"` | A `subagent` call with `agent: "<name>"`. The role text comes from `src/subagent/agents/<name>.md`. A user or project agent with the same name overrides it. |
| `subagent_type: generalPurpose`, `"shell"`, `"explore"` | A `subagent` call with `agent: "worker"`, which has every editing tool and no role prompt. For read-only work, use `agent: "scout"`. Use `agent: "poteto-agent"` only for a poteto-mode delegate whose brief names poteto-mode's path. |
| `readonly: true`, Ask mode | A `subagent` call with `agent: "scout"`, which has no edit or write tool. MCP and shell stay available, so a reviewer that needs MCP can still be read-only. Its `bash` can still write, and the network stays open. A scout can change remote state with `gh`, `curl`, or an MCP tool, so the brief says what it must not change. When the role needs another agent, the brief says the subagent must not edit. |
| `readonly: false`, agent mode | An agent with edit and write tools, such as `poteto-agent`. |
| `environment: "cloud"`, Cursor cloud agent, `cloud_base_branch` | A checkout of its own. Pass `isolation: "worktree"` on the `subagent` call, or create the worktree yourself. See the next row. Cursor cloud agents start from the repository's default branch, so name that branch as `<ref>` when you create the worktree yourself. |
| A worktree for one subagent | Two mechanisms exist. With `isolation: "worktree"`, the `subagent` tool creates `.pi/worktrees/subagent-<name>-<hex>` on branch `worktree/subagent-<name>-<hex>` at the current commit. It keeps both and reports `Worktree kept: <path>` only when the subagent leaves changes or commits. A `fork` refuses `isolation: "worktree"`. For a worktree on a branch you choose, run `git worktree add -b <branch> .pi/worktrees/<slug> <ref>` through `tmux_run`, inside the working directory so the VM can edit it. Then pass that path as the call's `cwd`. |
| `environment: "local"` | Omit `cwd`. The subagent runs in your working directory. |
| `run_in_background: true` | A `subagent` call with `wake`. It returns a job id at once and wakes you with the message and the report when every subagent finishes. Without `wake`, the call blocks until its subagents finish and returns their reports. |
| Spawn N in one message | One `subagent` call with `tasks`. Up to 8 tasks run, 4 at a time. Use a `chain` when each step needs the last step's output. `{previous}` in a step's task is the prior step's output. |
| Nested subagents, launched by a subagent | A subagent loads the same extensions, so it has `subagent`, `tmux_run`, and `tmux_jobs` too. Every pstack workflow fits in one level. The extension limits depth and concurrency. See the environment variables below. |
| `resume` an agent | Not available. A standard subagent runs `pi` with `--no-session`, so it keeps no session. A fix round goes to a fresh subagent, and passing the earlier subagent's worktree as `cwd` keeps its uncommitted state. A `fork` runs with `--session` on a temp copy of the parent session, and the copy is deleted when the fork ends. |
| Steer or stop a running agent | `subagent` with `stop: "<job id>"` for a wake job, or abort a blocking call. Then give a fresh subagent consolidated scope. A print-mode Pi takes no mid-run input. |
| Wait for agents | A blocking `subagent` call returns when its subagents finish. A wake job wakes you, so end your turn and let the wake arrive. Use `tmux_jobs` `wait` only for a short wait on named `tmux_run` jobs. A subagent in print mode waits for its own `tmux_run` jobs and wake jobs before it finishes. |
| Structured review findings | The `report_findings` tool. It takes an optional `level` and up to 32 `findings`. Each finding has a `file`, a `summary`, and a `failure_scenario`, and may add `line`, `short_summary`, `category`, `verdict`, and `outcome`. |
| `file_attachments` | List the paths in the brief. |
| `model` slug such as `claude-opus-5-5-xhigh` or `grok-4.7-xhigh-fast` | `subagent` `model: "<provider>/<id>"` and `thinking: "<level>"`. Thinking levels are `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. A call's model and thinking override the agent's and the session's. Pi has no fast variant, so a fast choice is dropped. |
| `~/.cursor/rules/pstack-models.mdc`, `~/.claude/rules/pstack-models.md` | `~/.pi/agent/pstack-v2-models.md`, written by `/skill:setup-pstack`. The extension shows its role lines to the model in a `pstack-models` system-prompt section. A role with no line, or a line of `inherit-parent` or `auto`, runs on the session model, so omit `model`. |
| A model slug the Task tool rejects | A subagent that fails because its model is not valid. Only `provider/id` values that `pi --list-models` prints work, which are the models Pi holds credentials for. An omitted model runs on the session model. |
| Open a todolist, `TodoWrite` | Write `TODO.md`. |
| Custom Mode, set with Option+Enter on a slash skill | `/pstack-mode <skill>`. The extension puts the skill in a `pstack-mode` system-prompt section every turn and records the choice on the session branch, so it survives `/compact`, resume, and `/tree`. `/pstack-mode off` ends it, and the footer shows the active mode. |
| `AskQuestion`, a multiple-choice popup | Ask in plain text with numbered options, then end your turn. Pi has no question popups. |
| `/loop` with an event | `tmux_run` the watcher command with `wake: "<what to do next>"`. |
| `/loop <interval>` heartbeat | `tmux_run` with `command: "sleep <seconds>"`, `wake: "<tick prompt>"`, and `repeat: true`. Stop it with `tmux_jobs` `stop`. |
| A shell command run in the background | `tmux_run`. |
| Plan mode, a plan to approve | A plan file. |
| `/<skill>` | `/skill:<skill>`. |
| A skill that says to run another skill by name | Pi hides skills marked `disable-model-invocation` from the skill list. The extension adds one system-prompt line that gives the absolute path of the package's `skills/` directory. The model reads `<dir>/<name>/SKILL.md` and follows it. |
| `.cursor/skills/`, `~/.cursor/skills/` | `.pi/skills/`, `~/.pi/agent/skills/`, or the Agent Skills paths `.agents/skills/` and `~/.agents/skills/`. |
| `.cursor/rules/*.mdc`, always-applied rules | `AGENTS.md` in the project, or `~/.pi/agent/AGENTS.md` for the user. |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json`, `/add-plugin` | A Pi package. Install it with `pi install <source>` and list it with `pi list`. |
| Cursor chat transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | Pi sessions in `~/.pi/agent/sessions/--<cwd with / as ->--/*.jsonl`. Standard subagents run with no session, so they keep none. The extension names the current session's file in a `pstack-session` system-prompt section. A brief that asks a subagent to read it carries that path, because the subagent cannot find it alone. |
| `/create-skill` | Write `SKILL.md` to the Agent Skills format that Pi's skills spec describes, and check that it loads with `/skill:<name>`. |
| Cursor Automations, routines, webhook wakes, `SendToUser` | A tmux job that runs `pi -p` against a session, or Pi's RPC mode. Secrets come from environment variables the user sets, never from chat. Upstream's dormant benny pack runs Slack issue triage, then reproduce-and-fix. It needs that service, so this package does not ship it. |
| Cursor canvas | A self-contained HTML file opened in the browser. |
| Cursor Bugbot, agentic security review | Unchanged. They are GitHub reviewers whose comments any coding agent reads from the forge. |
| Cursor's built-in PR tool | `gh`. |
| MCP tools | Pi's built-in MCP, with `pi mcp list`, `~/.pi/agent/mcp.json`, and `.pi/mcp.json`, plus Codemode, set with `"defaultTools": ["+codemode"]` in settings. A subagent reads the real agent directory, so it has the same settings, MCP servers, and Codemode. |
| Cursor's agent store, project store, project tracker | Files in the checkout: `decisions.tsv` and `plans/`. A subagent keeps its `decisions.tsv` in its `cwd`, where the root reads it. |
| Orchestrate's `notes.md` | A file at the checkout root, never staged, like `TODO.md`. |
| Origin, `origin pr` | Used as is when `command -v origin` succeeds and Origin resolves the repository. Otherwise `gh`. Graphite is never required. |
| Hold or stand-down order to running agents | Stop each owner job with `subagent` `stop: "<job id>"`. A print-mode subagent takes no mid-run input, and a stopped subagent's report says only that it was aborted. Then the root commits each owner's uncommitted edits as one `wip:` commit in the owner's worktree. A fresh `subagent` per owner releases the hold, with consolidated scope. |
| A lane that needs a simulator, `open`, a local display or socket, or auth that exists only on this machine | Run it on the host through `tmux_run`, since Pi's own `bash` runs in the Gondolin VM. |

## Environment variables

| Variable | Effect |
| --- | --- |
| `PI_SUBAGENT_DEPTH` | The nesting depth. The extension sets it one higher for each child. |
| `PI_SUBAGENT_MAX_DEPTH` | The depth limit. The default is 3. At the limit, the model no longer sees `subagent`, and a direct call is refused. |
| `PI_SUBAGENT_MAX_CONCURRENT` | The limit on running subagents across the session, wake jobs included. The default is 20. A call that would exceed it is refused. |
| `PI_SUBAGENT_IS_FORK` | The extension sets it to `1` in a fork. A fork cannot fork again. |
| `PI_SUBAGENT_FORK_DISABLED` | `1` or `true` turns forks off. |
| `PI_SUBAGENT_MEMORY_DIR` | A subagent's memory directory. The Gondolin VM mounts it writable when it lies outside the working directory. |
| `PI_GONDOLIN_SHARED_BUILD_CACHE` | `1` or `true` turns the shared build cache on. `0` or `false` turns it off. |

## Gondolin details

- `src/gondolin` is Pi's `gondolin` example extension, split into modules. It adds the read-only mounts, the writable memory mount, the git write denial, the network allowlist, and the shared build cache that the sections below describe. `test/gondolin.test.ts` tests the VM lifecycle and the guest tools without booting QEMU.
- Each Pi process boots one VM when its session starts and closes it at shutdown. Tool calls made while the VM boots wait for the same VM. A subagent is its own Pi process, so it gets its own VM, mounted on its own working directory.
- Paths map to the guest the same way for every tool. A relative path, or a host path inside the working directory, lands under `/workspace`. Any other absolute path names that path in the guest's own filesystem.
- The system prompt's working-directory line names `/workspace` and the host directory it comes from.
- `/gondolin` shows the VM id, the host and guest workspaces, and the shell. Commands run in `bash` when the guest has it, and in `/bin/sh` otherwise.
- QEMU must be installed. Gondolin downloads its guest image on first use.

### Mounts

- `/workspace` is the host working directory, writable. Gondolin's `ShadowProvider` denies writes to `.git/hooks` and `.git/config` under it.
- Each of these is mounted read-only at its host path, when it exists and lies outside the working directory:
  - This package's root.
  - `<agentDir>/skills`.
  - `~/.agents/skills`.
  - Each directory in the `skills` array of `<agentDir>/settings.json`.
  - `<agentDir>/pstack-v2/subagents`, which holds the `.output` logs of subagent wake jobs.
- The directory in `PI_SUBAGENT_MEMORY_DIR` is mounted writable at its host path, when it is a directory outside the working directory.
- `/cache` is mounted writable when the shared build cache is on.

### Network

The VM reaches only the hosts in `DEFAULT_ALLOWED_HOSTS` in `src/gondolin/policy.ts`. They are GitHub, the npm, Node, Yarn, and Bun registries, PyPI, crates.io, the Go module proxy, RubyGems, Alpine and Maven mirrors, and the Docker registries. A request to any other host fails.

## What Gondolin does not cover

- `tmux_run` jobs, and the `pi` processes that `subagent` starts, run on the host. Only Pi's built-in tools run in the VM. A `/workspace` path does not exist on the host, so give `tmux_run` paths relative to the working directory.
- A host path outside the working directory does not exist in the guest, except the mounts above. The system prompt names the boundary and points at `tmux_run` and `tmux_jobs` `output` for the rest.
- The guest image ships `node` but not `git`, `gh`, `tmux`, or `bun`, so the model's `bash` cannot commit, push, or open a PR. Run those through `tmux_run`.
- A linked worktree's `.git` file points at a git directory outside the mount, so git in the guest cannot use it even after you install git there.
- Writes under `/workspace` reach the host as they are made. The VM keeps no copy to roll back.

## Jobs on disk

Each `tmux_run` job lives in `~/.pi/agent/pstack-v2/jobs/<id>/` and holds these files:

- `job.json`, the job spec. Its `env` field holds the variables exported before the command runs. The field is set only when the shared build cache is on.
- `wrapper.sh` and `wrapper.pid`.
- `output.log` and `exit`, both written by the tmux wrapper.
- `woken`, an empty marker file. A wake is claimed once through this file, so restarting Pi never delivers a report twice.

Each spawning session runs its own tmux server on a socket in `pstack-v2-<uid>/` under the system temp directory. The socket name is a hash of the session id. `tmux_jobs` `list` prints a `tail -f` command to follow each job's output and a `tmux attach` command for each running job.

Subagent wake jobs write their logs to `~/.pi/agent/pstack-v2/subagents/<id>.output`.
