# pstack for pi

This package ports pstack 0.15.5 and cursor-team-kit 1.2.0 workflows to pi 0.87.1. It preserves 187 upstream files and exposes 65 public skills. It does **not** provide 100% behavior parity with Cursor. Required Cursor services and external integrations remain unavailable. Read the [compatibility report](docs/parity.md) before using those workflows.

## Install

From this repository root, run:

```sh
pi install ./extensions/pi-pstack
```

Reload an existing pi session with `/reload`. Run `/pstack` to inspect status and `/setup-pstack` to select available models for each role. Setup requires terminal or RPC dialogs and confirms the complete table before saving.

Start a task with `/poteto-mode your task`. The mode persists on that session branch until `/poteto-mode off`. Natural-language opt-in and opt-out use the model-callable `pstack_mode` tool. Each public skill also has its original slash alias, such as `/how`, `/architect`, `/swarm`, and `/bro`. Pi's `/skill:poteto-mode` form is supported.

The runtime uses current `@earendil-works` pi packages. Host dependencies are peers. SDK 0.87.1 is the development and verification target. Other versions have not been verified.

## Team-kit workflows

Pstack's required `/deslop`, `/control-cli`, and `/control-ui` skills are bundled. The kit also adds `/verify-this`, CI and PR workflows, `/pr-review-canvas` with its HTML, CSS, and renderer, and the complete strict code-review rubric. Every skill supports both its short alias and `/skill:name`.

The kit's two `alwaysApply` rules require top-level imports and exhaustive TypeScript switches. They apply with Poteto mode on or off, including in readonly workers. These are model instructions, not compiler checks.

CLI and UI workflows use the project's existing terminal or browser tools. Bundling instructions does not install tmux, Playwright, Chromium, or GitHub credentials. `loop-on-ci` watches CI through GitHub CLI. It does not implement Cursor's persistent `/loop` scheduler.

## Local agents

`Task` starts a local SDK session. Background calls return a task ID and deliver a completion message. `TaskOutput` reads or waits for its result. `TaskMessage` sends steering or follow-up input. `TaskStop` aborts it. `Task` with `resume` continues the same child transcript.

Supported personas are `generalPurpose`, `poteto-agent`, `comment-sicko` with alias `Comment Sicko`, `ci-watcher`, and `thermo-nuclear-code-quality-review`. The last includes the complete team-kit rubric. The CI watcher preserves the source's `fast` model request. Supply an exact available pi `model` or an explicit `inherit-parent` choice when that selector is unavailable. Resume retains the model already selected.

Cursor's built-in `shell` and `explore` personas are not defined by either source plugin and remain unsupported. The thermo review persona can consume a diff and file contents collected with ordinary tools, but its prescribed built-in collector orchestration is not reproduced.

A terminal child closes its session and cancels unfinished descendants. Workers must collect every required child result before returning their final answer. Resuming opens the same persisted transcript in a new SDK session.

Use a separate worktree when a workflow requires isolated writes. A child session does not isolate its filesystem. Readonly tasks restrict tools and disable extensions. They are not an operating-system sandbox. Writable children discover installed pi extensions, so service tools require those integrations to be installed.

Readonly tasks also disable providers supplied only by extensions. Use a configured built-in provider for those tasks. Background model usage enters parent totals when the parent retrieves the result with `TaskOutput` or `TaskStop`; uncollected usage is not recovered after a reload.

`environment: "cloud"` fails explicitly. It never runs a cloud-required task locally without an explicit change of scope. Child processes do not survive parent shutdown as hosted Cursor cloud agents do.

## Models and state

The model rule lives in `~/.pi/agent/pstack/models.mdc`, or the corresponding directory under `PI_CODING_AGENT_DIR`. It retains all upstream role names and panel ordering. Repeated `auto` or `inherit-parent` entries remain separate seats.

Model selections use pi provider/model IDs, optionally followed by a supported thinking level, such as `provider/model:high`. Cursor model names are preserved in the source defaults. An unavailable name fails with available choices. The adapter does not silently substitute a model family.

Mode, todo, and task records follow the current session branch. Child transcripts and complete outputs live under the parent session directory's `pstack-workers` folder. An unfinished restored task is interrupted until resumed. Use `pstack_context` for the active transcript and history scoped to the current workspace.

## Source and maintenance

`upstream/` contains the complete pinned plugin, including its license, scripts, tests, guides, images, and dormant Benny automation pack. The package does not register Benny's operational skills as public commands.

`upstream-team-kit/` contains all 29 files from the pinned cursor-team-kit plugin, with its license, manifest, agents, rules, and canvas assets. The original pstack snapshot remains unchanged.

`skills/` contains 143 resources generated from both snapshots. The generator normalizes two display names to valid pi names and maps model-rule and skill-authoring paths to pi locations. It preserves every other byte and rejects overlapping source destinations before writing. [The resource map](docs/resource-map.json) lists every generated file and transformation.

Use these commands inside this directory:

```sh
npm install
npm run check:resources
npm run typecheck
npm test
npm run check:cli
```

`npm run generate` recreates the operational skills from the immutable snapshot. The checker rejects changed upstream hashes and generated resource drift. Do not edit generated skills directly.

The CLI check starts an isolated local pi process and exercises RPC commands without model calls. Helper scripts may install their locked dependencies into their generated `node_modules` directory. The resource checker excludes that dependency directory and still checks every generated source file.

[Provenance](docs/provenance.json), [source audit](docs/source-audit.md), [architecture](docs/architecture.md), and [decision trail](docs/decisions.tsv) document the implementation. Original portable helper scripts retain their own runtime dependencies, including Bun, git, and GitHub CLI where required.
