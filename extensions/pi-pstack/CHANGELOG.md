# Changelog

Revisions follow the pinned upstream pstack version, then `-pi.N` for this package's own releases.

## 0.15.15-pi.1

- Tracks upstream pstack commit `ccb5507cec1546dc88135c1139c811e6c59115ba`. The team-kit pin is unchanged because its source has no delta.
- Adds `/poteto-help` as a native skill and prompt template, with host rows that name the Pi install command, the sticky `/poteto-mode` session mode, and the next-turn model rule.
- Adds host `/automate` (creation-only Automations editor handoff) plus `pstack_automations` tools: Prepare, Inspect, OpenEditor, Save (always disabled), RecordThreadSafety, Enable (receipt + confirm, local status only), and Disable. Slack ingress is not started.
- Routes the Pi setup-benny adapter through host `/automate` instead of webhook `Routine*` tools for Slack Benny drafts.
- Moves default model panels to Claude and Grok, drops GPT from the arena, architect, interrogate, and reflect defaults, and uses `xhigh` as the default Claude effort.
- Renames the unlimited budget to `unlimited — max reasoning`. It now raises each entry to `max` where the model supports it, and a model without `max` keeps its highest level.
- Adds `scripts/refresh-pstack-snapshot.mjs` and a shared `scripts/source-normalize.mjs`, so a pin refresh and the pin check use one normalization.
- Preserves 164 pstack source files, 193 total source files, 215 generated resources, 73 discoverable skills, and 71 prompt templates.

## 0.15.9-pi.1

- Tracks upstream pstack commit `e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a` with the existing source-name normalization.
- Replaces the perf-issue strategy families with seven ordered performance mantras. The playbook stops when an earlier mantra meets the target.
- Makes hillclimb borrow the mantra order without the perf-issue stop rule, and updates the benchmark checklist cross-reference.
- Screens architecture candidates for agent contributors and adds design flags for split ownership, duplicate task paths, importable internals, and hand-synced lists.
- Removes the obsolete Poteto persona resume override so workers receive the authoritative fresh-worker policy without conflicting instructions.
- Adds a `--current` source verification option that rejects stale pins and uncommitted authoritative pstack changes.
- Removes downstream workflow-policy overrides and restores source-defined investigation coverage, review gates, model roles, plan data, and orchestration rules.
- Restores the authoritative helper behavior instead of adding generic bootstrap locks, GitHub pagination, synthetic zero-check readiness, Graphite alternatives, and cleanup classifications.
- Preserves the external GitHub account `cursor`, pagination terminology, and editor caret terminology during normalization. Reflection now recommends supported Pi context and skill routing instead of `paths:` triggers.
- Protects decision-log evidence against spreadsheet text qualifiers while retaining the source's first-character formula guard and append semantics.
- Preserves 161 pstack source files, 190 total source files, 211 generated resources, 71 discoverable skills, and 69 prompt templates.

## 0.15.7-pi.1

- Tracks upstream pstack commit `9511e60321f7e533a187d62854a3d53a53752874` with documented source-name normalization.
- Adds `/correct`, `/benchmark-checklist`, and `/principle-explain-the-number` as native skills and prompt templates.
- Carries fresh-subagent rules, hourly autopilot audits, per-unit pushes, merge-preparation drift checks, and schema-first validation guidance.
- Carries PR section headings, explicit scope exclusions, and preference for an available built-in PR tool. Forge commands remain the fallback when no such tool exists.
- Removes obsolete generator mappings for thirty-minute wakes, autopilot goals, and hand-written cast guards. The plan checker now requires `/loop 1h`.
- Corrects status text about cloud VM requirements and prevents the no-workers verification selector from launching child Tasks.
- Records update evidence and verification limits in `docs/latest-parity.md` and `docs/latest-parity-decisions.tsv`. Source and discovery parity do not prove identical model decisions or external-service behavior.

## 0.15.5-pi.4

- Rebuilds the native parity contract against the current pstack reconstruction. The reference is vendored at `docs/parity/reference/pstack-architecture-reconstruction.md`, the clause slices keyed to the deleted `pstack-reverse-engineering.md` are replaced by `s1` to `s4`, and `bun run check:native-parity` runs green over every slice.
- `/setup-pstack` lists the `trail reviewer`, `figure-it-out judge`, and `recall miners` roles. A re-run dropped those three lines as retired even though the host contract and three skills read them. The generator now emits them, and `test/models.test.ts` keeps the table equal to `src/models.ts`.
- `/no-comments` spawns Comment Sicko with `readonly: true` and tells the caller to pass the resolved scope, because a read-only child keeps only the read tools. The read-only guarantee is structural instead of prompt-only.
- The hillclimb playbook names the note field in its decision-log mapping, so every upstream hillclimb field is recorded in the canonical `decisions.tsv`.
- Re-verifies all 316 Reference Assistant subagent parity rows against the reconstruction and fixes the twelve the re-verification found: pause and halt emit `workflow.run_settled`, a failed preparation releases its admitted subagent, a credit stop classifies as `workflow_limit_reached` and resumes with a raised limit, a closed workflow limiter reports its own message, a schema reply retries once with both spawns counted, a child transcript keeps its own session id, the task store is populated before `subagent.started`, `session.tasks.register` and `session.tasks.update` exist, `/tasks` lists shells, `copilot_cli_execution_subagent_model` gates the execution model, and the events log directory and the tool-init stages carry tests.
- States the Pi-native mechanism in fifteen more matrix rows where Pi replaces a Reference Assistant host channel: permission routing, prompt sections, in-process workflow hosting, the AHP prefix, MCP tasks, web search, quota gating, shell and client task kinds, and the idle notice.
- Raises the package back over its 80 percent coverage thresholds with behavior tests across the subagent, goal, timer, and command modules. `bun run test:coverage` now reports 80.1 statements, 80.98 branches, 82.41 functions, and 82.92 lines.
- Gives the clause gate an `--allow-external` flag for the clauses that need live third-party credentials, and runs it through `make verify-parity-audit`. The default run stays strict and exits non-zero on any finding.
- Adds `check:parity` to `make verify-extension` and to the package CI workflow, and documents both parity commands in the README. `check:native-parity` stays out of the portable target because its provenance checks read the preserved source checkout at `~/src/experiments/plugins`.

## 0.15.5-pi.3

- Audits the pi-subagents source against the native-first order (`extensions/AGENTS.md`) and removes the custom stand-ins it found. The findings and fixes are in `docs/subagents-native-audit.md`, and `docs/subagents-native-gaps.md` records what stays.
- Subagent settings, hooks, and the status line command now come from `pi.getSettings()`. They used a `SettingsManager` that trusted every project, so a hook in an untrusted project's `.pi/settings.json` ran. Children, and the Reference-style `Task` workers, now load project settings and extensions only where the parent trusts the project.
- Children load the pi MCP, `codemode` and `tool_search` extensions, so MCP servers the parent registers connect in the child. A child whose definition names its tools keeps exactly those tools, including tools that register later. Aggressive deferral now registers inherited MCP servers with the `deferred` exposure instead of dropping tools.
- Fixes children being unable to write files. The write gate read an inverted environment flag, so every `task` child was refused `edit` and `write`. The gate now asks whether the parent still has a write tool active.
- `task`, `read_agent`, `write_agent`, `list_agents`, `context_board`, `send_inbox` and the specialized tools return the `structuredContent` their `outputSchema` declares. A sync child reports its usage in the tool result, a long reply is cut to pi's output limit with a pointer to the transcript, and the four agent tools share the `subagents` namespace. Pi validates arguments, so the tools no longer validate again.
- Registers `run_dynamic_workflow`, `dynamic_workflows_manage` and `read_workflow_run` when `COPILOT_DYNAMIC_WORKFLOWS` is on. They were written but never registered.
- Workflow runs persist as `reference-assistant-workflow` session entries instead of a `workflows.json` beside the session. The lease heartbeat timer and the 200 ms concurrency poll are gone: a counting semaphore wakes the next waiter when a slot frees.
- A cancelled or paused workflow run stops its in-flight child, its configured `workflows.defaultLimits` apply to enforcement rather than only to the confirmation text, a workflow agent's `modelPolicy` and `effortLevel` reach the child selection, and a run a previous process left interrupted can be resumed.
- `session.tasks.cancel` cancels an idle agent and disposes its session, and `session.tasks.remove` stops and disposes a live child before it drops the record, so no settle path outlives its node.
- Reads parent MCP servers without the 25 ms settle loop, takes session statistics from `getSessionStats()`, runs git probes through `pi.exec`, and reads the project agent directory name from `CONFIG_DIR_NAME`.
- A failed `/subagents` write no longer overwrites an unreadable `settings.json`, and progress counters no longer append a session entry per tool call.
- Adds `bun run check:native-first` to `make verify-extension`.
- Rebuilds `pi-subagents` for parity with the Reference CLI 1.0.91 subagent reconstruction: `task`, `read_agent`, `write_agent`, and `list_agents` over a factory, scheduler, and task registry, with the documented limits, statuses, events, settings, hooks, model provenance, sidekicks, and dynamic workflow runs.
- Replaces the Claude-reference `Agent`, `SendMessage`, and `ListAgents` tools and retires their modules. The Reference-style `Task` workers keep their runtime.
- Adds `/tasks`, `/subagents`, `/rubber-duck`, `/fleet`, `/workflows`, and `/factories`, the `session.tasks`, `session.tools`, `session.agent`, and `session.workflow` RPC methods, the context board with the rem-agent launcher, and the nested depth and concurrency link to the root limiter.

## 0.15.5-pi.2

- Makes poteto mode trigger on Anthropic models at any effort. Below `high`, those models skipped the playbook read and the todolist. In poteto mode, each prompt to an `anthropic-messages` model now carries a hidden first-action rule, sent from `before_agent_start`. Other model families are unchanged.
- Integrates the team-kit 1.2.0 workflows, including the CI and PR skills, `/pr-review-canvas`, and the strict code-review rubric.
- Adds the local `/loop` skill and template on native `BackgroundShell` wakes, and the `/goal` command with `CreateGoal`, `GetGoal`, and `UpdateGoal`.
- Adds native `Task` workers with the `generalPurpose`, `poteto-agent`, `comment-sicko`, `ci-watcher`, and thermo review personas, plus `environment: "cloud"` detached worktrees.
- Adds durable timers, routines, and the dormant Benny pack with its Pi setup adapter.
- Hardens TodoWrite, AskQuestion, setup dialogs, history scoping, and shell wake delivery against the failures found by driving the real CLI.
- Moves the test suite to Vitest 5 with V8 coverage and adds the real-CLI journey checks.
- Declares the repository and homepage, a gallery image, a minimum Pi version for the host peers, and a pull request workflow.
- Ships a Pi adaptation of the ten-chapter guide under `docs/guide/` and a playbook and skill reference in the README.

## 0.15.5-pi.1

- First Pi port of pstack 0.15.5: the preserved upstream snapshot, generated skills and prompt templates, the `pstack_mode` tool, `/poteto-mode`, `/setup-pstack`, and `/pstack`.
