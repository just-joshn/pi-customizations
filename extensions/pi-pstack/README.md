# pstack for pi

This Pi package ports pstack 0.15.5 and team-kit 1.2.0 workflows to Pi 1.0.0. It preserves 187 upstream files and all 65 workflow entry points through 64 skills and 63 prompt templates. A Pi-authored loop skill and `/loop` template add a 65th skill and 64th template. Its extension supplies executable behavior. Upstream-hosted facilities run as local Pi equivalents. The [compatibility report](docs/parity.md) lists each mapping and the differences that remain.

## Install

Clone the repository with Git, then install the package:

```sh
git clone https://github.com/just-joshn/pi-customizations.git
cd pi-customizations
pi install ./extensions/pi-pstack
```

If you already have a checkout, run only the `pi install` command from its root. Keep the checkout in place. Pi loads local packages from that directory without copying them.

The package lives in `extensions/pi-pstack`, not the repository root. Use the clone-and-install commands above rather than `pi install git:github.com/just-joshn/pi-customizations`. The repository root is a separate package that holds only the five standalone skills.

To update, run `git pull --ff-only` from the checkout root, then run `/reload` in pi.

Reload an existing pi session with `/reload`. Run `/pstack` to inspect status and `/setup-pstack` to select available models for each role. Setup requires terminal or RPC dialogs and confirms the complete table before saving.

Start a task with `/poteto-mode your task`. The mode persists on that session branch until `/poteto-mode off`. Natural-language opt-in and opt-out use the model-callable `pstack_mode` tool. `/poteto-mode`, `/setup-pstack`, and `/pstack` are extension commands. Workflow aliases such as `/how`, `/architect`, and `/swarm` are prompt templates that ask the model to read the corresponding skill. Pi's `/skill:name` form loads those instructions directly. `/bro` is a standalone prompt template; use it instead of the retired `/skill:bro`.

On Anthropic models, each prompt in the mode also carries a short hidden rule that makes the first tool call a read of the matching playbook and the second a `TodoWrite` of its steps. Pi sends it as a user-role message from `before_agent_start`. Lower effort settings make those models skip both calls, and a softer reminder did not change that. A test with a feature, an investigation and a bug-fix task showed 3 of 3 playbook reads and todolists on `claude-sonnet-5-5` at `low` and `medium` effort and on `claude-opus-5-5` and `claude-haiku-4-5` at `low`. Without the rule the counts were 0 or 1 of 3 for the playbook read and 0 of 3 for the todolist. A casual prompt and a one-line question did not trigger it. Other model families get no rule.

Every turn, the host context lists each bundled skill, host skill, and playbook by name with its file path. A workflow that says "the how skill" therefore resolves to one file read, as Reference's routing by name does. With Poteto mode on, the source skill's `reminder` line leads the injected mode text. Workflow templates obtain the bundled skill path from the same host context. Enable the package extension when using these aliases. Native `/skill:name` invocation remains available when only skills are loaded. Templates do not recursively invoke `/skill:` commands or enforce the skill's instructions.

With the package extension enabled, direct user invocations of pstack-owned prompt aliases preserve the raw argument suffix, including quotes, whitespace, newlines, backslashes, and dollar placeholders. The input hook quotes that suffix as one parser argument and leaves native prompt discovery and expansion in place. User-owned prompts, other extension commands, and `/bro` are not rewritten. Extension-generated messages keep Pi's normal literal delivery or opt-in expansion. When the extension is disabled, Pi's native prompt parser removes grouping quotes, joins parsed arguments with spaces, and converts unquoted line breaks to spaces. Use `/skill:name` to load a skill directly.

The runtime uses current `@earendil-works` pi packages. Host dependencies are peers with a minimum of 1.0.0. SDK 1.0.0 is the development and verification target. Newer versions have not been verified.

## Usage

Use `/poteto-mode` at the start of a task. It reads your request, picks one of twenty-three playbooks, copies the playbook's steps into a todo list, routes to the other skills as the steps fire, and writes an unslopped reply. The mode is sticky on that session branch until `/poteto-mode off`. New to pstack? The [pstack guide](docs/guide/README.md) walks through a first real task, from setup and prompting through verification and overnight runs. It is the Pi adaptation of the upstream ten-chapter guide.

### The twenty-three playbooks

The full rules live in [`skills/poteto-mode/SKILL.md`](skills/poteto-mode/SKILL.md).

| playbook | for |
|---|---|
| [investigation](skills/poteto-mode/playbooks/investigation.md) | a read-only question: how does X work, why was Y built this way, are we sure. |
| [bug fix](skills/poteto-mode/playbooks/bug-fix.md) | reproduce a defect, root-cause it, and fix it with runtime evidence. |
| [perf issue](skills/poteto-mode/playbooks/perf-issue.md) | trace a measured slowness and improve it against a baseline. |
| [hillclimb](skills/poteto-mode/playbooks/hillclimb.md) | sustained improvement of one metric against a target, with before and after measurement and one commit per accepted win. |
| [runtime forensics](skills/poteto-mode/playbooks/runtime-forensics.md) | diagnose a live symptom such as a leak, an idle CPU spin, or a glitch from instrumentation. |
| [trace forensics](skills/poteto-mode/playbooks/trace-forensics.md) | diagnose a captured profiling artifact such as a cpuprofile, trace, spindump, or heap snapshot. |
| [feature](skills/poteto-mode/playbooks/feature.md) | new or changed behavior, built from a named data shape. |
| [refactoring](skills/poteto-mode/playbooks/refactoring.md) | a behavior-preserving change to structure or shape. |
| [prototype](skills/poteto-mode/playbooks/prototype.md) | a throwaway sketch that settles a design or behavioral fork by observation. |
| [visual parity](skills/poteto-mode/playbooks/visual-parity.md) | pixel-exact UI equivalence between two implementations. |
| [authoring a skill](skills/poteto-mode/playbooks/authoring-a-skill.md) | writing or editing a SKILL.md. |
| [eval](skills/poteto-mode/playbooks/eval.md) | test how a skill or prompt change affects agent behavior, blinded. |
| [babysit](skills/poteto-mode/playbooks/babysit.md) | drive a PR or a stack to merge-ready: conflicts, review threads, CI. |
| [shipping](skills/poteto-mode/playbooks/shipping.md) | independently verify a green stack, then land the contiguous verified run bottom-up. |
| [autonomous run](skills/poteto-mode/playbooks/autonomous-run.md) | drive a long task to completion without stopping. |
| [orchestrate](skills/poteto-mode/playbooks/orchestrate.md) | a standing project handed to one coordinator session: multi-day work, many stacked PRs, fleets of subagents. |
| [autopilot full](skills/poteto-mode/playbooks/autopilot-full.md) | run independent PRs to merged with one owner per PR and a root swarm verdict on each round. |
| [autopilot stack](skills/poteto-mode/playbooks/autopilot-stack.md) | build and verify one linear base-branch stack for the operator to review and land. |
| [session pickup](skills/poteto-mode/playbooks/session-pickup.md) | resume or take over a prior agent's in-flight work. |
| [pause safely](skills/poteto-mode/playbooks/pause-safely.md) | suspend in-flight work cleanly so it can be resumed later. |
| [multi phase plan](skills/poteto-mode/playbooks/multi-phase-plan.md) | work that spans phases or stacked PRs. |
| [worktree cleanup](skills/poteto-mode/playbooks/worktree-cleanup.md) | reclaim disk by pruning merged or abandoned worktrees and stale simulators, safety-gated. |
| [opening a pr](skills/poteto-mode/playbooks/opening-a-pr.md) | open a ready PR from small ordered commits with a briefing-style body. Every other playbook ends here. |

## Example prompts

Each line is one prompt to paste into Pi.

```text
/poteto-mode this PR has a subtle bug where the scroll drifts every 750ms even when idle. repro first, then fix and verify.
/poteto-mode add a --json flag to this command. text output stays byte-identical. verify both forms.
/poteto-mode move parsing into one module with zero behavior change. record the current output first and prove it is unchanged.
/poteto-mode startup takes 1.8s on this fixture. trace it, fix the measured cause, and show me before and after.
/poteto-mode new task. figure out why the cache entry survives logout. don't change any code yet.
/poteto-mode im going to bed. land the stack even if CI flakes. i want everything merged by morning.
/poteto-mode take over this branch. read the decision log, figure out what's done, and continue from there.
/poteto-mode what's eating my disk? prune the worktrees that are safe to prune.
/poteto-mode write a skill for verifying database migrations in this repo.
/poteto-mode run the eval playbook on this skill change. same task for both variants, candidates stay blind.
/how do we dedupe notifications? is there an n+1 when we look up subscribers?
/why was the retry limit set to five? does the reason still hold?
/teach me how this PR changes retries. convince me it fixes the cause and not the symptom.
/recall catch me up on the export work from last week.
/architect design the import pipeline before writing any code. i care most about how callers use it.
/arena this, 5 candidates. the cache key format is expensive to change later.
/swarm check every package under packages/ against its check.sh. one worker per package.
/interrogate review this PR. no nitpicks unless it is an actual bug or regression.
/tdd implement
/blast-radius what else could this one-line change to the parser break?
```

## Skills to use directly

`/poteto-mode` runs most of these for you when a step needs them. This table is for when you want one directly. Every skill also loads with Pi's `/skill:name` form.

| skill | use it when |
|---|---|
| [`/poteto-mode`](skills/poteto-mode/SKILL.md) | the default entry point for any non-trivial task. |
| [`/how`](skills/how/SKILL.md) | you want a walkthrough of how a subsystem works. |
| [`/why`](skills/why/SKILL.md) | you want to know why something was built this way. It queries each evidence category your tools expose, such as source control, the issue tracker, docs, chat, observability, and error tracking, in parallel. |
| [`/recall`](skills/recall/SKILL.md) | you are starting or resuming work and want your recent context on a topic rebuilt from your own Pi sessions and the shared record. |
| [`/blast-radius`](skills/blast-radius/SKILL.md) | you have a small-looking change and want to know what else it could break, with the one fact that makes it safe proven by running code. |
| [`/architect`](skills/architect/SKILL.md) | you are about to write code that crosses a function boundary and want the caller's usage, types, and module shape settled first. |
| [`/arena`](skills/arena/SKILL.md) | you want N parallel attempts at the same thing, then the best parts of each. |
| [`/swarm`](skills/swarm/SKILL.md) | you want N parallel workers across different slices or races, then one aggregated report. |
| [`/interrogate`](skills/interrogate/SKILL.md) | you have a diff and want several different models to try to break it, including a strict code-quality lens. |
| [`/automate-me`](skills/automate-me/SKILL.md) | you want your own `-mode` skill, drafted from how you have actually worked. |
| [`/make-bot-ui`](skills/make-bot-ui/SKILL.md) | you want a page or dashboard whose buttons wake a persistent Pi routine over an authenticated webhook. In Pi it runs through the routine adapter at `host/adapters/make-bot-ui/SKILL.md`, which calls `RoutinePrepare` and `RoutineEnable` and keeps the sender key out of chat and browser code. It is off the main path, so `/poteto-mode` does not route to it. |
| [`/setup-pstack`](skills/setup-pstack/SKILL.md) | you want to pick which models pstack uses per role. It detects your models and writes the model rule. |
| [`/reflect`](skills/reflect/SKILL.md) | a long task landed and you want the recipe captured as a skill edit. |
| [`/teach`](skills/teach/SKILL.md) | you want to actually understand a change or subsystem, not just have it summarized. |
| [`/tdd`](skills/tdd/SKILL.md) | you are fixing a bug and there is a cheap local test path. Write the failing test first, then the fix. |
| [`/no-comments`](skills/no-comments/SKILL.md) | you want comments stripped before review. |
| [`/typescript-best-practices`](skills/typescript-best-practices/SKILL.md) | you are reading or editing TypeScript. It grounds the type-system-discipline principle in syntax. |
| [`/figure-it-out`](skills/figure-it-out/SKILL.md) | no bundled playbook fits. It designs a rigorous, auditable playbook for the task. |
| [`/show-me-your-work`](skills/show-me-your-work/SKILL.md) | you want a reviewable decision trail logged to a TSV you can commit. |
| [`/create-verification-skill`](skills/create-verification-skill/SKILL.md) | your project has no scripted way to prove app behavior. It generates a project-local verify skill with a feature map. |
| [`/maintain-verification-skill`](skills/maintain-verification-skill/SKILL.md) | your verify skill's feature map has drifted from the app. |
| [`/unslop`](skills/unslop/SKILL.md) | you are cleaning up writing and want AI tells removed. |
| [`/technical-writing`](skills/technical-writing/SKILL.md) | you are writing docs, RFCs, readmes, PR descriptions, or commit messages to a layered standard. |
| [`/bro`](prompts/bro.md) | you want the last message restated in plain human language. It is a prompt template, not a skill. |

## Team-kit workflows

Pstack's required `/deslop`, `/control-cli`, and `/control-ui` skills are bundled. The kit also adds `/verify-this`, CI and PR workflows, `/pr-review-canvas` with its HTML, CSS, and renderer, and the complete strict code-review rubric. Every skill supports both its short alias and `/skill:name`.

The kit's two `alwaysApply` rules remain in the source archive. The observed Reference CLI does not deliver plugin rules to the model, so this port does not inject them. Pi has no rules facility. Context files such as `AGENTS.md`, and `APPEND_SYSTEM.md`, still apply. The host contract maps upstream rule, create-skill, MCP, and tool-name references to their Pi facilities.

CLI and UI workflows use the project's existing terminal or browser tools. Bundling instructions does not install tmux, Playwright, Chromium, or GitHub credentials. `loop-on-ci` watches CI through GitHub CLI.

## Loops

`/loop [interval] <prompt>` runs a prompt on a fixed interval, on a self-paced heartbeat, or when a watched event fires. It ports the local half of Reference's synced loop skill. The skill text in `host/skills/loop` is written for Pi, not copied. `BackgroundShell` starts a shell and wakes the agent on each output line that matches `notify_on_output`, and when the shell exits unless it already matched and exited with status zero. A successful exit after a match sends no redundant exit notification. If writing the output log fails, `BackgroundShell` still sends an exit wake, even after a match and a zero exit. While one wake is queued, later matches from the same shell are counted, not queued, so a slow turn never builds a backlog. A match during a busy parent turn is delivered when that turn ends. `BackgroundShellStop` drops that held wake, and an aborted turn keeps it until a later turn ends. `BackgroundShellList` and `BackgroundShellStop` find and stop shells. Stopping signals the shell's process group and returns within a bounded wait even when a descendant escaped that group, and a descendant that calls `setsid` and inherits the pipes outlives the session. Shells end when the session quits, reloads, or switches. Cloud timers are not supplied.

## Goals

`/goal <objective>` arms a goal that Pi pursues across turns. `CreateGoal`, `GetGoal`, and `UpdateGoal` are model-callable, so a playbook that says to arm a `/goal` does so itself. The goal lives on the session branch. While it is active, each finished turn queues a continuation until `UpdateGoal` marks it complete after a completion audit. An aborted or failed turn does not continue. `/goal clear` drops it. A leading time limit is rejected with a notice. The host skills `goal`, `create-skill` (targets Pi's skill format and paths), and `origin` (origin CLI setup and repair) are Pi ports of the Reference built-ins.

## Local agents

`Task` starts a local SDK session. A foreground call streams sanitized child tool-start, tool-finish, and retry snapshots into the active Task row. The snapshots omit child arguments, results, and shell output. RPC clients receive the same partial updates and render them themselves.

A background call returns a task ID and sends a completion message. It receives no progress after the tool call returns. `TaskOutput` reads or waits for the result. Pi announces a task that finishes during a parent turn when that turn ends, unless the turn already read or stopped the task. After an aborted turn, the announcement waits for the next turn to end. `TaskMessage` sends steering or follow-up input. `TaskStop` aborts a task. `Task` with `resume` continues the same child transcript.

Supported personas are `generalPurpose`, `poteto-agent`, `comment-sicko` with alias `Comment Sicko`, `ci-watcher`, and `thermo-nuclear-code-quality-review`. The last includes the complete team-kit rubric. The CI watcher inherits the parent model, matching the observed Reference plugin loader. An explicit pi model selection overrides inheritance. Resume retains the previously selected model unless the Task call supplies an explicit model. The original persona file still records its author-requested `fast` selector.

Native `shell` and `explore` personas cover the built-in roles that the kit's review agent calls. The thermo review persona can consume a diff and file contents they collect.

A terminal child closes its session and cancels unfinished descendants. Workers must collect every required child result before returning their final answer. Resuming opens the same persisted transcript in a new SDK session.

Use a separate worktree when a workflow requires isolated writes. A child session does not isolate its filesystem. Readonly tasks restrict tools and disable extensions. They are not an operating-system sandbox. Writable children discover installed pi extensions, so service tools require those integrations to be installed.

Readonly tasks copy the selected provider registration into an isolated model runtime without loading its tool extensions. Failed foreground tasks preserve their nested model usage in the failed tool result. Background model usage enters parent totals when the parent retrieves the result with `TaskOutput` or `TaskStop`; unclaimed usage persists on the active branch across reloads and is charged only once. Resuming a task retains any pending usage.

`environment: "cloud"` starts a detached Pi root on a configured isolated VM executor, at `cloud_base_branch` (the local branch, else `origin/<branch>`) or the parent's committed HEAD. `remote_executor` selects the executor from `executors.json`. Uncommitted parent changes are not copied. Without a configured executor the Task fails with an explicit error and never falls back to local execution. Resume keeps the executor and checkout SHA, `TaskAttach` re-attaches a task launched earlier in the same repository, and the detached root outlives the parent session.

## Reference Assistant subagents

The `task`, `read_agent`, `write_agent`, and `list_agents` tools implement the subagent contract reconstructed from Reference Assistant CLI 1.0.91. `task` dispatches one of the eight built-in agents (`general-purpose`, `explore`, `task`, `code-review`, `security-review`, `research`, `rubber-duck`, `rem-agent`) or any custom agent defined in `~/.reference-assistant/agents`, `~/.pi/agent/agents`, or a repository's `.github/agents` or `.pi/agents` directories. `mode: "sync"` waits for the child's final message; `mode: "background"` returns an `agent_id` at once and wakes the parent when the agent goes idle. `read_agent` reads responses with `wait`, `timeout`, and `since_turn`; `write_agent` sends follow-ups to background agents that are running or idle; `list_agents` lists them.

A root session configures the depth and concurrency limiter once from `subagents.maxDepth` and `subagents.maxConcurrency`; nested spawns reach the same slots through their parent. Model choice resolves per call from the task argument, `subagents.agents.<type>` settings (`model`, `modelPolicy`, `effortLevel`, `contextTier`), and the definition's own candidates, then reports its provenance on `subagent.started`. `/subagents` edits the preferences, `/tasks` lists agents, `/rubber-duck` and `/fleet` inject delegation prompts, and the `session.tasks`, `session.tools`, `session.agent`, and `session.workflow` RPC methods answer over the extension bus. Execution and search subagents exist behind their feature flags with their own model and turn caps. Sidekicks run on their own task store and deliver through `send_inbox`. `defineWorkflow` registers dynamic workflows with durable runs behind `COPILOT_DYNAMIC_WORKFLOWS=1`.

Each subagent is an SDK `AgentSessionRuntime`, so closing one emits `session_shutdown` before it disposes the session. A child loads the pi `codemode`, `tool_search` and MCP extensions the CLI loads as built-ins, which is how it connects the MCP servers its parent registered. It reads project settings and project extensions only where the parent trusts the project. Subagent settings come from `pi.getSettings()`, so they follow pi's project trust too. `task`, `read_agent` and the specialized tools return their result as `structuredContent`, report the usage of a sync child so pi adds it to the session totals, and cut a long reply to pi's output limit with a pointer to the child's transcript. Dynamic workflow runs persist as `reference-assistant-workflow` session entries and follow the active branch.

The parity matrix in `docs/subagents-parity.tsv` is the contract: one row per behavior in the reconstruction, closed only when its implementation and test pointers resolve. `bun run check:parity` enforces it. `docs/subagents-native-gaps.md` records every custom adapter that remains, and `bun run check:native-first` fails when a stand-in for a pi mechanism appears anywhere else.

## Models and state

The model rule lives in `~/.pi/agent/pstack/models.mdc`, or the corresponding directory under `PI_CODING_AGENT_DIR`. It retains all upstream role names and panel ordering. Repeated `auto` or `inherit-parent` entries remain separate seats.

`/setup-pstack` and `/skill:setup-pstack` run the extension's validated dialogs. The setup skill is hidden from automatic model selection so that a natural-language request cannot bypass them. A saved rule applies from the next prompt.

Model selections use pi provider/model IDs, optionally followed by a supported thinking level, such as `provider/model:high`. Reference model names are preserved in the source defaults. An unavailable name fails with available choices. The adapter does not silently substitute a model family.

Mode, todo, and task records follow the current session branch. Child transcripts and complete outputs live under the parent session directory's `pstack-workers` folder; a session that is not persisted uses a temporary directory instead. An unfinished restored task is interrupted until resumed. Use `pstack_context` for the active transcript and history scoped to the current workspace.

## Source and maintenance

`upstream/` contains the complete pinned plugin, including its license, scripts, tests, guides, images, and dormant Benny automation pack. The package does not register Benny's operational skills as public commands.

`upstream-team-kit/` contains all 29 files from the pinned team-kit plugin, with its license, manifest, agents, rules, and canvas assets. The original pstack snapshot remains unchanged.

`skills/` contains 142 files and `prompts/` contains 63 templates generated from both snapshots. The generator normalizes two display names, removes unsupported Reference frontmatter, and maps model-rule, skill-authoring, transcript, and repository paths to Pi locations. The generated worktree audit reads Pi session directories. It retains the workflow bodies and supporting resources, with `bro` moved to a prompt template. It rejects overlapping source destinations before writing. [The resource map](docs/resource-map.json) lists every generated file and transformation. It is a maintenance inventory, not a Pi manifest or API.

Development verification requires Node, Bun, and uv. From the repository root, `make verify` runs all maintained checks and the isolated helper suite. Use these commands inside this directory:

```sh
bun install
bun run check:resources
bun run typecheck
bun run test
bun run test:coverage
bun run check:cli
bun run check:upstream
bun run check:journeys
bun run check:progress-tui
```

`bun run check:journeys` starts the real Pi CLI against the package with a deterministic local provider. It loads every skill and prompt template as a user would, drives the mode, status, todo, context, dialog, delegation, shell, setup, helper-script, and worktree journeys, and reports one line per check. `bun run check:progress-tui` requires Pi 1.0.0 and tmux. It launches an isolated TUI with the deterministic provider and checks the visible foreground Task updates.

`bun run generate` recreates the operational skills and prompts from the immutable snapshot. The checker rejects changed upstream hashes and generated resource drift. Do not edit generated resources directly.

The CLI check starts an isolated local pi process and exercises RPC commands without model calls. Helper scripts may install their locked dependencies into their generated `node_modules` directory. The resource checker excludes that dependency directory and still checks every generated source file.

The [changelog](CHANGELOG.md) lists each `-pi.N` revision. A pull request workflow at the repository root (`.github/workflows/pi-pstack.yml`) runs `bun run check:resources`, `bun run typecheck`, and `bun run test` for changes under this directory.

[Provenance](docs/provenance.json), [source audit](docs/source-audit.md), [architecture](docs/architecture.md), and [decision trail](docs/decisions.tsv) document the implementation. Original portable helper scripts retain their own runtime dependencies, including Bun, git, and GitHub CLI where required.

The [Pi mechanism audit](docs/mechanism-audit.md) records the facility classifications, fixes, verification, and invocation changes.

The [earlier comprehensive audit](docs/comprehensive-audit.md) records rule checks, reference parity corrections, regression tests, and approved source-preservation conflicts. The [AGENTS compliance audit](docs/agents-compliance.md) records subsequent fixes, verification, compatibility changes, and remaining findings. The [research parity audit](docs/research-parity-audit.md) checks each claim in the pstack ecosystem reverse-engineering report.
