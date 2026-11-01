# Host feature map: Cursor → Pi (pstack 0.15.36)

Sources: tip pstack skill/playbook text, `parity/pi-pstack-0.15.36/design.md`, `extensions/pi-pstack/src/**`.

Status values: **implemented** (code under `src/`), **substituted** (different mechanism, same user job), **flagged-no-substitute** (none found).

## Map

| Cursor host feature (skills name it) | Pi mechanism | Status | Evidence |
| --- | --- | --- | --- |
| `Task` spawn / `subagent_type` / `run_in_background` / `readonly` / `model` | `Task` tool `src/task/tool.ts` + agent registry | implemented | registered from `index.ts` via `registerTask` |
| `environment: "cloud"` (isolated cloud agent / VM) | isolated local git worktree on branch `pstack/<agent id>`; Task field name kept | substituted | design.md §1 vocabulary + §2.8; `src/task/worktree.ts` |
| Message a running worker | `Task` with `resume` as RPC steer when child is in this process | implemented | design.md §2.8; `src/task/runner.ts` |
| Stop / stand down a worker | `stop_agent` | implemented | `src/task/stop.ts` (registered from Task registration) |
| Fork agent / copy transcript | `Task` `fork` (+ optional `fork_turns`) | implemented | design.md §2.1; `src/task/records.ts` `keepFirstTurns` |
| Cloud agent status UI | `agent_status` | implemented | `src/task/status.ts` |
| `TodoWrite` | `TodoWrite` | implemented | `src/todo.ts` |
| `AskQuestion` | `AskQuestion` | implemented | `src/ask.ts` |
| `Shell` / filesystem tools | Pi `bash`, `read`, `grep`, `find`, `ls`, `edit`, `write` | substituted | design.md vocabulary table; shipped Markdown rewritten |
| Custom Mode / sticky skill / Option+Enter | `/mode <skill>` / `/mode off` | implemented | `src/mode.ts` |
| Plan Mode | `/plan` / `/plan off` + readonly tool set + `bash_readonly` | implemented | `src/plan.ts`, `src/readonly-shell.ts` |
| `/loop` | `/loop` command + `Loop` tool | implemented | `src/loop.ts` |
| Always-applied model rule `pstack-models.mdc` | `pstack-models.md` under pstack dir; injected every request | implemented | `src/rule.ts`, design.md §3 |
| Project tracker / Project store | `<workspace>/projects/<slug>/{notes.md,store/}` named in system prompt | implemented | `src/paths.ts`, `src/sections.ts` |
| PR / CI event subscriptions | `subscribe_github_pr`, `list_subscriptions`, `unsubscribe` (polls via `gh`) | implemented | `src/subscriptions/github.ts`, `index.ts` |
| Timers / routine wakes | `subscribe_timer` (`cron` / `delaySeconds`, `wake_self` / `new_session`) | implemented | `src/subscriptions/` |
| Cursor Automations webhooks (`api2.cursor.sh/...`) | local `subscribe_webhook` listener `http://127.0.0.1:<port>/routines/<slug>` | substituted | design.md §2.4; `src/subscriptions/webhook.ts` |
| Routines panel / Cmd+Shift+I | `/routines` | implemented | subscriptions registrar |
| `SendToUser` secret-request for webhook key | credential file path returned by tool; agent must not print key | substituted | design.md §1; `make-bot-ui` Pi text |
| `/visualize` / chart tool | `visualize` tool (Unicode + SVG artifact) | implemented | `src/visualize.ts` |
| Image generation tool | Pi codemode `models.generateImages()` when configured; else Mermaid/table | substituted | `src/sections.ts` image line; design.md vocabulary |
| `agent-transcripts` / Cursor project slug paths | Pi session directories + `<pstack>/workspaces/.../subagents`; `worktree-audit.sh` Pi paths | substituted | design.md; poteto `worktree-audit.sh` Pi rewrite |
| Cursor model slugs (`claude-opus-5-5-xhigh`, `-fast`) | Pi specs `id:level` / `[effort=,fast=]`; parser accepts dash forms | implemented | design.md §2.9; `src/task/models.ts` |
| `inherit-parent` / `auto` model | parent chat model | implemented | design.md §1 |
| Grok Bot / automation-owned chat | the Pi session that owns the routine | substituted | design.md vocabulary |
| Install / plugin marketplace (`/add-plugin pstack`) | `pi install <path-to-pi-pstack>` | substituted | design.md vocabulary |
| `.cursor/rules` always-apply project rules | `AGENTS.md` (Pi host) + team-kit rules as skills + section line | substituted | design.md; `src/sections.ts` always-applied engineering rules |
| Cursor cloud Computer Use / enterprise org policy witnessing | none as Cursor platform; local workers + Pi MCP/policy are the substitute story | substituted (out of plugin parity scope) | `phase-a-frame.md` done predicate §7; **not** a missing host tool in pi-pstack |

## Flagged: no Pi substitute yet

**None** for features skills call by name that design.md marks in-scope.

Conditional degradation (substitute exists, quality depends on Pi host config):

1. **Image generation.** Without codemode + an image model, ketchup/visual playbooks fall back to Mermaid/table. That is a substitute, not a missing map entry.

Closed (was conditional):

2. **Subscription durability.** Desired state dual-writes to `durable/<slug>/subscriptions.json`. Creating a subscription starts `pstack-routines-supervisor`, which arms timers/polls/webhooks after chat exit. Optional launchd/systemd examples live under `packaging/`. Cursor-hosted Automations cloud identity remains `cursor-platform-out-of-scope-with-pi-substitute`.

## Host feature inventory vs `src/` registration (measured)

Registered tools/commands observed in package source: `Task`, `stop_agent`, `agent_status`, `TodoWrite`, `AskQuestion`, `visualize`, `subscribe_github_pr`, `subscribe_timer`, `subscribe_webhook`, `list_subscriptions`, `unsubscribe`, `Loop`, `/mode`, `/plan`, `/loop`, `/routines`, readonly shell in plan/readonly workers, model rule injection, projects path section.
