# Changelog

Revisions follow the pinned upstream pstack version, then `-pi.N` for this package's own releases.

## 0.15.5-pi.4

- Rebuilds the native parity contract against the current pstack reconstruction. The reference is vendored at `docs/parity/reference/pstack-architecture-reconstruction.md`, the clause slices keyed to the deleted `pstack-reverse-engineering.md` are replaced by `s1` to `s4`, and `bun run check:native-parity` runs green over every slice.
- `/setup-pstack` lists the `trail reviewer`, `figure-it-out judge`, and `recall miners` roles. A re-run dropped those three lines as retired even though the host contract and three skills read them. The generator now emits them, and `test/models.test.ts` keeps the table equal to `src/models.ts`.
- `/no-comments` spawns Comment Sicko with `readonly: true` and tells the caller to pass the resolved scope, because a read-only child keeps only the read tools. The read-only guarantee is structural instead of prompt-only.
- The hillclimb playbook names the note field in its decision-log mapping, so every upstream hillclimb field is recorded in the canonical `decisions.tsv`.
- Re-verifies all 316 Copilot subagent parity rows against the reconstruction and fixes the twelve the re-verification found: pause and halt emit `workflow.run_settled`, a failed preparation releases its admitted subagent, a credit stop classifies as `workflow_limit_reached` and resumes with a raised limit, a closed workflow limiter reports its own message, a schema reply retries once with both spawns counted, a child transcript keeps its own session id, the task store is populated before `subagent.started`, `session.tasks.register` and `session.tasks.update` exist, `/tasks` lists shells, `copilot_cli_execution_subagent_model` gates the execution model, and the events log directory and the tool-init stages carry tests.
- States the Pi-native mechanism in fifteen more matrix rows where Pi replaces a Copilot host channel: permission routing, prompt sections, in-process workflow hosting, the AHP prefix, MCP tasks, web search, quota gating, shell and client task kinds, and the idle notice.
- Raises the package back over its 80 percent coverage thresholds with behavior tests across the subagent, goal, timer, and command modules. `bun run test:coverage` now reports 80.1 statements, 80.98 branches, 82.41 functions, and 82.92 lines.
- Gives the clause gate an `--allow-external` flag and uses it in `make verify-extension`, because a clause that needs a live third-party service cannot pass without credentials. The default run stays strict and exits non-zero on any finding.
- Adds `check:parity` and `check:native-parity` to `make verify-extension`, adds `check:parity` to the package CI workflow, and documents both in the README.

## 0.15.5-pi.3

- Audits the pi-subagents source against the native-first order (`extensions/AGENTS.md`) and removes the custom stand-ins it found. The findings and fixes are in `docs/subagents-native-audit.md`, and `docs/subagents-native-gaps.md` records what stays.
- Subagent settings, hooks, and the status line command now come from `pi.getSettings()`. They used a `SettingsManager` that trusted every project, so a hook in an untrusted project's `.pi/settings.json` ran. Children, and the Cursor-style `Task` workers, now load project settings and extensions only where the parent trusts the project.
- Children load the pi MCP, `codemode` and `tool_search` extensions, so MCP servers the parent registers connect in the child. A child whose definition names its tools keeps exactly those tools, including tools that register later. Aggressive deferral now registers inherited MCP servers with the `deferred` exposure instead of dropping tools.
- Fixes children being unable to write files. The write gate read an inverted environment flag, so every `task` child was refused `edit` and `write`. The gate now asks whether the parent still has a write tool active.
- `task`, `read_agent`, `write_agent`, `list_agents`, `context_board`, `send_inbox` and the specialized tools return the `structuredContent` their `outputSchema` declares. A sync child reports its usage in the tool result, a long reply is cut to pi's output limit with a pointer to the transcript, and the four agent tools share the `subagents` namespace. Pi validates arguments, so the tools no longer validate again.
- Registers `run_dynamic_workflow`, `dynamic_workflows_manage` and `read_workflow_run` when `COPILOT_DYNAMIC_WORKFLOWS` is on. They were written but never registered.
- Workflow runs persist as `copilot-workflow` session entries instead of a `workflows.json` beside the session. The lease heartbeat timer and the 200 ms concurrency poll are gone: a counting semaphore wakes the next waiter when a slot frees.
- A cancelled or paused workflow run stops its in-flight child, its configured `workflows.defaultLimits` apply to enforcement rather than only to the confirmation text, a workflow agent's `modelPolicy` and `effortLevel` reach the child selection, and a run a previous process left interrupted can be resumed.
- `session.tasks.cancel` cancels an idle agent and disposes its session, and `session.tasks.remove` stops and disposes a live child before it drops the record, so no settle path outlives its node.
- Reads parent MCP servers without the 25 ms settle loop, takes session statistics from `getSessionStats()`, runs git probes through `pi.exec`, and reads the project agent directory name from `CONFIG_DIR_NAME`.
- A failed `/subagents` write no longer overwrites an unreadable `settings.json`, and progress counters no longer append a session entry per tool call.
- Adds `bun run check:native-first` to `make verify-extension`.
- Rebuilds `pi-subagents` for parity with the Copilot CLI 1.0.91 subagent reconstruction: `task`, `read_agent`, `write_agent`, and `list_agents` over a factory, scheduler, and task registry, with the documented limits, statuses, events, settings, hooks, model provenance, sidekicks, and dynamic workflow runs.
- Replaces the Claude-reference `Agent`, `SendMessage`, and `ListAgents` tools and retires their modules. The Cursor-style `Task` workers keep their runtime.
- Adds `/tasks`, `/subagents`, `/rubber-duck`, `/fleet`, `/workflows`, and `/factories`, the `session.tasks`, `session.tools`, `session.agent`, and `session.workflow` RPC methods, the context board with the rem-agent launcher, and the nested depth and concurrency link to the root limiter.

## 0.15.5-pi.2

- Makes poteto mode trigger on Anthropic models at any effort. Below `high`, those models skipped the playbook read and the todolist. In poteto mode, each prompt to an `anthropic-messages` model now carries a hidden first-action rule, sent from `before_agent_start`. Other model families are unchanged.
- Integrates the cursor-team-kit 1.2.0 workflows, including the CI and PR skills, `/pr-review-canvas`, and the strict code-review rubric.
- Adds the local `/loop` skill and template on native `BackgroundShell` wakes, and the `/goal` command with `CreateGoal`, `GetGoal`, and `UpdateGoal`.
- Adds native `Task` workers with the `generalPurpose`, `poteto-agent`, `comment-sicko`, `ci-watcher`, and thermo review personas, plus `environment: "cloud"` detached worktrees.
- Adds durable timers, routines, and the dormant Benny pack with its Pi setup adapter.
- Hardens TodoWrite, AskQuestion, setup dialogs, history scoping, and shell wake delivery against the failures found by driving the real CLI.
- Moves the test suite to Vitest 5 with V8 coverage and adds the real-CLI journey checks.
- Declares the repository and homepage, a gallery image, a minimum Pi version for the host peers, and a pull request workflow.
- Ships a Pi adaptation of the ten-chapter guide under `docs/guide/` and a playbook and skill reference in the README.

## 0.15.5-pi.1

- First Pi port of pstack 0.15.5: the preserved upstream snapshot, generated skills and prompt templates, the `pstack_mode` tool, `/poteto-mode`, `/setup-pstack`, and `/pstack`.
