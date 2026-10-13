# pi-pstack-two design record

Pi version under design: 1.1.0 (`pi --version`). API facts cite the installed `@earendil-works/pi-coding-agent` docs or `dist/**/*.d.ts`.

## Verified Pi behaviors (scratch runs, faux provider, `/tmp/pexp`)

| ID | Behavior | Result |
|---|---|---|
| E1 | `pi --mode json` with a piped prompt and no message argument | stdin becomes the first user message |
| E2 | `--session-dir D --session-id ID` twice | the second run resumes the first transcript (`users=2`) |
| E3 | An extension command that calls `sendUserMessage("/skill:x …", {expandPromptTemplates:true})` in print or JSON mode | no run starts; the process exits after the handled command |
| E3b | An `input` handler that returns `{action:"transform", text:"/skill:x args"}` | Pi expands the skill natively in JSON mode: `<skill name="x" location="…">References are relative to …</skill>\n\nargs` |
| E3c | A prompt template whose body is `/skill:x $@` | the literal text reaches the model; templates do not re-expand skills |
| E4 | `agent_before_settle` awaits, then returns a `custom_message` entry and `continue: true` | the model sees the entry as a new user turn and the run settles after it |
| E5 | `fauxProvider()` from `@earendil-works/pi-ai`, registered with `pi.registerProvider(handle.provider)` | selectable as `--model scripted/echo`; response factories see the full transcript |
| E6 | Package installed in settings and also passed with `-e` | loads once (deduplicated by resolved path) |

## D0. Which upstream version to port

| | A. Upstream `main` at port time, `1b6d44f` (pstack 0.15.20) (chosen) | B. The version in Cursor's plugin cache, `11713c6` (0.15.17) |
|---|---|---|
| Matches the request | Yes: the request names `tree/main/pstack` | No: `main` moved 11 commits |
| Cursor baselines | The fixtures were captured on 0.15.17; the Task, TodoWrite, listing, and attachment contracts did not change in the 0.15.20 source | Exact |
| Cost | Re-run the generator and re-verify | None |

**Choice: A.** The generator made the move mechanical (`sync-upstream.mjs`, 29 changed files plus `check-plan.test.ts`, the WTA patch still anchored exactly once). Host-visible changes: the `comment-sicko` agent id (TASK-006, LIVE-002, re-run live), `poteto-agent` as a delegate (text only), `worktree-audit.sh -b` (tests pass `-b main`, since the fixture repo has no origin), `check-plan.test.ts` in upstream's test script (SCRIPT-001: 63 pass), and `ketchup`'s generated images (HOST-006). Refreshing Cursor's cache to capture 0.15.20 would change the user's global Cursor state, so the one host value taken from source alone is the `comment-sicko` type (U8).

## D1. How the skills reach Pi

| | A. Near-verbatim skills plus a host map (chosen) | B. Rewrite every Cursor reference in the skill text |
|---|---|---|
| Coverage | All 52 skills; Cursor paths resolve through a `pstack_host` system-prompt section, the way Cursor's own prompt names `agent-transcripts/` | All skills, if every one of 85 `.cursor/` references and the prose around them is rewritten correctly |
| API fit | `before_agent_start` `systemPromptOptions.sections` (`dist/core/system-prompt.d.ts`, `sections?: Record<string,string>`) | Plain files |
| Complexity | One generator with two transforms (frontmatter, one script patch) | A per-sentence patch table |
| Security | A `tool_call` guard stops writes to Cursor's rule file (D6) | Rewrites can miss a path |
| Testability | Fidelity is a hash check: shipped bytes equal upstream bytes | Every patch needs its own test |
| Maintenance | Re-run the generator on a new commit | Re-author patches on every upstream change |

**Choice: A.** Executable code cannot reinterpret a path, so `worktree-audit.sh` gets one literal patch (WTA-001). Frontmatter must change because Pi loads `name: Poteto Mode` verbatim with a warning (spec P2), which would make the command `/skill:Poteto Mode`.

**Generator.** `scripts/sync-upstream.mjs --source <cursor-plugins checkout>` reads each file with `git show <commit>:<path>`, so the working tree state of the checkout does not matter. It writes the package files and `upstream.lock.json` (commit, source path, target path, source and target SHA-256, transform). `--check` regenerates in memory and fails on any difference. The offline test (`test/resources.test.ts`) verifies target hashes against the lock and the frontmatter and link rules, so a hand edit fails without network access.

## D2. `/name` skill invocation

| | A. `input` transform to `/skill:name` (chosen) | B. One extension command per skill | C. One prompt template per skill |
|---|---|---|---|
| Print/JSON | Works (E3b) | Fails: no run starts (E3) | Fails: no skill expansion (E3c) |
| Format | Pi's native skill block with location and base directory | Same, in TUI and RPC only | Literal `/skill:x` text |
| Completion menu | Not listed; `/skill:name` is listed by Pi | Listed | Listed |

**Choice: A**, because CMD-001 must hold in every mode and the native block carries the path that pstack's relative references need. The `/` menu gap is closed by `ctx.ui.addAutocompleteProvider` (CMD-003), which Pi resets with the rest of the extension UI on reload. The alias table comes from `pi.getCommands()`: every skill Pi loaded, minus names a prompt template or extension command owns, so a filtered skill gets no alias and a user's own `/how` template keeps its name. Round 1 limited aliases to this package's skills; round 2 widened them (parity review r2, finding 1). Cursor attaches any skill by `/name` (S4), and pstack itself creates skills the user invokes that way: `automate-me` writes a personal `-mode` skill triggered by `/<handle>-mode`. Widening is safe: Pi's interactive editor handles built-in commands such as `/model` before `session.prompt()` emits `input` (`dist/modes/interactive/interactive-mode.js` submit handler), and `getCommands()` lists skills even with `enableSkillCommands: false` (observed: 56 either way). The host map's skill list is a separate question, the package skills Pi loaded, found by canonical path (`packageSkillNames`), so a symlinked install and a settings filter both come out right.

## D3. Subagents

| | A. Child `pi --mode json -p` process per call (chosen) | B. In-process SDK `createAgentSession` per call |
|---|---|---|
| Isolation | Separate process, separate context; matches Cursor "subprocesses" (F1) | Shares the parent process; a crash or leak affects the parent |
| Tools and MCP | Child loads the user's extensions and MCP like the parent; `--tools read,grep,find,ls --no-mcp` gives readonly | Must rebuild the resource loader, MCP, and codemode factories by hand (`docs/sdk.md` §codemode-mcp) |
| Resume | `--session-dir` + `--session-id <agentId>` reopens the transcript (E2) | Must manage `SessionManager` files directly |
| Model | `--model provider/id --thinking level` | `modelRuntime` wiring |
| Cancellation | Kill the process group on abort and shutdown | `session.abort()` |
| Precedent | The checked example `examples/extensions/subagent/index.ts` | None in the examples |

**Choice: A.** The prompt goes on stdin (E1), so argument length and shell quoting do not matter. The child's stdin has an error handler: a child that exits or is killed before reading a large prompt closes the pipe, and an unhandled EPIPE would be an uncaught exception that ends interactive Pi (reproduced by the security reviewer and in `test/task-runner.test.ts`). The child gets `-e <package dir>`, which follows package discovery, so it loads the skills as well as the extension (`docs/packages.md`: "A directory follows normal package discovery rules"); E6 makes it safe when the package is also installed. Three variables tell the child its depth, its agent type, and its parent's pid: depth 2 keeps Task inactive (TASK-011), the agent type selects the body that the child's own copy of this extension adds as a `pstack_agent` section (no temp files), and the parent pid feeds a watchdog that ends an orphan whose parent crashed. The child reads the variables once and removes them, so commands it runs do not inherit them. A reviewer asked whether a reload inside a child would re-evaluate the module and lose them (Pi loads extensions with `moduleCache: false`). Observed: in JSON mode Pi does not execute `/reload`; it reached the model as text, and a depth-2 child still had no `Task` afterwards. Pi sets `process.title` to `pi`, so tests identify children by the pid in Task details, not by `ps` arguments.

Child contract after round 2:
- **Depth** is stored in the agent record, and a resumed agent runs at the deeper of its recorded depth and its caller's depth plus one, so the main chat cannot lift a grandchild to depth 1 and a subagent cannot lift a main-chat agent back to depth 1 (recheck r2).
- **Readonly** is `read,grep,find,ls,TodoWrite` plus `--no-mcp`. TodoWrite only changes the child's own list and is annotated `readOnlyHint`. Cursor also allows read-only shell commands (S3); Pi has no read-only shell, so the port withholds `bash` (recorded under TASK-008). A resume call can add readonly but not lift it.
- **Project trust**: the child gets `--approve` or `--no-approve` from `ctx.isProjectTrusted()` (`types.d.ts:238`). One-shot modes cannot show the trust prompt and skip protected project resources under the default `ask` (`docs/security.md`), so without this a child in a trusted project lacked its skills and extensions.
- **Usage** is summed the way `getSessionStats()` counts it: assistant `message_end` usage, `toolResult` usage (a grandchild's Task result, codemode), and `compaction_end` usage.
- **Watchdog** compares `process.ppid` with the parent pid. Node reads it live, the OS reparents an orphan (observed: it became 1), and a reused pid cannot fool it.

## D3b. Where subagent state lives

| | A. Per workspace under the package state directory (chosen) | B. One global directory | C. Inside Pi's session folder for the workspace |
|---|---|---|---|
| Workspace boundary | Kept: records and transcripts sit under `workspaces/<Pi session folder name>/`, and another workspace cannot resume an agent | Crossed: pstack forbids reading other workspaces' chats, and any project could resume any agent | Kept |
| Resume | Pi matches `--session-id` only among sessions for the same working directory (P2), so a record stores that directory | Same, plus global collisions | Same |
| Ownership | Package-owned files only | Package-owned | Writes into Pi's own session tree, which Pi lists one level deep |
| worktree-audit | The patch searches it explicitly | Would scan every project | Found by recursion |

**Choice: A.** One writer per agent ID holds through an in-process registry of foreground and background runs, registered before any await, plus a `<agent id>.lock` file for other processes. Pi appends to session files without a lock, so two writers would interleave a transcript. "The current agent's store" lives beside it as `store/<session id>`. Workspace folders use Pi's session-folder naming, so `/a-b/c` and `/a/b-c` share one, as they share Pi's session folder.

Run lock rules (after recheck):
- Created exclusively (`wx`) with the parent's pid, then rewritten atomically (temp file plus rename) to the child's pid once it starts, because the child writes the transcript and can outlive a SIGKILLed parent by a few seconds.
- A lock without a readable pid counts as held (fail closed), and the error names the file.
- A dead holder's lock is removed only if a re-read still names that holder, then created again exclusively. Two processes taking over the same stale lock within microseconds could both succeed; Node has no portable `flock`, so this residual race is documented, not closed.
- Release removes the lock only if it still names its owner.
- A fresh agent's record is written only after the child starts (Node leaves `pid` undefined when spawn fails), so a child that never ran has no resumable ID.

## D4. Background completion delivery

| | A. Custom message after the turn; hold settle in one-shot modes (chosen) | B. A polling `TaskOutput` tool |
|---|---|---|
| Fidelity | Matches F2/F3: notified after the turn ends, and the print run waited for delivery | Cursor tells the model not to poll |
| API | `pi.sendMessage(msg, {triggerTurn:true, deliverAs:"followUp"})` in TUI/RPC; `agent_before_settle` returns `{entries:[custom_message], continue:true}` in print/JSON (E4) | One more tool |

**Choice: A.** The settle hold is guarded by "a child launched by this process is still running", so it cannot loop, and it does not hold an aborted run (`event.outcome`), such as an orphan the watchdog aborted. Pi refuses a `continue: true` that the context cannot honor (`agent-session.js`), so no other guard is needed. The notification's `details` carry the child's usage. Background usage cannot enter session totals. Pi 1.1.0 totals `usage` session entries (`getSessionStats()` in `dist/core/agent-session.js`) and `SessionManager.appendUsage()` writes them, but `ExtensionContext.sessionManager` is a `ReadonlySessionManager` without it (`session-manager.d.ts:178`); boundary drafts carry usage only for compaction. Casting past the read-only type would rely on an undocumented internal, which `extensions/AGENTS.md` forbids. Both round-2 reviewers named one more public channel: a `tool_result` handler may set `usage` on any tool result (`ToolResultEventResult.usage`), so pending background usage could ride on the parent's next tool call. It was rejected: it charges the usage to an unrelated call, and it is lost whenever no tool call follows, which is the usual case after a notification and in a one-shot run's final continuation. The usage stays in the child transcript and in the notification details (TASK-017, NOT VERIFIED).

## D5. Custom Mode

| | A. `/mode <skill>` command plus a `pstack_mode` system-prompt section (chosen) | B. Rebind `alt+enter` | C. Inject a custom message each turn |
|---|---|---|---|
| Conflict | None | `alt+enter` is Pi's `app.message.followUp` (`docs/keybindings.md`) | None |
| Context cost | One section; Pi patches sections by name, so an unchanged mode adds nothing per turn (`docs/session-format.md`) | Same as A | The body repeats in history every turn |
| Persistence | `pi.appendEntry` per change; rebuilt from `getBranch()` | Same | Same |

**Choice: A.** `/mode` is an extension command, so it works in TUI and RPC. The entry stores only the skill name, and restore looks the name up among loaded skills. A stored path is never read (round 2, security 3): a session file can come from elsewhere, and reading a crafted path would send any local file to the model on every turn. Cursor offers Custom Modes only in interactive clients (S4), so print mode is not a parity target.

## D6. The model rule

| | A. Pi-owned rule file, injected section, guard on the Cursor path (chosen) | B. Append to `<agentDir>/AGENTS.md` | C. Replace the setup skill with a deterministic dialog |
|---|---|---|---|
| Always applied | Yes, `pstack_models` section each request | Yes | Yes |
| Invasiveness | One file under `<agentDir>/pstack-two/` | Edits a shared user file | One file |
| Fidelity | The skill text stays the source of truth | Same | Diverges from the skill |
| Safety | A `tool_call` handler blocks `write`/`edit` on `~/.cursor/rules/pstack-models.mdc` (`docs/extensions.md`: "tool_call can … block execution") | No guard | No guard needed |

**Choice: A.** The path is `getAgentDir()` + `pstack-two/pstack-models.mdc`, so it honors `PI_CODING_AGENT_DIR` (`docs/environment-variables.md`).

## D7. `/loop`

| | A. Command plus `Loop` tool, timers started lazily (chosen) | B. Background shell plus completion wake, like Cursor's `AwaitShell` |
|---|---|---|
| API fit | `registerCommand`, `pi.on("agent_settled")`, `sendUserMessage({deliverAs:"followUp"})` | Pi has no background-shell completion notification |
| Lifecycle | Timer cleared on `session_shutdown`; one loop per session | Needs a new process supervisor |

**Choice: A.** Print and JSON modes refuse `/loop` because the process exits at settle. The `Loop` tool is active in interactive and RPC sessions because pstack's playbooks tell the agent to arm a loop itself; an agent-armed loop's first run follows the current turn. In print and JSON runs, which include every subagent, `session_start` withdraws `Loop` (as `AskQuestion` is withdrawn without a UI), the tool refuses if forced active, and the host map's `/loop` line says to keep working instead. Before this, a subagent got "Loop armed" for a loop that never ran (recheck 2). The playbooks arm loops from the root chat, so nothing they direct is lost. An agent-paced loop with no scheduled wake ends, unless background subagents are still running, since their notification is the wake. Intervals cap at 24 days because `setTimeout` fires at once past 2³¹−1 ms. Loop state rides in a `pstack_loop` system-prompt section rather than in the prompt text, because Pi's template expansion drops text appended after a template command.

## D8. `AskQuestion`

| | A. Tool over `ctx.ui.select` (chosen) | B. Omit it |
|---|---|---|
| Fidelity | pstack prefers it (setup-pstack, automate-me) and the Cursor IDE has it (S6) | Matches the Cursor CLI, which has none (F1, tmux probe) |
| Modes | TUI and RPC dialogs (`docs/rpc-extension-ui.md` `select`); fails with guidance elsewhere | n/a |

**Choice: A.** `allow_multiple` repeats `select` with a reserved "✓ Done selecting" entry, because Pi has no built-in multi-select dialog and `custom()` is unavailable over RPC. Answers map back by label, so labels and ids must be unique. Without a UI the tool is withdrawn from the active set on session start, as the Cursor CLI has no such tool.

## D9. `TodoWrite`

| | A. Tool-result `details`, rebuilt from the branch (chosen) | B. `appendEntry` state |
|---|---|---|
| Branching | Follows `/tree` automatically (`docs/extensions.md` §State) | Needs manual branch handling |

**Choice: A**, with `executionMode: "sequential"` because calls share list state. Cursor's `minItems: 2` is relaxed to 1 so a single-item merge update is legal. This changes no pstack instruction.

## Native-gap gate (`extensions/AGENTS.md`)

Custom harness logic in this port, with the answers the repository's gate requires:

| Adapter | Required behavior | Pi mechanism evaluated, and why it cannot express it | Why not omit it | Smallest adapter | Pi-owned state that stays authoritative | Verification (lifecycle, cancellation, permissions, branching, accounting) | Delete when |
|---|---|---|---|---|---|---|---|
| `Task` child processes (`src/task/`) | Cursor's subagents: isolated context, parallel calls, background runs with notifications, resume by ID (TASK-001..016) | Pi 1.1.0 has no subagent mechanism; the checked `examples/extensions/subagent/` spawns `pi` the same way. `ctx.executeTool()` runs tools, not agents | Every pstack workflow skill spawns subagents | One `pi --mode json` process per call with the package loaded; no second agent loop, the child is plain Pi | Each child is an ordinary Pi session: its own `SessionManager` file, model, tools, compaction | Lifecycle and cancellation: abort, reload, new-session, quit, and orphan tests, mutation-checked. Permissions: readonly allowlist plus `--no-mcp`; trust follows the parent; a headless child cannot show permission dialogs (README). Branching: the child's own session tree. Accounting: foreground usage counted (nested included); background usage is the TASK-017 gap | Pi ships native subagents with background notifications and resume |
| `/loop` scheduler (`src/loop.ts`) | Cursor's built-in `/loop` (HOST-004) | No Pi scheduler; `sendUserMessage({deliverAs: followUp})` and `agent_settled` are the documented pieces it uses | Playbooks arm loops for overnight and audit runs | One timer per session, armed after settle | Pi's queue and settle semantics; timers start lazily and stop on `session_shutdown` | `test/loop.test.ts` over RPC: cadence, agent pacing, rescheduling, stop, abort, one-shot refusal | Pi ships a loop or timer primitive |
| Parent watchdog (`src/index.ts`) | A child exits when its parent dies without `session_shutdown` (TASK-013) | Pi exposes no parent-death event; the child runs in its own process group so abort can kill its descendants | Orphans keep spending tokens and writing transcripts | A 1 s `process.ppid` check started on `session_start` | Pi's own `ctx.abort()` and `ctx.shutdown()` end the child | "exits when its parent is killed outright", which fails with the watchdog removed | Pi supervises extension-spawned processes |
| Run lock (`src/task/records.ts`) | One writer per agent ID across processes (TASK-005) | Pi appends to session files without a lock and offers no cross-process session lock | Interleaved transcripts corrupt the agent's tree | One pid file per agent ID, created exclusively | The session file itself | `test/records.test.ts`; task e2e lock test, mutation-checked | Pi locks session files |

Pi-private logic the port copies, because Pi exports no function for it. Each copy can drift when Pi changes:

| Copy | Pi original | Why a copy | Delete when |
|---|---|---|---|
| `workspaceSlug` (`src/paths.ts`) and `pi_slug` in the `worktree-audit.sh` patch | the session-folder name in `session-manager.js` (`getDefaultSessionDirPath`), documented in `docs/session-format.md` | Per-workspace state must line up with Pi's session folder | Pi exports the folder-name function |
| `resolveToolPath` (`src/rule.ts`) | `resolveToCwd` used by the write and edit tools | The guard must resolve a path exactly as the tool will | Pi exports its path resolution or a protected-path hook |
| The skill block in `modeSection` (`src/mode.ts`) | `_expandSkillCommand` in `agent-session.js` | A mode must look like an attached skill | Pi exports the formatter |
| The first-line byte cut in `bounded` (`src/task/format.ts`) | `truncateHead` returns nothing for a first line over the limit | A subagent reply can be one long line; everything else uses `truncateHead` | `truncateHead` keeps a partial first line |

## Domain model

| Entity | Owner | Lifetime | Invariants |
|---|---|---|---|
| Shipped resources | Generator and lock | Package version | Target bytes match the lock; skill names equal directory names |
| Alias table | Rebuilt from `pi.getCommands()` on each input and menu query | Extension runtime | Every loaded skill maps, except names a prompt template or extension command owns; everything else passes through |
| Mode state `{skill}` | `pstack-two/mode` custom entries on the branch, skill name only | Session branch | At most one active mode; resolved by name among loaded skills, never by a stored path |
| Todo list | `TodoWrite` result details on the branch | Session branch | IDs unique; statuses from the enum |
| Rule file | User, through `/setup-pstack` | Across sessions | Lives only under `<agentDir>/pstack-two/` |
| Subagent record `{agentId, type, model (with thinking), readonly, cwd, createdAt, depth}` | `<stateDir>/workspaces/<folder>/subagents/<agentId>.json`, written atomically | Across sessions, within one workspace | Agent ID is a UUID; written only after the child has a pid; validated on read; resume requires the same working directory and an existing transcript, reuses the recorded model, and runs at max(recorded depth, caller depth + 1) |
| Running child | In-memory registry (foreground and background) plus `<agentId>.lock` naming the child's pid once it starts | Until exit, abort, `session_shutdown`, or parent death | One writer per agent ID across processes, except the documented microsecond takeover race; resume refuses while running |
| Loop `{prompt, intervalMs?, nextAt}` | In-memory, one per runtime | Until stop or shutdown | At most one; never in print or JSON mode, where the `Loop` tool is withdrawn |

Validation sits at the boundaries: tool parameters (TypeBox schemas plus explicit checks for model, type, attachments, and agent IDs), command arguments, and the generator's source files. Internal functions trust their inputs.

## 0.15.21 update (2026-10-12)

Upstream `364a77e` + `997ffc7` change only prose: poteto-mode tells the parent where bundled skills live and to pass its absolute SKILL.md path to every `poteto-agent`; `poteto-agent.md` tells the delegate to use that path.

- **Option A (selected): re-vendor byte for byte** by moving the pin in `scripts/sync-upstream.mjs` and running the sync. The Pi host already supplies the absolute path the prose asks for: `/skill:` expansion and `/mode` injection emit `<skill ... location="<abs>">`, and the package keeps skills as siblings, so `../<name>/SKILL.md` resolves. No extension code is needed.
- **Option B (rejected): inject the path into poteto-agent Task prompts in `src/task`.** It would make compliance deterministic, but it rewrites the parent's prompt, which Cursor does not do, and duplicates the host map's `<SKILLS>` line. That is behavior beyond the source.
- Version: `0.15.21-pi.1`. The README's Pi version is corrected to 1.2.0, the version the dev dependencies and the test run use.

## D4 revision (2026-10-12): what "subagent usage" means in Cursor

Cursor's subagent docs say subagents "consume tokens independently", each with "its own context window and token usage", that "the subagent task card shows which model ran", and that the account usage dashboard lists that model (fixtures/0.15.21/cursor-docs-quotes.md). They name no chat total that includes subagent tokens. TASK-017 had read "the usage dashboard" as the parent session's totals, and that reading is withdrawn. The requirement is now the documented contract: each child records its own usage, which Pi's per-child session already does, and the Task card names the model.

| | A. `renderResult` card (chosen) | B. Add the model to the Task result text |
|---|---|---|
| Fidelity | Cursor's card is UI, not model-visible text | Changes the Cursor-format result the model reads (TASK-002) |
| API | `registerTool({ renderResult })` | none |

## D9. Readonly shell (TASK-019)

| | A. OS sandbox around a `bash` override (chosen) | B. Own `sandbox-exec` profile, no dependency | C. Command allowlist |
|---|---|---|---|
| Enforcement | Kernel: Seatbelt on macOS, bubblewrap on Linux, via `@anthropic-ai/sandbox-runtime`, the library Pi's own `examples/extensions/sandbox` uses | Kernel, macOS only; Linux would need a second implementation | Parsing; pipes, substitutions, and pagers bypass it |
| API | `createBashTool(cwd, { operations })` with `BashOperations`, registered as `bash` only in readonly children | same | `tool_call` block |
| Cost | One dependency, loaded only in readonly children | Two hand-written sandboxes to maintain | Low, but unsound |

**Choice: A**, the official example's pattern with a fixed policy: `allowWrite: []`, no network domains. It matches Cursor's documented mechanism (a Seatbelt/Landlock sandbox with network blocked by default). It fails closed: if the module is missing (local installs get no dependency install) or the platform has no sandbox, the tool returns an error and never runs the command unsandboxed. The import is dynamic so the rest of the package loads without the dependency. Cursor's docs do not say whether its readonly sandbox also blocks `/tmp`; the port blocks every write.

## D10. AskQuestion title and option descriptions (HOST-005)

24 Cursor IDE calls use a top-level `title` and per-option `description`. Pi's `ctx.ui.select` takes a title and plain strings, so the title prefixes each question's prompt and a description follows its label after an em dash. Answers map back by the shown text, so duplicate checks use the shown text.

## D11. Mode badge styling (MODE-006)

Cursor styles the badge with `icon` (default lightning) and `color`. `ctx.ui.setStatus` takes text, and `ctx.ui.theme.fg` takes a theme color. The icons pstack uses map to glyphs (crown ♛, lightning ⚡), and Cursor's ten colors map to the nearest theme color (green→success, red→error, yellow/orange→warning, the blues and purples and brand→accent, default→none). The alternative, an emoji for every Cursor icon name, would mean guessing at an icon set Cursor does not publish.

## D9 revision (2026-10-13): enforcing the read-only shell after review

The security review (reviews/resume-security.md) reproduced four enforcement failures in the first version. Fixes, each with a regression test through the real sandbox (`test/readonly-shell-security.test.ts`):

- **Startup hooks ran before the sandbox.** `BASH_ENV`, `ENV`, and `BASH_FUNC_*` are stripped from the spawn environment, so the outer shell cannot source attacker-written startup files before the wrapper engages.
- **Dependency defaults were writable.** The sandbox makes `/tmp/claude` and `~/.npm/_logs`, `~/.claude/debug` writable for itself. `denyWrite` names `/tmp/claude` (Seatbelt is last-match-wins, deny after allow) and `denyRead` drops the home defaults from the dependency's write set.
- **A shared manager could carry a permissive policy.** `wrapWithSandbox` now receives `READ_ONLY_POLICY` as its per-command config, so the command never inherits whatever policy another consumer initialized. `session_shutdown` no longer calls `reset()` on the shared singleton; the short-lived child process is reclaimed by the OS instead.
- **A pre-aborted call could run.** Wrapping happens in `execute` (which honors abort), and spawning is delegated to Pi's own local shell operations, which refuse an already-aborted signal, enforce timeouts, and kill the process tree — replacing the hand-rolled spawn.
- **Resume could regain write access.** A raised readonly floor is now written to the agent record under the run lock, and the current type definition restricts older records (`src/task/tool.ts`).

Honest boundary: this sandboxes shell subprocesses, not Pi or trusted extensions; the tool description says so. Error message: "no verified OS sandbox is available: <reason>".

## D12. Pre-registered criterion for LIVE-001 and LIVE-004 (written before the runs)

The two LIVE requirements measure model compliance, which no host can make deterministic. Parity means the port does not lower compliance relative to Cursor under the same model. Criterion: five paired runs per scenario at `claude-opus-5-5` high effort in each host (Cursor through `cursor-live.mjs` with clean project-local pinned resources, Pi through `live-e2e.mjs`). VERIFIED if both hosts succeed in at least 4 of 5 and the Pi count is no more than one below the Cursor count; NOT VERIFIED if Pi is two or more below Cursor; otherwise INCONCLUSIVE. Earlier runs are not counted toward the five. Success: LIVE-001 `readPlaybook && firstTodosAreStepsVerbatim`; LIVE-004 `delegated && everyPromptHasSkillPath`.

## D12 result (2026-10-13)

LIVE-004: Cursor 5/5, Pi 5/5, so VERIFIED under the criterion. LIVE-001: Cursor 1/5 and Pi 3/5 under the strict checker (5/5 if a playbook read through `bash cat` counts). The criterion's 4/5 floor fails because the reference itself complied once, so LIVE-001 stays INCONCLUSIVE. The criterion was not changed after the data.

## D13. AskQuestion "Other" and print-mode skip (HOST-005)

Observed in cursor-agent 2026.10.01: every question ends with `Other: (type to answer)`, and in print mode AskQuestion stays available and the question resolves as skipped. Earlier the port withdrew the tool without a UI, on the belief that the Cursor CLI had none. That belief is now disproved, so the tool stays available and returns each question as skipped. Other is a reserved last option; picking it opens `ctx.ui.input`, and the answer comes back as id `other` plus its text.

## D14. Readonly contract versus observed Cursor behavior (TASK-019)

Observed in Cursor: a call-level `readonly: true` is not enforced (the Agents Window and the CLI both let the subagent `touch probe.txt`), and an agent-file `readonly: true` blocks every shell call in the CLI, including `git log`. The docs promise "no file edits, no state-changing shell commands", which rules out the first and does not require the second. The clean-room rule is to preserve accidents only when a compatibility requirement makes them part of the contract. pstack's skills pass `readonly: true` to keep reviewers and explorers from editing, so reproducing the non-enforcement would break the intent pstack relies on. The port keeps the documented contract: writes and network are denied, and read-only commands run. Requirement source: the documentation. The two observed behaviors are recorded as source defects.

## D15. Mode reminder (MODE-004)

In a real Agents Window Custom Mode (crown badge shown), the model reports no "New task?" line in its context, while still following the playbook. The port therefore drops the frontmatter `reminder` from the per-turn mode section. The rejected alternative was to keep it as an extra nudge, which adds context Cursor does not send.
