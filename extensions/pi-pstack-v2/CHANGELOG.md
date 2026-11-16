# Changelog

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
