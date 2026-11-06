# pstack 0.15.36 behavior specification and parity ledger (Linux run)

Reference: pstack 0.15.36 and cursor-team-kit 1.2.0 at cursor/plugins `bb68f236`, run in Cursor CLI 2026.11.05-86047df with Cursor's built-in skills synced 2026-11-06T07:44Z (pins in `notes.md`). Target: pi-pstack in this repository on Pi 1.5.0, Ubuntu 26.04 x86_64. Earlier ledgers (`parity/requirements.json`, `extensions/pi-pstack/docs/parity-status.md`) are inputs. A row here is `verified` only with evidence from this run on this host.

Statuses: `understood` (reference behavior established, target not yet matched), `implemented` (target changed, not yet verified), `verified` (target evidence from this run), `blocked` (a named external condition stops implementation or verification), `opaque` (the reference behavior is not observable from this host), `inapplicable` (the reference item has no behavior pstack depends on; evidence given).

## 1. Asset inventory

`tree-map.mjs` maps all 602 git-tracked files (regenerate the final map with `node parity/pstack-complete-2026-11-05/tree-map.mjs ~/Documents/GitHub/plugins extensions/pi-pstack .audit/pstack-linux-2026-11-05/final`) under `pstack/` (573) and `cursor-team-kit/` (29) to the package tree. Output: `.audit/pstack-linux-2026-11-05/tree-map.json`; word-level spans in `word-changes.txt`, non-trivial spans in `spans-kept.txt` (513 spans, all read).

| Class | pstack | team-kit | Accounting |
| --- | --- | --- | --- |
| Byte-identical | 501 | 22 | Shipped as is. Skills load through Pi's skill loader from `package.json` `pi.skills`. team-kit's two rule files joined this class when they started shipping unwired in `rules/` (row RULES-PLUGIN); at the start of the run they were absent and the count was 20. |
| Changed | 68 | 5 | Host translations in the categories below. Every span read. Exceptions with behavioral effect are rows CREATE-SKILL, RULE-*, and FORK-RUNNING. |
| Absent | 4 | 2 | `.cursor-plugin/plugin.json`, `plugin.json` (both): replaced by the Pi package manifest `package.json` `pi`. `pstack/.gitignore`: a development file, no behavior. `docs/harness/claude-code.md`: the Claude Code adapter, a different harness. team-kit `assets/avatar.png`: Pi has no plugin logo surface. |
| Target-only | 17 | | Package, docs, supervisor, tests; `skills/automate` and `skills/create-skill` stand in for Cursor built-ins (rows AUTOMATE, CREATE-SKILL). The two Pi-only rule skills were removed (row RULES-PLUGIN). |

Translation categories of the changed files:

- T1 paths and names: `~/.cursor/...` to `~/.pi/agent/...`, `.cursor/` to `.pi/`, Cursor transcript layout to Pi session files and pi-pstack subagent transcripts, plugin to package, Cursor to Pi.
- T2 model specs: `<model>-<effort>[-fast]` slugs to Pi specs `<model>:<effort>` and `<model>[effort=...,fast=true]`, with the selection rule unchanged.
- T3 model rule: `~/.cursor/rules/pstack-models.mdc` to the rule path the system prompt names. Timing wording changed; row RULE-TIMING.
- T4 tool names: Read, Grep, Glob, Shell to read, grep, find, bash.
- T5 host features: Custom Mode and Alt+Enter to `/mode`; `update_state` routine, routine panel, and `SendToUser` secret card to `subscribe_webhook`, its credential file, and `request_secret`; Automations editor to `/automations`; built-in `/automate` to the `automate` skill; Cursor Slack actions to the Slack tools; in-app browser to the system browser and `control-ui`; inline media to the read tool and system player; Projects to `/project`; PR and CI subscriptions to `subscribe_github_pr`; "agent mode" to `readonly` unset; Cursor's `mcps/` folder to `pi mcp list`.
- T6 Pi notes added where Pi behaves differently: supervisor and offline parking (guide 07 and 09, make-bot-ui), hidden-skill loading (poteto-help), `<SKILLS>` placeholders (multi-phase-plan), `stop_agent` mentions, fork needs an idle source (orchestrate; row FORK-RUNNING).
- T7 README, LICENSE, guide install steps.
- T8 scripts: `worktree-audit.sh` reads Pi transcripts; statechart `cli.test.ts` gains a `realpath` and an ENOENT guard for test robustness; two `package.json` names.

## 2. Dependency graph

| Dependency | Version | What pstack relies on | Pi mechanism | Status |
| --- | --- | --- | --- | --- |
| cursor-team-kit | 1.2.0 | 18 skills, 2 agents, 2 rules | skills vendored byte-identical (16) or translated (2); agents loaded by `src/task/agents.ts`; rules row RULES-PLUGIN | see rows |
| Cursor CLI agent loop | 2026.11.05 | Task, background shells and notifications, AwaitShell, TodoWrite, AskQuestion, SwitchMode, GenerateImage, plan mode and CreatePlan, skills catalog and `/name` attachment, custom modes, rules loading | `src/` tools, commands, and prompt sections | rows below |
| Cursor built-in skills | sync 07:44Z | `loop`, `create-skill` (named by pstack); `automate`, `visualize` (named, served by the backend) | `/loop` and `Loop`; `skills/create-skill`; `skills/automate`; `visualize` | rows LOOP, CREATE-SKILL, AUTOMATE, VISUALIZE |
| Cursor hosted services | n/a | cloud agents on VMs, Automations and Slack triggers, webhook routines, Projects, fork via CreateAgent | containers or worktrees, detached runs, subscriptions supervisor, Slack polling, loopback routines, `/project` | rows CLOUD-*, AUTO-*, FORK-RUNNING |
| Cursor desktop | 3.27.22 | `fork`, `readonly`, `environment`, `cloud_base_branch` on Task (absent from CLI 11.05), `shell` subagent behind a flag | Task parameters, `shell` agent | prior rows, `test/e2e/task.e2e.test.ts` |
| git, gh, rg, jq, bun/node | system | scripts (`worktree-audit.sh`, `watch-pr`, statechart), PR workflows | same tools | `test/scripts.test.ts`, statechart suite |
| bwrap / sandbox-exec | system | readonly shell isolation (Pi side only) | `src/linux-readonly-sandbox.ts`, `@anthropic-ai/sandbox-runtime` | prior rows |
| Docker | 29.1.3 client | cloud machine (Pi side) | `src/cloud/*` | blocked here (row CLOUD-CONTAINER) |
| ffmpeg | absent | video frames for subagents (Pi side) | `src/task/video.ts` | blocked here (row VIDEO) |

Host tools present in Cursor CLI 11.05 and absent from pi-pstack, with no pstack or team-kit reference (`git grep`, notes F7): WebSearch, WebFetch, CreateGoal, UpdateGoal, SendToCall, EditNotebook, FetchMcpResource, Delete (shell `rm` covers it), and the built-in subagents cursor-guide, ci-investigator, bugbot, security-review, best-of-n-runner. Status `inapplicable`.

## 3. Behavior rows

### Background work owned by the root chat

| ID | Reference behavior and evidence | Pi mechanism | Status |
| --- | --- | --- | --- |
| BG-OWN-1 | A subagent never receives notifications for its own background shells, even while it still runs. Live: `subagent-bg-shell-done.jsonl` (child waited 8 s after its job ended, saw nothing). Source: `wakeupOwnerConversationId: cr.parentAgentId` (1212.index.js). | `src/inbox.ts` mailbox; a child's `bash_background` notices are posted to the root's inbox (`src/index.ts` `forward`). | verified: `test/e2e/background-ownership.e2e.test.ts` BG-OWN-1 (red on old src, green on new), mutation `child-hears-own-jobs` caught, live deepseek-flash `live/subagent-bg-shell-done.jsonl` (child reported no notice; root got `status: success` after the Task result) |
| BG-OWN-2 | Each completion of a subagent's background shell wakes the root chat with `kind: shell` and the job's status, task id, title, and tool call id, after the subagent's result. Live: the notice arrived 3.5 s after the Task result. | `registerRootInbox` routes items to the shell notice path (follow-up turn, or the one-shot settle queue), holding an item while its source agent is still followed. | verified: `test/e2e/background-ownership.e2e.test.ts` BG-OWN-1/2 and the interactive ordering case, mutation `no-hold` caught, live runs as above |
| BG-OWN-3 | When a subagent ends, its still-running background shells are aborted and the root chat gets `kind: shell status: aborted` for each, without detail or output path. Live: `subagent-bg-shell.jsonl` (+3.9 s result, +6.4 s aborted notice). Source: shell manager `dispose()`, `enqueueShellCompletion`. | `jobs.shutdown(announce)` in a subagent stops running jobs and posts `aborted` notices. | verified: `test/e2e/background-ownership.e2e.test.ts` BG-OWN-3 (+ terminal file `status: aborted`), mutation `shutdown-silent` caught, live `live/subagent-bg-shell.jsonl` |
| BG-OWN-4 | A subagent's background subagent keeps running after the subagent ends and its `kind: subagent` completion (title from the prompt, detail = final text) wakes the root chat. Live: `subagent-bg-task.jsonl` (+5.0 s child result, +28.8 s grandchild notice to the root). | A subagent's background Task starts as a detached local run watched against the root pid and recorded with the root as owner; the root adopts it from an `adopt` item and stops it at its own shutdown (`startAdopted`, `adopt`). | verified: `test/e2e/background-ownership.e2e.test.ts` BG-OWN-4, mutation `no-adoption` caught, live `live/subagent-bg-task.jsonl` (same title and detail as Cursor) |
| BG-OWN-5 | A subagent's Shell launch text has no subagent-specific note. Source: one Shell tool for every depth. | Note removed from `src/background-shell.ts`. | verified: `test/e2e/background-ownership.e2e.test.ts` BG-OWN-3 asserts the exact launch text |
| BG-OWN-6 | AwaitShell on a job suppresses its notification for the owner. Source: `markAwaitedCompletion` suppresses the owner's queue. | `finish` delivers only unobserved jobs; forwarding sits behind it. | verified: `test/e2e/background-ownership.e2e.test.ts` BG-OWN-6, mutation `no-suppression` caught |

| BG-OWN-7 | A Cursor cloud agent is its own top-level conversation on its own machine, so it is the wakeup owner of its subtree (inferred from `wakeupOwnerConversationId: cr.parentAgentId` being per runtime; hosted runs are not observable here). | A detached cloud run gets no root identity, so it is the root of its tree: its jobs notify it and it keeps its background subagents. | verified for the Pi side: background-ownership BG-OWN-7, mutation `cloud-agent-not-own-root` caught; reference side inferred |
| LINUX-OWNER | Cursor's cloud machine is not the user's laptop, so nothing it writes changes file ownership on the user's machine. | On Linux the container runs as the host user (`hostUserArgs`), so the clone and the shared Project and store folders stay the user's. | verified: cloud-machine e2e asserts the host uid owns the Project notes and the edited file, mutation `machine-runs-as-root` caught (`[0, 1000]`), `test/cloud-host-user.test.ts` |

### Rules and the model rule

| ID | Reference behavior and evidence | Pi mechanism | Status |
| --- | --- | --- | --- |
| RULES-PLUGIN | team-kit's two `alwaysApply` rules never reach the model. Live: `rule-text.jsonl` (`--plugin-dir`), `rule-text-installed.jsonl` (installed under `plugins/local`). pstack never names them. | `src/sections.ts` injects no rule; `rules/*.mdc` ship byte-identical and unwired; the two rule skills are gone. | verified: `test/sections.test.ts` RULES-PLUGIN, `test/resources.test.ts` rule files, `package.e2e` packed paths, mutation `rules-injected` caught |
| RULE-SCOPE | `~/.cursor/rules/pstack-models.mdc` reaches workspaces under the home directory only (ancestor walk), rendered as `<always_applied_workspace_rule name="...">`. Live: `rule-scope-*.jsonl`. Source: `loadRulesFromDirAndAncestors`. | `sessionRule` in `src/rule.ts`; outside home no `pstack_models` and the host line names only the path. | verified: `host.e2e` RULE-SCOPE, mutation `rule-everywhere` caught |
| RULE-TIMING | Rules load once per session; a rule written mid-session applies to later sessions. pstack: "The rule applies to new chats." Source: rules load in the service constructor; the watcher covers only the workspace root's own globs. | Read in `session_start` after the legacy migration; setup-pstack, poteto-help, guide 01 say new sessions/new chats again. | verified: `host.e2e` RULE-TIMING over RPC with `new_session`, mutation `rule-every-request` caught |

### Host skills and features

| ID | Reference behavior and evidence | Pi mechanism | Status |
| --- | --- | --- | --- |
| CREATE-SKILL | pstack sends skill authoring to Cursor's built-in `create-skill` (`~/.cursor/skills-cursor/create-skill/SKILL.md`, 508 lines: discovery, design, implementation, verification). | `translate-create-skill.mjs` rebuilds it with eight named substitutions (57 words added, 114 removed, all host facts). | verified: `resources.test.ts` CREATE-SKILL, mutation `create-skill-redesigned` caught |
| AUTOMATE | pstack's benny text names `/automate`'s draft table, approval, readiness, and editor handoff. The skill text is served by Cursor's backend and absent from this host. | `skills/automate`, native. | opaque |
| VISUALIZE | `/ketchup` names `/visualize`; its skill text is served by the backend. | `visualize` tool (bar and line chart, SVG). | opaque |
| LOOP | `loop` built-in unchanged since the 2026-11-03 capture (`diff` exit 0). | `/loop`, `Loop` (prior rows, `test/loop.test.ts`, `test/e2e/host.e2e.test.ts`). | verified (baseline suite) |
| FORK-RUNNING | Upstream orchestrate: fork for a worker's checkout, uncommitted changes, or a running process. `fork_from`/`fork_turns` belong to desktop's hosted `CreateAgentArgs`; whether a running source may be forked is decided server-side. | Task `fork` refuses a running source. | opaque |
| SHELL-WINDOW | Cursor's Shell waits up to `block_until_ms` (default 30 s) and then moves the command to the background with a shell id. Pi's `bash` blocks to the end. Pi 1.5.0 lets an extension override `bash`. | `bash_background` with `block_until_ms` gives the two-step behavior when chosen; plain `bash` does not. Not changed: overriding Pi's `bash` alters every Pi tool consumer and two existing pi-pstack overrides. | open (decision) |
| SHELL-STATE | Cursor's Shell keeps cwd and environment between calls ("Shell state (cwd, env vars) persists for subsequent calls", `subagent-bg-shell-done.jsonl`). Pi's `bash` starts fresh each call. | none; Pi's `bash` is stateless (observed: `cd` and `export` do not survive to the next call). | open (decision) |

### Environment-blocked verification

| ID | Condition | Smallest unblock | Status |
| --- | --- | --- | --- |
| CLOUD-CONTAINER | The operator added `josh` to the `docker` group; tests run through `sg docker`. On Linux the first run failed cleanup on root-owned files (row LINUX-OWNER). | Done. | verified: `sg docker -c 'vitest run test/e2e/cloud-machine.e2e.test.ts'` 5 passed after the LINUX-OWNER fix |
| VIDEO | ffmpeg is absent from `PATH`. | Done for verification: wrappers run the flatpak runtime's ffmpeg 7.1.3 through its own loader. | verified: `PATH=/tmp/flatpak-ffmpeg-bin:$PATH vitest run test/e2e/video.e2e.test.ts` 1 passed |
| HOSTED | Cursor-hosted VMs, public webhook URLs, Slack push events, team MCP configuration, and server-side fork have no local equivalent to observe. | Paid Cursor cloud agents and a Slack workspace grant. | opaque |

### Repository hygiene found on the way

| ID | Finding | Change | Status |
| --- | --- | --- | --- |
| TEST-SUPERVISOR | Every suite run left `supervisor-main.ts` daemons for deleted sandboxes (8 after the baseline, 4 after U1), since the daemon has no exit condition. | `test/e2e/harness.ts` `dispose` stops the supervisor of its own workspace before deleting it. | verified: no `supervisor-main.ts --workspace /tmp/pi-pstack-e2e-*` process after the later runs |
| RES-007 | The relative-link check read link syntax inside fenced code as links, so Cursor's create-skill examples failed it. | The check blanks fenced code first (CommonMark). | verified: mutation `broken-link-outside-fence` caught |

## 4. Earlier rows re-run on this host

The package suite carries the earlier runs' contracts as tests that drive real Pi with the scripted model: modes, plan mode and `CreatePlan`, Task (fresh, resume, fork, readonly, worktree cloud driver, attachments, model rules, result texts), `/loop` and `Loop`, `TodoWrite`, `AskQuestion`, background shells and `AwaitShell`, subscriptions and the supervisor, Slack against a fake API, secrets, Projects, automations, `/in-cloud`, skill and template attachment, tool text, and the package install. It passed on this host before the change (820 passed, 7 skipped) and after it (`make verify` receipts in notes.md). These rows are verified as far as those tests check them; the five container-machine tests stay skipped here (row CLOUD-CONTAINER).

## 5. What this ledger does not claim

- Hosted behavior (HOSTED, AUTOMATE, VISUALIZE, FORK-RUNNING) is opaque from this host.
- SHELL-WINDOW and SHELL-STATE are open by decision.
- A real model following every pstack skill on both hosts was not observed; live runs here cover the background-ownership scenarios only.
