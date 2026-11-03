# Parity status

This page records what `pi-pstack` reproduces from Cursor `pstack` 0.15.36 and its dependencies, what it translates to a native Pi mechanism, and what remains a host difference. It is a status record, not a claim that every workflow has been observed on both hosts.

## Sources

- Cursor `pstack` and `cursor-team-kit`: `github.com/cursor/plugins` at `6ea74587e384e1a8035c09ae33a46fe3f881eb9b`. The plugin manifest reports pstack 0.15.36.
- Installed Cursor CLI at the time of the reference capture: `2026.10.22-27dcf5f`.
- Native implementation: this package, which pins its upstream provenance in `package.json.pstackSource`.

A path and byte comparison of the tracked trees shows every pstack skill, both pstack agents, all 18 team-kit skills, both team-kit agents, and both team-kit rules in this package. Seventeen team-kit skill files are byte-identical; `workflow-from-chats` describes Pi paths instead of Cursor paths. The changed pstack files are host translations, not content removals.

## Native translations

| Cursor dependency | Pi mechanism |
| --- | --- |
| Skill invocation and the slash menu | `pi.getCommands()` plus `/name` to `/skill:name` input rewriting, with TUI completions |
| Custom Mode | `/mode <skill>`, a branch-persisted entry, and a `pstack_mode` prompt section on every request |
| Plan mode | `/plan`, a reduced tool set, and `bash_readonly` in an OS sandbox |
| Always-applied model rule | `pstack-models.md` read before every request and injected as `pstack_models` |
| Task subagents | One `pi --mode rpc` process per agent, with resume, steer, fork, `fork_turns`, readonly, attachments, background notices, and local worktrees |
| Agent types | The four bundled agent Markdown files, loaded into the child system prompt |
| Project and agent stores | Workspace state folders named in the host system prompt |
| Todo list | `TodoWrite` with branch reconstruction and a TUI widget |
| Structured questions | `AskQuestion` over Pi select and input dialogs |
| `/loop` | `Loop` tool and `/loop` command driven by `agent_settled` |
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

## Repairs in 0.15.36-pi.10

Each item has a regression in the package suite.

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
