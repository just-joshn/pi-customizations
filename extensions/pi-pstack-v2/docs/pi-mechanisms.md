# How pstack maps onto Pi

pstack 0.15.36 and cursor-team-kit were written for Cursor. This package keeps every skill, playbook, principle, agent, rule, script, and guide chapter, and replaces each Cursor or Claude Code mechanism with the Pi mechanism that does the same job. The skills name Pi mechanisms directly. There is no adapter to read at run time.

Pi skips sub-agents, permission popups, plan mode, built-in to-dos, and background bash on purpose. Each row below names what pstack does instead.

## Pi's rules this port follows

| Pi rule | What pstack does |
| --- | --- |
| No sub-agents. Spawn Pi instances via tmux. | `pi_spawn` starts a separate `pi -p` process in its own tmux session with a standalone brief. It runs in parallel and wakes the spawning session with its report when it exits. |
| No permission popups. Run in a container. | Every `pi_spawn` and `tmux_run` job runs inside Seatbelt (`sandbox-exec`) on macOS or bubblewrap (`bwrap`) on Linux and WSL2. Writes are limited to the worker's own session directory, its worktree or working directory, the repository's git directory, and temp directories. Pi's own configuration stays read-only. No job runs unsandboxed. |
| No plan mode. Write plans to files. | A plan is a Markdown file, such as `plans/<slug>.md`. The human reviews the file. |
| No built-in to-dos. Use a TODO.md file. | Each checklist pstack used to keep in a todo tool lives in `TODO.md` at the root of the checkout you work in, as `- [ ]` and `- [x]` lines. It is working state. Never stage it unless the repository already tracks it. |
| No background bash. Use tmux. | Watchers, dev servers, long builds, and heartbeat ticks run through `tmux_run`. Nothing uses `&`, `nohup`, `setsid`, or `disown`. |

Pi's design principle for customizing is to pick the least powerful mechanism that meets the need. Skills carry all workflow text. The one extension (`src/index.ts`) exists only for what a skill cannot do: start sandboxed tmux jobs, wake the session when they exit, and put the model-role lines and the two team-kit rules into the system prompt.

## Vocabulary

| Cursor or Claude Code | Pi |
| --- | --- |
| Subagent, `Task` call, delegate, worker | A Pi instance started with `pi_spawn`. Call it a worker, a spawned Pi, or by its role (explorer, reviewer, runner). Never call it a subagent. |
| `subagent_type: "poteto-agent"`, `"comment-sicko"`, `"ci-watcher"`, `"thermo-nuclear-code-quality-review"` | `pi_spawn` with `agent: "<name>"`. The role text comes from `agents/<name>.md`. |
| `subagent_type: generalPurpose`, `"shell"`, `"explore"` | `pi_spawn` with no `agent`. |
| `readonly: true` (Ask mode) | `pi_spawn` with `readonly: true`. The sandbox denies writes outside the job directory and the edit and write tools are removed. MCP stays available, so a reviewer that needs MCP can still be readonly. |
| `readonly: false` (agent mode) | Leave `readonly` unset. |
| `environment: "cloud"`, Cursor cloud agent, `cloud_base_branch` | `pi_spawn` with `worktree: "<branch>"` and `base: "<ref>"`. The worker gets its own git worktree, and the sandbox confines its writes there. |
| `environment: "local"` | Omit `worktree`. |
| `run_in_background: true` | Nothing to set. Every `pi_spawn` runs in parallel, and you are woken when it exits. Keep working or end your turn. |
| Spawn N in one message | N `pi_spawn` calls in one message. |
| `resume` an agent | `pi_spawn` with `resume: "<job id>"` continues that job's Pi session. |
| Steer or stop a running agent | `tmux_jobs` with `action: "stop"`, then a fresh `pi_spawn` with consolidated scope. A print-mode Pi takes no mid-run input. |
| Wait for agents | End your turn and let the wake arrive, or call `tmux_jobs` with `action: "wait"`. A spawned Pi running in print mode waits for its own jobs automatically before it finishes. |
| `file_attachments` | List the paths in the brief. |
| `model` slug such as `claude-opus-5-5-xhigh` or `grok-4.7-xhigh-fast` | `pi_spawn` `model: "<provider>/<id>"` and `thinking: "<level>"`. Thinking levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Pi has no fast variant, so a "fast" choice is dropped. |
| `~/.cursor/rules/pstack-models.mdc`, `~/.claude/rules/pstack-models.md` | `~/.pi/agent/pstack-v2-models.md`, written by `/skill:setup-pstack`. The extension shows its role lines to the model in a `pstack-models` system-prompt section. A role with no line, or a line of `inherit-parent` or `auto`, runs on the session model, so omit `model`. |
| A model slug the Task tool rejects | A model `pi_spawn` rejects. It accepts only `provider/id` values that `pi --list-models` prints. |
| Open a todolist, `TodoWrite` | Write `TODO.md`. |
| `AskQuestion` (multiple-choice popup) | Ask in plain text with numbered options, then end your turn. Pi has no question popups. |
| `/loop` with an event | `tmux_run` the watcher command with `wake: "<what to do next>"`. |
| `/loop <interval>` heartbeat | `tmux_run` with `command: "sleep <seconds>"`, `wake: "<tick prompt>"`, and `repeat: true`. Stop it with `tmux_jobs` `stop`. |
| A shell command run in the background | `tmux_run`. |
| Plan mode, a plan to approve | A plan file. |
| `/<skill>` | `/skill:<skill>`. |
| `.cursor/skills/`, `~/.cursor/skills/` | `.pi/skills/`, `~/.pi/agent/skills/`, or the Agent Skills paths `.agents/skills/` and `~/.agents/skills/`. |
| `.cursor/rules/*.mdc`, always-applied rules | `AGENTS.md` (project) or `~/.pi/agent/AGENTS.md` (user). |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json`, `/add-plugin` | A Pi package: `pi install <source>`, listed by `pi list`. |
| Cursor chat transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | Pi sessions in `~/.pi/agent/sessions/--<cwd with / as ->--/*.jsonl`. Spawned workers keep theirs in `~/.pi/agent/pstack-v2/jobs/<id>/session/`. |
| `/create-skill` | Write `SKILL.md` to Pi's skills spec (Agent Skills format) and check it loads with `/skill:<name>`. |
| Cursor Automations, routines, webhook wakes, `SendToUser` | A tmux job that runs `pi -p` against a session, or Pi's RPC mode. Secrets come from environment variables the user sets, never from chat. |
| Cursor canvas | A self-contained HTML file opened in the browser. |
| Cursor Bugbot, agentic security review | Unchanged. They are GitHub reviewers whose comments any harness reads from the forge. |
| Cursor's built-in PR tool | `gh`. |
| MCP tools | Pi's built-in MCP (`pi mcp`, `.pi/mcp.json`) and Codemode. |

## Sandbox details

- macOS uses a Seatbelt profile. Linux and WSL2 use bubblewrap. With neither available, `pi_spawn` and `tmux_run` refuse to start.
- A job writes only its working directory or worktree, that checkout's git directory, temp directories, and for Pi workers its own `session/` and `nested/` directories. Every other write is denied.
- `cwd` must be inside the session's project, which is the git top level or else the session cwd. The model cannot widen its own sandbox by naming another directory.
- Paths an unsandboxed process later executes from stay read-only even inside a writable checkout. Those are the git `hooks/`, `config`, and `info/` entries, a configured `core.hooksPath`, and `.pi/extensions`, `.pi/settings.json`, and `.pi/mcp.json`. Git finds hooks through `.git`, every linked worktree's `commondir`, `gitdir`, and `config.worktree`, and submodule git directories, so all of those stay read-only, and the `.git` directory itself cannot be renamed or replaced. A protected path that is a symlink is guarded at the link as well as its target.
- A protected path that does not exist at launch can still appear, because a job can rename a directory it built into place or link a parent elsewhere, and bubblewrap cannot bind what does not exist. The unsandboxed wrapper removes any such path when the job exits, including when it is stopped, and the job's output says so. It never follows a link: a linked parent is removed as the link.
- In Pi's agent directory a job may write only `auth.json`, which Pi refreshes in place, and the `*.lock` directories Pi takes beside its files. This holds even when the agent directory sits in a temp directory. On Linux the agent directory is a throwaway tmpfs holding its real entries read-only, so other writes there vanish with the job.
- Pi runs an `auth.json` key that starts with `!` as a command. When a top-level job starts, the root records the command keys present. Once a job has exited, and whenever a Pi with this extension starts, any command key that appeared since is removed under Pi's own lock and saved in `~/.pi/agent/pstack-v2/auth-removed.json`, so one you added on purpose while a job ran can be restored.
- A job cannot reach anything outside its sandbox that would start a process for it. It cannot connect to the spawning session's tmux server, the default tmux server, or other jobs' servers. On macOS it cannot use LaunchServices (`open`) or Apple Events. On Linux the user's runtime directory and session bus are hidden, and the job runs in its own PID namespace.
- Stopping a job ends its whole process group, and on Linux every process in its PID namespace.
- A Pi worker's own jobs get their own sandbox, so `readonly` holds at any depth. bubblewrap nests directly. macOS cannot apply a second Seatbelt profile, so a sandboxed worker there writes the job as a request in its `nested/` directory, and the root Pi launches it under a profile built from the paths it validated. The root refuses any request that would write outside what it granted the top-level worker, so no worker can hand a descendant more than it was given. The root writes results only under the top-level job, never into a worker's directory, and serves requests while it runs. If you quit the root Pi, nested requests wait until you resume that session.
- Start the main session sandboxed too when you want it contained. For example, run Pi inside one of the methods in Pi's containerization guide.

## What the sandbox does not cover

- Reads and network access stay open, so a job can read anything you can and send it over the network.
- A writer job's changes are code you and the root Pi later run, such as tests, builds, package scripts, Makefiles, `.envrc`, a nested repository with its own `.git`, and instruction files such as `AGENTS.md` and `.pi/skills`. Review a worker's diff before you run or trust it, as with any agent.
- A Pi started without this extension, such as with `--no-extensions`, does not run the credential check, so one started while a job runs could use a command that job planted.
- Until a job exits, a protected path it created by rename or link still exists, and an unsandboxed process started in that checkout during the job could use it.
- On macOS a job process that detaches into its own session with `setsid` survives `stop`, still inside its sandbox.

## Jobs on disk

Each job lives in `~/.pi/agent/pstack-v2/jobs/<id>/`: `job.json` (the spec), `brief.md`, `output.log`, `exit`, and for Pi workers `session/`, `nested/`, and `stderr.log`. The job directory is read-only to the job, so a job cannot rewrite its own spec or exit code. The unsandboxed tmux wrapper writes `output.log` and `exit`. A Pi worker can write only `session/` and `nested/`, and the jobs it starts live in `nested/`. Each spawning session runs its own tmux server on a socket in `/tmp/pstack-v2-<uid>/`, named from a hash of the session id. `tmux_jobs` `list` prints the attach command for each job. A wake is claimed once through a `woken` marker file, so restarting Pi never delivers a report twice.
