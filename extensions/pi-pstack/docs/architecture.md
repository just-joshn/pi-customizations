# About the pi-pstack architecture

pstack was written for Cursor. Its skills call a `Task` subagent tool, a todo tool, plan mode, `AskQuestion`, background shells, `/loop`, cloud agents, and Cursor Automations. Pi has none of these, and its design says an extension should not add them. pi-pstack 0.15.36-pi.39 added them anyway, in about 10,900 lines of extension code under `src/` (`git diff --shortstat 2f045b2c 3bbdca7b -- extensions/pi-pstack/src`). pi-pstack 0.15.36-pi.40 removes that runtime and keeps pstack's workflows on Pi's own mechanisms. This page explains the parts of the new design and why each one has the shape it has. The requirement is `parity/pi-native-tmux-2026-11-11/specification.md` at the repository root, and `contract.md` beside it fixes the names and file formats.

## One source, one compiled copy

`vendor/upstream-pstack/` and `vendor/upstream-cursor-team-kit/` hold the upstream files byte for byte, at the commit in `generated/upstream-lock.json`. Nobody edits them.

`scripts/compile-skills.mjs` reads them and writes `generated/`. Each change from the upstream text is a rule in `adapters/cursor-to-pi.ts` or `adapters/skill-transforms.ts`. A rule names the file, the exact source span, the replacement, and the Cursor primitive it replaces. `generated/transformation-manifest.json` records every span. The compiler fails when a rule's source text matches a different number of times than the rule expects, so an upstream change cannot slip past a stale rule (`tests/skill-parity/gates.test.ts`). `scripts/check-parity.mjs` then checks the inventory: 62 skills (34 primary, 24 principle, 4 team-kit), 23 playbooks, 3 worker roles, and 62 prompts, with 179 rules over 244 spans at the current pin.

The old package kept a hand-edited copy of every skill in `skills/`. That copy drifted from upstream with each fix and had no record of what changed or why. The compiled copy costs a rule per change, which is the point: each difference from pstack is written down and tested (`tests/skill-parity/`).

## A thin extension

`src/extension.ts` registers two model tools and one command. Everything else stays in the skills.

- `pstack_worker` spawns, inspects, steers, aborts, and collects workers (`src/workers.ts`).
- `pstack_evidence` records and verifies evidence receipts (`src/evidence.ts`).
- `/pstack` turns the persistent style on and off and controls runs (`src/commands.ts`).
- An `input` handler rewrites `/pstack:<name>` to `/skill:<name>` for a skill name another command owns (`src/skill-routing.ts`).
- `before_agent_start` adds the `poteto-mode` skill once per context while the style is on (`src/style.ts`).

Inside a worker (`PSTACK_WORKER=1`) the extension registers only `pstack_evidence`, plus `pstack_worker` for a sub-coordinator. `tests/integration/pi-load.test.ts` loads the package into the real Pi binary and checks that the model sees exactly these tools and none of the old ones.

## Workers are Pi processes in tmux

Spec section 9.1 compared three ways to run a worker: typing into Pi's TUI, running Pi's SDK in the parent process, and running `pi --mode rpc` behind a small host inside tmux. The third won, and the implementation keeps it.

`spawnAssignment` in `src/workers.ts` is the only code that runs `tmux new-session`. It starts `dist/worker-host.js` on the `-L pstack` tmux server. The host starts Pi in RPC mode, forwards prompts and steering, prints a readable log in the pane, and writes `state.json`. You attach with the command `pstack_worker` returns. The host never reasons or runs tools, so the worker is Pi and its transcript is a normal Pi session file.

Most of the hard work is in what counts as done. A prompt that Pi accepted is not finished work. The host counts each prompt, steer, and follow-up as a generation. A settle covers only the generations Pi acknowledged before a `get_state` answer that found Pi idle with nothing queued. `collect` returns a result only when the latest settle covers the latest generation. A host that is gone before that point gives no result, never a pass. Two review rounds rejected weaker versions of this rule before this one. `tests/worker-lifecycle/settle-coverage.test.ts` and `settle-liveness.test.ts` hold it.

A spawn takes `claim/` with an exclusive `mkdir` before tmux starts, so two spawns of one assignment cannot both run. When the outcome of a spawn is unknown, the claim stays until evidence settles it (`tests/worker-lifecycle/spawn-outcome.test.ts`). An abort with no answering host kills the tmux session only when the session's recorded identity still matches, because a restarted tmux server reuses session ids (`tests/worker-lifecycle/lifecycle.test.ts`, "abort of a dead host never ends another session").

## Run files instead of tools

A run is a directory, `<project>/.pi/pstack/runs/<runId>/`. `TODO.md` replaces `TodoWrite`. `scripts/start-run.mjs` copies the playbook's steps into it in order, and the parent ticks them off with evidence ids. A plan is a Markdown file under `.pi/pstack/plans/`, which replaces plan mode. `events.jsonl` is an audit trail. Pi's own session files stay the record of every conversation.

Files survive a restart where in-memory tool state does not. When the parent restarts, it reads its runs, lists the live tmux sessions, and delivers each worker's settle exactly once. The delivery record is the `pstack-worker` message in the parent's own session branch, so no second database can disagree with it (`tests/recovery/recovery.test.ts`).

## What the old runtime did that this one does not

| Old feature | Now |
| --- | --- |
| `Task` subagents, `agent_status`, `stop_agent` | `pstack_worker` with an assignment file |
| `TodoWrite` | `TODO.md` in the run directory |
| `/plan`, `CreatePlan`, `SwitchMode` | A plan file under `.pi/pstack/plans/`, checked by `check-plan.mjs` |
| `/mode <skill>` | `/pstack on` for `poteto-mode`. Other skills have no persistent mode. |
| `AskQuestion` | A question in the conversation |
| `/loop`, `bash_background`, `AwaitShell` | A `watch` worker. Its exit wakes the parent. |
| Subscriptions, the routines supervisor, Slack tools | `/pstack automation` event sources that run as watch workers |
| Cloud agents, `/in-cloud` | Not yet. Container workers are pending. |
| `GenerateImage`, `visualize`, `request_secret`, Projects | Removed |
| A `/name` anywhere in a message attaches its skill | A `/name` prompt at the start of a message, and the `input` handler rewrites a message that names a skill later to Pi's `/skill:<name>` form |

The removals are deliberate. Each old feature was a second implementation of something Pi or the file system already does, and each carried its own state, recovery code, and tests. The cost is real for a few users. A `/loop` with a timer has no direct replacement.

## Limits that stay

The design has three limits that only more infrastructure can remove.

1. Workers run on the parent's machine as the parent's user. The capability boundary (`capabilities` in `assignment.json`) strips MCP, environment variables, and posting tools from automation workers, and a readonly worker reaches only the MCP tools the operator lists in `<agent dir>/pstack/readonly-mcp.json`, and Benny's trusted tracker worker also gets the exact write tools in `<agent dir>/pstack/tracker-mcp.json`. That filter is by tool name, not by argument or target resource, so authority over a team, project, or issue is the MCP server's credentials; use narrowly scoped ones. None of that is a credential or filesystem boundary. A local worker keeps your filesystem and network authority, so a shell command can still write to an external system. A container worker closes that gap, and a requirement that needs it is reported blocked otherwise.
2. Cursor-hosted services are replaced by local equivalents with the same contract, not reproduced. A routine receiver on `127.0.0.1` stands in for Cursor's webhook URL. Bugbot has no stand-in.
3. A second model family must be configured for a diverse review panel. `/pstack doctor` reports a panel that resolves to one family.

[`parity-status.md`](parity-status.md) lists each requirement with the test that proves it, and each known gap.
