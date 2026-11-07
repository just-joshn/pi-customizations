# Changelog

## [0.15.36-pi.34] - 2026-11-07

- Skip a background job's completion notice when `AwaitShell` saw the job end, even when it saw the end after the job had exited. A job that finished while the agent was busy queued its notice at exit, so a later `AwaitShell` that reported it complete still left a notice that started an extra turn after the answer. A notice for a job that ends during a run now waits until the run ends, and goes out only when nothing saw the job end.

## [0.15.36-pi.33] - 2026-11-07

- Have `/poteto-help` link the public copy of the file its answer came from, `https://github.com/cursor/plugins/blob/main/pstack/` followed by its path, as Cursor's pstack does. It gave the installed package path instead.

## [0.15.36-pi.32] - 2026-11-07

- Run the readonly shell on Linux armv7, ppc64le, and s390x. Its seccomp filter knew only x64 and arm64, so every readonly command on those architectures was refused. Each architecture's filter uses its kernel's audit arch and syscall numbers, refuses `socket(AF_UNIX)`, `io_uring_setup`, and `socketcall(SYS_SOCKET)`, and kills other ABIs. On s390x, glibc creates every socket through `socketcall`, so programs built on glibc, Node and curl included, cannot open a network connection in the readonly shell there.

## [0.15.36-pi.31] - 2026-11-07

- Count a run as using its cloud machine from the moment it takes its run lock. A fork that was still starting held its lock but had no record yet, so another run ending on the same machine could stop the container under it. The run lock now names the container on a second line after the pid.

## [0.15.36-pi.30] - 2026-11-07

- Stop a cloud machine only when no live run still uses it. A cloud agent, its forks, and resumes of its subagents can share one container, and each stopped it when its own run ended, so the first to finish killed the others mid-command. Every stop now first checks the workspace's run locks and records, under a per-machine lease, and the machine still stops when its last run ends. A run whose process died no longer counts.

## [0.15.36-pi.29] - 2026-11-07

- Resume and fork a cloud agent's subagent on that agent's container machine. From the main chat, such a run used to execute on the host in the clone folder. It now boots the machine if it is stopped, stops it again afterwards, takes the read-only sibling container for a readonly run, and fails with "The cloud machine … no longer exists" when the machine is gone.

## [0.15.36-pi.28] - 2026-11-07

- Let a cloud agent resume and fork the subagents it started. Its Pi process runs in its own checkout, and the ownership check compared that only against the main chat's workspace, so the cloud agent got "belongs to … not this workspace". A subagent now belongs to the caller whose working directory is its workspace root or its own checkout, so another cloud agent's subagents are still refused.

## [0.15.36-pi.27] - 2026-11-07

- Remove a cloud agent's read-only sibling container once the run that started it has died. A killed Pi process left the sibling running forever. Each Pi session now removes, when it starts, every sibling of its workspace whose run lock names no live process, so a sibling in use by a live run is never touched.

## [0.15.36-pi.26] - 2026-11-07

- Count a subscription wake as delivered once any branch of the owner session holds it. Before, a restart after `/tree` left the branch that held the wake sent it again.

## [0.15.36-pi.25] - 2026-11-07

- Wait 30 seconds by default before moving a `bash` command to the background, as Cursor CLI's Shell does with its default `block_until_ms`. Before, a call without `timeout` held the turn until a long build or test run ended. The `timeout` description now says the command keeps running. A readonly subagent and plan mode have no background shells, so their `bash` still waits for the command to end.

## [0.15.36-pi.24] - 2026-11-07

- Move a `bash` command whose `timeout` elapses to the background instead of killing it, as Cursor CLI 2026.11.05 does. The call returns the output so far with Cursor's wording, the shell ID, the PID, and the terminals file; the command keeps writing to that file, `AwaitShell` can wait on it, a notification arrives after the turn when it finishes, and ending the session stops it. It keeps no shell state. A cloud agent's `bash` does the same on its machine; the read-only shells of readonly subagents and plan mode still stop the command, since they have no background shells.

## [0.15.36-pi.23] - 2026-11-07

- Keep a subscription wake pending until the owner's session file holds it. Before, a wake left the pending queue as soon as it was handed to Pi, so an owner that died while busy, or before Pi saved the message, lost it for good. Now the next process that opens the session receives it, and a session that already holds the wake does not receive it again. A busy owner can hold at most 20 unsaved wakes per subscription; further fires report the queue as full.
- Mount the pi-pstack package read-only on every cloud machine, so a cloud agent can read the skills, playbooks, and scripts its system prompt names; they were missing from the container.
- Make a readonly cloud agent's machine unwritable: a read-only root filesystem, no `/dev/shm`, and your user instead of root, on top of the read-only clone, Projects folder, and store. `/tmp` and the rest of the container were writable before. A readonly `resume` or `fork` of an agent on a writable machine now fails with an error, since it used to run with that machine's writable mounts.
- Run a cloud agent's readonly subagent on a read-only sibling container instead of the agent's writable machine: the same image and mounts, all read-only, with the read-only root filesystem and your user, removed when the subagent ends. It used to write the clone, `/tmp`, and the Projects folder from its read-only `bash`.
- Keep a cloud command's stdout and stderr in the order the command wrote them, and make ending a cloud command (abort, timeout, or ending a background job) kill it on the machine: Debian's `sh` rejected the `kill -- -<pid>` the old code sent, so the command kept running.
- Keep the shell's working directory and exported environment variables between `bash` calls in a session, as Cursor CLI 2026.11.05 does. Pi started every command fresh in the session's directory, so a `cd` or `export` in one call was gone in the next. `bash_background` jobs now start from the same state. Readonly subagents, plan mode, and cloud machines share the behavior; a new, resumed, or forked session and every subagent start fresh.

## [0.15.36-pi.22] - 2026-11-07

- Let a readonly or plan-mode shell on macOS read a server on loopback, such as a local dev server. sandbox-runtime sends loopback addresses around its proxy, and the sandbox refused the direct connect with `EPERM`, so `curl` and Node's `fetch` failed unless told to use the proxy. File writes and Unix sockets stay blocked. Linux already allowed it.

## [0.15.36-pi.21] - 2026-11-07

- Run the routines supervisor and the statechart script on plain Node 22.19 or later, with no Bun. Both shipped as TypeScript that Node refuses to strip under `node_modules`, so an npm-installed package could not keep timers and webhook routines running after the chat closed, or check a statechart, unless Bun was on PATH. They now ship as JavaScript built by Bun 1.4.4 from the same sources, and the supervisor's launcher is a POSIX `sh` script, so it also starts on Alpine without bash. `bun run check:helpers`, `prepack`, CI, and the release job fail when a built helper is stale.
- Start the statechart worker with V8's `--single-threaded` on Node. Built as one bundled script, the worker could deadlock at exit while a V8 background thread compiled it, which hung the check until it was killed. In a Linux container, 9 of 24 runs of the statechart CLI tests hung before the change, and 0 of 8 full statechart suites hung after it.
- Give the supervisor and the detached runs it starts the absolute agent directory, so a relative or `file://` `PI_CODING_AGENT_DIR` still names the same profile after the supervisor changes directory.

## [0.15.36-pi.20] - 2026-11-06

Matches the Cursor CLI 2026.11.05 contracts a Linux run observed with pstack installed. `parity/pstack-linux-2026-11-05/` in the repository holds the probes, the ledger, the decisions, and the mutation lever.

- Give the main chat every subagent's background work, as Cursor does. A subagent no longer hears about its own background shells; each finished job notifies the main chat after the subagent's result, and jobs still running when the subagent ends are stopped and reported as `aborted`. A subagent's background subagent keeps running after the subagent ends and reports to the main chat, which stops it when its own session ends. A cloud agent is the top of its own tree, as a Cursor cloud agent is its own conversation: its jobs and background subagents report to it. The subagent launch text no longer says its jobs stop with it.
- Stop adding cursor-team-kit's two always-applied rules to every request, since Cursor CLI never puts a plugin's rules in the model's context. The rule files ship unchanged in `rules/`; the `no-inline-imports` and `typescript-exhaustive-switch` skills, which Cursor does not have, are gone.
- Read the model rule when a session starts, and only for a workspace under the home directory, as Cursor loads `~/.cursor/rules`: a rule written mid-session applies to new sessions. `/setup-pstack`, `/poteto-help`, and the guide say so again.
- Rebuild `create-skill` from Cursor's built-in create-skill with only host facts translated, dropping the phases the port had added.
- Run a cloud agent's container machine as the host user on Linux, so the clone and the shared Project and store folders it writes stay yours to edit and delete; a root container left them root-owned.

## [0.15.36-pi.19] - 2026-11-05

Closes the host gaps earlier versions documented. `parity/pstack-complete-2026-11-05/` in the repository records the decisions, the levers that rebuilt the text, and the mutation receipts.

- Run cloud agents (`environment: "cloud"`) on their own machine: a container from `.pi/environment.json` (or `PSTACK_CLOUD_IMAGE`, default `node:24-bookworm`) with a fresh clone of the pushed remote, the Projects folder, and the root store, and every tool routed into it while the Pi process and model credentials stay on the host. Their own subagents run on the same machine. Without a container engine they run in a local worktree, and the system prompt says so.
- Run cloud agents detached: they keep running when the chat closes, the reopened chat receives a result it missed once, `agent_status` shows the machine and last run, `stop_agent` stops the container too, and a resume boots the stopped container with its disk.
- Add `/in-cloud`, which sends the next task (or its argument) to a background cloud agent.
- Restore pstack's cloud-agent wording in swarm, orchestrate, multi-phase-plan, autopilot-full, shipping, session-pickup, poteto-mode, poteto-help, and the guide.
- Let readonly and plan-mode shells make network reads, with writes and Unix sockets still blocked.
- Add `subscribe_slack` and the Slack tools (`slack_read_channel`, `slack_read_thread`, `slack_send`, `slack_react`, `slack_update`) for top-level chats; subagents get neither the tools nor `SLACK_BOT_TOKEN`.
- Add automations: `environment: "cloud"` for `new_session` subscriptions, a `MEMORIES.md` per automation named in every fire, the `automate` skill (`/automate`), and `/automations` to list, edit, or disable.
- Rebuild the Benny pack from upstream on the Slack trigger, the Slack tools, and `/automate`.
- Add `request_secret` and `/secret`, which store a secret typed into a masked field in a connector credential file, and ask for confirmation before creating a webhook routine.
- Add `/project`: a Project's tracker, store, and chats reach the chat and its subagents, and the footer shows the Project and how many subscriptions the chat listens to.
- Send a video in `file_attachments` as timestamped frames; the parameter text is Cursor's again.
- Enter a skill's mode with Alt+Enter on a `/skill` line.
- Match Cursor CLI 2026.11.05, which began enforcing plan mode's write rule: writes go only to `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, and `.mdx` files (no longer `.mdc`), and any other write fails with Cursor's `Cannot edit non markdown files in plan mode`.

## [0.15.36-pi.18] - 2026-11-05

Each item below comes from Cursor's own code, run from the installed desktop 3.27.22 runtime and the CLI 2026.10.22 bundle. `parity/pstack-source-audit-2026-11-05/` in the repository records the captured functions, probes, decisions, and mutation receipts.

- Load the bundled agents the way Cursor loads plugin agents: on the parent model, in the foreground unless the call sets `run_in_background`, and readonly only through `permissionMode: readonly`. `model`, `tools`, `is_background`, `background`, and `readonly: true` in agent frontmatter no longer change anything.
- Give each subagent Cursor's system reminder: the shared subagent reminder, then a plugin agent's custom-subagent framing and description before its body, or a built-in type's own text. explore's description and reminder are Cursor's.
- Add the built-in `shell` subagent, limited to `bash` and `bash_background`, which team-kit's thermo-nuclear agent names.
- Match `subagent_type` regardless of case, hyphens, underscores, or a trailing `agent`, `subagent`, `mode`, or `type`.
- Ignore a `model: "fast"` that names no listed model, read `inherit` in any case as an omitted model, and reject an empty model.
- Fail a resume that names a different `subagent_type` with Cursor's message, stop noting an ignored `model` on resume, and reject an empty `prompt`.
- Fail a follow-up to a running agent with Cursor's `Sub-agent is currently running. You may send the follow-up message when it has completed.`, in this or another Pi process, instead of steering it into the running turn. poteto-mode's steer and hold sentences are pstack's text again.
- Use the Task description and parameter text a live Cursor session showed, with Pi's tool names and the `pstack_subagents` catalogs.
- Use the TodoWrite, SwitchMode, and GenerateImage descriptions and parameter text a live Cursor session declared. SwitchMode leaves out the Debug and Ask modes, which Pi does not have.
- List subagent types under Cursor's catalog heading, `Available subagent_types and a quick description of what they do:`, one `- type: description` line each, without the `(default)` note.
- Render Task results with Cursor's text: a background launch names the transcript the way desktop does and says not to mention it or predict the reply, a foreground reply has no Transcript line, an empty reply reads `No output`, and a reply that already holds a `<response>` block is not wrapped again. Pi's notes follow a blank line, where Cursor puts a result suffix.
- Use desktop's AskQuestion description and field text, and drop the option `description` field Cursor's schema does not declare. An option description a model sends is accepted and, as in Cursor, not shown.
- Match AwaitShell patterns as RE2, as Cursor does, so inline flags such as `(?i)` work and lookahead is refused. Add `waiting_for_subagent`, which fails with Cursor's `You should NOT wait for subagents to complete.` message, and use Cursor's error for `block_until_ms: 0` without a `shell_id`.

## [0.15.36-pi.17] - 2026-11-05

Each item below is checked against the Cursor CLI 2026.10.22 bundle. `parity/pstack-parity-2026-11-05/` in the repository records the evidence, the decisions, and the 133-row behavior inventory.

- Expand a leading prompt template before attaching referenced skills when a message uses both, match skill names containing underscores in aliases and autocomplete, and trim trailing whitespace after a leading `/skill`.
- Accept Cursor's `reasoning`, `reasoning_effort`, `effort=none`, and `speed=fast|default` bracketed model parameters in `Task`, and honor `permissionMode: readonly` and `background: true` in agent frontmatter.
- Re-open the existing plan review dialog on a bare `/plan` when a plan file is already saved, as Cursor's `onShowExistingPlan` does.
- Detect zombie processes and pre-epoch supervisor locks on macOS as well as Linux.

## [0.15.36-pi.16] - 2026-11-04

Each item below is checked against the Cursor CLI 2026.10.22 bundle, Cursor's built-in skills, or Cursor's docs. `parity/pstack-parity-2026-11-05/` in the repository records the evidence, the decisions, and the behavior inventory.

- Attach every skill a message names, as Cursor's `findSkillReferences` does: a `/name` after the start of the message attaches its skill too, and several skills ride one message, each once, in order. Before, only a leading `/name` attached a skill.
- Return Cursor's reject reason from `AskQuestion` when nobody can answer: `Questions skipped by the user, continue with the information you already have`, or `Subagent cannot ask questions` in a subagent.
- Inject the two always-applied team-kit rules with their exact bodies. The port had added a heading to each.
- Keep a `/loop` running when one of its runs is interrupted. Cursor's loop is a background shell that a turn interrupt leaves running, so only `/loop stop` or the `Loop` tool's `stop` ends it.
- Run the built-in `explore` subagent on the parent model's `-fast` variant when Pi lists one, as Cursor's explore uses a faster model by default.

## [0.15.36-pi.15] - 2026-11-04

- Match watched shell output before a newline or process exit. Count every occurrence within a chunk and retain matches across chunk boundaries.
- Match the captured observer's batching, minimum debounce, completion flush, and 100-occurrence limit notice.
- Decode stdout and stderr independently so split UTF-8 characters reach the output file and monitor intact.
- Pin `re2js` 1.2.2 for output-watch patterns. Invalid patterns warn without stopping the command. A missing dependency leaves unrelated tools available but rejects a valid requested watch before the command runs.
- Record the pinned reference, original-component comparisons, and open requirements in `parity/pstack-full-parity-2026-11-04/`. Whole-plugin parity remains `NOT VERIFIED`.

## [0.15.36-pi.14] - 2026-11-04

Each item below was checked against Cursor CLI 2026.10.22 with pstack and cursor-team-kit loaded, through live captures. `parity/pstack-native-parity-2026-11-04/` in the repository records the evidence and the decisions.

- Add background shells: `bash_background` runs a command in the background, or after a foreground wait, writes `terminals/<id>.txt` with a status header and an exit footer, and sends a `kind: shell` notification when the command ends or prints a watched line. `AwaitShell` polls, waits for a pattern, or sleeps. pstack's babysit watcher, worktree-cleanup scan, PR review canvas server, and event-gated `/loop` wakes use them. The host section sends commands that can run for minutes to `bash_background`, because `bash` waits until a command ends.
- Run the Linux read-only shell under bubblewrap with a seccomp filter that bubblewrap loads itself, so readonly subagents get a working shell on Ubuntu 24.04 and later. Writes, the network, and Unix sockets stay blocked. macOS keeps sandbox-runtime.
- Tell the agent to run a loop's prompt once in the turn that arms it, as Cursor's loop skill does.
- Remove `AskQuestion` from subagents.
- State today's date in the host section.
- Restore upstream text in the architect runner prompt and arena where the port had added instructions with no host reason.

## [0.15.36-pi.13] - 2026-11-04

- Parse leading word intervals and preserve multiline prompts in `/loop`.
- Run different loop prompts independently. Return loop IDs and require an explicit ID for ambiguous wake or stop operations.
- Restore writable tools after leaving a planning branch with no recorded tool loadout.
- Preserve plan todo dependencies and project phases. Import unfinished root todos when building and synchronize later status updates without rewriting the rest of the plan file.
- Preserve completion when a reviewed plan omits a todo's optional status. Insert the missing field without rewriting existing metadata, comments, line endings, or body text.
- Persist plan-imported todos through native Pi branch entries so they survive a restart. Worktree plan builders import their own lists before the first request and retain the plan association on resume. Readonly resumes cannot synchronize plan files.
- Serialize Task stale-lock recovery with token-directory leases. Treat unreaped Linux zombies as exited writers.
- Open PR review canvases with the system browser instead of assuming Cursor's in-app browser.
- Keep Unix sockets blocked in the readonly shell. Refuse a missing seccomp helper instead of allowing a host service to change state on the command's behalf. Linux hosts that refuse the helper's nested namespaces cannot run readonly shell commands.
- Correct Benny's credential-isolation gate. Readonly children still inherit environment variables and can read credential files. Setup fails closed without separate isolation, and operational runs keep analysis and code work in the coordinator when isolation is unavailable.

## [0.15.36-pi.12] - 2026-11-04

Each item below was checked against Cursor CLI 2026.10.22 with pstack and cursor-team-kit loaded, through its bundle and live runs. `parity/pi-pstack-behavior-parity/` in the repository records the evidence and the decisions.

- A mode keeps its skill in context on every request until the user leaves it, as a Cursor Custom Mode does, and sends Cursor's notices: entered, the per-turn reminder, and an exit or switch notice once. The previous version sent the body on one request only, so models that replay the system prompt lost it.
- A background completion arrives as Cursor's system notification: its preamble, a title from the first line of the prompt (80 characters at most), and its follow-up request. The background launch text and the Agent ID line use Cursor's wording.
- Task, TodoWrite, and AskQuestion descriptions carry Cursor's usage rules, and AskQuestion needs two options per question. The model list adds Cursor's rules for user-requested models.
- Add Cursor's built-in `explore` subagent type, a file-search specialist with Pi's search tools and no Task tool. team-kit's thermo-nuclear agent text, which names it, is upstream's again.
- Every subagent hears Cursor's reminder that it runs under a parent and spawns no subagents unless asked.
- Add `GenerateImage`, Cursor's image tool, on Pi's image models. It is offered when an image model is available and saves each image to the session's artifacts folder. `teach` asks for the image tool again, as upstream does.
- Stop attaching `typescript-best-practices` when a `.ts` file is read. Cursor loads a skill that sets `paths` and `disable-model-invocation` only when invoked by name.
- Plan mode follows Cursor's: its instructions, `CreatePlan {plan, name, overview, todos}` writing Cursor's plan file, edits to markdown files only, `SwitchMode` with the user's consent, and a build-locally, build-in-a-worker, or propose-changes choice after a saved plan. `create_plan` is gone.
- A `/loop` wake that comes due during a run fires once when the run settles. A fixed tick was dropped before, and an agent-paced wake that landed during another run stopped the loop.
- `make-bot-ui` describes webhook routines as they behave: no default expiry, and `sessionStrategy: "new_session"` for webhooks.

## [0.15.36-pi.11] - 2026-11-04

- Title a background completion notice with the Task `description`, as Cursor names a subagent, instead of a slice of its prompt.
- Stream a foreground Task's last tool steps and latest line into its card while the child works, the way Cursor shows conversation steps.
- `/loop` accepts the interval first or last, in unit words (`10 minutes`, `every 10 minutes`), prints usage for a bare command, and keeps wall-clock cadence so a long run does not delay the next tick.
- A bare `/plan` enters plan mode as Cursor's plan command does, and plan mode keeps `stop_agent` so a launched child can be stopped.
- Attach a skill whose frontmatter declares `paths`/`globs` (including the shipped `typescript-best-practices`) when the session reads or edits a matching file, once per session.
- Inject the shipped always-applied engineering rules as their full text instead of a paraphrase.
- Put the current todo list in every request's system prompt so compaction and branch switches do not drop it.
- Start `cloud_base_branch` from `origin/<branch>` when that ref exists, falling back to a local ref.
- Say that a resume ignores a supplied `subagent_type` instead of dropping it silently.
- Record a detached `new_session` fire's own final message as its run output in `list_subscriptions`.
- Restore the upstream Benny commit-before-enable gate and sweep from the last successful sweep so downtime does not lose reports.
- Restore the architect runner prompt's independence sentence, describe `visualize` as a bar or line chart, and deliver screenshots and video the way Pi can.
- A webhook routine accepts `sessionStrategy: "new_session"`, so an accepted POST runs detached with no chat open, as a Cursor Automation does, and records its outcome. Older stored routines keep `wake_self`.
- A timer or webhook routine no longer expires after seven days. Cursor defines no automation expiry, so `expiresInHours` is the only limit; `0` means none, and a GitHub watch keeps its 7-day default.
- Each workspace binds its own routines port: a busy default falls back to an ephemeral port the workspace reuses and reports, while an explicit `PSTACK_ROUTINES_PORT` still reports a collision.
- A mode attaches its skill body on the request that enters it and sends a path-naming reminder on later requests, as Cursor's Custom Mode does, instead of re-sending the whole body every turn.
- Plan mode saves a `.plan.md` artifact through `create_plan`, and `/plan build` starts the work from the saved file.

## [0.15.36-pi.10] - 2026-11-03

- Resume and fork a descendant that a worktree worker started inside its worktree, from the root chat, while keeping unrelated-directory records refused.
- Recover a steering message stranded at settlement with its recorded images and its own message boundary instead of joining text and dropping attachments.
- Refuse a new subscription event with HTTP 503 and `Retry-After` when 20 events are undelivered, instead of evicting an event the sender was told was accepted.
- Keep accepted `new_session` work eligible after the subscription expires; expiry only stops new occurrences.
- Run a `new_session` timer on the model, thinking level, and project-trust decision it was created with, live or detached.
- Append Task settle-time notices to entries another extension proposed at the same boundary.
- Signal a pre-epoch supervisor lock only when its command line identifies this supervisor, so a reused pid cannot target an unrelated process.
- Report durable subscriptions and detached supervision in the host section instead of saying they live only in the current Pi process.

## [0.15.36-pi.9] - 2026-11-03

- Follow the repository Vitest rules in the test suite. No runtime change.
- Correct stale documentation against the current code, including versions, counts, paths and host requirements.

## [0.15.36-pi.8] - 2026-11-02

- Declare `cost.totalFromProvider` on the exported `Usage` type so the package typechecks again, completing the provider-reported cost provenance aggregation shipped in 0.15.36-pi.7.

## [0.15.36-pi.7] - 2026-11-02

- Update the host compatibility documentation for Pi 1.5.0. Retain the four native gaps for RPC process control, skill-block formatting, named-ID fork truncation, and workspace folder naming.
- Keep earlier verification records unchanged. This documentation audit does not claim new runtime-test results or complete upstream parity.
- Preserve string-enum argument shapes and optional literal types with TypeBox schemas under Pi 1.5.0 validation.
- Preserve provider-reported cost provenance when aggregating subagent usage.
- Ship a versioned package-root changelog entry for Pi 1.5.0's extension update notices.

## [0.15.36-pi.6]

- Implement version-2 durable subscription registry with transactional file locking, native owner continuation delivery via `pi.sendMessage`, bounded exponential retry on detached failures, per-subscription queue caps, non-blocking GitHub arming, legacy supervisor termination, and in-process fallback isolation.
- Decode child RPC stdout streams using `StringDecoder` to preserve split multibyte UTF-8 code points across buffer boundaries.
- Publish upstream pstack git commit provenance in `pstackSource` and exclude nested script dependencies from npm publication archives via `skills/.npmignore`.
- Canonicalize statechart symlink test fixture paths on macOS and add checksum-verified TLC statechart verification to CI.

## [0.15.36-pi.5]

- Replace hand-rolled frontmatter, attachment MIME, and session header parsers with Pi 1.4.0 exports (`stripFrontmatter`, `detectSupportedImageMimeTypeFromFile`, and `parseSessionEntries`).
- Register TUI message renderers for `pstack/task` and `pstack/subscription`, drain parked `runtime/inbox/` wakes on session restore, surface durable delivery state in `list_subscriptions`, and report live supervisor status in `/routines`.
- Declare published `files` in `package.json`, record the REA architecture reconstruction report in `docs/parity-reverse-engineering.md`, and enforce zero dependencies on an external `pstack` checkout.

## [0.15.36-pi.4]

- Add a durable routines supervisor (`pstack-routines-supervisor`) that dual-writes subscription desired state and auto-starts on `subscribe_*` so timers and webhook routines keep firing after the interactive chat exits. Optional launchd/systemd examples live under `packaging/`.
- Add `packaging/install-supervisor-unit.sh` for opt-in reboot survival (idempotent launchd or systemd user unit). Benny setup and the overnight guide point at it.
- Teach `/ketchup-video` and the host media section to open the rendered mp4 in the system player, read one frame per slide, and name the path (Pi chat does not inline-play video).
- Expand the vendored `create-skill` soft-dep to full interview and structure depth with Pi paths.

## [0.15.36-pi.3]

- Vendor the full soft-dependency team-kit skill and agent set into the package (CI, PR, review, verification, weekly summary, and the two engineering rules as skills), so pi-pstack no longer needs a separate team-kit install for parity.
- Inject the two former always-apply engineering rules into the host system prompt, and teach the thermo-nuclear agent to gather diffs with Pi tools instead of inventing `shell` / `explore` Task types.
- Keep Claude Code harness notes out of the package (Pi users get `docs/native-gaps.md` instead).

## [0.15.36-pi.2]

- Add repository, homepage, and bugs metadata and a changelog to the npm package.
