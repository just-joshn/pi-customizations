# Review: pi-pstack-two (architecture and maintainability)

**The tree changed during the review.** `src/index.ts`, `src/autocomplete.ts`, `src/task/{runner,tool,format}.ts` and several tests have timestamps between 20:39 and 20:41, and I started reading at about 20:30. For example, the `input` handler now skips names claimed by a user's prompt template (`index.ts:47-56`), `runner.ts` now has a `parseEvent` try/catch, and resume uses `record.cwd`. My own `bunx vitest run` gave **21 files, 179 tests passed**, not the reported 19/175. `bun run typecheck` is clean. Line numbers below are from the latest read.

## Confirmed defects

1. **After a failed `TodoWrite`, a resumed or `/tree`-navigated session shows an empty todo list.** `src/todo.ts:81-88` (high)
   - `todosFromBranch` returns the `details` of the last `TodoWrite` result on the branch, and falls back to `?? []`.
   - When `execute` throws (duplicate id at `:54`, a new item missing content or status at `:46`, or a schema failure), Pi stores the result with `details: {}`. I checked this in `pi-agent-core/dist/agent-loop.js:640-645` (`createErrorToolResult`) and `:656-664`.
   - So on `session_start` or `session_tree`, the failed call is "last" and the list resets to `[]`. In-memory state stays correct until then, so the bug only shows on resume or branch navigation.
   - Pi's own `examples/extensions/todo.ts:118-126` avoids this by skipping results without details and returning errors with full details.
   - No test covers it: `test/todo.test.ts:61-67` only uses successful entries.

2. **"Resuming a running agent fails" only holds for background agents.** `src/task/tool.ts:80-82, 155-160` and `src/task/background.ts:36-44,60` (medium)
   - `isRunning` checks only the background registry. Foreground children are never registered.
   - `Task` has no `executionMode`, so sibling calls run in parallel. Two sibling calls that resume the same ID, or one that resumes an agent another sibling is running in the foreground, start two `pi --session-id <id>` processes against the same session file.
   - The registry is also per runtime, while the subagent records live in the global `<agentDir>/pstack-two/subagents/`. A second Pi process can therefore resume an agent that this process is still running.
   - Spec TASK-005 is marked verified, but `test/e2e/task.e2e.test.ts:168-170` only checks the background case.

3. **`Loop` is active and declared to the model on every request, even with no loop running.** `src/loop.ts:100-120` (low-medium)
   - It registers with the default `direct` exposure, so registration activates it.
   - `extensions/AGENTS.md` ("Dynamic tools": register first, keep optional tools inactive, use `setActiveTools`) and Pi's `docs/extensions.md` §"Activate tools dynamically" call for activating it from `/loop` start and deactivating it on stop.
   - Related: at depth 2, `Task` is still declared but always throws (`tool.ts:45`), and `AskQuestion` is declared in JSON-mode children that can never answer it.

4. **`AskQuestion` maps answers by label, so it picks wrong ids in two cases.** `src/ask.ts:29, 42-45` (low)
   - Duplicate labels collapse to the last id.
   - An option whose label is `Done` is treated as the sentinel and ends selection without recording a pick.
   - `validate` (`:19-26`) checks duplicate question ids but not duplicate option labels or ids.

5. **The docs contradict the code.** (low)
   - `README.md:33` says the menu shows only `/skill:<name>`. `decisions.md:39,41` records the menu gap as a limitation.
   - In fact `src/autocomplete.ts` adds `/<name>` items, CMD-003 is verified, and `evidence/tui-smoke.md` shows it working.
   - `decisions.md:54` says agent bodies go through `--append-system-prompt <temp file>`. The code instead passes `PI_PSTACK_TWO_AGENT` and adds a `pstack_agent` section (`index.ts:17-21`, `tool.ts:103`).
   - The new behavior that a user's prompt template or extension command keeps its name over an alias (`index.ts:47-56`) is not in the README or spec CMD-002.

6. **Skill discovery and some types are duplicated instead of using what Pi already loaded.** (low)
   - `aliases.ts:10-13` scans the skills directory. `autocomplete.ts:12-20` scans it again and re-parses every `SKILL.md` on each `session_start`.
   - Pi already has these names and descriptions: `pi.getCommands()` returns `SlashCommandInfo { name, description, source: 'skill', sourceInfo }` (`dist/core/slash-commands.d.ts`), and `mode.ts:56-62` already uses it.
   - Practical effect: if a user filters a shipped skill out in package settings, the alias still rewrites `/x` to `/skill:x`. Pi then passes that text through literally (`agent-session.js` `_expandSkillCommand`: "Unknown skill, pass through").
   - The autocomplete still offers aliases that the new `input` handler now yields to user templates, so the two disagree.
   - The same model mapping appears in both `index.ts:24` and `tool.ts:69-71`.
   - `AvailableModel` (`task/models.ts:3-7`) and `ModelChoice` (`sections.ts:16-20`) are the same type.

7. **`mode.ts:48-52` hand-copies Pi's skill-block format.** (low)
   - It reproduces the literal from `agent-session.js:1677` without a comment noting the gap. Pi exports no formatter for it.
   - If Pi changes the format, mode turns and attached-skill turns will silently differ.

8. **A failed attachment check leaves an orphan agent record.** `tool.ts:154` vs `:102` (low)
   - `recordFresh` writes the record before `launchChild` checks attachments. When `resolveAttachments` throws, the record stays behind, and `resume` will accept that agent ID even though it never ran.

## Suspicions and questions

- **Children can outlive Pi on a hard exit.** Children run with `detached: true` (`runner.ts`) in their own process group, so a terminal SIGHUP or a crash or SIGKILL of the parent does not reach them. Foreground children are stopped only through the turn `signal`, and background ones only through `session_shutdown`. I did not confirm that Pi aborts the active turn and runs `session_shutdown` on SIGHUP or SIGTERM. If it doesn't, "No child outlives the parent process" (TASK-013) does not hold for hard exits.
- **Environment variables leak into tools run by children.** `PI_PSTACK_TWO_DEPTH` and `PI_PSTACK_TWO_AGENT` pass to everything a child spawns. If a child drives `pi` through bash or tmux (as `control-cli` does), that nested Pi would get the `poteto-agent` body in its system prompt and a depth limit it shouldn't have.
- **`piCommand()` (`tool.ts:58-63`) guesses the Pi binary.** It uses `process.argv[1]`, a `/$bunfs/` check, and a `node`/`bun` name test. This is fragile under wrappers and shims. Pi documents no public way to find its own binary, so this may be an unavoidable but undocumented gap.
- **The `worktree-audit.sh` patch (`scripts/patches.json`) hard-codes Pi's session folder naming** (`sessions/--<path>--`). It ignores a custom `sessionDir` setting, and I did not find the naming in Pi's public docs.
- **No tool sets `annotations`.** Permission extensions will therefore treat `TodoWrite` and `Loop` as destructive and open-world, which `extensions/AGENTS.md` §Annotations asks to avoid when the hints are accurate.
- **Results may often lack a transcript path.** `transcriptFor` is called right after spawn (`tool.ts:157`), before Pi has written the session file, so background results probably have no `Transcript:` line even though spec TASK-012 says results name the location. It also re-reads a global directory that grows without bound, several times per call.
- **An interval loop keeps running after Escape.** `agent_settled` with `aborted: true` still schedules the next fixed-interval run (`loop.ts:65-71`). This may be intended, but it isn't documented.

## Overall assessment

The design is mostly Pi-native and the API use is correct. I checked each API against the installed 1.1.0 declarations and docs:
- `input` transform results and `source`
- mutating `before_agent_start` `systemPromptOptions.sections`, which the docs allow
- `agent_before_settle` `BoundaryResult` with a guarded `continue`
- `agent_settled`, idempotent `session_shutdown`, `tool_call` block
- `registerTool` `exposure`, `executionMode`, `promptSnippet`, `promptGuidelines`
- `sendMessage` `triggerTurn`/`deliverAs`, `sendUserMessage` `expandPromptTemplates`
- `getCommands`, and `ctx.ui.addAutocompleteProvider`, which Pi resets on session invalidation (`interactive-mode.js:366,1915`), so wrappers don't stack

I found no invented APIs and no hard-ban violations. Children are spawned with argv arrays, readonly mode correctly uses `--tools` as an allowlist plus `--no-mcp`, state lives on the branch through tool `details` and `appendEntry`, and stale runtime use after reload is guarded with the `retired` flag.

The real problems are narrower:
- todo-state reconstruction is wrong after a failed call (high);
- the "resume while running" guard covers only background agents (medium);
- the `Loop` tool is always active (low-medium);
- skill discovery is duplicated alongside Pi's own;
- the README and design record have drifted from the code.

Because files changed mid-review, re-run this review against a frozen commit before shipping.
