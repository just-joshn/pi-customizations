# pstack for pi

This Pi package ports pstack 0.15.5 and cursor-team-kit 1.2.0 workflows to Pi 0.87.1. It preserves 187 upstream files and all 65 workflow entry points through 64 skills and 63 prompt templates. Its extension supplies executable behavior. It does **not** provide 100% behavior parity with Cursor. Required Cursor services and external integrations remain unavailable. Read the [compatibility report](docs/parity.md) before using those workflows.

## Install

From this repository root, run:

```sh
pi install ./extensions/pi-pstack
```

Reload an existing pi session with `/reload`. Run `/pstack` to inspect status and `/setup-pstack` to select available models for each role. Setup requires terminal or RPC dialogs and confirms the complete table before saving.

Start a task with `/poteto-mode your task`. The mode persists on that session branch until `/poteto-mode off`. Natural-language opt-in and opt-out use the model-callable `pstack_mode` tool. `/poteto-mode`, `/setup-pstack`, and `/pstack` are extension commands. Workflow aliases such as `/how`, `/architect`, and `/swarm` are prompt templates that ask the model to read the corresponding skill. Pi's `/skill:name` form loads those instructions directly. `/bro` is a standalone prompt template; use it instead of the retired `/skill:bro`.

Workflow templates obtain the bundled skill path from the extension's host context. Enable the package extension when using these aliases. Native `/skill:name` invocation remains available when only skills are loaded. Templates do not recursively invoke `/skill:` commands or enforce the skill's instructions.

The runtime uses current `@earendil-works` pi packages. Host dependencies are peers. SDK 0.87.1 is the development and verification target. Other versions have not been verified.

## Team-kit workflows

Pstack's required `/deslop`, `/control-cli`, and `/control-ui` skills are bundled. The kit also adds `/verify-this`, CI and PR workflows, `/pr-review-canvas` with its HTML, CSS, and renderer, and the complete strict code-review rubric. Every skill supports both its short alias and `/skill:name`.

The kit's two `alwaysApply` rules remain in the source archive. The observed Cursor CLI does not deliver plugin rules to the model, so this port does not inject them. Project rules supplied through pi still apply.

CLI and UI workflows use the project's existing terminal or browser tools. Bundling instructions does not install tmux, Playwright, Chromium, or GitHub credentials. `loop-on-ci` watches CI through GitHub CLI. It does not supply the background shell notifications or cloud timers used by Cursor's synced `/loop` skill.

## Local agents

`Task` starts a local SDK session. Background calls return a task ID and deliver a completion message. `TaskOutput` reads or waits for its result. `TaskMessage` sends steering or follow-up input. `TaskStop` aborts it. `Task` with `resume` continues the same child transcript.

Supported personas are `generalPurpose`, `poteto-agent`, `comment-sicko` with alias `Comment Sicko`, `ci-watcher`, and `thermo-nuclear-code-quality-review`. The last includes the complete team-kit rubric. The CI watcher inherits the parent model, matching the observed Cursor plugin loader. An explicit pi model selection overrides inheritance. Resume retains the model already selected. The original persona file still records its author-requested `fast` selector.

Cursor's built-in `shell` and `explore` personas are not defined by either source plugin and remain unsupported. The thermo review persona can consume a diff and file contents collected with ordinary tools, but its prescribed built-in collector orchestration is not reproduced.

A terminal child closes its session and cancels unfinished descendants. Workers must collect every required child result before returning their final answer. Resuming opens the same persisted transcript in a new SDK session.

Use a separate worktree when a workflow requires isolated writes. A child session does not isolate its filesystem. Readonly tasks restrict tools and disable extensions. They are not an operating-system sandbox. Writable children discover installed pi extensions, so service tools require those integrations to be installed.

Readonly tasks copy the selected provider registration into an isolated model runtime without loading its tool extensions. Failed foreground tasks preserve their nested model usage in the failed tool result. Background model usage enters parent totals when the parent retrieves the result with `TaskOutput` or `TaskStop`; unclaimed usage persists on the active branch across reloads and is charged only once. Resuming a task retains any pending usage.

`environment: "cloud"` fails explicitly. It never runs a cloud-required task locally without an explicit change of scope. Child processes do not survive parent shutdown as hosted Cursor cloud agents do.

## Models and state

The model rule lives in `~/.pi/agent/pstack/models.mdc`, or the corresponding directory under `PI_CODING_AGENT_DIR`. It retains all upstream role names and panel ordering. Repeated `auto` or `inherit-parent` entries remain separate seats.

Model selections use pi provider/model IDs, optionally followed by a supported thinking level, such as `provider/model:high`. Cursor model names are preserved in the source defaults. An unavailable name fails with available choices. The adapter does not silently substitute a model family.

Mode, todo, and task records follow the current session branch. Child transcripts and complete outputs live under the parent session directory's `pstack-workers` folder. An unfinished restored task is interrupted until resumed. Use `pstack_context` for the active transcript and history scoped to the current workspace.

## Source and maintenance

`upstream/` contains the complete pinned plugin, including its license, scripts, tests, guides, images, and dormant Benny automation pack. The package does not register Benny's operational skills as public commands.

`upstream-team-kit/` contains all 29 files from the pinned cursor-team-kit plugin, with its license, manifest, agents, rules, and canvas assets. The original pstack snapshot remains unchanged.

`skills/` contains 142 files and `prompts/` contains 63 templates generated from both snapshots. The generator normalizes two display names, removes unsupported Cursor frontmatter, and maps model-rule and skill-authoring paths to Pi locations. It retains the workflow bodies and supporting resources, with `bro` moved to a prompt template. It rejects overlapping source destinations before writing. [The resource map](docs/resource-map.json) lists every generated file and transformation. It is a maintenance inventory, not a Pi manifest or API.

Development verification requires Node/npm, uv, and Bun. From the repository root, `make verify` runs all maintained checks and the isolated helper suite. Use these commands inside this directory:

```sh
npm install
npm run check:resources
npm run typecheck
npm test
npm run test:coverage
npm run check:cli
npm run check:upstream
```

`npm run generate` recreates the operational skills and prompts from the immutable snapshot. The checker rejects changed upstream hashes and generated resource drift. Do not edit generated resources directly.

The CLI check starts an isolated local pi process and exercises RPC commands without model calls. Helper scripts may install their locked dependencies into their generated `node_modules` directory. The resource checker excludes that dependency directory and still checks every generated source file.

[Provenance](docs/provenance.json), [source audit](docs/source-audit.md), [architecture](docs/architecture.md), and [decision trail](docs/decisions.tsv) document the implementation. Original portable helper scripts retain their own runtime dependencies, including Bun, git, and GitHub CLI where required.

The [Pi mechanism audit](docs/mechanism-audit.md) records the facility classifications, fixes, verification, and invocation changes.

The [comprehensive audit](docs/comprehensive-audit.md) records the current rule checks, reference parity corrections, regression tests, and approved source-preservation conflicts.
