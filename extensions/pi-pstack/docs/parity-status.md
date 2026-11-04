# Parity status

This page records what `pi-pstack` reproduces from Cursor `pstack` 0.15.36 and its dependencies, what it translates to a native Pi mechanism, and what remains a host difference. It is a status record, not a claim that every workflow has been observed on both hosts.

## Sources

- Cursor `pstack` and `cursor-team-kit`: `github.com/cursor/plugins` at `6ea74587e384e1a8035c09ae33a46fe3f881eb9b`. The plugin manifest reports pstack 0.15.36. `package.json.pstackSource.revision` pins `ae5650fe`, this port's capture base; `git log ae5650fe..6ea74587 -- pstack cursor-team-kit` is empty, so both commits name the same plugin content.
- Installed Cursor CLI at the time of the reference capture: `2026.10.22-27dcf5f`.
- Native implementation: this package, which pins its upstream provenance in `package.json.pstackSource`.

A path and byte comparison of the tracked trees shows every pstack skill, both pstack agents, all 18 team-kit skills, both team-kit agents, and both team-kit rules in this package. Seventeen team-kit skill files are byte-identical; `workflow-from-chats` describes Pi paths instead of Cursor paths. The changed pstack files are host translations. One upstream paragraph has no counterpart: `poteto-help`'s Claude Code install path and its `docs/harness/claude-code.md` adapter, because this package targets Pi only. The two non-portable frontmatter keys Cursor ships (`icon`/`color` on `poteto-mode`, `paths` on `typescript-best-practices`) are kept under `metadata`, the Agent Skills extension point; the port reads both, and it attaches `typescript-best-practices` by path through `src/path-skills.ts`.

## Native translations

| Cursor dependency | Pi mechanism |
| --- | --- |
| Skill invocation and the slash menu | `pi.getCommands()` plus `/name` to `/skill:name` input rewriting, with TUI completions |
| Custom Mode | `/mode <skill>`, a branch-persisted entry, the skill attached once on the entering request, and a path-naming reminder in a `pstack_mode` prompt section on every later request |
| Plan mode | `/plan`, a reduced tool set, `bash_readonly` in an OS sandbox, a `create_plan` artifact under `plans/`, and `/plan build` |
| Always-applied model rule | `pstack-models.md` read before every request and injected as `pstack_models` |
| Task subagents | One `pi --mode rpc` process per agent, with resume, steer, fork, `fork_turns`, readonly, attachments, background notices, and local worktrees |
| Agent types | The four bundled agent Markdown files, loaded into the child system prompt |
| Project and agent stores | Workspace state folders named in the host system prompt |
| Todo list | `TodoWrite` with branch reconstruction and a TUI widget |
| Structured questions | `AskQuestion` over Pi select and input dialogs |
| `/loop` | `Loop` tool and `/loop` command. A fixed interval is wall-clock from each fire, like Cursor's sleep loop, and accepts the interval first or last (`5m`, `10 minutes`, `every 10 minutes`). An interval-less loop is agent-paced through `Loop` `wake_in`. |
| Path-scoped skills | `src/path-skills.ts` attaches a loaded skill once per session when the session reads or edits a file matching its `paths`/`globs` (also under `metadata`), the way Cursor files a skill under `fileGlobbed` |
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
- **A mode carries its body once, then a reminder.** Cursor attaches the skill body on the turn that enters the mode and sends a path-naming reminder every turn after, in a user-message field. Pi rebuilds its prompt per request, so the body rides the first request after entry as a `pstack_mode` section and later requests carry the reminder. A process restart re-sends the body once, since the new process cannot know the conversation already saw it.
- **A fork needs an idle source.** Cursor exposes `fork` only on its internal and cloud-agent protos, never on the CLI Task schema, and no doc states whether a fork may start while the source runs. A Pi fork runs in the source's directory or worktree, so a running source is refused; the orchestrate playbook says to wait for its completion notification.
- **Plan mode's restriction is stricter than the host's.** Cursor's inspected CLI carries no client-side plan-mode filter, and its docs recommend stating read-only intent in the prompt, so the restriction on that surface is prompt or backend side; no source shows a plan-mode network rule. Pi enforces a tool allowlist and a sandboxed shell that also denies network, so `gh`, `curl`, and package queries can fail while planning.
- **No host-managed plan review UI.** The plan is a file the agent writes with `create_plan`, and `/plan build` starts the work from it. Cursor also renders a plan review menu with "build locally", "build in cloud", and "no, propose changes", and can hand the plan to a cloud agent. Pi has no equivalent UI, and its plan review is the file plus the reply.
- **benny's default cadence still needs its owning session open.** `wake_self` timers and webhook routines park while the owner is offline. A timer or webhook routine created with `sessionStrategy: "new_session"` runs detached with no chat open, but a detached run is one-shot: it must do the work in that run, because a background `Task` ends with it. Cursor automations run in the cloud and can hand work to anything. So benny keeps `wake_self` by default and setup names the tradeoff before switching.
- **A routines listener is local, one port per workspace.** Cursor hosts each routine URL. Pi binds a loopback port per workspace, so two workspaces serve routines at once only because the default port falls back to an ephemeral one that the workspace then reuses and reports. A sender outside the machine still needs its own forwarding path.
- **Cloud execution is local.** Cursor documents cloud VMs for its cloud product, but the inspected CLI schema omits `environment` and a requested cloud Task ran on the same machine and directory. Pi's `environment: "cloud"` goes further with a git worktree and a separate local process. Neither runs with the laptop off or provides a remote VM.
- **Webhook routines are local.** Cursor provides a hosted routine endpoint and an editor panel. Pi serves an authenticated listener on loopback and stores a sender key in a local file. A sender outside the machine needs its own forwarding path.
- **Slack-triggered automations need an external sender.** The Benny workflows can sweep on a timer or receive a local webhook. The Cursor Automations product and its Slack trigger are not reproduced.
- **Inline video is not rendered in the reply.** The ketchup-video workflow writes the video and names its path; Pi opens it in the system player instead.
- **Video attachments have no Pi model input.** Cursor can attach video to a Task. Pi names the video path for the agent instead of decoding the file as text; the agent opens it with a media tool.
- **Hosted guidance and pages are outside the package.** MCP providers, ticket trackers, browsers, simulators, and Tailscale remain the user's own dependencies, as they are for Cursor.
- **Background usage cannot enter parent totals.** Pi exposes no API that adds a later notification's usage to the parent session. It stays in the notification details and the child transcript.

## Open evidence

The following were not observed end to end and are not claimed.

- A real model following every ported skill on both hosts.
- Authenticated MCP exchanges and provider-specific tool behavior.
- A successful live Cursor run for each workflow after the reference capture.
- Reboot survival through a real launchd or systemd unit on both platforms.
- Multi-workspace webhook routing.
- Exactly-once external actions in Benny workflows.

Passing package tests show the extension contracts hold. They do not replace those observations.
