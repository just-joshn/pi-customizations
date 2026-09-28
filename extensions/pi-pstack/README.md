# pstack for pi

This Pi package ports pstack 0.15.5 and cursor-team-kit 1.2.0 workflows to Pi 0.87.1. It preserves 187 upstream files and all 65 workflow entry points through 64 skills and 63 prompt templates. A Pi-authored loop skill and `/loop` template add a 65th skill and 64th template. Its extension supplies executable behavior. It does **not** provide 100% behavior parity with Cursor. Required Cursor services and external integrations remain unavailable. Read the [compatibility report](docs/parity.md) before using those workflows.

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

Workflow templates obtain the bundled skill path from the extension's host context. Enable the package extension when using these aliases. Native `/skill:name` invocation remains available when only skills are loaded. Templates do not recursively invoke `/skill:` commands or enforce the skill's instructions.

Pi parses template arguments with shell-like quoting and joins them with spaces. Quote characters are delimiters and are removed, so `it's` arrives as `its`. An unpaired quote swallows the rest of the line into the same argument, and unquoted line breaks become spaces. Use `/skill:name` when the request must arrive exactly as typed.

The runtime uses current `@earendil-works` pi packages. Host dependencies are peers. SDK 0.87.1 is the development and verification target. Other versions have not been verified.

## Team-kit workflows

Pstack's required `/deslop`, `/control-cli`, and `/control-ui` skills are bundled. The kit also adds `/verify-this`, CI and PR workflows, `/pr-review-canvas` with its HTML, CSS, and renderer, and the complete strict code-review rubric. Every skill supports both its short alias and `/skill:name`.

The kit's two `alwaysApply` rules remain in the source archive. The observed Cursor CLI does not deliver plugin rules to the model, so this port does not inject them. Pi has no rules facility. Context files such as `AGENTS.md`, and `APPEND_SYSTEM.md`, still apply. The host contract maps upstream rule, create-skill, MCP, and tool-name references to their Pi facilities.

CLI and UI workflows use the project's existing terminal or browser tools. Bundling instructions does not install tmux, Playwright, Chromium, or GitHub credentials. `loop-on-ci` watches CI through GitHub CLI.

## Loops

`/loop [interval] <prompt>` runs a prompt on a fixed interval, on a self-paced heartbeat, or when a watched event fires. It ports the local half of Cursor's synced loop skill. The skill text in `host/skills/loop` is written for Pi, not copied. `BackgroundShell` starts a shell and wakes the agent on each output line that matches `notify_on_output`. While one wake is queued, later matches from the same shell are counted, not queued, so a slow turn never builds a backlog. A match during a busy parent turn is delivered when that turn ends. `BackgroundShellStop` drops that held wake, and an aborted turn keeps it until a later turn ends. `BackgroundShellList` and `BackgroundShellStop` find and stop shells. Stopping signals the shell's process group and returns within a bounded wait even when a descendant escaped that group, and a descendant that calls `setsid` and inherits the pipes outlives the session. Shells end when the session quits, reloads, or switches. Cloud timers are not supplied.

## Local agents

`Task` starts a local SDK session. Background calls return a task ID and deliver a completion message. `TaskOutput` reads or waits for its result. A task that finishes during a parent turn is announced when that turn ends, unless the turn already read its result with `TaskOutput` or `TaskStop`. After an aborted turn, the announcement waits for the next turn to end. `TaskMessage` sends steering or follow-up input. `TaskStop` aborts it. `Task` with `resume` continues the same child transcript.

Supported personas are `generalPurpose`, `poteto-agent`, `comment-sicko` with alias `Comment Sicko`, `ci-watcher`, and `thermo-nuclear-code-quality-review`. The last includes the complete team-kit rubric. The CI watcher inherits the parent model, matching the observed Cursor plugin loader. An explicit pi model selection overrides inheritance. Resume retains the previously selected model unless the Task call supplies an explicit model. The original persona file still records its author-requested `fast` selector.

Cursor's built-in `shell` and `explore` personas are not defined by either source plugin and remain unsupported. The thermo review persona can consume a diff and file contents collected with ordinary tools, but its prescribed built-in collector orchestration is not reproduced.

A terminal child closes its session and cancels unfinished descendants. Workers must collect every required child result before returning their final answer. Resuming opens the same persisted transcript in a new SDK session.

Use a separate worktree when a workflow requires isolated writes. A child session does not isolate its filesystem. Readonly tasks restrict tools and disable extensions. They are not an operating-system sandbox. Writable children discover installed pi extensions, so service tools require those integrations to be installed.

Readonly tasks copy the selected provider registration into an isolated model runtime without loading its tool extensions. Failed foreground tasks preserve their nested model usage in the failed tool result. Background model usage enters parent totals when the parent retrieves the result with `TaskOutput` or `TaskStop`; unclaimed usage persists on the active branch across reloads and is charged only once. Resuming a task retains any pending usage.

`environment: "cloud"` fails explicitly. It never runs a cloud-required task locally without an explicit change of scope. Child processes do not survive parent shutdown as hosted Cursor cloud agents do.

## Models and state

The model rule lives in `~/.pi/agent/pstack/models.mdc`, or the corresponding directory under `PI_CODING_AGENT_DIR`. It retains all upstream role names and panel ordering. Repeated `auto` or `inherit-parent` entries remain separate seats.

`/setup-pstack` and `/skill:setup-pstack` run the extension's validated dialogs. The setup skill is hidden from automatic model selection so that a natural-language request cannot bypass them. A saved rule applies from the next prompt.

Model selections use pi provider/model IDs, optionally followed by a supported thinking level, such as `provider/model:high`. Cursor model names are preserved in the source defaults. An unavailable name fails with available choices. The adapter does not silently substitute a model family.

Mode, todo, and task records follow the current session branch. Child transcripts and complete outputs live under the parent session directory's `pstack-workers` folder. An unfinished restored task is interrupted until resumed. Use `pstack_context` for the active transcript and history scoped to the current workspace.

## Source and maintenance

`upstream/` contains the complete pinned plugin, including its license, scripts, tests, guides, images, and dormant Benny automation pack. The package does not register Benny's operational skills as public commands.

`upstream-team-kit/` contains all 29 files from the pinned cursor-team-kit plugin, with its license, manifest, agents, rules, and canvas assets. The original pstack snapshot remains unchanged.

`skills/` contains 142 files and `prompts/` contains 63 templates generated from both snapshots. The generator normalizes two display names, removes unsupported Cursor frontmatter, and maps model-rule, skill-authoring, transcript, and repository paths to Pi locations. The generated worktree audit reads Pi session directories. It retains the workflow bodies and supporting resources, with `bro` moved to a prompt template. It rejects overlapping source destinations before writing. [The resource map](docs/resource-map.json) lists every generated file and transformation. It is a maintenance inventory, not a Pi manifest or API.

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
```

`bun run check:journeys` starts the real Pi CLI against the package with a deterministic local provider. It loads every skill and prompt template as a user would, drives the mode, status, todo, context, dialog, delegation, shell, setup, helper-script, and worktree journeys, and reports one line per check.

`bun run generate` recreates the operational skills and prompts from the immutable snapshot. The checker rejects changed upstream hashes and generated resource drift. Do not edit generated resources directly.

The CLI check starts an isolated local pi process and exercises RPC commands without model calls. Helper scripts may install their locked dependencies into their generated `node_modules` directory. The resource checker excludes that dependency directory and still checks every generated source file.

[Provenance](docs/provenance.json), [source audit](docs/source-audit.md), [architecture](docs/architecture.md), and [decision trail](docs/decisions.tsv) document the implementation. Original portable helper scripts retain their own runtime dependencies, including Bun, git, and GitHub CLI where required.

The [Pi mechanism audit](docs/mechanism-audit.md) records the facility classifications, fixes, verification, and invocation changes.

The [earlier comprehensive audit](docs/comprehensive-audit.md) records rule checks, reference parity corrections, regression tests, and approved source-preservation conflicts. The [AGENTS compliance audit](docs/agents-compliance.md) records subsequent fixes, verification, compatibility changes, and remaining findings. The [research parity audit](docs/research-parity-audit.md) checks each claim in the pstack ecosystem reverse-engineering report.
