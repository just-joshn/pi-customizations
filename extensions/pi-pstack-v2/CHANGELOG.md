# Changelog

## 0.1.7

### Fixed

- A subagent's `pi` gets the dispatching Pi's environment (agent dir, credentials, PATH). Each run now starts its own tmux server, so an already-running default server no longer replaces that environment with its own.
- The agents this package ships under `src/subagent/agents`, including `poteto-agent`, are discovered in every scope. User agents override them, and project agents override both.

## 0.1.6

### Changed

- Delegated Pi workers run through the packaged upstream `subagent` tool, which starts each `pi` in its own tmux session, in place of `pi_spawn`. Its agents live under `src/subagent/agents`.
- The `tmux_run`, `tmux_jobs`, and `subagent` tools and `/pstack-mode` check their input with zod before they act. Every key Pi passes in still reaches the tool.
- The extension, the watch-pr CLI, and the statechart CLI are reorganized into smaller modules that build new values instead of changing existing ones. Their output, exit codes, and error messages are unchanged.
- `node scripts/style-audit.mjs` checks the package's code style with Biome and GritQL rules. Spots where a rule would change behavior are listed with their reasons in `scripts/style/behavior-exceptions/`.

## 0.1.5

### Changed

- `poteto-mode` gains an Acceptance section for code-producing work. A correctable failure returns to investigation and design. Blocked or inconclusive evidence ends with a report of limits and remaining work. Verified work goes to the authorized endpoint, either a handoff with its evidence or Shipping when merge is granted. The guide's poteto-mode page draws the same flow.
- Opening a PR runs at the end of code-producing playbooks, not every playbook, so it no longer contradicts Investigation and Multi-phase plan. It says an open PR has passed no later merge gate, and continues to Shipping only on a merge grant.
- Route a change review to `interrogate`, and drop `reflect` from the routed skills that spawn their own workers, since it no longer fans out.
- `interrogate` says no verified findings is not evidence of no bugs. `create-formal-verification-skill` reports its generated-input fallback as empirical evidence, never as an exhaustive proof.
- A worker that runs `interrogate` with unclear intent states its assumed intent instead of stopping to ask, as `worker.md` requires.
- Autopilot-full's stand-down no longer asks stopped owners to commit `wip:`, which a print-mode worker cannot receive. The root stops each owner, commits its uncommitted edits in the owner's worktree, and reports from the commits and trail.
- Autonomous run records the permissions, workspace, and decision-trail location along with the exit condition.
- The setup guide says that installing starts no workflow, that the verification offers start separate work and install no tools, and that the model lines apply from the next message, matching what the extension does.

### Fixed

- A worker's own `pi_spawn` with `worktree` works. It always failed, because the worker's sandbox keeps `.git/worktrees` read-only, so `interrogate` and `arena` run by a worker could not give each adversary its own checkout. The worker now asks the root to create the worktree, which it does in a directory no worker can write, from the worker's own checkout, only for a worker that may write the repository. The root computes the new checkout's protected paths itself and removes the worktree and branch when it cannot launch the job.

## 0.1.4

### Added

- Add `/pstack-mode <skill>`, pstack's Custom Mode. The skill rides in the system prompt every turn, survives `/compact`, resume, and `/tree`, and shows in the footer until `/pstack-mode off`.

### Changed

- Sync the skills, playbooks, principles, and guide to pstack 0.15.43 (upstream e1cc031). Every agent a playbook starts reads the new `worker.md` first, which holds the operator's rules. `architect` and `reflect` no longer fan out, the Orchestrate playbook and `check-plan` are gone, the principles are condensed, and `/skill:setup-pstack` writes `# defaults: 3` with the retired roles dropped and no role above `xhigh`.
- Run watch-pr's Bun tests in `test` and CI in place of the retired `check-plan` test.
- Show each worker's run time and tool-call count in its report.
- List the valid models when `pi_spawn` rejects one, so a skill's fallback can pick from the list.
- `pi_spawn` rejects a model Pi holds no credentials for. Such a worker used to start, create its worktree, and fail at startup, so a skill's model fallback never ran.
- Tell workers that Unix sockets are refused, so SSH pushes through ssh-agent fail and an HTTPS remote works, and which configuration stays read-only.
- `autopilot-full` installs watch-pr's dependencies in the root session before it spawns owners, since a sandboxed worker cannot.
- Correct the mapping notes on nested workers, readonly workers, and rejected models, and say that the benny automation pack is not shipped.

### Removed

- Drop the two team-kit rules (no inline imports, exhaustive switches) from the system prompt and the package. pstack names neither.

### Security

- Refuse writing editor and agent-harness configuration: `.vscode`, `.idea`, `*.code-workspace`, `.cursorignore`, and `.cursor` and `.claude` apart from their `rules`, `commands`, `worktrees`, `skills`, and `agents`. A job could add an agent-harness hook, or a VS Code task, that ran unsandboxed the next time you opened the checkout. On Linux, entries that appear during a job are quarantined when it ends, as `.pi` code is.

## 0.1.3

### Fixed

- Give workers a private model catalog so sandboxed Pi can lock and read cached models such as Cursor Grok 4.7 Fast (#251).

## 0.1.2

- Add this changelog. Nothing else changes.

## 0.1.1

### Security

- Deny LaunchServices opens on macOS. A job could build an app in its temp directory and run it outside the sandbox with `open -a` (#245).
- Refuse a `cwd` that is a checkout of another repository, even when it sits inside the project. The job was handed that repository's git directory (#245).

### Fixed

- Build a worker's report from every answer it completed in its session file. A worker's reply to a late job notice used to replace its real report (#245).
- Tell a print-mode worker about a finished job while it still works, not only after its last answer (#245).
- Leave a failed turn the worker retried and recovered from out of its report. Label an answer that ended with `length`, `error`, or `aborted`, and say when a report shows raw stdout because no answer completed (#245).
- Make `tmux_jobs` `wait` with no ids skip jobs started without a wake, such as dev servers. End any wait when the user sends a message (#245).
- Stop reporting a job as lost after `tmux_jobs` `stop` ends it (#245).
- Share a worker's `$TMPDIR` with the commands it starts, so a path the worker hands a command exists for both (#245).
- Let `tmux_run` and `pi_spawn` work in a linked worktree of the same repository, such as a worker's checkout (#245).
- Base a `pi_spawn` worktree on the one remote branch a `base` names when no local ref matches (#245).
- macOS sandbox: headless Firefox runs, and Chromium downloads land in the job's private temp directory through `MAC_CHROMIUM_TMPDIR`. No job may write the shared per-user temp directory (#245).
- macOS sandbox: `mktemp` and zsh here-documents use the job's temp directory. Jobs find a `mktemp` first on `PATH`, and `TMPPREFIX` points zsh there (#245).
- Run pnpm scripts in a project that pins another pnpm version, by turning off pnpm's version switching inside jobs (#245).

### Changed

- Default `tmux_jobs` `wait` to five minutes, down from thirty. The tool says to end the turn and let the wake arrive (#245).
- Show a job's output live in its tmux session. `tmux_jobs` `list` prints the attach command for each running job, and Ctrl-C there stops it (#245).
- Write the checklist to `.pi/TODO.md` when the checkout already tracks a `TODO.md` (#245).
- `swarm`, `arena`, `interrogate`, and `maintain-verification-skill` no longer say to block on `tmux_jobs` `wait`. `poteto-mode` says when a wait is right and asks for a deadline on a `tmux_run` job that polls (#245).
- `poteto-mode` and the `poteto-agent` role treat a failure seen only inside the sandbox as a sandbox suspect until it is reproduced outside (#245).
- Tell workers what the sandbox refuses: `ps` and `top`, and a bash here-document in a checkout they cannot write. `pi_spawn` says the shared `/tmp` is read-only to the worker (#245).
- Rewrite the README for pi.dev, with absolute links and a one-sentence package description (#234).

### Known limits

- A bash here-document fails in a checkout the job cannot write, such as a readonly worker's. Change to `$TMPDIR` first, or write with `printf`.
- `ps` and `top` are refused inside a job on macOS. Read the load with `uptime`.
- A job reads no typed input. Run a command that needs an answer in the root session.

## 0.1.0

- First release. Port pstack 0.15.42 and cursor-team-kit 1.2.0 onto Pi's own mechanisms: 76 skills, four agent roles, two rules, and the guide, pinned in `upstream.lock.json` (#227).
- Add `pi_spawn`, which starts a Pi worker in its own tmux session. A worker can run readonly, in a git worktree, on a chosen model, and can start workers of its own (#227).
- Add `tmux_run` for watchers, dev servers, long builds, and heartbeat ticks, and `tmux_jobs` to list, read, wait on, and stop jobs (#227).
- Run every job in a sandbox, Seatbelt on macOS and bubblewrap on Linux and WSL2. A job writes only its checkout, its job directory, and a private temp directory (#227).
- Keep jobs away from your Pi agent directory. Each top-level job gets its own, with a copy of your credentials, and only refreshed OAuth tokens flow back (#227).
- Move any Pi code or git pointer that appears in a job's checkout into quarantine when the job ends (#227).
- Keep plans in files and checklists in `TODO.md`. `/skill:setup-pstack` writes the model roles to `~/.pi/agent/pstack-v2-models.md` (#227).
- Declare the package's `repository`, which npm needs to accept the provenance statement (#231).
