# pstack complete parity run (2026-11-05)

Goal: pi-pstack reproduces every behavior Cursor pstack 0.15.36 delivers, including what it gets from cursor-team-kit and from the Cursor host, through Pi-native mechanisms only. No subagents (operator order); all investigation, design, implementation, and review done in this chat.

## Reference pins

- cursor/plugins: local checkout `/Users/josh-desktop/src/experiments/plugins` at `bb68f2365eceafa0cb2d253112f675acf5f144cc`; upstream main `2776ddd2355d6d6c8747d3964600f28daf62f049` has no change under `pstack/`, `cursor-team-kit/`, or `pr-review-canvas/` (git log bb68f23..origin/main empty for those paths).
- pstack 0.15.36 (last change `c742dd61706fbacc1b95f1a20b7b988cf096ce6c`); cursor-team-kit 1.2.0 (last change `2b8ae2ee306f823d54879d3da7f8496b73c31d5d`).
- Installed Cursor plugin cache: `~/.cursor/plugins/cache/cursor-public/pstack/ae5650febf4320793844c12c4adaa937f417f8da` (no team-kit in cache).
- Cursor CLI `2026.10.22-27dcf5f` at `~/.local/share/cursor-agent/versions/2026.10.22-27dcf5f`, logged in.
- Cursor built-in skills synced to `~/.cursor/skills-cursor/` (loop, canvas, create-skill, autopilot, origin, ...).
- Pi 1.5.0 at `~/.pi/agent/install/releases/1.5.0`. Host: macOS 27.2 arm64. OrbStack installed (Docker context `orbstack`, daemon stopped at start).
- Repository start: `9ee6394b` (pi-pstack 0.15.36-pi.18).

## Discovery methods used

1. Tree map of every tracked reference file against pi-pstack (`tree-map.mjs`): pstack 499 identical, 70 changed, 4 absent; team-kit 20 identical, 5 changed, 4 absent.
2. Word-level change spans for every changed file (`word-changes.mjs`), read by hand.
3. Text scan of the pi-pstack copies for admissions of a missing capability ("not a VM", "unavailable", "Pi has no", "mark it blocked").
4. Cursor CLI bundle: ToolCall oneof (71 tool kinds), TaskArgs/SubagentArgs fields, internal MCP server names (`cursor-subscriptions`, `Cursor Slack Tools`, `Cursor Automation Tools`).
5. Cursor docs captured by the previous run (`.audit/pstack-parity-2026-11-05/cursor-docs/`).
6. Previous inventories used only as leads (`parity/pstack-parity-2026-11-05/host-dispositions.json`).

## Gap list (open at start of this run)

Text admissions in pi-pstack that a pstack behavior is missing, plus host mechanisms the earlier runs left as gaps:

- G1 cloud subagents: upstream text says each cloud worker runs on its own VM from pushed code and keeps running with the laptop closed (swarm, orchestrate, multi-phase-plan, autopilot-full, shipping, session-pickup, poteto-help, guide 02/07/10). pi-pstack rewrote those lines to "a git worktree on this machine, not a VM or credential boundary; report stronger isolation as unavailable". The Pi worker also dies with the chat.
- G2 Projects: persistent coordinator thread, tracker and store, cloud workers by default, PR/CI/Slack subscriptions.
- G3 Automations (benny): Slack new-top-level-message trigger, Slack read/reply tools, schedule trigger, memories, per-run checkout, `/automate` creation flow with draft review, approval, readiness, editor; enable after thread-safety test.
- G4 Routines (make-bot-ui): `update_state` create with confirm card, routine panel with URL and sender key, `SendToUser` secret-request card.
- G5 Subscriptions: cursor-subscriptions tool names (`subscribe_github_ci`, `subscribe_origin_ci`) and Slack channel listening.
- G6 Canvas and in-app browser (pr-review-canvas).
- G7 Inline screenshots and video in replies (ketchup, ketchup-video).
- G8 Video `file_attachments` to subagents.
- G9 `/visualize` contract.
- G11 Custom-mode trigger: select a skill in the `/` menu and press Alt+Enter.
- G12 Plan-mode and readonly shells deny network where Cursor allows read-only network commands.
- G13 A subagent's background shells and background subagents die with their process; Cursor keeps them and reports to the parent.
- G14 Confirmation gates pstack text relies on (routine create confirm card).
- G15 Model rule timing (Cursor: new chats; Pi: next request) and scope (Cursor: workspaces under the rule's ancestor).

## Findings that shape the design (this run)

- Cursor docs: cloud subagents "run on its own VM and branch", start from the repo's configured environment (`.cursor/environment.json`: `build.dockerfile`, `install`, `start`, `terminals`), keep working when the laptop closes, and use team MCP config. Nesting stops at depth 2.
- Cursor's cloud architecture keeps the agent loop off the VM: the VM (or a `cursor-agent worker`) only executes tool calls. Pi documents the same split (`docs/containerization.md`, Gondolin example): keep Pi on the host and route the built-in tools into an isolated environment through `createBashTool(cwd, { operations })` and the read/write/edit/ls/find/grep operation interfaces.
- Cursor CLI 2026.10.22 itself has no Task `environment`; a requested cloud Task ran locally (earlier evidence). The CLI's own "send to cloud" handoff exports the conversation and starts a background composer from the current pushed branch (`src/hooks/use-send-to-background.ts`, `cloud-transfer-start.ts`).
- Cursor readonly (Ask mode) shells: `getIsAskMode() ? {type:"workspace_readonly", networkPolicy}` when the sandbox is on; the CLI default is `sandbox.mode: "disabled"` with `networkAccess: "user_config_with_defaults"`. Cursor never denies all network to a readonly shell; pi-pstack does.
- Cursor CLI never sets `clientSupportsInlineImages`; the CLI does not embed media in replies, so Pi's read-tool image display already exceeds the CLI.
- Canvas (`~/.cursor/skills-cursor/canvas`) declares surfaces ide and cloud, not the CLI, and no pstack or team-kit file uses it; pr-review-canvas only serves HTML and opens a browser.
- Baseline: pi-pstack typecheck passes; 793 passed, 1 failed (subscription-owner detached routine reads the marker file between create and write: a test race), 2 skipped.

## Design: cloud workers (G1, G13)

Data shape. A cloud agent's record gains `machine`, a discriminated union on `driver`:
- `container`: a fresh clone of the pushed remote under `<workspace state>/machines/<agent id>/repo`, branch `pstack/<agent id>`, bind-mounted at the same absolute path into a Docker container `pstack-<agent id>` (image from `.pi/environment.json` or the default). Tools of the worker route into the container: bash and bash_background run through `docker exec`; file tools act on the bind mount for paths inside the clone and inside the container for every other path. Model credentials stay on the host.
- `worktree`: the earlier local worktree, used only when no container engine answers (or `PSTACK_CLOUD_DRIVER=worktree`); the host section and the Task result say so.

Lifecycle. The worker is a detached `pi --mode json -p` process with `--session-dir <subagents> --session-id <id>`, stdout to `machines/<id>/runs/<n>.jsonl`. It survives the chat. The parent tracks it through a handle with the RPC child's interface (done, stop, kill, pid) built on the pid and the events file; shutdown stops tracking without killing. A session that starts later delivers completions it missed. Resume starts a new detached run on the same transcript and machine. stop_agent signals the worker group and stops the container.

## State at the end of this run

Closed with a Pi-native mechanism, a real-Pi test, and (where marked) a mutation or live check:

| Gap | Mechanism | Evidence |
| --- | --- | --- |
| G1 cloud subagents | container machine (fresh clone of the pushed remote, tools routed in, Pi process and credentials on host), detached runs that survive the chat and report back once, `/in-cloud`, upstream wording restored | `test/e2e/cloud-machine.e2e.test.ts` (5), `in-cloud.e2e.test.ts`, `task.e2e.test.ts` (worktree driver, 64), 6/6 mutations caught, live deepseek-flash run (`live-cloud.sh`) |
| G2 Projects | `/project`, `pstack_project` section inherited by subagents, Projects folder and root store mounted on cloud machines, footer `listening: n` | `project.e2e.test.ts`, cloud-machine e2e writes notes.md from the container |
| G3 automations and benny | `subscribe_slack`, Slack tools, `new_session` + `environment: "cloud"`, `MEMORIES.md`, `automate` skill, `/automations`, automation runs keep Slack tools, benny rebuilt from upstream | `slack.e2e.test.ts` (fake Slack API), `automation.e2e.test.ts` (3), `restore-benny.mjs` |
| G4 SendToUser | `request_secret`, `/secret`, masked TUI field | `secrets.e2e.test.ts`, `secrets.test.ts` |
| G5 Slack channel subscriptions | `subscribe_slack` | `slack.e2e.test.ts` |
| G8 video attachments | ffmpeg frames with timestamps | `video.e2e.test.ts` |
| G11 Alt+Enter custom mode | `onTerminalInput` in `mode.ts` | `tui-alt-enter.py` in a real pty, mutation exit 1 |
| G12 readonly network | sandbox-runtime proxy admits every host; bwrap shares the net namespace | `task.e2e.test.ts` TASK-019 |
| G14 routine confirm | `ctx.ui.confirm` before a new webhook routine | `subscription-owner.e2e.test.ts` |

Still open (not closed by this run):

- G13b: a subagent's background shells stop with the subagent; Cursor keeps them running and notifies the parent. Needs jobs that write their own output file and a parent that adopts them.
- A sleeping host pauses cloud agents (the Pi process runs on the host); Cursor's hosted VMs do not pause.
- Cloud agents see the host's MCP servers; Cursor's use the team configuration.
- macOS readonly sandbox: `/usr/bin/curl` and LibreSSL clients fail TLS (gh, git, Homebrew curl, node fetch work).
- Slack triggers poll every 20 s; webhook routines listen on loopback.
- A fork and its source can both run on one machine if the source is resumed while the fork runs (worktree forks had the same edge); the first run's wrapper then stops the shared container.
- On Linux, files a container writes into the bind-mounted clone are root-owned on the host.
- Desktop-only surfaces stay out of scope by the operator's order (`/visualize`, the plan card, inline media in replies); the Cursor CLI has none of them.
