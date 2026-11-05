# Source-backed parity continuation

The goal is complete behavioral parity for Cursor pstack through Pi-native mechanisms. The completion predicate requires a source-backed contract for every discovered behavior, a working equivalent, real runtime checks, and no unresolved material gap. That predicate is not met.

## Reference baseline

`baseline.json` pins the reference checkout at `bb68f2365eceafa0cb2d253112f675acf5f144cc`. It records hashes of pstack, cursor-team-kit, pr-review-canvas, and create-plugin files. The repository starts at `0632cee3ef7d7507861974184b9faed49e5b28cb`.

Cursor desktop 3.27.22 is installed under `/usr/share/cursor/resources/app`. Cursor CLI is `2026.10.22-27dcf5f`. Pi is 1.5.0. The desktop distro is `d5c0e77a0214208f36b56d42e8e787de88d02ea4`.

The earlier report at `../pstack-parity-2026-11-05/report.md` is background material, not authority. Its claim that desktop is absent is false on this host. Its broad verified statuses have not been established again in this run.

## Workflow and rigor

1. Pin reference sources and capture host contracts with hashes and offsets.
2. Audit dependencies and conditional paths. Keep unknown contracts separate from confirmed ones.
3. Specify each mismatch with the requested 17 fields before implementation.
4. Implement one cohesive unit. First demonstrate its failure through real Pi, then run narrow tests, runtime checks, and a controlled mutation.
5. Return to reference sources for a separate confirmation.
6. Attempt to disprove the conclusion and record remaining gaps.

No LLM agents are permitted. I perform the how and architect investigations, implementation, tests, and reviews personally. Tests may drive real Pi with the deterministic faux provider. Those tests do not establish instruction-following by an LLM.

The full reference review is unfinished. Capturing file hashes does not mean reading every file. The earlier file-level inventory does not establish every branch or workflow. Hosted execution, hosted triggers, embedded UI, and model-specific behavior remain under investigation.

## Units

1. Shell subagent and type lookup. Done: red baseline, green treatment, mutation caught.
2. Plugin-agent loading, system reminders, model aliases, resume type checks, empty prompts. Done: fixture from Cursor's executed code, unit and real-Pi tests, five mutations caught, full package suite green after a README wording fix.
3. Resume of a running agent. Done. Desktop's agent host (`throwIfFollowupTargetsBusyRun`) and the live CLI schema refuse it with `Sub-agent is currently running. You may send the follow-up message when it has completed.` Pi now refuses it the same way in one process and across processes, the steering machinery is deleted, and poteto-mode's steer and hold sentences are pstack's text again. Mutations `running-text` and `lock-mapping` are caught.
4. Task description and parameter text. Done. `probe-task.mjs` runs desktop's description builder with the live session's flags and asserts byte equality with that session, then Pi applies six named wording changes. Mutations `task-description` and `resume-param` are caught. Full package suite: 788 passed, 1 skipped.
5. Other tool text. Open. `compare-tool-text.mjs` against the live session: Task keeps 96 percent of Cursor's words and AwaitShell 95 percent, but TodoWrite keeps 16 percent and GenerateImage 24 percent. SwitchMode is not offered in a JSON run, so it needs an RPC measurement.
6. visualize. Open. The skill text is server-supplied; only the renderer and file rules are local.

## Evidence layout

The repository is public, so Cursor's code never enters it. `capture-reference.mjs` and `extract-source.mjs` copy whole functions from the installed Cursor bundles into the ignored `.audit/pstack-source-audit-2026-11-05/source/`. They record each capture's source file hash, offsets, and excerpt hash in `baseline.json` and `evidence/source-captures.json`. Run both scripts to regenerate the captures on a machine with the same Cursor builds. `extract-source.mjs` finds the whole function that encloses a unique marker with `@babel/parser`, so no capture depends on a guessed slice.

`probe-reference.mjs` and `probe-agents.mjs` run the captured functions with plain record constructors in place of protobuf classes. They start no Cursor process, model, or agent. Their outputs are `evidence/reference-probes.json`, `evidence/reference-agent-definitions.json`, and the test oracle `extensions/pi-pstack/test/fixtures/cursor-agent-definitions.json`. `mutate.mjs` reintroduces named defects, runs the narrow tests, and restores each file byte for byte.

## Host findings

- Desktop defines shell when `includeShellSubagent` is true. Its tool filter retains only `SHELL`. It removes Task and question tools. `SHELL` supplies foreground and background execution. `AWAIT` is a different identifier and is not retained.
- Desktop type lookup trims and folds case, removes hyphens and underscores, and strips a trailing agent, mode, type, subagent, or subagenttype. Pi previously required an exact match.
- Cursor CLI finds command references throughout a message. It splits arguments on whitespace without quote processing. A command without placeholders appends arguments after two newlines. Pi prompt templates have different behavior. This is a confirmed difference, not yet a completed change.
- Desktop has visualization HTML validation, storage paths, renderer code, and serving code. The complete user-facing visualize skill contract has not been recovered. A bar chart test does not prove equivalence.

## Shell-agent architecture

### Overview

The existing agent-definition table owns prompts, spawn policy, defaults, and extra tools. Task resolves a definition and launches a Pi RPC process. Pi CLI tool selection controls the initial tools. The extension can change active tools on session start.

### Data shape

An agent definition gains an optional `onlyTools` list. Absence keeps the current inherited tools and additive search tools. Presence restricts the definition to that list. A readonly launch intersects that list with the existing readonly tools.

### Alternatives

A prompt-only shell role does not enforce the reference restriction. A new shell-specific child runner would duplicate session, cancellation, and persistence logic. The chosen design reuses the existing runner with exact tool selection and a request-time intersection. The latter prevents image-model discovery from adding GenerateImage to a restricted agent.

### How it works

The shell definition selects Pi bash and bash_background. These two tools implement Cursor SHELL execution. The child gets no MCP tools and cannot launch nested Tasks. Existing Task records preserve the shell type across resume and fork. Type lookup normalizes names at the definition boundary.

### Where things live

- `extensions/pi-pstack/src/task/agents.ts` owns the definition and name lookup.
- `extensions/pi-pstack/src/task/runner.ts` builds native Pi CLI arguments.
- `extensions/pi-pstack/src/task/tool.ts` passes the definition's restriction to the runner.
- `extensions/pi-pstack/src/index.ts` intersects active tools with the restriction before each request.

### Gotchas

The source exposes shell conditionally. The runtime feature-flag value for this Cursor installation has not been observed. Supporting the source-defined shell capability does not prove that every Cursor account currently sees it. A shell-only role still has write and network access through shell commands unless readonly is requested. It is not a sandbox.
