# pi-pstack-two review: parity coverage

The tree changed while I was reviewing it. `src/task/{runner,tool,format}.ts` and `src/index.ts` were rewritten at 20:40:41, and several test files also changed. At 20:40:35, `bunx vitest run test/task-runner.test.ts` printed "15 passed" but also "Errors 1 error": an uncaught `SyntaxError` from an unguarded `JSON.parse` at `runner.ts:164`. A full run a few seconds later passed cleanly, with 21 files and 179 tests. The author reported 19 files and 175 tests, so that claim describes an earlier revision. Line numbers below refer to the tree as it stood after 20:41.

## Confirmed defects

1. **The agent cannot start a `/loop`, but pstack's autonomous workflows tell it to (high).** `src/loop.ts:80` and `:110` throw "No loop is running. The user starts one with /loop…". `src/sections.ts:36` tells the model that only the user starts loops.
   - Upstream asks the agent to arm the loop itself in several places:
     - `playbooks/autonomous-run.md:6`: "Pick the wake mechanism using Cursor's `/loop`".
     - `autopilot-stack.md:6`: "the root arms `/loop 1h`".
     - `multi-phase-plan.md:41`: "arm the audit tick as `/loop 1h`".
     - `orchestrate.md:71`: "arm it via the loop skill".
     - `visual-parity.md:8`.
   - The flagship overnight prompt (`docs/guide/07-overnight.md`, `poteto-help/references/recipes.md:42`) puts `/loop until done` in the middle of a `/poteto-mode …` message. In the port that is plain text, and the Loop tool then refuses.
   - HOST-004 covers only loops the user starts, so the spec misses this and `loop.test.ts` cannot catch it. A related gap: if a turn ends while background subagents are still pending and no wake is set, the loop stops for good (`loop.ts:69`). The playbook's "watcher subagent that wakes you" can then wake the agent but not the loop.

2. **A failed `TodoWrite` erases the todo list on resume, reload, or `/tree` (medium).** `src/todo.ts:84-85` returns `details?.todos ?? []` for the last `TodoWrite` result, including error results.
   - Pi builds failed tool results with `details: {}` (`pi-agent-core/dist/agent-loop.js:640-644`), and schema errors take the same path.
   - So a merge call that adds a new id without `status` fails as intended (`todo.ts:46`). After that, any branch restore rebuilds an empty list. The in-memory list survives only until the next `session_start` or `session_tree`.
   - `test/todo.test.ts:62-67` never includes an `isError` entry.

3. **No "agent store" path, although orchestrate needs one (medium).** `orchestrate.md:23` says: "Create `orchestrate/<project-slug>/` in the current agent's store (path in the system prompt)." `orch.ts:203-206` fails without `--store`/`ORCH_STORE`.
   - `hostSection` (`src/sections.ts:25-41`) names no store, and HOST-001 does not list one. The model has to guess.

4. **`worktree-audit.sh` cannot see subagent transcripts, so worktrees used only by subagents can be marked `safe` (medium).**
   - Patched lines 26-29 and 66-72 search only `sessions/--<main>--` and `sessions/--<wt>--`.
   - Cursor's `rg` over `agent-transcripts/` recursed into `<parent>/subagents/` (the layout `reflect/SKILL.md:21` describes). Port children write to `<agentDir>/pstack-two/subagents/` with the parent's working directory (`tool.ts:105`), and the script never searches there.
   - pstack's standing advice is one worktree per writing subagent. A merged worktree touched only by a subagent therefore drops from `verify-recent-chat` to `safe` (lines 77-81), and `worktree-cleanup.md` uses that bucket to decide which worktrees to delete.
   - The script also ignores a custom `sessionDir` and `PI_CODING_AGENT_SESSION_DIR`. `scripts.test.ts:81` tests only a main-agent session.

5. **TASK-013's "No child outlives the parent process" fails on a crash (low).** `runner.ts:165` spawns children with `detached: true`, in their own process group, and `:192` closes their stdin immediately. Nothing watches for parent death, so a SIGKILLed or crashed parent leaves its children running. The VERIFIED evidence covers only graceful paths (abort, RPC stdin close, reload).

6. **The NA-008 reason doesn't hold up (low).** `teach/SKILL.md:17` tells the model to "reach for the image-generation tool". The ledger excuses this because "Pi provides the capability natively". But codemode is off by default (`docs/cli.md`), and `pstack_host` never mentions it. This is a host feature pstack calls, just like AskQuestion. It is neither mapped nor tested, so NOT APPLICABLE is the wrong status.

## Suspicions and questions

- **LIVE-003 never exercised a real model choice.** The prompt said "using inherit-parent for any role whose model is not available", and the rule came out with every role set to `inherit-parent` (`live-setup-flash-run2.json`). A real choice going from rule to `Task` resolution was never shown live.
  - `subagentsSection` lists only `provider/id` values, capped at 60 (`sections.ts:22,53`). Cursor lists effort slugs.
  - So setup-pstack's checks ("every real slug written must be in the detected set", the effort ladder) and interrogate's family-prefix fallback (`claude-*`, `grok-*`) may fail on Pi names. RULE-003 has only a unit test.
- **The MODE-004 reason may be weaker than stated.** The gap says the Cursor CLI has no Custom Mode in print mode. But `poteto-help/SKILL.md:55` says Cursor documents Custom Modes in the CLI, and the author already ran tmux probes against interactive `cursor-agent` (D8). A capture looks possible.
  - Also, `poteto-help:54` says a mode "stays out of casual turns". The port injects the full body on every turn and relies only on the reminder line.
- **Resuming a poteto-agent runs in the foreground by default** (`tool.ts:155`, `fresh && …`). Cursor's behavior here is unobserved.
  - `poteto-mode/SKILL.md:101` also mentions sending "a stop or hold order to a running agent". The port has no way to stop or message a running child.
- **Subagent transcripts are global, across all workspaces** (`paths.ts:21`). The skills explicitly forbid crossing workspaces (reflect, eval, session-pickup). A model following `reflect`'s `ls -t …/subagents/*.jsonl` pattern against `<subagentDir>` would read other projects' chats. Nothing records which parent session a child belongs to.
- **AskQuestion label collisions.** It maps answers by label (`ask.ts:163`). Duplicate labels, or an option labelled `Done` in multi-select, return the wrong id or end the question early. This is minor, and the schema itself is unknown (U1).
- **Mode state stores an absolute skill path** (`mode.ts:88`). Reinstalling the package from a different path leaves the stored mode pointing at a missing file.
- **`-fast` is stripped before lookup** (`models.ts:18`). If a provider's Pi model id itself ends in `-fast`, `grok-4.7-xhigh-fast` either can't resolve or picks a different model.

## Overall assessment

Within its own spec, the port is careful. The e2e tests drive the real CLI, and most VERIFIED rows' tests do exercise their behavior rather than stubs. The NA rows I checked are honest, apart from NA-008.

Most of the parity risk is in what the spec leaves out. The biggest miss is that pstack's autonomous and overnight workflows depend on the agent starting `/loop` itself, which the port forbids. Two more host requirements are missing: an agent store path, and transcript discovery that includes subagents. The todo list is also lost on restore after any failed `TodoWrite`.

None of these is caught by the current tests, because the scripted model only performs the user-started paths the spec describes. I would hold the HOST-004 and TODO-002 VERIFIED statuses until these are fixed and covered. I would also re-run the suite on a frozen revision, since the tree changed mid-review.
