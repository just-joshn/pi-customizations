# pstack (Cursor plugin) → `pi-pstack-two` behavioral specification

Port target: `extensions/pi-pstack-two`, a Pi 1.1.0 package. Source: the Cursor plugin `pstack` 0.15.20 at `cursor/plugins@1b6d44ff26d4e242f4e8f68c391e6d2f7ca16def` (upstream `main` on 2026-10-12), plus the dependencies it names: three `cursor-team-kit` 1.2.0 skills and the Cursor host features its skills call.

## Sources

| Ref | Kind | Location | License or authorization |
|---|---|---|---|
| S1 | permitted source | `github.com/cursor/plugins` `pstack/` at `1b6d44f` (cloned to a temp dir, never edited). The port began at `11713c6` (0.15.17); `git log 11713c6..1b6d44f -- pstack` lists the 11 upstream commits taken in the resync | MIT, © 2026 Lauren Tan |
| S2 | permitted source | same commit, `cursor-team-kit/skills/{deslop,control-cli,control-ui}` | MIT (team-kit LICENSE) |
| S3 | doc | cursor.com/docs/subagents (fetched 2026-10-12) | public documentation, quoted briefly |
| S4 | doc | cursor.com/docs/skills, /docs/agent/prompting (Custom Modes), /docs/cli/using | public documentation |
| S5 | doc | cursor.com/docs/rules (`alwaysApply`) | public documentation |
| S6 | doc | cursor.com/docs/agent/overview (Tools: "Ask questions", `/loop`, `/goal`) | public documentation |
| F1 | fixture | `fixtures/cursor/cursor-cli-task-todowrite-contract.json` | black-box capture, `cursor-agent` 2026.10.01, logged-in user's own account; tool prose reduced to contract excerpts |
| F2 | fixture | `fixtures/cursor/cursor-task-foreground-background.jsonl` | black-box capture |
| F3 | fixture | `fixtures/cursor/cursor-task-resume-invalid-model.jsonl` | black-box capture |
| F4 | fixture | `fixtures/cursor/cursor-subagent-types-and-models.json` | black-box capture (model-relayed) |
| F5 | fixture | `fixtures/cursor/cursor-skill-slash-attach.jsonl` | black-box capture (model-relayed) |
| F6 | fixture | `fixtures/cursor/cursor-available-skills-listing.json` | black-box capture (model-relayed) |
| P1 | doc | Pi 1.1.0 bundled `docs/` (extensions, skills, prompt-templates, packages, sdk, json, rpc, rpc-extension-ui, session-format, settings, environment-variables, custom-provider) and `dist/**/*.d.ts` | installed package |
| P2 | observation | scratch runs of Pi 1.1.0 with a faux provider (`/tmp/pexp`), recorded in `decisions.md` §Verified Pi behaviors | own experiments |
| P3 | observation | the user's installed `pi` launcher (`~/.pi/agent/bin/pi`, managed release 1.1.0) running the e2e suite and a tmux TUI session (`evidence/tui-smoke.md`) | own runs |

The Cursor fixtures F1 to F6 were captured with pstack 0.15.17, the version in Cursor's plugin cache (`~/.cursor/plugins/cache/cursor-public/pstack/11713c6…`). Refreshing that cache would change the user's global Cursor state, so no 0.15.20 Cursor capture exists. The host contracts the fixtures record (Task, TodoWrite, subagent listing, skill attachment) did not change in the 0.15.20 source; the one changed host-visible value, the `comment-sicko` agent id, is taken from source (TASK-006).

Cursor's built-in skills (`create-skill`, `loop`, `babysit`) are proprietary prose under `~/.cursor/skills-cursor/`. They were not opened. Their contracts come from S4 and S6 only, and the Pi replacements are written fresh.

## Scope

- **In scope.** All 52 pstack skills with their references and scripts; the `poteto-agent` and `Comment Sicko` subagent definitions; the guide pages that `poteto-help` links; the dormant Benny pack as inert files; the `deslop`, `control-cli`, and `control-ui` team-kit skills that pstack names as dependencies; and the Cursor host features the skills call by name: `/name` skill invocation, Custom Modes, the `Task` subagent tool, `TodoWrite`, `AskQuestion`, the always-applied model rule, the transcript and skill paths the system prompt names, Cursor's built-in `create-skill`, and `/loop`.
- **Out of scope (surrounding harness).** The Agent Plugins v1 root manifest `pstack/plugin.json` (packaging metadata added in 0.15.20). Cursor cloud VMs (`environment: "cloud"`, `cloud_base_branch`), Grok Bot routines (`update_state`, `SendToUser`) that `make-bot-ui` drives, Cursor Automations and Slack ingress that Benny needs, Plan/Ask/Debug modes and `SwitchMode`, `/goal`, Cursor's built-in `babysit`, Bugbot, Origin, and the plugin marketplace (logo, `/add-plugin`). The rest of `cursor-team-kit` is a separate plugin and is not a pstack dependency.
- **Source-internal dependencies and their Pi replacements.**

| Cursor dependency | Pi replacement |
|---|---|
| `/name` attaches a skill to one message | `input` transform to Pi's native `/skill:name` expansion |
| Custom Mode (Option+Enter) | `/mode <skill>` command; a `before_agent_start` system-prompt section |
| `Task` tool, subagent files, background notifications | `Task` extension tool spawning `pi --mode json` children; notifications as custom messages |
| `TodoWrite` | `TodoWrite` extension tool, branch-aware details |
| `AskQuestion` (IDE tool) | `AskQuestion` extension tool over `ctx.ui.select` |
| `~/.cursor/rules/pstack-models.mdc`, `alwaysApply` | `<agentDir>/pstack-two/pstack-models.mdc` injected into the system prompt; `tool_call` guard on the Cursor path |
| `agent-transcripts/` named by the system prompt | Pi session directory and `PI_SESSION_FILE` named by a system-prompt section |
| `create-skill` built-in | fresh Pi-native `create-skill` skill |
| `/loop` built-in | `/loop` command and `Loop` tool |

## Requirements

Each requirement lists evidence as **fact** (documented or source text), **observation** (captured run), **inference**, or **unknown**. Status lives in `ledger.json`.

### RES-001: Every pstack skill is discoverable under its Cursor slash name
- Trigger: Pi starts with the package loaded.
- Input → output: 52 skills load with `name` equal to the source directory name (`Poteto Mode` → `poteto-mode`, `Make Bot UI` → `make-bot-ui`) and the source `description` unchanged. Pi reports no skill diagnostics.
- Platform and mode: all modes.
- Evidence: S1 file tree; S4 "Lowercase letters, numbers, and hyphens only. Must match the parent folder name"; P2 shows Pi keeps the invalid display name `Poteto Mode` and warns. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/resources.test.ts`

### RES-002: Skill bodies, references, and scripts match upstream except declared transforms
- Input → output: every shipped file (166 at `1b6d44f`) equals its source bytes, except SKILL.md frontmatter normalization and the one declared patch to `worktree-audit.sh` (WTA-001).
- Success: a lock file records the source commit and per-file hashes; a check regenerates from a source checkout and finds no drift.
- Evidence: S1. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/resources.test.ts`

### RES-003: Model-invocation visibility matches upstream
- Input → output: 51 pstack skills keep `disable-model-invocation: true` and stay out of the model's skill list; `setup-pstack` stays model-invocable.
- Evidence: S1 frontmatter; S4 "only included when explicitly invoked via /skill-name". **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/resources.test.ts`

### RES-004: Non-standard frontmatter survives as metadata
- Input → output: `mode`, `icon`, `color`, `reminder` (poteto-mode) and `paths` (typescript-best-practices) move under `metadata` with a `cursor-` prefix and their original values. Only Agent Skills fields remain at the top level.
- Evidence: S1; S4 lists `icon`, `color`, `paths` as Cursor fields. S4: `paths` scopes when a skill is surfaced automatically, and `disable-model-invocation: true` makes a skill explicit-only; the one pstack skill with `paths` (`typescript-best-practices`) is explicit-only, so `paths` changes nothing for it in Cursor either. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/resources.test.ts`

### RES-005: The team-kit dependencies ship and stay model-invocable
- Input → output: `deslop`, `control-cli`, and `control-ui` load with upstream text and no `disable-model-invocation`.
- Evidence: S1 README "not shipped here … install `cursor-team-kit`"; S2. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/resources.test.ts`

### RES-006: Subagent definitions ship unchanged
- Input → output: `agents/poteto-agent.md` and `agents/comment-sicko.md` equal upstream. At 0.15.20 the Comment Sicko file declares `name: comment-sicko`, and `poteto-agent` describes itself as a delegate, not the runner for `/poteto-mode`.
- Evidence: S1 (`de2dba6`, `2bd5dd4`). **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/resources.test.ts`

### RES-007: Links that skills follow outside the skills tree resolve
- Input → output: every relative Markdown link in a shipped skill resolves to a shipped file, including `poteto-help`'s `../../docs/guide/*.md` and `../../README.md`.
- Evidence: S1 `poteto-help/SKILL.md`. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/resources.test.ts`

### RES-008: Benny ships dormant
- Input → output: `automations/benny/**` ships as files and none of its `SKILL.md` files load as skills.
- Evidence: S1 README "its files are not registered as slash skills". **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/resources.test.ts`

### RES-009: License notices travel with the copies
- Input → output: the pstack and team-kit MIT license texts ship with the package and the README names both.
- Evidence: S1, S2 LICENSE files. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/resources.test.ts`

### CMD-001: `/<skill> args` attaches the skill to one message
- Trigger: the user submits `/<name> <args>` for any skill Pi loaded: pstack's, and skills the user or pstack created, such as `automate-me`'s `/<handle>-mode`.
- Input → output: the model receives the skill body, the skill's file path and base directory, and the raw argument text, in the same message. No later turn carries the skill.
- Platform and mode: interactive, print, JSON, RPC.
- Evidence: S4 "A skill invoked this way attaches to one message"; F5 shows `Skill Name`, `Path`, and the inlined body. P2 shows that an extension command cannot start a run in print mode, and that an `input` transform to `/skill:name` expands natively in every mode. **fact + observation**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/aliases.e2e.test.ts`

### CMD-002: Aliases leave other input alone
- Input → output: `/skill:name`, Pi built-ins (handled by the interactive editor before the `input` event), unknown `/words`, and plain text pass through unchanged. Argument text keeps quotes, newlines, and `$` characters. A user's own prompt template or extension command with a skill's name keeps that name. A skill the user's settings filter out gets no alias.
- Evidence: P1 prompt-templates and extensions docs; Pi expands templates after `input` handlers run. **inference**, high.
- Acceptance test: `extensions/pi-pstack-two/test/aliases.test.ts`

### CMD-003: The `/` menu lists skills under their Cursor names
- Trigger: the user types `/` and part of a skill name in the interactive editor.
- Input → output: matching pstack skills appear as `<name>` with their descriptions, ahead of Pi's `skill:<name>` entries; choosing one completes `/<name> `.
- Evidence: S4 "typing / in Agent chat and searching for the skill name". **fact**, high. Pi API: `ctx.ui.addAutocompleteProvider` (`dist/core/extensions/types.d.ts`), reset by Pi with other extension UI on reload.
- Platform and mode: interactive only; RPC clients own their own completion.
- Acceptance test: `extensions/pi-pstack-two/test/autocomplete.test.ts` and `evidence/tui-smoke.md`

### MODE-001: `/mode <skill>` keeps the skill in context on every turn
- Trigger: `/mode poteto-mode [task]`.
- Input → output: every later model request carries the full skill body and path until the mode exits. With a task, the task is submitted at once.
- Evidence: S4 "Inside a mode, the skill stays in context on every turn … until you exit the mode". **fact**, high. Pi has no Option+Enter equivalent because `alt+enter` queues a follow-up (P1 keybindings).
- Platform and mode: interactive and RPC (Cursor offers modes only in interactive clients).
- Acceptance test: `extensions/pi-pstack-two/test/e2e/mode.e2e.test.ts`

### MODE-002: `/mode off` exits and `/mode` reports
- Input → output: `/mode off` removes the section from the next request; `/mode` alone reports the active mode or none; an unknown skill name fails with the list of valid names.
- Evidence: S4. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/mode.test.ts`

### MODE-003: Mode state follows the session branch and survives resume
- Input → output: the mode is reconstructed from the active branch on resume and on `/tree` navigation.
- Evidence: P1 extensions "Reconstruct branch-sensitive state from getBranch()". **inference**, medium.
- Acceptance test: `extensions/pi-pstack-two/test/mode.test.ts`

### MODE-004: poteto-mode's reminder leads the injected mode text
- Input → output: the `cursor-reminder` metadata line opens the mode section.
- Evidence: S1 frontmatter `reminder:`; S4 does not document `reminder`. **inference**, low.
- Acceptance test: `extensions/pi-pstack-two/test/mode.test.ts`

### MODE-005: The active mode is visible
- Input → output: a status entry names the active mode while it is on.
- Evidence: S4 "An active mode shows a badge in the chat input". **fact**, medium.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/mode.e2e.test.ts`

### TASK-001: `Task` accepts Cursor's parameter contract
- Input → output: `description` and `prompt` required; optional `subagent_type`, `model`, `resume`, `run_in_background`, `file_attachments`, plus `readonly` and `environment`, which pstack skills pass.
- Evidence: F1 schema; S1 skills pass `readonly` and `environment`. **observation + fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/task-schema.test.ts`

### TASK-002: Foreground Task returns the child's final message and agent ID
- Input → output: the call blocks until the child finishes and returns `This is the output of the subagent:` with the response in `<response>` tags and an `Agent ID: … (can be used with the resume parameter …)` line.
- Evidence: F3 relayed text. **observation**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/task.e2e.test.ts`

### TASK-003: Background Task returns at once and notifies on completion
- Input → output: the call returns immediately with the agent ID and a note not to wait. When the child finishes, the parent receives a `<task>` notification with `kind`, `status`, `task_id`, `title`, `tool_call_id`, and `detail`, after the parent's current turn; its stored details also carry the child's usage. A one-shot print or JSON run stays alive until pending notifications are delivered, unless the run was aborted.
- Evidence: F2 and F3 (`task_notification` event, relayed text; the print-mode run continued until delivery). **observation**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/task.e2e.test.ts`

### TASK-004: Several Task calls in one message run concurrently
- Evidence: F2 (both started before either finished); S3 "Agent sends multiple Task tool calls in a single message, so subagents run simultaneously". **observation + fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/task.e2e.test.ts`

### TASK-005: `resume` continues the same transcript
- Input → output: the resumed child sees its earlier turns and keeps its earlier model, and runs in the directory where it first ran. Resuming a running agent fails, whether it runs in the foreground, in the background, or in another Pi process. An unknown ID fails, and so does the ID of a fresh agent whose process never started. Agent IDs are scoped to a workspace (the working directory), so another workspace cannot resume them.
- A resumed agent keeps its depth and its readonly floor; a resume call can add `readonly: true`. Resume fails clearly when the record names another working directory (two directories can share a workspace folder name), when the agent's transcript is missing (Pi would otherwise start an empty session under the old ID), when its record is corrupt, or when its recorded type no longer exists (for example a 0.15.17 `Comment Sicko` record).
- State: a run lock per agent ID names the pid of the process writing the transcript (the child once it starts). A lock without a readable pid counts as held, and the refusal names the lock file. A dead holder's lock is taken over only if it still names that holder; release leaves a lock another holder took over.
- Evidence: F1 "If the agent is still running, the request fails"; F3 resume returned ECHO-2 on the same agent ID; P2 shows Pi matches a session ID only among sessions for the same working directory; Pi appends to session files without a lock. **observation**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/task.e2e.test.ts`

### TASK-006: Subagent types resolve from the plugin's agent files
- Input → output: `generalPurpose` (default) runs with no extra prompt; `poteto-agent` and `comment-sicko` run with their Markdown body appended to the system prompt; an unknown type, including the pre-0.15.20 name `Comment Sicko`, fails with the valid list.
- Evidence: F4 type list shows Cursor lists a plugin type by the agent file's `name`; S3 file format; S1 `de2dba6` renamed the id to `comment-sicko` "so Grok can spawn it". **observation + fact**; the 0.15.20 Cursor type list itself is **inference**, high (U8).
- Acceptance test: `extensions/pi-pstack-two/test/task-agents.test.ts`

### TASK-007: `model` resolves Cursor slugs and Pi specs, and rejects the rest
- Input → output: `inherit`, `inherit-parent`, `auto`, and omission run on the parent model and thinking level. `<model-id>-<effort>[-fast]` maps to that model at that thinking level. `provider/model[:level]` maps directly. A thinking level the model does not support (pi-ai `getSupportedThinkingLevels`) fails like an unlisted slug, naming the supported levels, instead of being clamped silently by Pi; the allowed list shows each model's levels. Anything else fails with `Invalid model selection "…"` and the allowed list.
- Evidence: F1 model description; F3 error text; S1 setup-pstack aliases. **observation + fact**, high. Pi has no "fast" tier, so `-fast` is dropped and the result names the model that ran (inference).
- Acceptance test: `extensions/pi-pstack-two/test/task-model.test.ts`

### TASK-008: `readonly: true` withholds write and shell tools and MCP
- Input → output: the child runs with `read`, `grep`, `find`, `ls`, and `TodoWrite` only, and no MCP. A call can add readonly to a fresh or resumed agent but never lifts it.
- Divergence: Cursor allows read-only shell commands in a readonly subagent (S3 "no state-changing shell commands"). Pi has no read-only shell, and prose cannot enforce one, so the port withholds `bash`; a readonly child cannot run `git log` or `git blame`.
- Evidence: S3 "no file edits, no state-changing shell commands"; S1 "readonly strips MCP". **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/task.e2e.test.ts`

### TASK-009: `is_background: true` makes background the default
- Input → output: `poteto-agent` runs in the background unless the call sets `run_in_background: false`.
- Evidence: S3 field table; S1 `poteto-agent.md`. **fact**, medium.
- Acceptance test: `extensions/pi-pstack-two/test/task-agents.test.ts`

### TASK-010: `environment: "cloud"` fails clearly
- Input → output: the call fails with a message that Pi has no cloud subagents and that a local run needs its own worktree. It never runs locally instead.
- Evidence: S3 cloud subagents run on Cursor VMs. **fact**; the refusal is a design decision.
- Acceptance test: `extensions/pi-pstack-two/test/task-schema.test.ts`

### TASK-011: Nesting stops at grandchildren
- Input → output: the main agent and its direct subagents can call Task; a subagent's subagent cannot. A resumed agent runs at the deeper of its recorded depth and its caller's depth plus one, so neither the main chat (resuming a grandchild) nor a subagent (resuming a main-chat agent) can lift it.
- Evidence: S3 FAQ. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/task.e2e.test.ts`

### TASK-012: Subagent transcripts persist where the parent can read them
- Input → output: each child writes a Pi session file named by its agent ID under `<agentDir>/pstack-two/workspaces/<workspace folder>/subagents/`, named the way Pi names session folders, and results name the file or its glob pattern.
- Evidence: S3 "Background subagents write output to ~/.cursor/subagents/"; F1 "returns output_file path". **fact**, medium.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/task.e2e.test.ts`

### TASK-013: Cancellation and shutdown stop children
- Input → output: aborting the parent turn stops foreground children; session shutdown, reload, and session switch stop background children and say how many. A child whose parent process dies (crash, SIGKILL) exits within seconds, together with the commands it runs.
- Evidence: P1 extensions lifecycle; security reference. **inference**, high. Children run in their own process group, so they need the parent-pid watchdog to notice a parent that never ran `session_shutdown`.
- Acceptance test: `extensions/pi-pstack-two/test/task-runner.test.ts`

### TASK-014: Foreground usage counts toward session totals
- Input → output: the Task result carries the child's usage, summed the way Pi's session stats count it: assistant messages, tool results that carry nested usage (the child's own subagents, codemode), and compactions. The parent's `get_session_stats` includes it.
- Evidence: P1 "include their usage in the result". **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/task.e2e.test.ts`

### TASK-015: A failed child reports an error status
- Input → output: a child that exits nonzero or ends with an error stop reason makes the Task call fail (foreground) or produces `status: error` (background), with the child's error text.
- Evidence: S3 "The subagent returns an error status to the parent agent". **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/task.e2e.test.ts`

### TASK-017: Background subagent usage counts toward session totals
- Input → output: the tokens a background child spends appear in the parent session's usage totals, as Cursor bills and lists every subagent run.
- Evidence: S3 "Each request bills at the list price of the model that ran … The usage dashboard lists that model". **fact**, high. Pi 1.1.0 `getSessionStats()` totals assistant usage, tool-result usage, compaction and branch-summary usage, and `usage` session entries. `SessionManager.appendUsage()` writes those entries, but extensions receive `ReadonlySessionManager`, which omits it; Pi's cache warmer is its only caller. A background result arrives after its tool call has returned, through `sendMessage` or a settle-time `custom_message`, neither of which carries usage. **fact** (installed `.d.ts` and `dist/core/agent-session.js`), high.
- Acceptance test: none possible with the public API; see the ledger gap.

### TASK-016: `file_attachments` reach the child
- Input → output: each listed file is attached to the child's first prompt; a missing path or a directory fails the call, and `~` expands as in Pi's read paths.
- Evidence: F1 schema. **observation**, medium.
- Acceptance test: `extensions/pi-pstack-two/test/task-runner.test.ts`

### TASK-018: A subagent loads the project resources its parent trusted
- Input → output: a child gets `--approve` when the parent's project trust is active and `--no-approve` otherwise, so project skills, extensions, and settings load in the child exactly when they load in the parent.
- Evidence: Cursor subagents work in the same workspace with its resources (S3); Pi's one-shot modes cannot show the trust prompt and skip protected project resources under the default `ask` (P1 `docs/security.md`); `ctx.isProjectTrusted()` (P1 `types.d.ts`). **inference**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/task.e2e.test.ts`

### TASK-019: A readonly subagent can still run shell commands that change nothing
- Input → output: in Cursor, a readonly subagent may run commands such as `git log` or `git blame`.
- Evidence: S3 "no file edits, no state-changing shell commands". **fact**, high. Pi has no read-only shell, and a command allowlist parsed by the port could be bypassed (pipes, substitutions, pagers), which would claim isolation Pi does not provide, so the port withholds `bash` (TASK-008). pstack's readonly workflows (`how` explorers and explainers, `interrogate` reviewers) only read code, and `interrogate`'s parent runs `git diff` itself. **observation**, high.
- Acceptance test: none; recorded as a gap in the ledger.

### TODO-001: `TodoWrite` follows Cursor's schema and merge rule
- Input → output: every call valid under Cursor's schema behaves the same: `todos` items carry `id`, `content`, `status` (`pending`, `in_progress`, `completed`, `cancelled`); `merge: true` updates by `id` and appends new IDs; `merge: false` replaces the list. The result lists the full current state.
- Evidence: F1 schema. **observation**, high. The port accepts a superset: one item (Cursor sets `minItems: 2`), and a merge update that omits `content` or `status`, which Cursor's `merge` description allows while its schema marks both required (decision D9).
- Acceptance test: `extensions/pi-pstack-two/test/todo.test.ts`

### TODO-002: The todo list follows the branch and is visible
- Input → output: state is rebuilt from the active branch on start and `/tree`; a widget lists the items.
- Evidence: P1 todo example. **inference**, medium.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/todo.e2e.test.ts`

### RULE-001: The model rule is always applied when present
- Input → output: when `<agentDir>/pstack-two/pstack-models.mdc` exists, its content appears in every request's system prompt. When it is absent, the section says that defaults apply.
- Evidence: S5 "Always included"; S1 setup-pstack writes an `alwaysApply: true` rule. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/host.e2e.test.ts`

### RULE-002: Pi never writes Cursor's rule file
- Input → output: `write` or `edit` calls on `~/.cursor/rules/pstack-models.mdc` are blocked with the Pi path in the reason.
- Evidence: decision D6; the user's real Cursor rule exists. **inference**, high. A `bash` command can still write it; see the Security notes.
- Acceptance test: `extensions/pi-pstack-two/test/rule.test.ts`

### RULE-003: Configured role models flow into Task
- Input → output: rule values that use Cursor slugs or Pi specs resolve through TASK-007 when a skill passes them as `model`.
- Evidence: S1 role lines. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/task-model.test.ts`

### HOST-001: The system prompt names the Pi equivalents the skills need
- Input → output: a `pstack_host` section names the skills directory and the package skills Pi loaded, the rule path, the session directory (for `agent-transcripts/` and `recall`'s `~/.cursor/projects/<slug>/agent-transcripts/`) with the session-file shape `reflect` reads, the current session file, the subagent directory and how to tell a subagent is still running (its lock file), and the Cursor-to-Pi mappings for `.cursor/skills`, `create-skill`, `/loop`, `AskQuestion`, MCP tool names, and the unavailable features. Cloud workers map to local workers in their own git worktrees, without stopping to ask, as pstack's never-block principle requires.
- Evidence: S1 "the agent-transcripts/ directory the system prompt names"; F6 Cursor lists skills with paths. **fact + observation**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/host.e2e.test.ts`

### HOST-002: The system prompt lists subagent types and model slugs
- Input → output: a `pstack_subagents` section lists each type with its description and the models Task accepts, matching Cursor's `<available_subagent_types>` and `<available_subagent_models>`.
- Evidence: F1, F4. **observation**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/host.e2e.test.ts`

### HOST-003: `create-skill` exists for Pi
- Input → output: a `create-skill` skill, written fresh, guides authoring Pi skills (frontmatter, locations, `disable-model-invocation`, validation by loading).
- Evidence: S1 README "/create-skill is a cursor built-in"; S4 table. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/resources.test.ts`

### HOST-004: `/loop` runs a prompt repeatedly until stopped
- Input → output: `/loop <interval> <prompt>` submits the prompt now and again each interval after the agent settles; `/loop <prompt>` lets the agent pick each wake through the `Loop` tool, and the loop stops when the agent picks none and no background subagent is still running. The agent can also arm a loop itself with `Loop {prompt, interval | wake_in}`, as pstack's autonomous, autopilot, multi-phase, orchestrate, and visual-parity playbooks direct; its first run follows the current turn. The prompt can be a skill or template command. `/loop stop`, `Loop {stop:true}`, and aborting a loop run end it. Intervals are at most 24 days. One loop per session. Print and JSON modes, including every subagent, refuse `/loop` because the process exits at settle: they do not offer the `Loop` tool, refuse it if it is forced active, and their host map says to keep working instead. The playbooks arm loops from the root chat, so a subagent loses nothing it was told to do.
- Evidence: S4 "/loop Runs a prompt or skill repeatedly at a specified interval"; S6 "If you don't specify a fixed interval, the agent chooses when to wake. Stop the loop when you want it to end."; S1 playbooks such as `autopilot-stack.md` "the root arms `/loop 1h`". **fact**, medium. Wake mechanics are not documented (unknown U3).
- Acceptance test: `extensions/pi-pstack-two/test/loop.test.ts`

### HOST-005: `AskQuestion` asks structured multiple-choice questions
- Input → output: each question shows its options; `allow_multiple` collects several picks; the result maps question IDs to option IDs. Without a UI the tool is withdrawn and the host map says to put questions in the final reply.
- Evidence: S1 "Use the AskQuestion tool (structured multi-choice)", "allow_multiple: true"; S6 "Ask questions". The schema is not observable from the CLI (U1). **inference**, medium.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/ask.e2e.test.ts`

### HOST-006: Image generation maps to Pi's own image path
- Input → output: the host map tells the model that Pi generates images through codemode's `models.generateImages()` when codemode is on and an image model is configured, and otherwise to say no image tool is available and use a diagram or table.
- Evidence: S1 `teach` step 5 "reach for the image-generation tool" and `ketchup` at 0.15.20 "a generated image"; F1 lists Cursor's `GenerateImage`; P1 `docs/codemode.md`. **fact**, medium.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/host.e2e.test.ts` (the mapping text); generating an image needs an image model this environment does not have.

### HOST-008: Cursor tool names and transcript shapes have Pi meanings
- Input → output: the host map says that `Read`, `Grep`, `Glob`, and `Shell` in pstack text mean Pi's `read`, `grep`, `find`, and `bash`, that a skill under `~/.cursor/plugins/` is one under the package skills directory, and how a tool call and an attached skill look in a Pi transcript, which `reflect`'s reviewers inspect.
- Evidence: S1 `reflect/references/*-reviewer.md` ("a `Read` of its `SKILL.md` (under `.cursor/skills/`, `~/.cursor/skills/`, or `~/.cursor/plugins/`) … a tool call (Shell, Grep, MCP, etc.)") and `how/references/explainer-prompt.md` ("Use Read, Grep, and Glob"); Pi `docs/session-format.md`. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/host.e2e.test.ts`

### HOST-007: "The current agent's store" has a Pi path
- Input → output: the host map names `<agentDir>/pstack-two/workspaces/<workspace folder>/store/<session id>` as the store that orchestrate's store layout and `orch --store` use.
- Evidence: S1 `orchestrate.md` "Create `orchestrate/<project-slug>/` in the current agent's store (path in the system prompt)"; `orch.ts` requires `--store` or `ORCH_STORE`. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/host.e2e.test.ts`

### WTA-001: `worktree-audit.sh` reads Pi transcripts
- Input → output: the LAST_CHAT column comes from Pi session files for the main worktree and the audited worktree and from this port's subagent transcripts for both, not `~/.cursor/projects`. A custom session folder is found as Pi finds it: `PI_CODING_AGENT_SESSION_DIR`, else the working directory's `.pi/settings.json` `sessionDir`, else the agent `settings.json` `sessionDir`, with `~` expanded and a relative path resolved from that working directory. Everything else, including 0.15.20's `-b <base>` merge check, is upstream's.
- Evidence: S1 script comment "Transcripts dir: ~/.cursor/projects/<slug>/agent-transcripts"; Pi `main.js` session-dir precedence, `settings-manager.js` `normalizePath`, `docs/settings.md`. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/scripts.test.ts`

### SCRIPT-001: Bundled scripts run from the package
- Input → output: `log.sh`, `check-plan.mjs`, and the Bun tools `watch-pr` and `orch` run from the installed location, and upstream's own test script (`bun test orch watch-pr check-plan.test.ts` at 0.15.20) passes.
- Evidence: S1 scripts and tests. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/scripts.test.ts`

### PKG-001: The package installs and removes cleanly
- Input → output: `pi install <path>` in an isolated agent directory exposes the skills, aliases, and tools; `pi remove` withdraws them.
- Evidence: P1 packages. **fact**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/package.e2e.test.ts`

### PKG-002: Reload and session switches leave no stale state
- Input → output: `/reload` and a new session keep aliases and tools working, reset mode and todos to the new branch, and stop background children of the old runtime.
- Evidence: P1 lifecycle. **inference**, high.
- Acceptance test: `extensions/pi-pstack-two/test/e2e/lifecycle.e2e.test.ts`

### SEC-001: Child processes take argv arrays and validated inputs
- Input → output: no shell interpolation; the prompt travels on stdin, and a child that closes stdin early cannot crash the parent (EPIPE); model, type, and attachment values are validated before spawn; model-facing output is bounded with Pi's own limits (`truncateHead`, 2000 lines or 50KB).
- Evidence: security reference. **inference**, high.
- Acceptance test: `extensions/pi-pstack-two/test/task-runner.test.ts`

### LIVE-001: A real model follows `/poteto-mode` into a playbook todo list
- Paired baselines: `fixtures/cursor/cursor-live-poteto-baseline.json` (Cursor, auto) and `fixtures/cursor/cursor-live-poteto-sonnet-baseline.json` (Cursor, claude-sonnet-5-5-medium). Results: `evidence/live-summary.md`.
- Input → output: with a real model, `/poteto-mode <investigation task>` reads a playbook and calls `TodoWrite` whose first items are that playbook's steps.
- Evidence: S1 poteto-mode "Open a todolist whose first items are the matched playbook's steps, copied in verbatim". **fact**; model behavior is probabilistic.
- Acceptance test: `extensions/pi-pstack-two/scripts/live-e2e.mjs`

### LIVE-002: A real model routes `/no-comments` to the comment-sicko subagent
- Input → output: the run calls `Task` with `subagent_type: "comment-sicko"` (0.15.20).
- Evidence: S1 no-comments step 1. **fact**; model behavior is probabilistic.
- Acceptance test: `extensions/pi-pstack-two/scripts/live-e2e.mjs`

### LIVE-003: A real model runs `/setup-pstack` to a written rule
- Input → output: the run writes `<agentDir>/pstack-two/pstack-models.mdc` with every role line from step 5 and no write under `~/.cursor`.
- Evidence: S1 setup-pstack. **fact**; model behavior is probabilistic.
- Acceptance test: `extensions/pi-pstack-two/scripts/live-e2e.mjs`

### NA-001 to NA-007: Excluded host features
Cloud subagents, Grok Bot routines, Cursor Automations, Plan and Ask modes, `/goal`, Cursor's built-in `babysit`, and the plugin logo and marketplace. Each is recorded in the ledger as NOT APPLICABLE with its reason. Image generation moved to HOST-006 after review.

## Unknowns

| Question | Why it matters | How it could be resolved |
|---|---|---|
| U1. The exact `AskQuestion` schema in the Cursor IDE | HOST-005 reconstructs it from pstack text | Capture from the Agents Window; the CLI has no such tool (observed) |
| U2. Exactly what Cursor injects each turn for a Custom Mode, including `reminder` | MODE-001, MODE-004 | Capture a mode turn in the Agents Window. Alt+Enter on `/poteto-mode` in `cursor-agent` 2026.10.01 under tmux entered no mode |
| U3. How Cursor's `/loop` wakes the agent and how it ends | HOST-004 | Black-box a `/loop` run in the Agents Window |
| U4. Whether Cursor routes `disable-model-invocation` skills by name | HOST-001 lists names and paths either way | F6 shows they are absent from `<available_skills>`; the routing path is unobserved |
| U5. Cursor's `TodoWrite` result text and UI | TODO-001 result wording | Capture a TodoWrite call result |
| U6. Whether readonly subagents exist in the CLI | F1 has no `readonly` parameter; S3 documents it in agent files | Agents Window capture |
| U7. Whether a resumed `is_background` agent runs in the background by default | The port resumes in the foreground unless the call says otherwise | Capture a Cursor resume of `poteto-agent` |
| U8. Whether Cursor with pstack 0.15.20 lists the type exactly as `comment-sicko` | TASK-006 and LIVE-002 follow the source rename | Capture `<available_subagent_types>` after Cursor's plugin cache moves to 0.15.20 |
