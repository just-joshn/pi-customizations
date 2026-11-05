# Changelog

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
