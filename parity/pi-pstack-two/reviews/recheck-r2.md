## Confirmed defects

**1. A subagent can bring a sibling back at depth 1 by resuming it, so nesting is no longer capped (medium).** `extensions/pi-pstack-two/src/task/tool.ts:112` sets `depth: record.depth ?? depth + 1`, so the recorded depth always wins, even when it is lower than the caller's.
- Inside a subagent, `options.depth` is 1. Suppose that subagent resumes an agent the main chat created, whose record says `depth: 1` (written at `tool.ts:128`).
- The resumed agent starts at depth 1, and `defaultActive: options.depth < 2` (`tool.ts:208`) gives it `Task`.
- The process chain then runs main → A(1) → B(1, resumed) → C(2). The resumed B can in turn resume another idle depth-1 agent, so the chain is limited only by how many such records exist.
- Both kinds of agent share one records folder: `subagentDir(ctx.cwd)` is the same for parent and child because they share the agent dir and the working directory.
- Before round 2, a resume from a child always ran at `depth + 1` = 2, so this is a regression from the "depth kept on resume" fix.
- The only test is the opposite direction: main chat resumes a grandchild (`test/e2e/task.e2e.test.ts:313`). Nothing covers a child resuming a depth-1 agent.
- TASK-011 in the ledger ("Grandchildren cannot spawn subagents") and README line 42 ("A subagent's own subagents cannot spawn more") overstate the guarantee.
- Fix: `Math.max(record.depth ?? 0, depth + 1)`, plus a test where a child resumes a depth-1 agent.

**2. The domain-model table in `decisions.md` describes the old code (low).**
- `parity/pi-pstack-two/decisions.md:172` still says the alias table is "Built at load from the skills directory" and "Only shipped skill names map". Since round 2, `aliasTable` (`src/aliases.ts:18-26`) covers every loaded skill and is rebuilt from `pi.getCommands()` on each input. D2 in the same file (`:51`) states this correctly, so the two parts of the document disagree.
- `decisions.md:176` says a record is "written only after attachments validate" and lists a separate `thinking` field. The record is now written only after the child has a pid (`tool.ts:142-145`), and thinking sits inside `model`.

**3. `modeFromBranch` still reads and returns the stored `path` (low).**
- `src/mode.ts:39` returns `{skill, path}` from the session entry, and `test/mode.test.ts:23,32` assert that it does.
- `restore` (`mode.ts:80`) then ignores the path, so nothing is read from it. The finding's fix holds.
- The cost is dead parsing, and a docstring at `:32` ("Only its skill name is trusted") that the returned value contradicts.

**4. Evidence counts disagree with each other (low).**
- The ledger row for LIVE-003 (`ledger.json:477`) says "in 5/5 runs" and calls the 0.15.20 runs "run 1… runs 2 and 3". `evidence/live-summary.md` lists six runs and numbers those three as runs 4, 5, and 6.
- `reconciliation-r2.md` reports 252 tests (66 e2e). This session's `npx vitest run` gave 24 files and 251 tests, which matches the context brief.

## Suspicions and questions

- **Unknown mode names go into the system prompt as stored.** With no matching skill, `modeSection` (`src/mode.ts:49`) puts the stored skill string straight into the system prompt on every turn, with no length limit or escaping. A crafted session entry can no longer cause a file read, but it can still inject persistent system-prompt text. This is low impact, because the session file's messages already reach the model.
- **Trust is taken from the current folder, not the agent's folder.** On resume, the trust flag comes from `ctx.isProjectTrusted()` for `ctx.cwd`, while the child runs in `record.cwd` (`tool.ts:112`). The two differ only on a workspace-slug collision (`/a/b-c` vs `/a/b/c`, recorded in D3b). In that case `--approve` could be applied to a different, untrusted folder. Using `record.cwd !== ctx.cwd` as a refusal condition would close it.
- **The watchdog can misfire if `pi` on `PATH` is a wrapper script.** When `piCommand()` falls back to `['pi']` (`tool.ts:72`) and that `pi` is a shell wrapper that does not `exec`, the child's `process.ppid` is the shell, not `PARENT_ENV`. The watchdog (`src/index.ts:58`) would then kill a healthy child within about 1 s. The fallback only happens when `argv[1]` is missing or in `/$bunfs/` while running under node or bun, so it is rare. I did not reproduce it.
- **Old rules break silently under the strict level check.** A rule written before round 2 with an unsupported level (for example `deepseek/deepseek-flash:xhigh`) now fails every Task call that uses it. The model gets the allowed list and retries, which matches Cursor, but nothing tells the user to rerun `/setup-pstack`. I found nothing in the README Limits about this.
- **Usage totals may miss some kinds of spend.** `usageOf` (`src/task/runner.ts:139-144`) mirrors `getSessionStats`, which also counts `usage` entries (the cache warmer) and `branch_summary` usage (`agent-session.js:3391-3396`). A JSON-mode child emits no event for either, so any such spend is quietly missing; I did not confirm whether a child can incur it. I found no double counting: the grandchild's total arrives only on the child's `toolResult` message, and Pi's nested-call merge at `agent-session.js:711-720` applies only to `ctx.executeTool`.
- **A lock-takeover failure surfaces as a different error.** In `acquireRunLock`, if the stale lock is replaced between the `rmSync` and the second `createExclusive`, the caller gets the "still running" error with the new holder's pid. That is acceptable, but no test covers it.
- **The realpath cache is module-wide.** The reconciliation's "cached per runtime" for `src/aliases.ts:29` relies on Pi loading extensions with `moduleCache: false` (`loader.js:478`, confirmed). Within one runtime the cache never refreshes, so a skill folder that is symlinked in later is only picked up after `/reload`.

Checked and holding up, against code and tests:
- the EPIPE handler (`runner.ts:237`)
- readonly on resume
- the missing-transcript refusal
- the `wake_in` replacement (`loop.ts:107-110`)
- `bounded` through `truncateHead` with the first-line byte cut
- the `process.ppid` watchdog
- the rule guard's nearest-ancestor canonicalization, with its symlink test (`test/rule.test.ts:64-79`)
- level validation against pi-ai `getSupportedThinkingLevels`
- trust flags (`--approve`/`--no-approve` are documented in `docs/cli.md:237`)
- the harness clearing `PI_CODING_AGENT_SESSION_DIR`
- the `worktree-audit.sh` patch: its resolution order matches `main.js:548-551`, and `~` expansion matches `normalizePath`
- the ledger counts: 51/2/4/7, with TASK-017 and TASK-019 NOT VERIFIED

## Overall assessment

Most round-2 fixes do what their rows say, and the ones I traced have tests that would fail without them: EPIPE, readonly on resume, the transcript check, wake replacement, nested usage, trust passing, mode by name only, and the guard. The test suite passes: 24 files and 251 tests. One fix introduced a real regression. Storing depth in the record and letting it override the caller's depth stops the main chat from lifting a grandchild, but it lets a subagent resume a depth-1 agent that can spawn again. That undoes the nesting cap TASK-011 and the README claim, and the one-sided test misses it. It needs a `max()` and a reverse-direction test. The other findings are documentation drift: the domain-model table in `decisions.md`, the LIVE-003 run count, and the test total. There is also leftover path parsing in `modeFromBranch`.
