# How pstack maps onto Pi

pstack 0.15.43 and cursor-team-kit 1.2.0 were written for Cursor. `upstream.lock.json` pins the exact upstream commit. This package keeps every skill, playbook, principle, agent, script, and guide chapter, and replaces each Cursor or Claude Code mechanism with the Pi mechanism that does the same job. The skills name Pi mechanisms directly. There is no adapter to read at run time.

Pi skips sub-agents, permission popups, plan mode, built-in to-dos, and background bash on purpose. Each row below names what pstack does instead.

## Pi's rules this port follows

| Pi rule | What pstack does |
| --- | --- |
| Spawn Pi instances via tmux. | The packaged `subagent` tool starts each delegated `pi` in its own tmux session (upstream subagent example, with the process launch switched from `child_process.spawn` to tmux). |
| No permission popups. Run in a sandbox. | The packaged `gondolin` extension, Pi's own `gondolin` example, runs `read`, `write`, `edit`, `bash`, `ls`, `find`, `grep`, and `!` shell commands inside a Gondolin micro-VM. The directory Pi started in is mounted at `/workspace`, and writes there reach the host. Every other guest path is the VM's own. |
| No plan mode. Write plans to files. | A plan is a Markdown file, such as `plans/<slug>.md`. The human reviews the file. |
| No built-in to-dos. Use a TODO.md file. | Each checklist pstack used to keep in a todo tool lives in `TODO.md` at the root of the checkout you work in, as `- [ ]` and `- [x]` lines. It is working state, so never stage it. When the checkout already tracks a `TODO.md`, the checklist is `.pi/TODO.md`. |
| No background bash. Use tmux. Full observability, direct interaction. | Watchers, dev servers, long builds, and heartbeat ticks run through `tmux_run`. Nothing uses `&`, `nohup`, `setsid`, or `disown`. Every job is a tmux session you can attach to with the command `tmux_jobs` `list` prints. Its output shows there as it is written, and Ctrl-C there stops it. A job reads no input, so a command that needs an answer typed runs in the root session. |

Pi's design principle for customizing is to pick the least powerful mechanism that meets the need. Skills carry all workflow text. The extensions exist only for what a skill cannot do. `src/index.ts` starts tmux jobs, wakes the session when they exit, and puts the model-role lines into the system prompt. `src/subagent` starts workers. `src/gondolin` runs Pi's tools in a VM.

## Vocabulary

| Cursor or Claude Code | Pi |
| --- | --- |
| Subagent, `Task` call, delegate, worker | A Pi instance started with `pi_spawn`. Call it a worker, a spawned Pi, or by its role (explorer, reviewer, runner). Never call it a subagent. |
| `subagent_type: "poteto-agent"`, `"comment-sicko"`, `"ci-watcher"`, `"thermo-nuclear-code-quality-review"` | `pi_spawn` with `agent: "<name>"`. The role text comes from `agents/<name>.md`. |
| `subagent_type: generalPurpose`, `"shell"`, `"explore"` | `pi_spawn` with no `agent`. |
| `readonly: true` (Ask mode) | `pi_spawn` with `readonly: true`. The edit and write tools are removed. MCP and shell stay available, so a reviewer that needs MCP can still be readonly. Here the network stays open, so readonly stops local writes only. A readonly worker can still change remote state with `gh`, `curl`, or an MCP tool, so the brief says what it must not change. |
| `readonly: false` (agent mode) | Leave `readonly` unset. |
| `environment: "cloud"`, Cursor cloud agent, `cloud_base_branch` | `pi_spawn` with `worktree: "<branch>"` and `base: "<ref>"`. The worker gets its own git worktree. Cursor cloud agents start from the repository's default branch. A worktree here starts from the session's current `HEAD` unless `base` names another ref, so pass the default branch as `base` to start from it. |
| `environment: "local"` | Omit `worktree`. |
| `run_in_background: true` | Nothing to set. Every `pi_spawn` runs in parallel, and you are woken when it exits. Keep working or end your turn. |
| Spawn N in one message | N `pi_spawn` calls in one message. |
| Nested subagents, launched by a subagent | pstack allows one level, which every pstack workflow fits. The root Pi and the workers it starts have `pi_spawn`. A worker started by another worker does not, and the root refuses a Pi request from one. Every worker keeps `tmux_run` and `tmux_jobs`. |
| `resume` an agent | `pi_spawn` with `resume: "<job id>"` continues that job's Pi session. |
| Steer or stop a running agent | `tmux_jobs` with `action: "stop"`, then a fresh `pi_spawn` with consolidated scope. A print-mode Pi takes no mid-run input. |
| Wait for agents | End your turn and let the wake arrive. `tmux_jobs` `wait` is for a short wait on named jobs. A spawned Pi running in print mode waits for its own jobs automatically before it finishes. |
| `file_attachments` | List the paths in the brief. |
| `model` slug such as `claude-opus-5-5-xhigh` or `grok-4.7-xhigh-fast` | `pi_spawn` `model: "<provider>/<id>"` and `thinking: "<level>"`. Thinking levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Pi has no fast variant, so a "fast" choice is dropped. |
| `~/.cursor/rules/pstack-models.mdc`, `~/.claude/rules/pstack-models.md` | `~/.pi/agent/pstack-v2-models.md`, written by `/skill:setup-pstack`. The extension shows its role lines to the model in a `pstack-models` system-prompt section. A role with no line, or a line of `inherit-parent` or `auto`, runs on the session model, so omit `model`. |
| A model slug the Task tool rejects | A model `pi_spawn` rejects. It accepts only `provider/id` values that `pi --list-models` prints, which are the models Pi holds credentials for. Any other model fails at the call with the list of valid ones, before a job or worktree exists, and an omitted model runs on the session model. |
| Open a todolist, `TodoWrite` | Write `TODO.md`. |
| Custom Mode (Option+Enter on a slash skill) | `/pstack-mode <skill>`. The extension puts the skill in a `pstack-mode` system-prompt section every turn and records the choice on the session branch, so it survives `/compact`, resume, and `/tree`. `/pstack-mode off` ends it, and the footer shows the active mode. |
| `AskQuestion` (multiple-choice popup) | Ask in plain text with numbered options, then end your turn. Pi has no question popups. |
| `/loop` with an event | `tmux_run` the watcher command with `wake: "<what to do next>"`. |
| `/loop <interval>` heartbeat | `tmux_run` with `command: "sleep <seconds>"`, `wake: "<tick prompt>"`, and `repeat: true`. Stop it with `tmux_jobs` `stop`. |
| A shell command run in the background | `tmux_run`. |
| Plan mode, a plan to approve | A plan file. |
| `/<skill>` | `/skill:<skill>`. |
| A skill that says to run another skill by name | Pi hides skills marked `disable-model-invocation` from the skill list. The extension adds one system-prompt line giving the absolute path of the package's `skills/` directory. The model reads `<dir>/<name>/SKILL.md` and follows it. |
| `.cursor/skills/`, `~/.cursor/skills/` | `.pi/skills/`, `~/.pi/agent/skills/`, or the Agent Skills paths `.agents/skills/` and `~/.agents/skills/`. |
| `.cursor/rules/*.mdc`, always-applied rules | `AGENTS.md` (project) or `~/.pi/agent/AGENTS.md` (user). |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json`, `/add-plugin` | A Pi package: `pi install <source>`, listed by `pi list`. |
| Cursor chat transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | Pi sessions in `~/.pi/agent/sessions/--<cwd with / as ->--/*.jsonl`. Spawned workers keep theirs in `~/.pi/agent/pstack-v2/jobs/<id>/session/`. The extension names the current session's file in a `pstack-session` system-prompt section, and a brief that asks a worker to read it carries that path, because a worker cannot find it by itself. |
| `/create-skill` | Write `SKILL.md` to Pi's skills spec (Agent Skills format) and check it loads with `/skill:<name>`. |
| Cursor Automations, routines, webhook wakes, `SendToUser` | A tmux job that runs `pi -p` against a session, or Pi's RPC mode. Secrets come from environment variables the user sets, never from chat. Upstream's dormant benny pack (Slack issue triage, then reproduce-and-fix) runs only on that service, so this package does not ship it. |
| Cursor canvas | A self-contained HTML file opened in the browser. |
| Cursor Bugbot, agentic security review | Unchanged. They are GitHub reviewers whose comments any harness reads from the forge. |
| Cursor's built-in PR tool | `gh`. |
| MCP tools | Pi's built-in MCP (`pi mcp list`, `~/.pi/agent/mcp.json`, `.pi/mcp.json`) and Codemode (`"defaultTools": ["+codemode"]` in settings). Workers get a copy of your settings, so they have the same MCP servers and Codemode. |
| Cursor's agent store, project store, project tracker | Files in the checkout: `decisions.tsv` and `plans/`. A worker keeps its `decisions.tsv` in its worktree, which the root reads at `<agent dir>/pstack-v2/jobs/<id>/worktree/`. |
| Orchestrate's `notes.md` | A file at the checkout root, never staged, like `TODO.md`. |
| Origin (`origin pr`) | Kept as is when `command -v origin` succeeds and Origin resolves the repository, otherwise `gh`. Graphite is never required. |
| Hold or stand-down order to running agents | `tmux_jobs` `stop` after each worker commits a `wip:` checkpoint, then a fresh `pi_spawn` to release. |
| A lane that needs a simulator, `open`, a local display or socket, or auth that exists only on this machine | Run it on the host through `tmux_run`, since Pi's own `bash` runs in the Gondolin VM. |

## Gondolin details

- `src/gondolin` is Pi's `gondolin` example extension, split into modules. It behaves as the example does, and `test/gondolin.test.ts` pins that behavior without booting QEMU.
- Each Pi process boots one VM when its session starts and closes it at shutdown. Tool calls made while it boots wait for the same VM. A worker that `subagent` starts is its own Pi process, so it gets its own VM, mounted on its own working directory.
- Paths map to the guest the same way for every tool. A relative path, or a host path inside the working directory, lands under `/workspace`. Any other absolute path names that path in the guest's own filesystem.
- The system prompt's working-directory line names `/workspace` and the host directory it comes from.
- `/gondolin` shows the VM id, the host and guest workspaces, and the shell. Commands run in `bash` when the guest has it, and in `/bin/sh` otherwise.
- QEMU must be installed. Gondolin downloads its guest image on first use.

## What Gondolin does not cover

- `tmux_run` jobs, and the `pi` processes `subagent` starts, run on the host. Only Pi's built-in tools run in the VM. A `/workspace` path does not exist on the host, so give `tmux_run` paths relative to the working directory.
- A host path outside the working directory does not exist in the guest. When Pi runs outside this package's directory, that includes the skills, so the model cannot `read` a `SKILL.md` it is pointed at. `/skill:<name>` and `/pstack-mode` still work, since Pi puts their text in the prompt itself.
- The guest image ships `node` but not `git`, `gh`, `tmux`, or `bun`, so the model's `bash` cannot commit, push, or open a PR. Run those through `tmux_run`.
- A linked worktree's `.git` file points at a git directory outside the mount, so git in the guest cannot use it even after you install git there.
- Writes under `/workspace` reach the host as they are made. The VM keeps no copy to roll back.

## Jobs on disk

Each `tmux_run` job lives in `~/.pi/agent/pstack-v2/jobs/<id>/`: `job.json` (the spec), `wrapper.sh`, `wrapper.pid`, `output.log`, and `exit`. The tmux wrapper writes `output.log` and `exit`. Each spawning session runs its own tmux server on a socket in `/tmp/pstack-v2-<uid>/`, named from a hash of the session id. `tmux_jobs` `list` prints a `tail -f` command to follow each job's output and a `tmux attach` command for each running job. A wake is claimed once through a `woken` marker file, so restarting Pi never delivers a report twice.
