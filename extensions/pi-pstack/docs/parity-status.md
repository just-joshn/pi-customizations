# Parity status

This page records what `pi-pstack` reproduces from Cursor `pstack` 0.15.36 and its dependencies, what it translates to a native Pi mechanism, and what remains a host difference. It is a status record, not a claim that every workflow has been observed on both hosts.

## Sources

- Cursor `pstack` and `cursor-team-kit`: `github.com/cursor/plugins` at `6ea74587e384e1a8035c09ae33a46fe3f881eb9b`. The plugin manifest reports pstack 0.15.36. `package.json.pstackSource.revision` pins `ae5650fe`, this port's capture base; `git log ae5650fe..6ea74587 -- pstack cursor-team-kit` is empty, so both commits name the same plugin content.
- Installed Cursor CLI at the time of the reference capture: `2026.10.22-27dcf5f`.
- Native implementation: this package, which pins its upstream provenance in `package.json.pstackSource`.

A path and byte comparison of the tracked trees shows every pstack skill, both pstack agents, all 18 team-kit skills, both team-kit agents, and both team-kit rules in this package. Sixteen team-kit skill files are byte-identical. `workflow-from-chats` describes Pi paths instead of Cursor paths, and `pr-review-canvas` opens a system browser instead of Cursor's in-app browser. The changed pstack files are host translations. One upstream paragraph has no counterpart: `poteto-help`'s Claude Code install path and its `docs/harness/claude-code.md` adapter, because this package targets Pi only. The two non-portable frontmatter keys Cursor ships (`icon`/`color` on `poteto-mode`, `paths` on `typescript-best-practices`) are kept under `metadata`, the Agent Skills extension point. The port reads `icon` and `color` for the mode badge. `paths` stays as metadata only, because Cursor loads a `paths` skill that sets `disable-model-invocation` only when it is invoked by name. team-kit's thermo-nuclear agent changes only where it names the plugin that ships its rubric.

## Native translations

| Cursor dependency | Pi mechanism |
| --- | --- |
| Skill invocation and the slash menu | `pi.getCommands()` plus `/name` to `/skill:name` input rewriting, with TUI completions |
| Custom Mode | `/mode <skill>`, a branch-persisted entry, the skill in a `pstack_mode_skill` prompt section on every request while the mode is on, and Cursor's entered, reminder, and exit or switch notices in `pstack_mode` |
| Plan mode | `/plan` and `SwitchMode`, Cursor's plan-mode instructions in `pstack_plan`, a reduced tool set with `bash_readonly` in an OS sandbox and markdown-only `edit` and `write`, `CreatePlan` writing Cursor's plan file under `plans/`, and a build prompt after a saved plan (`/plan build` too) |
| Always-applied model rule | `pstack-models.md` read before every request and injected as `pstack_models` |
| Task subagents | One `pi --mode rpc` process per agent, with resume, steer, fork, `fork_turns`, readonly, attachments, Cursor's result and completion texts, Cursor's subagent reminder, and local worktrees |
| Agent types | Cursor's built-in `generalPurpose` and `explore`, then the four bundled agent Markdown files, loaded into the child system prompt |
| Project and agent stores | Workspace state folders named in the host system prompt |
| Todo list | `TodoWrite` with branch reconstruction and a TUI widget |
| Structured questions | `AskQuestion` over Pi select and input dialogs, with Cursor's schema minimums and usage rules |
| Image generation (`GenerateImage`) | `GenerateImage` on `ctx.modelRegistry.generateImages()`, offered when an image model is available |
| `/loop` | `Loop` tool and `/loop` command. A fixed interval is wall-clock from each fire, like Cursor's sleep loop, and accepts the interval first or last (`5m`, `10 minutes`, `every 10 minutes`). An interval-less loop is agent-paced through `Loop` `wake_in`. A wake that comes due mid-run fires once when the run settles, as Cursor's monitored shell output notifies after the turn. |
| Path-scoped skills | None needed. pstack's only `paths` skill also sets `disable-model-invocation`, and Cursor loads such a skill only by name, which Pi does natively |
| Always-applied rules | The two shipped rule bodies are read into `pstack_host` verbatim on every request, not paraphrased |
| Todo list state | `TodoWrite` writes branch entries, and the current list rides in the `pstack_todos` prompt section on every request, so a compacted context still sees it |
| Automations | Durable timer, GitHub, and webhook subscriptions with a detached supervisor |
| `/visualize` | `visualize` tool that returns a Unicode chart and writes an SVG |
| Benny automation pack | The same text workflows, run through subscriptions instead of the Cursor Automations editor |

## Reference observations

A live Cursor CLI session with both plugins loaded produced these contracts.

- A foreground `Task` call returned the child's final text, an agent ID, `isBackground: false`, and a duration.
- A background `Task` call returned `isBackground: true` with no conversation steps, then delivered a completion message naming the title and agent ID. The parent turn resumed from that message.
- `Task` arguments included `description`, `prompt`, `subagentType`, `model`, `agentId`, `attachments`, `mode`, `environment`, and `machine`.
- The CLI's model-facing `Task` schema exposes only `description`, `prompt`, `model`, `resume`, `subagent_type`, `file_attachments`, and `run_in_background`. It does not expose `readonly`, `environment`, `cloud_base_branch`, `fork`, or `fork_turns`, so those pstack arguments are inert in that CLI. A live Task started with `readonly: true` wrote a file, which confirms the CLI did not enforce it.
- Pi exposes those arguments and enforces `readonly`, because the pstack skills use it to keep explorers and reviewers from editing. That is a deliberate correction of the host gap, not literal reproduction of it.
- A live Task asked for `environment: "cloud"` ran in the same working directory on the same machine, with `environment: SUBAGENT_EXECUTION_ENVIRONMENT_UNSPECIFIED`. In this CLI, the cloud argument was inert too. Pi's local worktree is a stronger isolation than that observation, though still weaker than the documented cloud VM.

Pi returns the child's final text with a transcript path and usage, and reports background completion as a `pstack/task` notification. The payload shape differs because the hosts are different; the observable workflow, a subagent result arriving after the parent turn, is preserved.

## Repairs in 0.15.36-pi.14

An independent audit on 2026-11-04 compared every reference file and probed Cursor CLI 2026.10.22 live. The repository's `parity/pstack-native-parity-2026-11-04/` holds the notes, decision log, inventory, and the scripts; `.audit/pstack-native-parity-2026-11-04/cursor/` holds the raw Cursor captures.

- **Background shells.** Cursor's `Shell` runs a command in the background (`block_until_ms: 0`, or after the wait runs out), writes `terminals/<id>.txt` with a status header and an exit footer, notifies after the turn when the command ends (`kind: shell`) and on each `notify_on_output` match (the first at once, later ones counted per debounce window), and `AwaitShell` polls, waits for a pattern, or sleeps. pstack leans on it: babysit's "watcher output drives wakeups", worktree-cleanup's "background it", pr-review-canvas's "run this backgrounded", and the event-gated branch of Cursor's `/loop`. pi-pstack had no background shell. `bash_background` and `AwaitShell` now reproduce the captured texts, header layout (173 bytes for the probed job), and notification shapes. Two choices differ from one observation each. A job whose end `AwaitShell` saw sends no completion notice, as Cursor's AwaitShell description promises, though one Cursor run sent a duplicate. A subagent's jobs stop when the subagent ends, because a Pi subagent is its own process; Cursor ran the job on and reported it `aborted` to the parent.
- **Linux read-only shell.** sandbox-runtime's seccomp helper needs a nested user namespace, which Ubuntu 24.04 and later refuse by default (`kernel.apparmor_restrict_unprivileged_userns=1`), so every readonly subagent on such a host had no shell. Cursor documents readonly as "no file edits, no state-changing shell commands", so read-only commands must work. Linux now runs `bwrap` directly with every namespace unshared, `/` bound read-only, and a generated seccomp filter (`bwrap --seccomp`) that refuses `socket(AF_UNIX)` and `io_uring_setup`. Writes, TCP, and Unix sockets stay refused; `git log` works. macOS keeps sandbox-runtime.
- **`/loop` arming.** Cursor's loop skill runs the prompt once when the loop is armed. The host section and the `Loop` tool now say to do that in the arming turn; the first scheduled run still comes after the interval or wake.
- **Subagents have no `AskQuestion`.** Cursor's generalPurpose subagent listed no such tool (`subagent-tools.jsonl`), and one asked to call it replied that it does not exist (`subagent-askquestion.jsonl`).
- **Today's date.** Cursor's user info states "Today's date" in every chat (`context-paths.jsonl`). Pi's system prompt has no date, so `pstack_host` now states it in the same form.
- **Long commands.** Cursor's `Shell` moves a command to the background after its 30-second foreground window. Pi's `bash` waits until the command ends, so the host section sends watchers, polling scripts, and servers to `bash_background`.
- **Text.** The architect runner prompt is upstream's again, and arena drops a port-assignment sentence and a `cloud` instruction that no host difference required. Arena keeps upstream's `composer-*`/`cursor-grok-*` family rule.

Observed, not changed: Cursor CLI 2026.10.22 does not load plugin rules (team-kit's two always-applied rules) or name an agent store or Projects in its context (`context-paths.jsonl`); pi-pstack keeps both, because pstack's text relies on them.

## Reconstruction repairs in 0.15.36-pi.13

The repository's `parity/pstack-reconstruction-2026-11-04/` holds the reference inventory, baseline and treatment receipts, and decision log. These repairs do not establish that every workflow has been observed on both hosts.

The pre-bump PR-preparation run, `pr-make-verify.txt`, exits at pi-pstack's coverage suite with 680 passing tests and five failing positive readonly-shell checks. Lint, typecheck, mechanisms, toolchain, and test conventions pass before that stop. No later package result is inferred. `pr-preparation.md` records the focused checks, local review, and publication redactions.

The later [Linux CI run at `83cf4d9b`](https://github.com/just-joshn/pi-customizations/actions/runs/41885522222/job/126768816594) passes all 685 package tests and 367 statechart tests on Ubuntu 24.04. This includes successful restricted commands and the host Unix-socket regression. The workflow pins Ubuntu 24.04 after `ubuntu-latest` selected Ubuntu 26.04 and the helper refused nested namespace setup. The sandbox policy and assertions are unchanged. This result does not resolve startup on Ubuntu 26.04 or replace the failed local full-repository receipt.

- Leading word intervals such as `/loop every 10 minutes check CI` set the cadence instead of becoming part of the submitted prompt. Interval extraction preserves internal newlines.
- Different loop prompts run independently. Each `Loop` result includes an ID in text and details. With several loops running, `loop_id` selects a wake, stop, or replacement, and `/loop stop <id>` selects a command-line stop. Re-arming the same prompt replaces its schedule. Real Pi RPC regressions observe both prompts repeating and one continuing after the other stops.
- Leaving a planning branch restores the pre-plan tools when Pi has no recorded system-message tool loadout to replay. Both the recorded and unrecorded cases run through real Pi tree navigation.
- `CreatePlan` preserves todo dependencies, `is_project`, and project phases in the plan file. Building loads unfinished root todos from that file, including review edits. Imported lists survive a Pi restart. Worktree builders import their own lists before their first model request and restore the plan association on resume. Writable `TodoWrite` updates synchronize matching root statuses while preserving quotes, comments, custom metadata, and the plan body. Readonly resumes update only the session list. `plan-worker-baseline.txt` and `plan-worker-treatment.txt` record the actual Pi RPC regression.
- A reviewed todo without a status imports as pending and now records later completion in the saved file. The synchronizer inserts only the missing field. Unit regressions cover block and flow mappings, trailing commas, and CRLF. An actual Pi RPC regression covers the same edit. `plan-missing-status-baseline.txt` and `plan-missing-status-treatment.txt` retain the failing and passing cases.
- Task stale-lock recovery uses the same token-directory lease as subscription ownership. A two-process regression forces the former check-to-remove race and observes one owner after the repair. Task status also treats an unreaped Linux zombie as exited rather than blocking recovery indefinitely. Older versions without the lease do not participate in this protection.
- `pr-review-canvas` names the system browser and `control-ui` instead of assuming Cursor's in-app browser. This is an instruction translation, not evidence that a real model completed a canvas review.
- A readonly Pi child reached a disposable Unix socket and caused its unsandboxed server to modify a file. The shell now keeps Unix sockets blocked and refuses a missing seccomp helper. The Linux host used for this audit refuses the helper's nested namespace setup, so the treatment proves failure-closed behavior, not successful restricted command execution. `readonly-boundary-baseline.txt`, `readonly-boundary-treatment.txt`, and `package-suite-readonly-strict.txt` retain the evidence. The latter has 675 passing tests and five failing positive shell checks. The earlier full repository pass predates this safety change.
- A fake Slack token remained readable in a readonly child's inherited environment. Benny's instructions now require separate credential isolation rather than inferring it from readonly tools. Setup stops without that proof, and operational runs keep analysis and code work in the coordinator. This instruction repair is not a live Slack integration test.

## Repairs in 0.15.36-pi.12

A fresh reverse engineering of Cursor CLI 2026.10.22 with pstack and cursor-team-kit loaded found these differences. The repository's `parity/pi-pstack-behavior-parity/` holds the findings, the decision trail, and `probe-cursor.sh`, which reruns every Cursor probe. Each change has a test that failed on the earlier code.

- A Custom Mode keeps its skill in context for the whole session in Cursor (its docs, and `durable_skill_blocks` in the CLI's conversation state). pi-pstack sent the body on one request, so a model that replays the system prompt lost it after a turn. The skill now rides every request, and Cursor's exit and switch notice is sent once after a mode ends.
- A background completion uses Cursor's `<system_notification>` text, a title from the prompt's first line (80 characters at most), and its follow-up request; the launch text and Agent ID line use Cursor's words. An earlier repair had titled it by `description`, which Cursor shows in its UI but not in the model-facing notice.
- Task, TodoWrite, and AskQuestion carry Cursor's usage rules; AskQuestion needs two options per question.
- `explore` exists, and every subagent hears Cursor's subagent reminder. team-kit's thermo-nuclear agent text is upstream's again.
- `GenerateImage` exists on Pi's image models. pstack's `teach` and `ketchup` reach for an image tool, which codemode, off by default, did not provide.
- The path-skills module is gone. A live probe showed Cursor never surfaces a `paths` skill that sets `disable-model-invocation`, which is `typescript-best-practices`.
- Plan mode follows Cursor's instructions and `CreatePlan` contract, allows markdown edits, offers `SwitchMode`, and asks whether to build a saved plan.
- A `/loop` wake that comes due mid-run fires once after the run instead of being dropped, which had also stalled agent-paced loops.

## Repairs in 0.15.36-pi.11

Each code change has a regression in the package suite. Text restorations are recorded here and checked against the reference by the parity audit.

- A background completion notice names the subagent by its `description`, the field the Task schema says names it in the UI, instead of 200 characters of prompt. Cursor's own completion block puts the child's prompt in its `title` field; this notice keeps both the name and a prompt excerpt.
- A foreground Task streams its child's last tool steps and latest line into the running card, throttled and capped, instead of showing a blank wait until the child settles.
- `/loop` accepts the interval at either end and in unit words (`10 minutes`, `every 10 minutes`), and a bare `/loop` prints usage. A fixed loop keeps wall-clock cadence, so a long run no longer pushes the next tick out.
- A bare `/plan` enters plan mode, as Cursor's plan command does, and plan mode keeps `stop_agent` so a launched child can still be stopped.
- Rules that declare `paths`/`globs` attach on Pi when a matching file is read or edited, once per session.
- The always-applied engineering rules are injected as their shipped text, including "interface fields" and "strict circular-dependency reason".
- The todo list is in every request's system prompt, so compaction and a branch switch do not leave the model without it.
- `cloud_base_branch` starts from `origin/<branch>` when that ref exists, as a cloud worker sees only pushed code, and falls back to a local ref.
- A resume that names a `subagent_type` keeps the recorded type and says the parameter was ignored.
- A detached `new_session` fire records its own final message as the run output, so `list_subscriptions` shows what the run said instead of `detached run completed`.
- benny restores the upstream requirement that the pack and referenced configuration are committed before a subscription is enabled, and a sweep reads from the last successful sweep so downtime does not lose reports.
- The architect runner prompt restores "What matters is independence between candidates."
- `/ketchup` describes the `visualize` tool as a bar or line chart and delivers screenshots and video the way Pi can (read the image, open the video, name the path).
- A webhook routine accepts `sessionStrategy: "new_session"`, so an accepted POST starts a fresh detached run with no chat open, the way a Cursor Automation runs, and records its outcome in `list_subscriptions`. Records written before this field existed still load and behave as `wake_self`. Evidence: `test/e2e/subscription-owner.e2e.test.ts` runs the real Pi CLI with the owner closed, POSTs to the bound listener, and finds the detached run's file and its recorded outcome.
- A timer or webhook routine no longer expires after seven days. Cursor's automation docs define no expiry and describe "always-on agents"; the closest documented cap, 180 days, belongs to cloud agent subscriptions, a different surface. `expiresInHours` still sets one, `0` means none, and a GitHub watch keeps its 7-day default because it is this port's own surface.
- Each workspace binds its own routines port. With no explicit port, a busy default falls back to an ephemeral port that the workspace reuses and reports in the routine URL, so two workspaces serve routines at once. An explicit `PSTACK_ROUTINES_PORT` still reports a collision as an error. Evidence: the two-workspace case runs two real Pi sessions and supervisors in `test/e2e/subscription-owner.e2e.test.ts`.
- A mode now matches Cursor's injection. The skill body rides the first request after entry as the same `<skill>` block Pi's own `/skill:name` expansion builds, addressed with Cursor's entry notice, and every later request carries Cursor's reminder shape, which names the skill file. The mode re-sends the body after a restart. Evidence: `test/e2e/mode.e2e.test.ts` reads the real system prompt on the entering turn, on the next turn, and after a restart.
- Plan mode saves an artifact. A `create_plan` tool writes the plan to `<pstack dir>/plans/<title>-<id8>.plan.md`, the file name shape Cursor uses, and records it on the branch. `/plan build` leaves plan mode and sends the file's content as the next turn, which is Cursor's "Yes, build locally" path without its review menu. Evidence: `test/e2e/plan.e2e.test.ts` drives the real CLI through `/plan`, the tool call, and `/plan build`.

## Repairs in 0.15.36-pi.10

Each code change has a regression in the package suite. Text restorations are recorded here and checked against the reference by the parity audit.

- The root chat can resume and fork a descendant that a worktree worker started inside that worktree. Unrelated directories remain refused. New records store the owning workspace root; older records are recognized by this workspace's worktree folder.
- A steering message stranded at settlement is resumed with its recorded images and keeps its own message boundary, instead of joining cleared text and dropping attachments.
- A full subscription queue refuses a new event with HTTP 503 and `Retry-After` instead of evicting an event already acknowledged with 200.
- Accepted `new_session` work stays eligible after expiry, so expiry stops new occurrences without stranding accepted work.
- Task's settle-time notification appends to entries another extension proposed at the boundary instead of replacing them.
- A `new_session` timer reuses the model, thinking level, and project trust it was created with, whether its owner is live or detached.
- The upstream `ci-watcher` `model: fast` is restored; `fast` picks the parent model's listed `-fast` variant, else the parent model.
- A pre-epoch supervisor lock is signaled only when its command line identifies this supervisor, so a reused pid cannot terminate an unrelated process.

## Remaining host differences

These are not closed by extension code.

- **Background workers stop when the chat exits.** A Pi subagent is a child process of the chat, so quitting or shutting the session stops the agents it started and reports how many. Whether a Cursor background subagent outlives its parent is unobserved; the CLI changelog says cancelling the prompt stops its subagents, and only the cloud-agent product promises work after the laptop closes. A `new_session` subscription fire is Pi's one detached path, and it starts a fresh run rather than continuing a subagent.
- **A mode's skill rides the system prompt.** Cursor attaches the skill to the user message that enters the mode and keeps it durable in the conversation; its notices travel in user-message fields. Pi carries the skill and the notices in system-prompt sections, which reach the model on every request and survive compaction, so the model sees the same text in a different place.
- **A fork needs an idle source.** Cursor exposes `fork` only on its internal and cloud-agent protos, never on the CLI Task schema, and no doc states whether a fork may start while the source runs. A Pi fork runs in the source's directory or worktree, so a running source is refused; the orchestrate playbook says to wait for its completion notification.
- **A subagent's background shells end with it.** Cursor runs a subagent inside the parent process, so a background shell it starts outlives the subagent's Task result and its notification reaches the parent (`subagent-bg-shell.jsonl`, status `aborted`). A Pi subagent is its own process, so its jobs stop when it finishes, and its launch result says so.
- **Linux readonly shells need bubblewrap.** The policy blocks host Unix sockets as well as IP traffic and filesystem writes. bubblewrap must be able to create its user namespace (Ubuntu's `bwrap` AppArmor profile allows it); where it cannot, or on an architecture other than x86-64 or arm64, the command does not run. Readonly also does not isolate environment credentials or files readable through the ordinary read tools.
- **Plan mode's restriction is stricter than the host's.** Cursor's plan mode keeps every tool and restricts by instruction: edit only markdown files, run only read-only commands. Pi enforces the same rules with a tool allowlist, markdown-only `edit` and `write`, and a sandboxed shell that also denies network, so `gh`, `curl`, and package queries can fail while planning. Allowing network in a read-only shell would also open a path for remote changes, so the sandbox keeps it closed.
- **The plan review is a dialog, not a card.** Cursor renders the plan with a build menu. Pi shows the same three choices in a select dialog after the run that saved the plan, and "build in cloud" starts a background isolated worktree worker, Pi's counterpart to a cloud agent, rather than a remote VM.
- **benny's default cadence still needs its owning session open.** `wake_self` timers and webhook routines park while the owner is offline. A timer or webhook routine created with `sessionStrategy: "new_session"` runs detached with no chat open, but a detached run is one-shot: it must do the work in that run, because a background `Task` ends with it. Cursor automations run in the cloud and can hand work to anything. So benny keeps `wake_self` by default and setup names the tradeoff before switching.
- **A routines listener is local, one port per workspace.** Cursor hosts each routine URL. Pi binds a loopback port per workspace, so two workspaces serve routines at once only because the default port falls back to an ephemeral one that the workspace then reuses and reports. A sender outside the machine still needs its own forwarding path.
- **Cloud execution is local.** Cursor documents cloud VMs for its cloud product, but the inspected CLI schema omits `environment` and a requested cloud Task ran on the same machine and directory. Pi's `environment: "cloud"` goes further with a git worktree and a separate local process. Neither runs with the laptop off or provides a remote VM.
- **Webhook routines are local.** Cursor provides a hosted routine endpoint and an editor panel. Pi serves an authenticated listener on loopback and stores a sender key in a local file. A sender outside the machine needs its own forwarding path.
- **Slack-triggered automations need an external sender.** The Benny workflows can sweep on a timer or receive a local webhook. The Cursor Automations product and its Slack trigger are not reproduced.
- **Inline video is not rendered in the reply.** The ketchup-video workflow writes the video and names its path; Pi opens it in the system player instead.
- **Video attachments have no Pi model input.** Cursor can attach video to a Task. Pi names the video path for the agent instead of decoding the file as text; the agent opens it with a media tool.
- **Hosted guidance and pages are outside the package.** MCP providers, ticket trackers, browsers, simulators, and Tailscale remain the user's own dependencies, as they are for Cursor.
- **Background usage cannot enter parent totals.** Pi exposes no API that adds a later notification's usage to the parent session. It stays in the notification details and the child transcript.

## Session probes on 2026-11-04 (continuation)

These observations update earlier open notes. They do not make the package VERIFIED.

- Cursor's live `TodoWrite` accepted a one-item write even though the published schema sets `minItems: 2` and requires `content` and `status` on every item. Pi keeps `minItems: 1` and status-only merges, which matches that runtime behavior. Evidence: this session's `CallDynamicTool` one-item call, plus `test/e2e/todo.e2e.test.ts` merge updates.
- On this Linux host, `kernel.apparmor_restrict_unprivileged_userns=1`. Socket-restricted sandbox commands fail in `apply-seccomp` while writing `/proc/self/setgroups`. The same sandbox with `allowAllUnixSockets: true` runs under bubblewrap and denies writes. Docker and passwordless sudo were unavailable here, so the positive restricted path remains a host blocker. CI on Ubuntu 24.04 still owns that green path.
- Benny operational skills now resolve `SOURCE_THREAD_TS` from `thread_ts`, then `message_ts`, then `ts`, so the documented webhook payload works when `thread_ts` is empty. Upstream Cursor skills still name only `trigger.ts`. Completeness audit: `parity/pstack-reconstruction-2026-11-04/session-2026-11-04T19-completeness.json`.
- The sibling `cursor-sdk` plugin remains out of scope. No pstack skill or agent references it.

## Open evidence

The following were not observed end to end and are not claimed.

- A real model following every ported skill on both hosts.
- Cursor's project-phase execution UI and per-phase build behavior. Pi preserves phase metadata but does not reproduce that UI.
- Hosted cloud plan execution's full todo lifecycle and simultaneous independent builders updating one plan. Native worktree startup, resume, dependency retention, writable status synchronization, and readonly non-synchronization have actual Pi RPC evidence.
- Authenticated MCP exchanges and provider-specific tool behavior.
- A successful live Cursor run for each workflow after the reference capture.
- Reboot survival through a real launchd or systemd unit on both platforms.
- Multi-workspace webhook routing.
- Exactly-once external actions in Benny workflows.

Passing package tests show the extension contracts hold. They do not replace those observations.
