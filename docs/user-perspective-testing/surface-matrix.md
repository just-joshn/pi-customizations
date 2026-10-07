# User-observable surface inventory — pi-customizations

Reconnaissance for an exhaustive user-perspective verification program. Every row is derived from the
actual source and manifests at commit `78dd5a0`, not from tests or docs. Source columns point at the
registration/read site. Tests were cross-checked only for counts: `extensions/pi-pstack/test/integration.test.ts`
asserts 71 skills / 69 prompt templates and `test/user-perspective.test.ts` asserts the same, which agrees
with the source. Disagreement: `.pi/skills/verify-pi-customizations/SKILL.md` still documents "65 skills,
64 prompt templates" and is stale.

Legend — every row is one observable surface. `[NET]`, `[FS]`, `[CRED]`, `[PROC]`, `[CLI]` flags mark
network, filesystem-outside-repo, OAuth-credential, process-level-state, and external-CLI dependencies.
"agentDir" means Pi's `getAgentDir()` (normally `~/.pi/agent`).

---

## pi-pstack

Summary: 71 skills + 69 prompt templates + 11 commands + 38 tools + 48 event hooks + 4 UI widgets +
14 notification/dialog rows + 13 agent definitions + 13 config files + 24 env vars + 1 install side effect.
The extension entry is `src/index.ts` (`pi` manifest `extensions: ./src/index.ts`); most tools are
model-only or direct and all persist through session entries and agentDir files.

| Surface ID | Kind | Exact name/identifier | User trigger | Observable result | Source file:line | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| PS-CMD-1 | command | `/poteto-mode` | Type `/poteto-mode` or `/poteto-mode off` | Enables sticky Poteto mode, injects SKILL.md body as a user turn; `off` notifies "Poteto mode is off." | extensions/pi-pstack/src/commands.ts:57 | Registered from skills map; also reachable as `/skill:poteto-mode` via input hook |
| PS-CMD-2 | command | `/setup-pstack` | Type `/setup-pstack` | Opens pstack model/budget pickers and writes the model rule | extensions/pi-pstack/src/commands.ts:57, src/commands.ts:30 | Delegates to models.ts UI |
| PS-CMD-3 | command | `/goal` | Type `/goal <objective>`, `/goal clear`, or `/goal` | Creates a persistent goal, clears it, or prints usage/current goal | extensions/pi-pstack/src/goal.ts:75 | Time-limit prefix dropped with a warning |
| PS-CMD-4 | command | `/pstack` | Type `/pstack`, `/pstack status`, `/pstack todos` | Posts the pstack status message (versions, skill/prompt counts, mode) | extensions/pi-pstack/src/context.ts:92 | Unknown arg notifies an error |
| PS-CMD-5 | command | `/workflows` | Type `/workflows` | Lists dynamic workflow runs | extensions/pi-pstack/src/subagents/subagent-commands.ts:76 | Workflow runtime must be enabled |
| PS-CMD-6 | command | `/factories` | Type `/factories` | Same list as /workflows | extensions/pi-pstack/src/subagents/subagent-commands.ts:77 | Legacy alias |
| PS-CMD-7 | command | `/tasks` | Type `/tasks`, `/tasks all`, `/tasks background`, `/tasks cancel <id>` | Lists agents and shells, promotes or cancels one | extensions/pi-pstack/src/subagents/subagent-commands.ts:78 | Notifications at :29, :33, :39 |
| PS-CMD-8 | command | `/subagents` | Type `/subagents [agent model\|tier\|off ...]` | Shows or persists subagent preferences to agentDir/settings.json | extensions/pi-pstack/src/subagents/subagent-commands.ts:79 | Writes user-global settings [FS] |
| PS-CMD-9 | command | `/rubber-duck` | Type `/rubber-duck [focus]` | Sends a prompt telling the model to call the rubber-duck agent now | extensions/pi-pstack/src/subagents/subagent-commands.ts:80 | Warns if rubber-duck agent disabled |
| PS-CMD-10 | command | `/fleet` | Type `/fleet <goal>` | Sends the fleet prompt (parallel background subagents) | extensions/pi-pstack/src/subagents/subagent-commands.ts:87 | Warns on empty goal |
| PS-CMD-11 | command | `/pstack-worker-finalize` | Cloud/detached worker root only | Stops all owned tasks, then exits | extensions/pi-pstack/src/worker-runtime.ts:138 | Env-gated by PI_PSTACK_WORKER_OWNER [PROC] |
| PS-TOOL-1 | tool | `pstack_mode` | Model-callable / user requests Poteto mode | Toggles sticky mode and returns state | extensions/pi-pstack/src/state.ts:135 | Writes session entry |
| PS-TOOL-2 | tool | `TodoWrite` | Model-callable | Replaces or merges ordered todos; TUI renders a checklist widget | extensions/pi-pstack/src/state.ts:152 | renderCall/renderResult at :175 |
| PS-TOOL-3 | tool | `RestartSubscriptions` | Model/user after a stopped timer supervisor | Restarts supervisor, reattaches Pi root, returns subscription list | extensions/pi-pstack/src/timers.ts:89 | Spawns timer service [PROC][FS] |
| PS-TOOL-4 | tool | `SubscribeGithubCI` | Model call with repo/pr | Durable CI watcher; wakes the owning root on terminal state | extensions/pi-pstack/src/timers.ts:121,176 | Uses gh CLI and network through gh [NET][CLI][PROC] |
| PS-TOOL-5 | tool | `SubscribeOriginCI` | Model call with repo/pr | Fails unless PI_PSTACK_ORIGIN_CI_COMMAND is set | extensions/pi-pstack/src/timers.ts:121,177 | Origin forge command is external [NET][PROC] |
| PS-TOOL-6 | tool | `SubscribeTimer` | Model call with name/prompt/delay or cron | Creates a durable timer in a dedicated Pi root | extensions/pi-pstack/src/timers.ts:146 | Spawns a second Pi process [PROC] |
| PS-TOOL-7 | tool | `ListSubscriptions` | Model call | Lists durable subscriptions owned by this session | extensions/pi-pstack/src/timers.ts:178 | Reads timer state [FS] |
| PS-TOOL-8 | tool | `Unsubscribe` | Model call with subscriptionId | Cancels and drains a subscription | extensions/pi-pstack/src/timers.ts:196 | [FS][PROC] |
| PS-TOOL-9 | tool | `RoutinePrepare` | Model call | Creates a disabled webhook routine draft plus hidden key-initializer command | extensions/pi-pstack/src/routines.ts:57 | Writes agentDir/pstack-routines [FS] |
| PS-TOOL-10 | tool | `RoutineInspect` | Model call with routineId | Returns definition and receipt without the sender key | extensions/pi-pstack/src/routines.ts:75 | [FS] |
| PS-TOOL-11 | tool | `RoutineEnable` | Model call; needs operator confirm dialog | Starts the routine's receiver and dedicated Pi root | extensions/pi-pstack/src/routines.ts:90 | Model-only; confirm at :107 [PROC][NET] |
| PS-TOOL-12 | tool | `RoutineDisable` | Model call with routineId | Stops ingress and drains the owned process | extensions/pi-pstack/src/routines.ts:113 | [PROC] |
| PS-TOOL-13 | tool | `Task` | Model call | Starts/resumes a subagent locally or in a configured cloud VM | extensions/pi-pstack/src/workers.ts:13 | Spawns child Pi sessions; cloud needs executor config [PROC][NET] |
| PS-TOOL-14 | tool | `TaskOutput` | Model call with task_id, optional block | Returns status/output; block waits for completion | extensions/pi-pstack/src/workers.ts:35 | |
| PS-TOOL-15 | tool | `TaskStop` | Model call with task_id | Aborts a running child task | extensions/pi-pstack/src/workers.ts:49 | Kills process group [PROC] |
| PS-TOOL-16 | tool | `TaskMessage` | Model call with task_id/message/mode | Queues steering or follow-up input | extensions/pi-pstack/src/workers.ts:66 | |
| PS-TOOL-17 | tool | `TaskList` | Model call; `repository: true` for branch discovery | Lists branch tasks or repository launch receipts | extensions/pi-pstack/src/workers.ts:82 | Repository mode runs git and reads the task index [FS][CLI] |
| PS-TOOL-18 | tool | `TaskAttach` | Model call with task_id or branch | Attaches a previously launched remote task and reconciles status | extensions/pi-pstack/src/workers.ts:109 | [NET] for remote placement |
| PS-TOOL-19 | tool | `CreateGoal` | Model call | Arms one goal; fails if another is active | extensions/pi-pstack/src/goal.ts:97 | Session entry |
| PS-TOOL-20 | tool | `UpdateGoal` | Model call with status complete | Marks the active goal complete | extensions/pi-pstack/src/goal.ts:116 | |
| PS-TOOL-21 | tool | `GetGoal` | Model call | Returns current goal or null | extensions/pi-pstack/src/goal.ts:138 | |
| PS-TOOL-22 | tool | `pstack_context` | Model call; optional history:true | Returns transcript path, branch entries, tools, models, workspace history | extensions/pi-pstack/src/context.ts:55 | Reads session dir [FS] |
| PS-TOOL-23 | tool | `BackgroundShell` | Model call | Starts a background bash command, writes a log, wakes on pattern | extensions/pi-pstack/src/shells.ts:98 | Spawns detached process [PROC][FS] |
| PS-TOOL-24 | tool | `BackgroundShellList` | Model call | Lists this session's shells | extensions/pi-pstack/src/shells.ts:113 | |
| PS-TOOL-25 | tool | `BackgroundShellStop` | Model call with id | Stops the shell's process group | extensions/pi-pstack/src/shells.ts:126 | [PROC] |
| PS-TOOL-26 | tool | `AskQuestion` | Model call | TUI/RPC dialogs up to 4 questions with options | extensions/pi-pstack/src/questions.ts:63 | Errors headless or with PI_PSTACK_HEADLESS; dialogs at :39,:49,:52 |
| PS-TOOL-27 | tool | `pstack_setup` | Model call | Opens the same model/budget setup as /setup-pstack | extensions/pi-pstack/src/setup-tool.ts:7 | Model-only |
| PS-TOOL-28 | tool | `task` | Model call | Delegates to a built-in/custom agent in a child context | extensions/pi-pstack/src/subagents/agent-tools.ts:74 | Re-registered on session_start at src/subagents.ts:206 |
| PS-TOOL-29 | tool | `read_agent` | Model call | Reads a background agent's status/output | extensions/pi-pstack/src/subagents/agent-tools.ts:104 | |
| PS-TOOL-30 | tool | `write_agent` | Model call | Sends a follow-up to a running/idle background agent | extensions/pi-pstack/src/subagents/agent-tools.ts:123 | |
| PS-TOOL-31 | tool | `list_agents` | Model call | Lists started agents | extensions/pi-pstack/src/subagents/agent-tools.ts:143 | |
| PS-TOOL-32 | tool | `context_board` | Model call | Reads/writes durable project facts on a per-cwd board | extensions/pi-pstack/src/subagents/context-board.ts:55 | Writes agentDir/context-boards [FS] |
| PS-TOOL-33 | tool | `send_inbox` | Model call | Emits a message on a pstack child-event channel | extensions/pi-pstack/src/subagents/inbox.ts:19 | |
| PS-TOOL-34 | tool | `execution_subagent` | Model call; enabled by feature flag | Runs build/test commands in a separate context | extensions/pi-pstack/src/subagents/specialized-tools.ts:11,58 | Gated by COPILOT_CLI_ENABLED_FEATURE_FLAGS / COPILOT_EXPERIMENTS; registered at src/subagents.ts:265 |
| PS-TOOL-35 | tool | `search_subagent` | Model call; enabled by feature flag | Searches code in a separate context | extensions/pi-pstack/src/subagents/specialized-tools.ts:21,58 | Same feature-flag gate; registered at src/subagents.ts:265 |
| PS-TOOL-36 | tool | `run_dynamic_workflow` | Model call; needs user approval dialog | Starts a registered dynamic workflow | extensions/pi-pstack/src/subagents/workflows/tools.ts:35 | Gated by COPILOT_DYNAMIC_WORKFLOWS; confirm at extensions/pi-pstack/src/subagents/workflows/runtime.ts:125 |
| PS-TOOL-37 | tool | `dynamic_workflows_manage` | Model call | Lists, cancels, pauses or resumes workflow runs | extensions/pi-pstack/src/subagents/workflows/tools.ts:46 | |
| PS-TOOL-38 | tool | `read_workflow_run` | Model call with run_id | Returns status, consumption, phases, journal | extensions/pi-pstack/src/subagents/workflows/tools.ts:63 | |
| PS-EVT-1 | event-hook | `agent_start` | Any agent turn starts | Defers delivery waiters for setup-pstack follow-ups | extensions/pi-pstack/src/deliver.ts:9 | |
| PS-EVT-2 | event-hook | `agent_settled` | Agent settles | Releases deferred follow-up delivery | extensions/pi-pstack/src/deliver.ts:12 | |
| PS-EVT-3 | event-hook | `session_start` | Session start | Restores pstack state and shows host version warning | extensions/pi-pstack/src/index.ts:66 | |
| PS-EVT-4 | event-hook | `session_tree` | Branch/tree change | Restores pstack state | extensions/pi-pstack/src/index.ts:70 | |
| PS-EVT-5 | event-hook | `before_agent_start` | Before each turn | Injects pstack_host, pstack_mode, pstack_todos sections and first-action rule | extensions/pi-pstack/src/index.ts:71 | |
| PS-EVT-6 | event-hook | `session_start` | Session start | Restores goal from branch entries | extensions/pi-pstack/src/goal.ts:56 | |
| PS-EVT-7 | event-hook | `session_tree` | Branch change | Restores goal | extensions/pi-pstack/src/goal.ts:57 | |
| PS-EVT-8 | event-hook | `before_agent_start` | Before each turn | Injects/removes the pstack_goal section | extensions/pi-pstack/src/goal.ts:58 | |
| PS-EVT-9 | event-hook | `agent_before_settle` | Agent about to settle with a completed goal | Schedules a continuation message | extensions/pi-pstack/src/goal.ts:63 | Goal loops across turns |
| PS-EVT-10 | event-hook | `context` | Context assembly | Filters out old pstack-status messages | extensions/pi-pstack/src/context.ts:89 | |
| PS-EVT-11 | event-hook | `session_start` | Session start | Rebinds shell runtime to the session context | extensions/pi-pstack/src/shells.ts:61 | |
| PS-EVT-12 | event-hook | `session_shutdown` | Session end | Stops shells or hands them to the parent | extensions/pi-pstack/src/shells.ts:74 | [PROC] |
| PS-EVT-13 | event-hook | `message_end` | Shell output message delivered | Marks wake as delivered | extensions/pi-pstack/src/shells.ts:95 | |
| PS-EVT-14 | event-hook | `session_start` | Session start | Restores subagent records and re-registers the task tool | extensions/pi-pstack/src/subagents.ts:110 | |
| PS-EVT-15 | event-hook | `session_tree` | Branch change | Restores subagent/workflow state | extensions/pi-pstack/src/subagents.ts:111 | |
| PS-EVT-16 | event-hook | `session_shutdown` | Session end | Halts workflow runtime | extensions/pi-pstack/src/subagents.ts:112 | |
| PS-EVT-17 | event-hook | `input` | User input arrives | Triggers sidekick agents on user.message | extensions/pi-pstack/src/subagents.ts:170 | Feature-flag gated |
| PS-EVT-18 | event-hook | `session_compact` | Compaction | Triggers sidekicks and resets selection | extensions/pi-pstack/src/subagents.ts:174 | |
| PS-EVT-19 | event-hook | `model_select` | Model change | Cancels sidekicks | extensions/pi-pstack/src/subagents.ts:178 | |
| PS-EVT-20 | event-hook | `agent_end` | Turn end | Cancels sidekicks on abort | extensions/pi-pstack/src/subagents.ts:181 | |
| PS-EVT-21 | event-hook | `session_before_tree` | Before branch rewind | Notifies scheduler of rewind | extensions/pi-pstack/src/subagents.ts:187 | |
| PS-EVT-22 | event-hook | `agent_before_settle` | Headless run with active work | Waits for background tasks before exit | extensions/pi-pstack/src/subagents.ts:188 | |
| PS-EVT-23 | event-hook | `session_start` | Session start | Starts session tracking and limiter refresh | extensions/pi-pstack/src/subagents.ts:200 | |
| PS-EVT-24 | event-hook | `resources_discover` | Resource discovery | Clears cached discovery | extensions/pi-pstack/src/subagents.ts:208 | |
| PS-EVT-25 | event-hook | `session_tree` | Branch change | Tracks context and restores schedulers | extensions/pi-pstack/src/subagents.ts:209 | |
| PS-EVT-26 | event-hook | `tool_execution_start` | edit/write tool starts | Appends a file-change session entry | extensions/pi-pstack/src/subagents.ts:216 | |
| PS-EVT-27 | event-hook | `session_shutdown` | Session end | Cancels sidekicks, shuts down scheduler, may launch rem | extensions/pi-pstack/src/subagents.ts:221 | May spawn detached Pi [PROC] |
| PS-EVT-28 | event-hook | `before_agent_start` | Before each turn | Injects selected_agent, subagent_usage, model preferences sections | extensions/pi-pstack/src/subagents.ts:232 | |
| PS-EVT-29 | event-hook | `before_agent_start` | Before each turn | Enforces subagent tool policy | extensions/pi-pstack/src/subagents/tool-policy.ts:17 | |
| PS-EVT-30 | event-hook | `tool_call` | Tool call | Blocks disallowed tools with a reason | extensions/pi-pstack/src/subagents/tool-policy.ts:20 | |
| PS-EVT-31 | event-hook | `tool_call` | Tool call | Blocks writes in plan mode | extensions/pi-pstack/src/subagents/write-gate.ts:9 | |
| PS-EVT-32 | event-hook | `tool_call` | Tool call | Applies content exclusion policy | extensions/pi-pstack/src/subagents/content-exclusion.ts:39 | |
| PS-EVT-33 | event-hook | `model_select` | Model change | Tracks model history | extensions/pi-pstack/src/subagents/model-history.ts:16 | |
| PS-EVT-34 | event-hook | `model_select` | Child model change | Re-applies identity headers | extensions/pi-pstack/src/subagents/identity-extension.ts:17 | |
| PS-EVT-35 | event-hook | `before_provider_headers` | Provider request | Adds identity headers | extensions/pi-pstack/src/subagents/identity-extension.ts:20 | Internal child identity only |
| PS-EVT-36 | event-hook | `before_provider_request` | Provider request | Mutates body fields for assistant-wire identity | extensions/pi-pstack/src/subagents/identity-extension.ts:23 | Internal |
| PS-EVT-37 | event-hook | `session_start` | Session start | Attaches the task panel widget | extensions/pi-pstack/src/subagents/task-panel.ts:100 | |
| PS-EVT-38 | event-hook | `session_shutdown` | Session end | Detaches the panel | extensions/pi-pstack/src/subagents/task-panel.ts:101 | |
| PS-EVT-39 | event-hook | `input` | User input | Refreshes panel decorations | extensions/pi-pstack/src/subagents/task-panel.ts:102 | |
| PS-EVT-40 | event-hook | `session_start` | Child session start | Re-registers inherited MCP servers | extensions/pi-pstack/src/subagents/mcp-inheritance.ts:26 | [NET] for remote MCP servers |
| PS-EVT-41 | event-hook | `tool_result` | Task tool result | Reports failed-task usage | extensions/pi-pstack/src/worker-runtime.ts:148 | |
| PS-EVT-42 | event-hook | `session_start` | Worker root start | Restores records and registers finalize command | extensions/pi-pstack/src/worker-runtime.ts:155 | [PROC] |
| PS-EVT-43 | event-hook | `session_tree` | Worker branch change | Restores records | extensions/pi-pstack/src/worker-runtime.ts:156 | |
| PS-EVT-44 | event-hook | `session_shutdown` | Worker root end | Stops all tasks | extensions/pi-pstack/src/worker-runtime.ts:157 | |
| PS-EVT-45 | event-hook | `agent_end` | Turn end | Tracks aborted turns for deferred wakes | extensions/pi-pstack/src/deferred-wakes.ts:16 | |
| PS-EVT-46 | event-hook | `agent_before_settle` | Clean completed turn | Flushes held wakes | extensions/pi-pstack/src/deferred-wakes.ts:20 | |
| PS-EVT-47 | event-hook | `agent_settled` | Agent settled | Flushes held wakes | extensions/pi-pstack/src/deferred-wakes.ts:23 | |
| PS-EVT-48 | event-hook | `input` | User types `/skill:poteto-mode`, `/skill:setup-pstack`, or an owned `/prompt args` | Rewrites to skill expansion or encoded prompt argument | extensions/pi-pstack/src/commands.ts:78 | Prompt-template arg quoting |
| PS-UI-1 | ui-widget | status key `pstack` | Poteto mode on | Status badge shows mode name (crown glyph) | extensions/pi-pstack/src/state.ts:108 | TUI theme colors only in TUI |
| PS-UI-2 | ui-widget | widget key `pstack-todos` | Todos exist | Checklist widget (first 8 around active item) | extensions/pi-pstack/src/state.ts:111 | RPC gets plain lines |
| PS-UI-3 | ui-widget | status key `pstack-goal` | Active goal | Status shows "goal" | extensions/pi-pstack/src/goal.ts:37 | |
| PS-UI-4 | ui-widget | widget key `pstack-agents` | Running subagents | Task panel of running agents | extensions/pi-pstack/src/subagents/task-panel.ts:10,65 | |
| PS-UI-5 | ui-notification | "Poteto mode is off." | `/poteto-mode off` | Info notice | extensions/pi-pstack/src/commands.ts:26 | |
| PS-UI-6 | ui-notification | setup error notice | `/setup-pstack` fails | Error notice and pstack-setup-error message | extensions/pi-pstack/src/commands.ts:49 | |
| PS-UI-7 | ui-notification | unknown `/pstack` argument | `/pstack bogus` | Error notice listing valid forms | extensions/pi-pstack/src/context.ts:104 | |
| PS-UI-8 | ui-notification | `/pstack` status message | `/pstack` | Rendered status block (versions, counts, mode, optional todos) | extensions/pi-pstack/src/context.ts:127 | customType pstack-status |
| PS-UI-9 | ui-notification | "Goal cleared." | `/goal clear` | Info notice | extensions/pi-pstack/src/goal.ts:81 | |
| PS-UI-10 | ui-notification | goal usage/current goal | `/goal` with no objective | Info notice | extensions/pi-pstack/src/goal.ts:86 | |
| PS-UI-11 | ui-notification | "Time limits are unsupported." | `/goal 5m do x` | Warning notice; goal created without limit | extensions/pi-pstack/src/goal.ts:89 | |
| PS-UI-12 | ui-notification | host version mismatch | Session start on untested Pi | Warning notice | extensions/pi-pstack/src/index.ts:68 | |
| PS-UI-13 | ui-notification | setup model table / wrote rule / family warnings | `/setup-pstack` steps | Info/warning notices | extensions/pi-pstack/src/models.ts:238,280,292,296 | |
| PS-UI-14 | ui-notification | /tasks, /subagents, /workflows, /rubber-duck, /fleet notices | Those commands | Info/warning notices with agent lists or errors | extensions/pi-pstack/src/subagents/subagent-commands.ts:29,33,39,45,52,54,59,64,83,90 | Writes agentDir/settings.json at :49 |
| PS-UI-15 | ui-notification | workflow run confirmation | Model starts a dynamic workflow | Confirm dialog with description and effective limits | extensions/pi-pstack/src/subagents/workflows/runtime.ts:125 | Needs UI |
| PS-UI-16 | ui-notification | routine enable confirmation | RoutineEnable tool | Confirm dialog showing draft JSON | extensions/pi-pstack/src/routines.ts:107 | Needs UI |
| PS-UI-17 | ui-notification | model setup dialogs | `/setup-pstack` / `pstack_setup` | Selection, text-input and confirm dialogs; non-TUI uses select | extensions/pi-pstack/src/models.ts:200,231,262,293 | Needs UI/RPC dialog support |
| PS-UI-18 | ui-notification | picker custom component | Role picker during setup | Custom TUI selector | extensions/pi-pstack/src/picker.ts:8-9 | TUI only; select fallback otherwise |
| PS-SKILL-GROUP | skill | 71 skills discoverable as `/skill:<name>` | Any `/skill:<name>` | Injects the skill body into the conversation | extensions/pi-pstack/package.json:24-27 | Full list: architect, arena, automate-me, benchmark-checklist, blast-radius, check-compiler-errors, control-cli, control-ui, correct, create-verification-skill, deslop, figure-it-out, fix-ci, fix-merge-conflicts, get-pr-comments, how, interrogate, loop-on-ci, maintain-verification-skill, make-bot-ui, make-pr-easy-to-review, new-branch-and-pr, no-comments, poteto-mode, principle-attack-the-premise, principle-boundary-discipline, principle-build-the-lever, principle-encode-lessons-in-structure, principle-exhaust-the-design-space, principle-experience-first, principle-explain-the-number, principle-fix-root-causes, principle-foundational-thinking, principle-guard-the-context-window, principle-laziness-protocol, principle-make-operations-idempotent, principle-migrate-callers-then-delete-legacy-apis, principle-minimize-reader-load, principle-model-the-domain, principle-never-block-on-the-human, principle-outcome-oriented-execution, principle-prove-it-works, principle-redesign-from-first-principles, principle-separate-before-serializing-shared-state, principle-sequence-verifiable-units, principle-subtract-before-you-add, principle-test-behavior-not-implementation, principle-type-system-discipline, pr-review-canvas, recall, reflect, review-and-ship, run-smoke-tests, setup-pstack, show-me-your-work, swarm, tdd, teach, technical-writing, thermo-nuclear-code-quality-review, typescript-best-practices, unslop, verify-this, weekly-review, what-did-i-get-done, why, workflow-from-chats, create-skill, goal, loop, origin |
| PS-PROMPT-GROUP | prompt-template | 69 prompt templates | Type `/<name>` (arguments allowed after a space) | Expands the prompt template; pstack input hook re-quotes arguments for owned templates | extensions/pi-pstack/package.json:28-31 | Full list: architect, arena, automate-me, benchmark-checklist, blast-radius, bro, check-compiler-errors, control-cli, control-ui, correct, create-verification-skill, deslop, figure-it-out, fix-ci, fix-merge-conflicts, get-pr-comments, how, interrogate, loop-on-ci, maintain-verification-skill, make-bot-ui, make-pr-easy-to-review, new-branch-and-pr, no-comments, principle-attack-the-premise, principle-boundary-discipline, principle-build-the-lever, principle-encode-lessons-in-structure, principle-exhaust-the-design-space, principle-experience-first, principle-explain-the-number, principle-fix-root-causes, principle-foundational-thinking, principle-guard-the-context-window, principle-laziness-protocol, principle-make-operations-idempotent, principle-migrate-callers-then-delete-legacy-apis, principle-minimize-reader-load, principle-model-the-domain, principle-never-block-on-the-human, principle-outcome-oriented-execution, principle-prove-it-works, principle-redesign-from-first-principles, principle-separate-before-serializing-shared-state, principle-sequence-verifiable-units, principle-subtract-before-you-add, principle-test-behavior-not-implementation, principle-type-system-discipline, pr-review-canvas, recall, reflect, review-and-ship, run-smoke-tests, show-me-your-work, swarm, tdd, teach, technical-writing, thermo-nuclear-code-quality-review, typescript-best-practices, unslop, verify-this, weekly-review, what-did-i-get-done, why, workflow-from-chats, create-skill, loop, origin |
| PS-AGENT-GROUP | agent | 13 agent definitions | Task tool with agent_type `<name>` | Launches that persona in a child session | extensions/pi-pstack/src/subagents/builtin-agents.ts:14-60, src/personas.ts:16-27 | Built-in: general-purpose, explore, task, code-review, security-review, research, rubber-duck, rem-agent. Reference personas: shell, explore (same name), poteto-agent, comment-sicko (alias "Comment Sicko"), ci-watcher, thermo-nuclear-code-quality-review |
| PS-CFG-1 | config-file | agentDir/pstack/models.mdc | `/setup-pstack` confirmed | Writes the per-role model rule; read at every before_agent_start | extensions/pi-pstack/src/models.ts:44 | [FS] user-global |
| PS-CFG-2 | config-file | `<cwd>/.pi/pstack/models.mdc` | Placed by user | Project rule overrides the user rule for named roles | extensions/pi-pstack/src/models.ts:47 | [FS] project-local, read-only by extension |
| PS-CFG-3 | config-file | agentDir/settings.json | `/subagents <agent> off\|model\|tier` | Persists subagent preferences | extensions/pi-pstack/src/subagents/subagent-commands.ts:49 | [FS] user-global |
| PS-CFG-4 | config-file | agentDir/pstack/executors.json (or PI_PSTACK_EXECUTORS) | Model uses Task environment cloud | Selects the isolated VM executor | extensions/pi-pstack/src/remote-executors.ts:38 | [FS][NET] SSH/lima |
| PS-CFG-5 | config-file | agentDir/pstack-timers/<hash>/ | SubscribeTimer/CI tools | Timer supervisor state, session, system prompt, status.json | extensions/pi-pstack/src/timers.ts:17-19, extensions/pi-pstack/src/timers.ts:55-74 | [FS] user-global; contains transcript copy |
| PS-CFG-6 | config-file | agentDir/pstack-routines/<hash>/<routineId>/ | Routine tools | Routine definition, revision receipt, session dir | extensions/pi-pstack/src/routines.ts:16-18 | [FS] user-global |
| PS-CFG-7 | config-file | agentDir/pstack-task-index/<repoHash>/<taskId>.json | Remote Task launch | Launch receipts for TaskList repository discovery | extensions/pi-pstack/src/task-discovery.ts:18,29 | [FS] user-global |
| PS-CFG-8 | config-file | agentDir/pstack/store/<cwd-slug>/ | pstack host contract | Agent store for orchestrate state and default plans | extensions/pi-pstack/src/host.ts:22 | [FS] user-global; referenced in system prompt |
| PS-CFG-9 | config-file | agentDir/context-boards/<sha1>.json | context_board tool | Durable per-cwd facts | extensions/pi-pstack/src/subagents/context-board.ts:10-11 | [FS] user-global |
| PS-CFG-10 | config-file | agentDir/agents + ~/.copilot/agents + project .github/agents and .pi/agents | Drop agent .md files | Custom agents appear in Task and `/subagents` | extensions/pi-pstack/src/subagents/agent-locations.ts:21-38 | [FS] reads |
| PS-CFG-11 | config-file | sidekick definitions dir | none (feature flags) | Five sidekick agents can launch on triggers | extensions/pi-pstack/src/subagents/sidekicks/spec.ts:36 | cloud-session-search.md, github-context.md, github-context-memory.md, session-search.md, subconscious-agent.md |
| PS-CFG-12 | config-file | agentDir/settings.json `subagentStatusLine` | User config | Runs a shell command for task-panel decorations | extensions/pi-pstack/src/subagents/task-panel.ts:13-16 | [CLI] user-defined command |
| PS-CFG-13 | config-file | orchestrate state under the agent store | Workflow/orchestrate usage | Plans and state under agentDir/pstack/store/<slug>/orchestrate | extensions/pi-pstack/src/host.ts:22, scripts/orch | [FS] referenced from system prompt |
| PS-ENV-1 | env-var | `PI_PSTACK_HEADLESS` | Set non-empty | Suppresses TUI follow-up delivery and AskQuestion dialogs | extensions/pi-pstack/src/deliver.ts:16, extensions/pi-pstack/src/questions.ts:76 | Changes interaction; verification must cover both modes |
| PS-ENV-2 | env-var | `PI_PSTACK_TIMER_DIRECTORY` | Set to a directory | Overrides the timer owner directory; Unsubscribe passes the session file | extensions/pi-pstack/src/timers.ts:17,208 | [FS] |
| PS-ENV-3 | env-var | `PI_PSTACK_ORIGIN_CI_COMMAND` | Set to executable | Enables SubscribeOriginCI; command prints head/state/summary JSON | extensions/pi-pstack/src/timers.ts:135 | [NET][CLI] |
| PS-ENV-4 | env-var | `PI_PSTACK_WORKER_OWNER` | Set in detached roots | Marks cloud/detached ownership; switches skill catalog mode | extensions/pi-pstack/src/index.ts:51, extensions/pi-pstack/src/worker-runtime.ts:137,261 | [PROC] |
| PS-ENV-5 | env-var | `PI_PSTACK_EXECUTORS` | Set to executors.json path | Overrides executor config path | extensions/pi-pstack/src/remote-executors.ts:38 | [FS] |
| PS-ENV-6 | env-var | `PSTACK_PI_COMMAND` | Set to pi command | Chooses the Pi executable for detached roots | extensions/pi-pstack/src/subagents/pi-command.ts:31 | [PROC][CLI] |
| PS-ENV-7 | env-var | `ORCH_STORE` | Set to orchestrate dir | Adds a session store to cloud filesystem root enumeration | extensions/pi-pstack/src/cloud-filesystem.ts:8 | [FS] |
| PS-ENV-8 | env-var | `COPILOT_CLI_ENABLED_FEATURE_FLAGS` / `COPILOT_EXPERIMENTS` | Comma list | Enables feature-flagged tools (specialized subagents, dynamic workflows) | extensions/pi-pstack/src/subagents/feature-flags.ts:12 | |
| PS-ENV-9 | env-var | `COPILOT_DYNAMIC_WORKFLOWS` | 1/true/yes/on | Enables the three workflow tools | extensions/pi-pstack/src/subagents/workflows/runtime.ts:15 | |
| PS-ENV-10 | env-var | `COPILOT_SUBCONSCIOUS` | 1/true/yes/on | Enables rem-agent/rem launcher | extensions/pi-pstack/src/subagents/feature-flags.ts:20 | |
| PS-ENV-11 | env-var | `COPILOT_DEBUG_ENABLE_SIDEKICKS` | 1/true | Enables all sidekick agents | extensions/pi-pstack/src/subagents/sidekicks/manager.ts:20 | |
| PS-ENV-12 | env-var | `SESSION_SEARCH_SIDEKICK_AGENT`, `GITHUB_CONTEXT_SIDEKICK_AGENT`, `GITHUB_CONTEXT_SIDEKICK_AGENT_FULL`, `CLOUD_SESSION_SEARCH_SIDEKICK_AGENT` | feature flags | Enables individual sidekick definitions | extensions/pi-pstack/src/subagents/sidekicks/definitions/*.md, extensions/pi-pstack/src/subagents/sidekicks/manager.ts:20 | Runs gh and reads sessions [NET][CLI][FS] |
| PS-ENV-13 | env-var | `COPILOT_TASK_WAIT_TIMEOUT_SECONDS` | Integer | Headless settle wait duration | extensions/pi-pstack/src/subagents.ts:59 | |
| PS-ENV-14 | env-var | `COPILOT_EVENTS_LOG_DIRECTORY` | Directory | Writes subagent events log | extensions/pi-pstack/src/subagents.ts:50 | [FS] |
| PS-ENV-15 | env-var | `COPILOT_EVENTS_LOG_INCLUDE_SUBAGENTS` | "true" | Includes subagent events in the log | extensions/pi-pstack/src/subagents/events.ts:132 | |
| PS-ENV-16 | env-var | `COPILOT_DETACHED_SESSION` | Set by launcher | Prevents a detached rem session from re-launching | extensions/pi-pstack/src/subagents/rem-launcher.ts:20 | [PROC] |
| PS-ENV-17 | env-var | `CLAUDE_CODE_HANDBACK_PROVENANCE` | 0/false disables | Controls the subagent hand-back provenance frame | extensions/pi-pstack/src/subagents/output-trust.ts:22 | |
| PS-ENV-18 | env-var | `CLAUDE_CODE_SIMPLE` | Set | Disables status-line decorations in the task panel | extensions/pi-pstack/src/subagents/task-panel.ts:32 | |
| PS-ENV-19 | env-var | `CLAUDE_PROJECT_DIR` | Set for status-line command | Injected project dir for user status command | extensions/pi-pstack/src/subagents/status-line.ts:104 | [CLI] |
| PS-ENV-20 | env-var | `EXECUTION_SUBAGENT_MODEL`, `EXECUTION_SUBAGENT_MAX_TURNS` | Set | Model and turn cap for execution_subagent | extensions/pi-pstack/src/subagents/specialized-tools.ts:36,58 | |
| PS-ENV-21 | env-var | `SEARCH_SUBAGENT_MODEL`, `SEARCH_SUBAGENT_MAX_TURNS` | Set | Model and turn cap for search_subagent | extensions/pi-pstack/src/subagents/specialized-tools.ts:36,58 | |
| PS-ENV-22 | env-var | `PATH` | System | Used to resolve pi/gh/git for child sessions | extensions/pi-pstack/src/subagents/pi-command.ts:22, extensions/pi-pstack/src/subagents/environment-facts.ts:35 | [CLI] |
| PS-ENV-23 | env-var | Timer and routine root args | SubscribeTimer/RoutineEnable | Passes `--approve`/`--no-approve`, provider, model, thinking, `-e` extensions | extensions/pi-pstack/src/timers.ts:27-43, extensions/pi-pstack/src/routines.ts:44-52 | [PROC] |
| PS-ENV-24 | env-var | Provider credentials of the parent | Any cloud/remote Task | Model credentials are inherited by child Pi roots | extensions/pi-pstack/src/worker-support.ts:39-46, cloud-worker.ts | [CRED] |
| PS-INSTALL-1 | install-side-effect | package.json `pi` field | `pi install ./extensions/pi-pstack` | Loads one extension, 71 skills, 69 prompts, remote package image | extensions/pi-pstack/package.json:20-33 | Registers resource discovery at load [FS] |

---

## pi-anthropic-oauth

Summary: 1 provider + 3 event hooks + 1 notification + 3 env vars + 1 credential surface + 1 install side
effect. Everything is a provider wrapper around Pi's built-in Anthropic provider; the default export
registers only `claude-subscription` and a context guard.

| Surface ID | Kind | Exact name/identifier | User trigger | Observable result | Source file:line | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| AN-PROV-1 | provider | `claude-subscription` ("Claude subscription") | `/login` then select Claude subscription; `/model` then pick a claude-subscription model | Claude Pro/Max subscription answers; all built-in Anthropic models re-registered with 1-hour prompt cache | extensions/pi-anthropic-oauth/src/index.ts:160-171 | OAuth via built-in anthropic provider; throws at load if that provider is absent [CRED][NET] |
| AN-EVT-1 | event-hook | `session_start` | Session start | Resets context-guard bias and notices | extensions/pi-anthropic-oauth/src/context/guard.ts:197 | |
| AN-EVT-2 | event-hook | `session_shutdown` | Session end | Resets guard state | extensions/pi-anthropic-oauth/src/context/guard.ts:198 | |
| AN-EVT-3 | event-hook | `before_agent_start` | Before each turn | Compacts the session early when the estimated payload crosses the threshold | extensions/pi-anthropic-oauth/src/context/guard.ts:199 | Only when the active model is claude-subscription and Pi compaction is enabled |
| AN-UI-1 | ui-notification | "Claude context guard: compacting before this request ..." plus failure and trim notices | Automatic when threshold crossed | Info notice plus an appended guard entry | extensions/pi-anthropic-oauth/src/context/guard.ts:145, extensions/pi-anthropic-oauth/src/index.ts:158 | Same messages also delivered as appendEntry when there is no UI |
| AN-ENV-1 | env-var | `CLAUDE_CODE_OAUTH_TOKEN` | Set | Used as subscription token if no stored credential | extensions/pi-anthropic-oauth/src/auth.ts:3 | [CRED] |
| AN-ENV-2 | env-var | `ANTHROPIC_OAUTH_TOKEN` | Set | Fallback token source | extensions/pi-anthropic-oauth/src/auth.ts:3 | [CRED] |
| AN-ENV-3 | env-var | `ANTHROPIC_AUTH_TOKEN` | Set | Fallback token source; must match sk-ant-oat01 shape | extensions/pi-anthropic-oauth/src/auth.ts:3,8 | [CRED] |
| AN-CRED-1 | config-file | Pi credential store entry for claude-subscription (stored credential key) | `/login` sign-in | Token refresh via OAuth refresh; requests identify as Provider CLI | extensions/pi-anthropic-oauth/src/auth.ts:13-24, src/identity.ts:6 | [CRED][NET]; reads stored credential through Pi, not a repo file |
| AN-INSTALL-1 | install-side-effect | package.json `pi.extensions` | `pi install ./extensions/pi-anthropic-oauth` | Loads `./src/index.ts` | extensions/pi-anthropic-oauth/package.json:13-15 | [FS] |

---

## pi-antigravity-oauth

Summary: 1 provider + 1 command + 1 notification + 1 env var + 1 credential surface + 1 install side
effect. The provider signs in through Google OAuth and talks to Cloud Code Assist.

| Surface ID | Kind | Exact name/identifier | User trigger | Observable result | Source file:line | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| AG-PROV-1 | provider | `google-antigravity` ("Google Antigravity") | `/login` then choose Google Antigravity; `/model` | Antigravity models answer through Cloud Code Assist; model catalog refreshed from the service | extensions/pi-antigravity-oauth/src/index.ts:22, src/cloudcode.ts:6 | Baseline snapshot plus fetchModels; OAuth installed-app client [CRED][NET] |
| AG-CMD-1 | command | `/antigravity` | Type `/antigravity` | Prints account email, project, tier and quota; error if not logged in | extensions/pi-antigravity-oauth/src/command.ts:86-99 | Writes to stderr when there is no UI; 30s network budget |
| AG-UI-1 | ui-notification | account/quota report or error | `/antigravity` | Info or error notice | extensions/pi-antigravity-oauth/src/command.ts:92 | |
| AG-ENV-1 | env-var | `CLOUD_CODE_URL` | Set | Overrides Cloud Code Assist base URL | extensions/pi-antigravity-oauth/src/cloudcode.ts:9 | [NET] |
| AG-CRED-1 | config-file | Pi credential store entry for google-antigravity | `/login` Google sign-in | OAuth credential with access token and project id | extensions/pi-antigravity-oauth/src/oauth.ts, extensions/pi-antigravity-oauth/src/models.ts:97-99 | [CRED][NET] |
| AG-INSTALL-1 | install-side-effect | package.json `pi.extensions` | `pi install ./extensions/pi-antigravity-oauth` | Loads `./src/index.ts` | extensions/pi-antigravity-oauth/package.json:13-15 | [FS] |

---

## pi-xai-oauth

Summary: 1 provider + 4 virtual models + 1 install side effect. No commands, hooks, or env vars.

| Surface ID | Kind | Exact name/identifier | User trigger | Observable result | Source file:line | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| XA-PROV-1 | provider | `grok-build` ("Grok Build") | `/login` then choose Grok Build; `/model` | Grok Build models answer through the Grok CLI proxy; catalog refreshed from the proxy | extensions/pi-xai-oauth/src/index.ts:50, extensions/pi-xai-oauth/src/catalog.ts:6,26-30 | OAuth from built-in xai provider [CRED][NET] |
| XA-VM-1 | virtual-model | `grok-4.7-low-fast` | Select model | Routes to grok-4.7-build-fast at low reasoning | extensions/pi-xai-oauth/src/index.ts:52-60, extensions/pi-xai-oauth/src/catalog.ts:119-130 | |
| XA-VM-2 | virtual-model | `grok-4.7-medium-fast` | Select model | Routes to grok-4.7-build-fast at medium reasoning | extensions/pi-xai-oauth/src/index.ts:52-60, extensions/pi-xai-oauth/src/catalog.ts:119-130 | |
| XA-VM-3 | virtual-model | `grok-4.7-high-fast` | Select model | Routes to grok-4.7-build-fast at high reasoning | extensions/pi-xai-oauth/src/index.ts:52-60, extensions/pi-xai-oauth/src/catalog.ts:119-130 | |
| XA-VM-4 | virtual-model | `grok-4.7-xhigh-fast` | Select model | Routes to grok-4.7-build-fast at xhigh reasoning | extensions/pi-xai-oauth/src/index.ts:52-60, extensions/pi-xai-oauth/src/catalog.ts:119-130 | |
| XA-INSTALL-1 | install-side-effect | package.json `pi.extensions` | `pi install ./extensions/pi-xai-oauth` | Loads `./src/index.ts` | extensions/pi-xai-oauth/package.json:13-15 | [FS] |

---

## pi-caveman

Summary: 5 commands + 3 tools + 6 event-hook rows (one covers the vendor runtime's 10 hooks) + 3 UI rows
(1 badge, 1 notification row, 1 renderer row) + 22 skills + 4 prompt templates + 3 agents +
5 config files + 10 env vars + 1 install side effect. The
extension also yields to the `caveman wrap pi` / `caveman enable pi` runtime when those are installed.

| Surface ID | Kind | Exact name/identifier | User trigger | Observable result | Source file:line | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| CV-CMD-1 | command | `/caveman` | `/caveman [ultra\|wenyan\|off\|status\|lite\|full\|...]` | Sets/clears terse voice; notice with resulting mode; status prints report | extensions/pi-caveman/src/commands.ts:16,23 | Mode words also recognized from any user message via input hook |
| CV-CMD-2 | command | `/ultracave` | `/ultracave [off\|status]` | Same as /caveman for the ultracave mode | extensions/pi-caveman/src/commands.ts:17,23 | |
| CV-CMD-3 | command | `/megacave` | `/megacave [off\|status]` | Same as /caveman for Classical Chinese mode | extensions/pi-caveman/src/commands.ts:18,23 | |
| CV-CMD-4 | command | `/caveman-help` | `/caveman-help` | Renders the quick-reference card as a message | extensions/pi-caveman/src/commands.ts:48-56 | |
| CV-CMD-5 | command | `/caveman-stats` | `/caveman-stats [--share] [--all] [--since 7d\|24h]` | Token usage and mode attribution report; appends to history | extensions/pi-caveman/src/commands.ts:64-93 | Writes agentDir/caveman/history.jsonl [FS] |
| CV-TOOL-1 | tool | `caveman_compress` | Model call with path | Compresses a memory file in place, backs up the original, validates structure | extensions/pi-caveman/src/compress-tool.ts:75 | Destructive; secrets are refused; model call [CRED][NET][FS] |
| CV-TOOL-2 | tool | `cavecrew` | Model call with agent/task | Runs investigator/builder/reviewer in an isolated Pi process and returns its compressed report | extensions/pi-caveman/src/cavecrew-tool.ts:19 | Spawns `pi` with `--mode json` [PROC][CLI][CRED] |
| CV-TOOL-3 | tool | `caveman_retrieve` | Model call with ccr_ handle | Recovers exact original content from the Caveman recovery store | extensions/pi-caveman/vendor/caveman/packages/pi-extension/src/index.ts:144 | Registered only when the package owns the runtime; MCP child process and ~/.caveman/ccr.db [PROC][FS] |
| CV-EVT-1 | event-hook | `session_start` | Session start | Restores mode from branch entries and renders badge | extensions/pi-caveman/src/controller.ts:66 | |
| CV-EVT-2 | event-hook | `session_tree` | Branch change | Restores mode | extensions/pi-caveman/src/controller.ts:67 | |
| CV-EVT-3 | event-hook | `input` | Any user message | Detects mode changes, queues the notice, rewrites `/caveman:caveman-*` to `/skill:caveman-*` | extensions/pi-caveman/src/controller.ts:69-77 | One-shot skills: caveman-commit, caveman-review, caveman-compress |
| CV-EVT-4 | event-hook | `before_agent_start` | Before each turn | Injects the caveman ruleset section and pending reminder/status message | extensions/pi-caveman/src/controller.ts:79-90 | |
| CV-EVT-5 | event-hook | `session_start` | Session start | Warns when a wrap/enable runtime did not load and direct mode applies | extensions/pi-caveman/src/runtime.ts:36 | Conditional on runtime owner |
| CV-EVT-6 | event-hook | `session_start`, `model_select`, `before_agent_start`, `turn_start`, `turn_end`, `tool_call`, `tool_result`, `session_before_compact`, `session_compact`, `session_shutdown` | Vendor runtime owner path | Proxies routing, tool-output shrinking, recovery handles via the caveman CLI/native runtime | extensions/pi-caveman/vendor/caveman/packages/pi-extension/src/index.ts:160-279 | Ten hooks; each is fail-open; local proxy and child processes [PROC][NET][CLI] |
| CV-UI-1 | ui-widget | status key `caveman` | Mode active | Status badge with the mode name in warning color | extensions/pi-caveman/src/controller.ts:42 | TUI only colors |
| CV-UI-2 | ui-notification | mode notices, help card, stats report, direct-mode warnings | Commands above and runtime gate | Info/warning notices or stderr lines when headless | extensions/pi-caveman/src/report.ts:8-13, extensions/pi-caveman/src/commands.ts:30-40 | |
| CV-UI-3 | ui-notification | message renderers for customType `caveman-help` and `caveman-stats` | After those commands | Markdown-rendered report message | extensions/pi-caveman/src/renderers.ts:12 | |
| CV-SKILL-GROUP | skill | 22 skills | `/skill:<name>` | Injects the skill body | extensions/pi-caveman/package.json:17-19 | Full list: cavecrew, caveman, caveman-commit, caveman-compress, caveman-discover, caveman-evidence-review, caveman-explore, caveman-help, caveman-learn, caveman-manage, caveman-optimize, caveman-review, caveman-setup, caveman-stats, investigate-first, lean-build, megacave, migration, safe-refactor, surgical-patch, ultracave, verify-and-stop |
| CV-PROMPT-GROUP | prompt-template | 4 prompt templates | `/<name>` | Expands the template | extensions/pi-caveman/package.json:20-22 | Full list: caveman-commit, caveman-compress, caveman-init, caveman-review |
| CV-AGENT-GROUP | agent | 3 agent definitions | Used through the cavecrew tool | Role prompt for the child Pi process | extensions/pi-caveman/agents/cavecrew-investigator.md, cavecrew-builder.md, cavecrew-reviewer.md | Shipped under `agents/` but not registered as Pi agents |
| CV-CFG-1 | config-file | `~/.config/caveman/config.json` (or XDG_CONFIG_HOME / APPDATA) | User writes config | Chooses defaultMode when no env/repo override | extensions/pi-caveman/src/config.ts:20-26,64-70 | [FS] user-global |
| CV-CFG-2 | config-file | `.caveman/config.json` or `.caveman.json` (walked up from cwd) | User writes repo config | Repo defaultMode | extensions/pi-caveman/src/config.ts:6,35-44 | [FS] project-local |
| CV-CFG-3 | config-file | agentDir/caveman/history.jsonl | `/caveman-stats` | Appends per-session usage records | extensions/pi-caveman/src/commands.ts:68, src/stats.ts:204-206 | [FS] user-global, mode 0600 |
| CV-CFG-4 | config-file | `~/.local/share/caveman-compress/backups` (or XDG_DATA_HOME/LOCALAPPDATA) | caveman_compress | Stores `.original.md` backups out of tree | extensions/pi-caveman/src/compress/paths.ts:42-52 | [FS] user-global |
| CV-CFG-5 | config-file | `~/.caveman/` (CAVEMAN_HOME) | Runtime owner path | caveman CLI/MCP/ccr recovery state | extensions/pi-caveman/vendor/caveman/packages/pi-extension/src/index.ts:26, extensions/pi-caveman/vendor/caveman/packages/pi-extension/src/recovery.ts:31 | [FS] user-global |
| CV-ENV-1 | env-var | `CAVEMAN_DEFAULT_MODE` | Set | Default mode when config has none | extensions/pi-caveman/src/config.ts:65 | |
| CV-ENV-2 | env-var | `CAVEMAN_PI_HOOK_CMD` | Set (by `caveman wrap pi`) | Marks runtime owner as caveman-wrap and overrides hook argv | extensions/pi-caveman/src/runtime.ts:18, extensions/pi-caveman/vendor/caveman/packages/pi-extension/src/lifecycle.ts:37 | [PROC] |
| CV-ENV-3 | env-var | `CAVECREW_INVESTIGATOR_MODEL`, `CAVECREW_BUILDER_MODEL`, `CAVECREW_REVIEWER_MODEL` | Set | Overrides the cavecrew child model | extensions/pi-caveman/src/cavecrew.ts:71-74 | [CRED] |
| CV-ENV-4 | env-var | `CAVEMAN_HOME` | Set | Overrides `~/.caveman` for CLI, MCP and state | extensions/pi-caveman/vendor/caveman/packages/pi-extension/src/index.ts:26 | [FS] |
| CV-ENV-5 | env-var | `CAVE_GATEWAY_URL` | Set | Overrides the local proxy URL, default http://127.0.0.1:8787 | extensions/pi-caveman/vendor/caveman/packages/pi-extension/src/index.ts:30-36 | [NET] localhost |
| CV-ENV-6 | env-var | `CAVEMAN_MCP_BIN` | Set | Overrides the caveman-mcp binary path | extensions/pi-caveman/vendor/caveman/packages/pi-extension/src/recovery.ts:28 | [CLI] |
| CV-ENV-7 | env-var | `CAVEMAN_PI_DEBUG` | "1" | Traces handler entry/exit to stderr | extensions/pi-caveman/vendor/caveman/packages/pi-extension/src/index.ts:115 | |
| CV-ENV-8 | env-var | `PI_TELEMETRY` | Set | Vendor provider-compat telemetry decision | extensions/pi-caveman/vendor/caveman/packages/pi-extension/src/provider-compat.ts:14 | |
| CV-ENV-9 | env-var | `XDG_CONFIG_HOME`, `APPDATA`, `XDG_DATA_HOME`, `LOCALAPPDATA` | Set | Change config/backup locations | extensions/pi-caveman/src/config.ts:22-24, src/compress/paths.ts:43 | [FS] |
| CV-ENV-10 | env-var | `PATH` | System | Resolves caveman CLI, cave, caveman-mcp | extensions/pi-caveman/vendor/caveman/packages/pi-extension/src/lifecycle.ts:29-32, extensions/pi-caveman/vendor/caveman/packages/pi-extension/src/recovery.ts:33-36 | [CLI] |
| CV-INSTALL-1 | install-side-effect | package.json `pi` field | `pi install ./extensions/pi-caveman` | Loads extension, 22 skills, 4 prompts; `caveman enable pi` may later write `~/.pi/agent/extensions/caveman-native.js` | extensions/pi-caveman/package.json:13-23, src/runtime.ts:12-19 | [FS] The enable marker changes runtime ownership |

---

## pi-s50

Summary: 2 commands (extension command + terminal bin) + 1 tool + 1 event hook + 1 skill + 2
notifications + 1 project-state dir + 2 install side effects. The tool is the only writer of `.s50/`
state.

| Surface ID | Kind | Exact name/identifier | User trigger | Observable result | Source file:line | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| S50-CMD-1 | command | `/s50` | `/s50 status`, `/s50 feature <objective>`, `/s50 apply '<json>'`, `/s50 registry refresh`, etc. | Runs the coordinator and posts bounded stdout as a message; nonzero exit notifies | extensions/pi-s50/src/index.ts:213-228 | Argument completion from SUBCOMMANDS; writes `.s50/` [FS][CLI] |
| S50-CMD-2 | command | `s50` CLI (bin) | Run `s50 <command>` in a terminal | Same CLI as /s50, no Pi UI; usage text on error | extensions/pi-s50/package.json:13-15, src/cli/main.ts:1-12 | Needs a TS-capable runner or the installed bin shim [CLI] |
| S50-TOOL-1 | tool | `s50` | Model call with argv | Runs the coordinator; error code 1 throws, code 2 returns isError, code 3 means a human gate | extensions/pi-s50/src/index.ts:230-255 | Writes `.s50/`, runs git, creates worktrees, registry fetches skills.sh [NET][FS][CLI] |
| S50-EVT-1 | event-hook | `tool_call` | Any bash/write/edit call | Blocks `.s50` bypasses; prompts to authorize gated commands; blocks when a human gate is open or UI is absent | extensions/pi-s50/src/index.ts:257-261, extensions/pi-s50/src/index.ts:194-210 | Confirm dialog at :198; records authorizations into `.s50/` |
| S50-SKILL-1 | skill | `s50` | `/skill:s50` | Injects the S50 coordinator skill | extensions/pi-s50/package.json:20-22, skills/s50/SKILL.md | |
| S50-UI-1 | ui-notification | "s50 exited <code>" | `/s50` nonzero exit | Info/error/warning notice by code | extensions/pi-s50/src/index.ts:223 | |
| S50-UI-2 | ui-notification | "S50: authorize <action>?" | Bash command touching a gated action while a run exists | Confirm dialog with the exact command | extensions/pi-s50/src/index.ts:198 | Requires UI; refuses without one |
| S50-CFG-1 | config-file | `<cwd>/.s50/` (run.json, graph.json, evidence.jsonl, findings.jsonl, decisions.jsonl, registry.lock.json, .gitignore) | Any /s50 or s50 command | Durable run state | extensions/pi-s50/src/orchestrator/persistence.ts:12,23-30 | [FS] project state; self-ignoring |
| S50-INSTALL-1 | install-side-effect | package.json `pi` field | `pi install ./extensions/pi-s50` | Loads the declared extension and discovers exactly one skill | extensions/pi-s50/package.json:16-22 | [FS][CLI] |
| S50-INSTALL-2 | install-side-effect | package.json `bin` field | Run the declared bin through a symlink into the checkout | The declared `s50` bin target exists and runs; the README states that a `node_modules` copy cannot run it and gives the checkout invocation | extensions/pi-s50/package.json:13-15, README.md:15-21 | [FS][CLI] |

---

## pi-tui-skin

Summary: 1 theme + 8 tool renderers + 7 event hooks + 7 UI chrome installs + 1 env var + 1 install
side effect. Presentation only: all handlers are read-only and install only in TUI mode.

| Surface ID | Kind | Exact name/identifier | User trigger | Observable result | Source file:line | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| TS-THEME-1 | theme | `tui-skin` | Session start installs it via `ctx.ui.setTheme`; also selectable in the theme list | Dark Reference-style palette | extensions/pi-tui-skin/themes/tui-skin.json:3, src/ui/install-ui.ts:76 | Selection persists in Pi settings |
| TS-RENDER-1 | ui-widget | tool renderer for `read` | Any read call | Custom call/result rows (shell 'self') | extensions/pi-tui-skin/src/tools/register-tool-renderers.ts:9,22 | |
| TS-RENDER-2 | ui-widget | tool renderer for `bash` | Any bash call | Custom command/output rows | extensions/pi-tui-skin/src/tools/register-tool-renderers.ts:10,22 | [CLI] output |
| TS-RENDER-3 | ui-widget | tool renderer for `powershell` | Any powershell call | Custom rows | extensions/pi-tui-skin/src/tools/register-tool-renderers.ts:11,22 | |
| TS-RENDER-4 | ui-widget | tool renderer for `edit` | Any edit call | Custom diff rows | extensions/pi-tui-skin/src/tools/register-tool-renderers.ts:12,22 | |
| TS-RENDER-5 | ui-widget | tool renderer for `write` | Any write call | Custom rows | extensions/pi-tui-skin/src/tools/register-tool-renderers.ts:13,22 | |
| TS-RENDER-6 | ui-widget | tool renderer for `grep` | Any grep call | Custom match rows | extensions/pi-tui-skin/src/tools/register-tool-renderers.ts:14,22 | |
| TS-RENDER-7 | ui-widget | tool renderer for `find` | Any find call | Custom path rows | extensions/pi-tui-skin/src/tools/register-tool-renderers.ts:15,22 | |
| TS-RENDER-8 | ui-widget | tool renderer for `ls` | Any ls call | Custom listing rows | extensions/pi-tui-skin/src/tools/register-tool-renderers.ts:16,22 | |
| TS-EVT-1 | event-hook | `session_start` | TUI session start | Installs theme, header, footer, editor, working indicator, activity widget | extensions/pi-tui-skin/src/lifecycle/register-lifecycle.ts:13 | No-op outside `mode === 'tui'`; the title is TS-UI-1 |
| TS-EVT-2 | event-hook | `session_shutdown` | Session end | Uninstalls every surface idempotently | extensions/pi-tui-skin/src/lifecycle/register-lifecycle.ts:17 | Aggregates cleanup failures |
| TS-EVT-3 | event-hook | `agent_start` | Turn starts | Marks agent running for the activity widget | extensions/pi-tui-skin/src/lifecycle/register-lifecycle.ts:21 | |
| TS-EVT-4 | event-hook | `agent_settled` | Agent settles | Marks idle | extensions/pi-tui-skin/src/lifecycle/register-lifecycle.ts:25 | |
| TS-EVT-5 | event-hook | `tool_execution_start` | Tool starts | Adds a live activity row | extensions/pi-tui-skin/src/lifecycle/register-lifecycle.ts:29 | |
| TS-EVT-6 | event-hook | `tool_execution_end` | Tool ends | Finishes the activity row | extensions/pi-tui-skin/src/lifecycle/register-lifecycle.ts:38 | |
| TS-EVT-7 | event-hook | `model_select` and `thinking_level_select` | Model/thinking change | Repaints footer | extensions/pi-tui-skin/src/lifecycle/register-lifecycle.ts:47-51 | Two registrations |
| TS-UI-1 | ui-widget | title `agent` | Session start | Terminal title is set to "agent" | extensions/pi-tui-skin/src/ui/install-ui.ts:75 | |
| TS-UI-2 | ui-widget | header banner | Session start | "Pi Coding Agent" + version + one random tip | extensions/pi-tui-skin/src/ui/install-ui.ts:79-84, src/ui/header.ts:30-40 | Tips rotate per launch |
| TS-UI-3 | ui-widget | footer | Session start | Thinking-level row, model + context percentage row, location row | extensions/pi-tui-skin/src/ui/install-ui.ts:85-90, src/ui/footer.ts | Reads HOME to shorten paths |
| TS-UI-4 | ui-widget | editor component | Session start | Custom prompt editor with a working-animation band | extensions/pi-tui-skin/src/ui/install-ui.ts:96-102 | |
| TS-UI-5 | ui-widget | working indicator + message "Working" | Session start and theme invalidations | Animated glyph frames; label "Working" | extensions/pi-tui-skin/src/ui/working-indicator.ts:31-32, extensions/pi-tui-skin/src/ui/install-ui.ts:101 | |
| TS-UI-6 | ui-widget | widget key `tui-skin.activity`, placement aboveEditor | Tool activity | Live "Reading file X" / "Running 2 commands" line | extensions/pi-tui-skin/src/ui/activity-widget.ts:9,64 | |
| TS-UI-7 | ui-widget | hidden thinking label "Thinking" | Session start | Collapsed thinking label | extensions/pi-tui-skin/src/ui/install-ui.ts:103 | |
| TS-ENV-1 | env-var | `HOME` | Set | Shortens displayed paths with `~` | extensions/pi-tui-skin/src/ui/activity-widget.ts:62, extensions/pi-tui-skin/src/ui/footer.ts:75, extensions/pi-tui-skin/src/tools/render-shell.ts:96 | |
| TS-INSTALL-1 | install-side-effect | package.json `pi` field | `pi install ./extensions/pi-tui-skin` | Loads extension and theme | extensions/pi-tui-skin/package.json:38-43 | [FS] |

---

## pi-one-dark-pro-theme

Summary: 1 theme + 1 install side effect. No extension source (`pi` manifest lists only themes).

| Surface ID | Kind | Exact name/identifier | User trigger | Observable result | Source file:line | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| OD-THEME-1 | theme | `one-dark-pro-flat` | Select theme in Pi, or it loads from the package glob | One Dark Pro Flat dark palette | extensions/pi-one-dark-pro-theme/themes/one-dark-pro-flat.json:3 | Computed from the pinned VS Code theme |
| OD-INSTALL-1 | install-side-effect | package.json `pi.themes` glob `./themes/*.json` | `pi install ./extensions/pi-one-dark-pro-theme` | Registers every theme JSON in the package | extensions/pi-one-dark-pro-theme/package.json:16-18 | [FS] |

---

## skills (repository root package, 5 standalone skills)

Summary: 5 skills + 1 install side effect. Root `package.json` is `pi-customizations` with
`pi.skills: ["./skills"]`; the skills ship shell/python helpers that the verification program should
treat as external CLI dependencies.

| Surface ID | Kind | Exact name/identifier | User trigger | Observable result | Source file:line | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| RS-SKILL-1 | skill | `doctor` | `/skill:doctor` | Reports Pi setup health, then applies only confirmed fixes | skills/doctor/SKILL.md:1-10 | `disable-model-invocation: true`; reads settings/skills/trust and runs `references/checks.md`, scripts/inventory.py [FS][CLI] |
| RS-SKILL-2 | skill | `run` | `/skill:run` or "run the app" | Launches the real app per bundled recipes (cli, electron, library, playwright, server, tui) | skills/run/SKILL.md:1-10, skills/run/examples/ | May start servers/browsers [CLI][PROC] |
| RS-SKILL-3 | skill | `simplify` | `/skill:simplify [target]` | 4 parallel cleanup reviewers, then applies behavior-preserving fixes | skills/simplify/SKILL.md:1-10 | Needs a subagent tool (pstack Task) for parallel mode |
| RS-SKILL-4 | skill | `reverse-engineer-cli` | `/skill:reverse-engineer-cli <target> [scope]` | Evidence workspace `.re/`, probe scripts, behavior/architecture reports | skills/reverse-engineer-cli/SKILL.md:1-10, references/probing.md | `disable-model-invocation: true`; scripts/investigate.py and probe.py need Python 3.10+ [CLI][FS] |
| RS-SKILL-5 | skill | `implement-cli-from-contract` | `/skill:implement-cli-from-contract` | Differential implementation against a captured contract | skills/implement-cli-from-contract/SKILL.md:1-10, references/feature-packet.md | `disable-model-invocation: true`; scripts/differential.py needs Python 3.10+ and the sibling probe runner [CLI][FS] |
| RS-INSTALL-1 | install-side-effect | root package.json `pi.skills` | `pi install .` from the repo root | Registers the five root skills | package.json:17-19 | [FS] |

---

## Cross-cutting surfaces

Env vars and config files reached by more than one package or by the workspace:

| Surface ID | Kind | Exact name/identifier | Packages that touch it | Source file:line | Notes |
| --- | --- | --- | --- | --- | --- |
| X-ENV-1 | env-var | `PATH` | pi-pstack (child pi/gh/git resolution), pi-caveman (caveman CLI and caveman-mcp), pi-s50 (git/gh/agent-browser), pi-tui-skin (no) | extensions/pi-pstack/src/subagents/pi-command.ts:22, extensions/pi-caveman/vendor/caveman/packages/pi-extension/src/lifecycle.ts:29, extensions/pi-s50/src/adapters/shell.ts | [CLI] Missing binaries degrade rather than fail in some paths |
| X-ENV-2 | env-var | `HOME` | pi-caveman (state), pi-tui-skin (path shortening), pi-pstack (child env allowlist) | extensions/pi-caveman/src/config.ts:18, extensions/pi-tui-skin/src/ui/footer.ts:75, extensions/pi-pstack/src/remote-worker-transport.ts:45 | [FS] |
| X-ENV-3 | env-var | `PI_CODING_AGENT_DIR` (Pi's agent dir override) | Every package via `getAgentDir()` (pstack state, caveman history, tui-skin none, s50 none) | harness convention; see .pi/skills/verify-pi-customizations/SKILL.md:14 | Verification should point it at a scratch dir [FS] |
| X-ENV-4 | env-var | Provider credential env vars (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`) | pi-anthropic-oauth; pstack child roots inherit credentials | extensions/pi-anthropic-oauth/src/auth.ts:3, extensions/pi-pstack/src/worker-support.ts:39 | [CRED] |
| X-CFG-1 | config-file | `<agentDir>/settings.json` | pi-pstack (`/subagents` writes, subagentStatusLine reads); root `doctor` skill reads/writes | extensions/pi-pstack/src/subagents/subagent-commands.ts:49, extensions/pi-pstack/src/subagents/task-panel.ts:13, skills/doctor/SKILL.md | Shared user-global Pi settings [FS] |
| X-CFG-2 | config-file | `<cwd>/.pi/` tree | pi-pstack project model rule `.pi/pstack/models.mdc`; agent discovery `.pi/agents`; doctor skill edits project context files | extensions/pi-pstack/src/models.ts:47, extensions/pi-pstack/src/subagents/agent-locations.ts:12 | Project-local [FS] |
| X-CFG-3 | config-file | Session transcript store (agentDir/sessions) | pi-pstack (pstack_context history, timer root history), pi-caveman (stats reads session file), pi-s50 (none) | extensions/pi-pstack/src/history.ts, extensions/pi-caveman/src/commands.ts:80 | Transcripts may contain other workspaces [FS] |
| X-CFG-4 | config-file | `<agentDir>/context-boards/` and `<agentDir>/pstack/store/` | pi-pstack only, referenced by system prompt and skills | extensions/pi-pstack/src/subagents/context-board.ts:11, src/host.ts:22 | Shared durable pstack state [FS] |
| X-PROC-1 | process | Detached Pi roots (timers, routines, workers, rem) | pi-pstack; spawned with the parent model/credentials | extensions/pi-pstack/src/timers.ts:27-43, extensions/pi-pstack/src/routines.ts:44-52, extensions/pi-pstack/src/subagents/rem-launcher.ts:20-25 | [PROC][CRED] Survives the UI; verification needs cleanup |
| X-PROC-2 | process | Background shell processes | pi-pstack only (own tool) | extensions/pi-pstack/src/shells.ts:98 | [PROC] Process-group ownership and handoff between sessions |

## Environment-sensitive surfaces

Everything that needs credentials, network, a TTY, tmux, a real Pi binary, or another installed CLI:

- Credentials / OAuth: AN-PROV-1, AN-CRED-1, AN-ENV-1..3, AG-PROV-1, AG-CRED-1, XA-PROV-1, CV-ENV-3, CV-TOOL-1..3, PS-TOOL-13 (cloud worker inherits parent credentials), X-ENV-4, X-PROC-1.
- Network: AN-PROV-1, AG-PROV-1, AG-CMD-1, AG-ENV-1, XA-PROV-1 (model catalog and chat traffic), PS-TOOL-4..6, PS-TOOL-11, PS-TOOL-18, PS-EVT-40 (inherited MCP), PS-TOOL-36, S50-TOOL-1 (skills.sh registry refresh), S50-EVT-1 (git/gh gating), CV-TOOL-3 and CV-EVT-6 (local proxy at 127.0.0.1:8787), PS-ENV-12 (github sidekicks run gh).
- TTY / interactive dialogs: PS-TOOL-26, PS-UI-15..18, S50-UI-2, PS-CMD-8, AG-CMD-1 (notify vs stderr), CV-UI-1, TS-EVT-1 through TS-UI-7 (install is a no-op outside TUI mode), and every ui-notification row for pstack when the scenario expects UI.
- tmux: pi-tui-skin `npm run check:smoke` and `npm run sweep` scripts; pi-one-dark-pro-theme `npm run check:smoke`; both are out-of-band from Pi load.
- Real `pi` binary: PS-TOOL-6, PS-TOOL-11, PS-TOOL-13, PS-CMD-11, PS-EVT-27 (rem), CV-TOOL-2 (cavecrew spawns `pi --mode json`), and the verification harness in `.pi/skills/verify-pi-customizations` (RPC launch).
- External CLIs: `gh` (PS-TOOL-4, PS-ENV-12, task discovery, S50 gating), `git` (PS-TOOL-17, S50, doctor, skills' recipes), `agent-browser` (S50 frontend flows), `caveman`/`cave`/`caveman-mcp` and optional Go/CLI toolchain (CV-ENV-4..6, CV-EVT-6), `limactl` or `ssh` (PS-TOOL-13 cloud), Python 3.10+ and uv (RS-SKILL-4, RS-SKILL-5, Makefile python coverage), `bun`/Node >= 22.19 for installs and builds.
- Filesystem outside the repo: PS-CFG-1..13, CV-CFG-1..5, X-CFG-1..4, AN-CRED-1, AG-CRED-1, S50-CFG-1 (inside cwd but a repo-local hidden dir), plus the doctor skill's edits to agentDir settings/trust/skills and untracked project context files.
