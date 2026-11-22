# Changelog

## 0.3.3

### Changed

- Add `test:coverage` script to `package.json`, remove the retired `style-audit` script and README reference, and update `test/port.test.ts` comments to reference `.pi/rules/coding-style.md`.
- Set `publishConfig.access` to public so the scoped package publishes publicly.

## 0.3.2

### Changed

- Rewrite `src/subagent/README.md` to match this package instead of the upstream example, update `README.md`, `docs/pi-mechanisms.md`, `docs/guide/`, and `CHANGELOG.md` to match the current tools, Gondolin policy, and subagent features, and tighten the prose.

## 0.3.1

### Fixed

- Remove the job directory when `tmux new-session` fails so `tmux_jobs` never lists ghost `lost` jobs, validate `job.json` with a real Zod schema so corrupt entries do not crash `list()`, and use distinct temp filenames for exit-file writes.
- Close the Gondolin VM when the startup shell probe fails or when `session_shutdown` fires while startup is in flight.
- Use one per-worker scratch directory in `subagent` so launch failures never leak `pi-subagent-*` temp directories.
- Acquire concurrency slots per running worker in `subagent` so a sequential chain runs under `PI_SUBAGENT_MAX_CONCURRENT=1`.
- Validate assistant message `usage` with Zod in `result-stream.ts` so malformed lines skip cleanly without hiding later messages in the same chunk.
- Check `tmux has-session` asynchronously every 1000 ms instead of calling blocking `spawnSync` every 50 ms per running worker.

### Changed

- Split `src/index.ts` into `mode.ts`, `prompt.ts`, `tmux-tools.ts`, and `watcher.ts`, break the `gondolin`/`subagent` cyclic import via `src/paths.ts`, add missing `@earendil-works/pi-ai` and `@earendil-works/pi-tui` peer dependencies, and simplify `subagent` progress, dispatch, call normalization, and rendering.

## 0.3.0

### Added

- Mount the skill roots and the subagent `.output` log directory read-only in the Gondolin VM, at their host paths. Create the log directory up front, so even a new session gets the log mount.
- Mount the subagent memory directory writable in the Gondolin VM, at its host path, when `PI_SUBAGENT_MEMORY_DIR` names a directory outside the working directory.
- Add an opt-in shared build cache for Gondolin and `tmux_run`. Mount it at `/cache`, and keep it private to the user.
- Frame each subagent report as untrusted model output, and end it with a `<usage>` block.
- Limit subagent nesting with `PI_SUBAGENT_MAX_DEPTH`, which defaults to 3, and hide `subagent` from the model at that depth. Limit running subagents with `PI_SUBAGENT_MAX_CONCURRENT`, which defaults to 20.
- Add agent frontmatter fields `disallowedTools`, `omitContextFiles`, `skills`, `maxTurns`, `memory`, and `isolation`.
- Add `fork` subagents. A fork continues a copy of the parent session and shares the parent's prompt cache. Drop corrupt transcript lines from the copy. Turn forks off with `PI_SUBAGENT_FORK_DISABLED`.
- Add persistent agent memory.
- Add `isolation: "worktree"`, as an agent frontmatter field and as a parameter on each `subagent` call, task, and chain step. It runs a subagent in its own git worktree, and keeps the worktree when the subagent leaves work behind.
- Add a live progress UI and `.output` logs. Both apply to wake jobs.
- Add the `report_findings` tool for structured findings.

## 0.2.6

### Fixed

- Match `find` and `grep` globs with `minimatch` instead of `path.matchesGlob`, which is experimental on Node 22.19 and on Node 23.x through 24.7. The matching rules are unchanged on Linux guests.
- Keep tmux job sockets under `os.tmpdir()` instead of `/tmp`. On macOS, the `attach:` hint now points at the per-user temp directory.
- Hide console windows for spawned processes on Windows.
- Replace unchecked casts in the subagent tool with guards.

## 0.2.5

### Changed

- Rewrite every test, including the `watch-pr` CLI tests, as a user behavior test. Each test loads the extension the way Pi does. It drives `tmux_run`, `tmux_jobs`, `subagent`, and the Gondolin tools, with tmux, child Pi processes, and the VM faked at their boundaries.
- Remove code that only tests reached: the `runPiInTmux` session hook, `formatAgentList`, and guards that no tool call can reach. Behavior is unchanged.

### Fixed

- Write the subagent tmux exit code to a temp file and move it into place. Before this, the parent could read an empty `exit` file mid-write and report `code null` for a child that had exited cleanly.

## 0.2.4

### Changed

- Protect `.git/hooks` and `.git/config` inside the Gondolin `/workspace` mount. Use Gondolin's `ShadowProvider` with `createShadowPathPredicate` and `writeMode: 'deny'`.
- Restrict outbound HTTP and HTTPS traffic from the default Gondolin VM to common development endpoints. Use `createHttpHooks({ allowedHosts })`.

## 0.2.3

### Changed

- Move `style-audit` to the repository root, so `bun run style-audit` runs it.
- Align the remaining test files with `AGENTS.md`. Runtime behavior is unchanged.

## 0.2.2

### Fixed

- Stop shipping the `node_modules` directories that the release tests install under `skills/*/scripts`. Version 0.2.1 carried 1,885 such files, including a 23 MB macOS-only `tsc` binary. Its tarball was 14.9 MB, and npm took about 11 minutes to serve it. `pi update` failed with a 404 for that whole window.
- Shrink the package from 2,524 files and 47.7 MB unpacked to 639 files and 6.0 MB. A test packs the package and rejects any `node_modules` path.

## 0.2.1

### Added

- Let `subagent` take `model` and `thinking` on a single call, on each parallel task, and on each chain step. They override the agent's and the session's values, so the `pstack-models` role lines can be honored.
- Add `wake` to `subagent`. A call with `wake` returns a job id at once. It wakes the session with the message and the report when every worker finishes. A root can then tick, verify, and replace a stuck worker while its workers run.
- Add `stop: "<job id>"` to abort a running wake job. Session shutdown aborts all of them. A print-mode Pi waits for its wake jobs before it settles.
- Run each owner in Autopilot-full as a wake job. Start a fresh owner job after each verdict, because a worker takes no input mid-run.
- Add a bundled `worker` agent. It has every editing tool and no role prompt. Eval candidates, arena runners, and interrogate adversaries run on it, so no role prompt steers or unblinds them.

### Fixed

- Mount this package read-only at its host path in the Gondolin VM. The model can then read the skill, playbook, and principle files that Pi and the skills name. Writes to it fail.
- Tell the model in the guest system prompt that the VM has no `git`, `gh`, `tmux`, or `bun`. Tell it that other host paths, such as the Pi agent directory, are absent, and that `tmux_run` and `tmux_jobs` `output` reach them.
- Stop naming `pi_spawn` and its `readonly`, `worktree`, `base`, and `resume` parameters in skills and docs. `subagent` replaced them in 0.1.6.
- Describe `subagent` as it works. An `agent` is required, and `scout` serves read-only work. The call blocks until its workers finish. A worker gets its own checkout from a worktree created inside the working directory and passed as `cwd`.
- Reject `pi_spawn`, a `key: value` that `subagent` does not accept, and worker session paths in tests. `subagent` workers never write session files.
- Put the worktree inside the working directory when a skill opens a PR. That is the only host directory the VM can edit.
- Stop `poteto-agent` from searching `~/.cursor/plugins` for poteto-mode when its brief gives no path. The search made it refuse every task under Pi. It now reads poteto-mode beside any pstack skill in its skill list.
- Explain npm's install-scripts warning for `ssh2` and `cpu-features` in the README. Both packages have arrived through Gondolin since 0.2.0. The README gives the `npm install-scripts deny` command that silences the warning. A test checks that the command names every dependency with an install script.

## 0.2.0

### Changed

- Run Pi's built-in tools (`read`, `write`, `edit`, `bash`, `ls`, `find`, `grep`) and `!` shell commands inside a Gondolin micro-VM. Port Pi's `gondolin` example extension to `src/gondolin` for this.
- Mount the directory Pi started in at `/workspace`, and show the VM with `/gondolin`. QEMU is now required.
- Run `tmux_run` jobs on the host without a sandbox. A job's `cwd` can be any directory, relative to the session's.

### Removed

- Remove the Seatbelt and bubblewrap sandbox. This also removes its protected paths, quarantine sweep, per-job credentials copy, private temp directories, and brokered nested jobs. bubblewrap is no longer required on Linux.

## 0.1.7

### Fixed

- Give a subagent's `pi` the dispatching Pi's environment: agent directory, credentials, and `PATH`. Start a new tmux server for each run, so an already running default server cannot replace that environment with its own.
- Discover the agents under `src/subagent/agents`, including `poteto-agent`, in every scope. User agents override them, and project agents override both.

## 0.1.6

### Changed

- Run delegated Pi workers through the packaged upstream `subagent` tool, which starts each `pi` in its own tmux session. It replaces `pi_spawn`. Its agents live under `src/subagent/agents`.
- Check the input of the `tmux_run`, `tmux_jobs`, and `subagent` tools and of `/pstack-mode` with zod before they act. Every key that Pi passes in still reaches the tool.
- Reorganize the extension, the watch-pr CLI, and the statechart CLI into smaller modules that build new values instead of changing existing ones. Output, exit codes, and error messages are unchanged.
- Add `node scripts/style-audit.mjs`, which checks the package's code style with Biome and GritQL rules. It lists each spot where a rule would change behavior, with its reason, in `scripts/style/behavior-exceptions/`.

## 0.1.5

### Changed

- Add an Acceptance section to `poteto-mode` for code-producing work. A correctable failure returns to investigation and design. Blocked or inconclusive evidence ends with a report of limits and remaining work. Verified work goes to the authorized endpoint, either a handoff with its evidence or Shipping when merge is granted. The guide's poteto-mode page draws the same flow.
- Run the Open a PR step at the end of code-producing playbooks only, not every playbook, so it no longer contradicts Investigation and Multi-phase plan. State that an open PR has passed no later merge gate. Continue to Shipping only on a merge grant.
- Route a change review to `interrogate`. Drop `reflect` from the routed skills that start their own workers, since it no longer fans out.
- State in `interrogate` that no verified findings is not evidence of no bugs. Make `create-formal-verification-skill` report its generated-input fallback as empirical evidence, never as an exhaustive proof.
- Make a worker that runs `interrogate` with unclear intent state its assumed intent instead of stopping to ask, as `worker.md` requires.
- Stop asking stopped owners to commit `wip:` in Autopilot-full's stand-down, because a print-mode worker cannot receive the request. The root stops each owner, commits its uncommitted edits in the owner's worktree, and reports from the commits and trail.
- Record the permissions, the workspace, and the decision-trail location, along with the exit condition, in Autonomous run.
- Say in the setup guide that installing starts no workflow. Say that the verification steps start separate work and install no tools, and that the model lines apply from the next message. This matches what the extension does.

### Fixed

- Make a worker's own `pi_spawn` with `worktree` work. It always failed, because the worker's sandbox keeps `.git/worktrees` read-only. As a result, `interrogate` and `arena` run by a worker could not give each adversary its own checkout.
- Have the worker ask the root to create the worktree. The root creates it in a directory no worker can write, from the worker's own checkout, and only for a worker that may write the repository. The root computes the new checkout's protected paths itself. It removes the worktree and branch when it cannot launch the job.

## 0.1.4

### Added

- Add `/pstack-mode <skill>`, pstack's Custom Mode. The skill rides in the system prompt every turn, survives `/compact`, resume, and `/tree`, and shows in the footer until `/pstack-mode off`.
- Show each worker's run time and tool-call count in its report.
- List the valid models when `pi_spawn` rejects one, so a skill's fallback can pick from the list.

### Changed

- Sync the skills, playbooks, principles, and guide to pstack 0.15.43, upstream commit e1cc031. Every agent that a playbook starts reads the new `worker.md` first, which holds the operator's rules.
- Stop `architect` and `reflect` from fanning out. Remove the Orchestrate playbook and `check-plan`. Condense the principles. Make `/skill:setup-pstack` write `# defaults: 3`, drop the retired roles, and allow no role above `xhigh`.
- Run watch-pr's Bun tests in `test` and CI in place of the retired `check-plan` test.
- Make `pi_spawn` reject a model that Pi holds no credentials for. Such a worker used to start, create its worktree, and fail at startup, so a skill's model fallback never ran.
- Tell workers that Unix sockets are refused, so SSH pushes through ssh-agent fail and an HTTPS remote works. Tell them which configuration stays read-only.
- Install watch-pr's dependencies in the root session before `autopilot-full` starts owners, since a sandboxed worker cannot.
- Correct the mapping notes on nested workers, readonly workers, and rejected models. State that the benny automation pack is not shipped.

### Removed

- Remove the two team-kit rules, no inline imports and exhaustive switches, from the system prompt and the package. pstack names neither.

### Security

- Refuse writes to editor and coding-agent configuration: `.vscode`, `.idea`, `*.code-workspace`, `.cursorignore`, and `.cursor` and `.claude` apart from their `rules`, `commands`, `worktrees`, `skills`, and `agents`. Before this, a job could add a coding-agent hook or a VS Code task that ran unsandboxed the next time you opened the checkout.
- Quarantine entries that appear during a job when it ends, on Linux, as `.pi` code is.

## 0.1.3

### Fixed

- Give workers a private model catalog, so sandboxed Pi can lock and read cached models such as Cursor Grok 4.7 Fast.

## 0.1.2

### Added

- Add this changelog.

## 0.1.1

### Security

- Deny LaunchServices opens on macOS. A job could build an app in its temp directory and run it outside the sandbox with `open -a`.
- Refuse a `cwd` that is a checkout of another repository, even when it sits inside the project. The job used to receive that repository's git directory.

### Added

- Show a job's output live in its tmux session. `tmux_jobs` `list` prints the attach command for each running job, and Ctrl-C there stops it.

### Changed

- Default the `tmux_jobs` `wait` timeout to five minutes, down from thirty. The tool tells the model to end the turn and let the wake arrive.
- Write the checklist to `.pi/TODO.md` when the checkout already tracks a `TODO.md`.
- Stop `swarm`, `arena`, `interrogate`, and `maintain-verification-skill` from saying to block on `tmux_jobs` `wait`.
- Make `poteto-mode` say when a wait is right and ask for a deadline on a `tmux_run` job that polls.
- Make `poteto-mode` and the `poteto-agent` role treat a failure seen only inside the sandbox as a sandbox suspect, until it is reproduced outside.
- Tell workers what the sandbox refuses: `ps` and `top`, and a bash here-document in a checkout they cannot write. Say in `pi_spawn` that the shared `/tmp` is read-only to the worker.
- Rewrite the README for pi.dev, with absolute links and a one-sentence package description.

### Fixed

- Build a worker's report from every answer it completed in its session file. A worker's reply to a late job notice used to replace its real report.
- Tell a print-mode worker about a finished job while it still works, not only after its last answer.
- Leave a failed turn that the worker retried and recovered from out of its report. Label an answer that ended with `length`, `error`, or `aborted`. Say when a report shows raw stdout because no answer completed.
- Make `tmux_jobs` `wait` with no ids skip jobs started without a wake, such as dev servers. End any wait when the user sends a message.
- Stop reporting a job as lost after `tmux_jobs` `stop` ends it.
- Share a worker's `$TMPDIR` with the commands it starts, so a path the worker hands a command exists for both.
- Let `tmux_run` and `pi_spawn` work in a linked worktree of the same repository, such as a worker's checkout.
- Base a `pi_spawn` worktree on the one remote branch that a `base` names when no local ref matches.
- Run headless Firefox in the macOS sandbox. Land Chromium downloads in the job's private temp directory through `MAC_CHROMIUM_TMPDIR`. Allow no job to write the shared per-user temp directory.
- Make `mktemp` and zsh here-documents use the job's temp directory in the macOS sandbox. Jobs find a `mktemp` first on `PATH`, and `TMPPREFIX` points zsh there.
- Run pnpm scripts in a project that pins another pnpm version, by turning off pnpm's version switching inside jobs.

### Known limits

- A bash here-document fails in a checkout that the job cannot write, such as a readonly worker's. Change to `$TMPDIR` first, or write with `printf`.
- `ps` and `top` are refused inside a job on macOS. Read the load with `uptime`.
- A job reads no typed input. Run a command that needs an answer in the root session.

## 0.1.0

### Added

- Port pstack 0.15.42 and cursor-team-kit 1.2.0 onto Pi's own mechanisms: 76 skills, four agent roles, two rules, and the guide, pinned in `upstream.lock.json`.
- Add `pi_spawn`, which starts a Pi worker in its own tmux session. A worker can run readonly, in a git worktree, and on a chosen model, and it can start workers of its own.
- Add `tmux_run` for watchers, dev servers, long builds, and heartbeat ticks. Add `tmux_jobs` to list, read, wait on, and stop jobs.
- Run every job in a sandbox: Seatbelt on macOS, and bubblewrap on Linux and WSL2. A job writes only its checkout, its job directory, and a private temp directory.
- Keep jobs away from your Pi agent directory. Give each top-level job its own, with a copy of your credentials. Only refreshed OAuth tokens flow back.
- Move any Pi code or git pointer that appears in a job's checkout into quarantine when the job ends.
- Keep plans in files and checklists in `TODO.md`. Have `/skill:setup-pstack` write the model roles to `~/.pi/agent/pstack-v2-models.md`.
- Declare the package's `repository`, which npm needs to accept the provenance statement.
