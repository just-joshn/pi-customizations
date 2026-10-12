# Review reconciliation, round 2

Three fresh `pi -p --no-session` reviewers ran in parallel on a frozen tree. Each used `claude-subscription/claude-opus-5-5` at medium thinking, read the same `context-r2.md`, and had one focus (`brief-*-r2.md`). Their raw output is in `parity-r2.md`, `security-r2.md`, and `architecture-r2.md`. A checksum of every package, parity, and gate file taken before the reviews matched the one taken after, so no reviewer changed the tree. Before acting, I checked every finding against the code and, where possible, reproduced it. Each fix below has a test that failed before the fix, and the mutation column names checks that remove the fix and watch the test fail.

## Round-1 recheck findings (`recheck.md`)

| Finding | Disposition | Evidence |
|---|---|---|
| 1. Aliases vanish for a symlinked install | Fixed. Package skills are matched by canonical path. Round 2 widened aliases to every loaded skill, which removes the path check from aliases, and `packageSkillNames` keeps it for the host map | aliases e2e "installed through a symlink"; TUI run through a symlinked install (`evidence/tui-smoke.md`); mutation-checked |
| 2. `Loop` says "armed" in print and JSON runs | Fixed. Withdrawn on `session_start`, refused if forced, and the host map's `/loop` line depends on the mode | `test/loop.test.ts` "one-shot runs … do not offer the Loop tool", "--tools does not bring it back"; host e2e |
| 3. Dead `shippedSkillDescriptions` | Fixed. Removed, and the directory scan it relied on is gone too | `src/autocomplete.ts` |
| 4. The mode-path fix had no test | Fixed. Round 2 then removed stored-path reads entirely (security 3 below) | mode e2e "stale path", "never inlines the stored path" |
| Run lock names the parent, not the child; plain-overwrite takeover; the error does not name the file | Fixed. `holdFor(child pid)`, a re-read before a stale takeover, fail-closed on an unreadable pid, and the file named in the error | `test/records.test.ts`; task e2e lock test |
| `worktree-audit.sh` reads only global `sessionDir`, without `~` | Fixed. Env, then project, then agent `sessionDir`, as Pi resolves them | `test/scripts.test.ts` (4 cases) |
| Workspace-slug collisions | Recorded. Mirrors Pi's own session folders | README Limits; `decisions.md` D3b |
| A child might lose its depth after a reload | Refuted. In JSON mode, `/reload` reached the model as text, and a depth-2 child still had no `Task` afterwards | Probe in this session; `decisions.md` D3 |
| A fresh record is written before an async spawn failure | Fixed. The record is written only when the child has a pid | `test/task-runner.test.ts` (missing pid on spawn failure); `src/task/tool.ts` `start` |

## Round 2: security

| # | Finding | Disposition | Evidence |
|---|---|---|---|
| 1 | EPIPE on the child's stdin crashes interactive Pi (high) | Fixed, and reproduced first: the suite reported 2 unhandled `write EPIPE` errors. Now a stdin error handler is in place, and an already-killed child gets no prompt | task-runner "exits without reading a large prompt", "abort before the child reads"; mutation: the handler removed gives an unhandled EPIPE |
| 2 | `readonly: true` is ignored on resume | Fixed with `effectiveReadonly(record.readonly, params.readonly)` | task e2e "honors readonly: true for an agent that started writable"; mutation-checked |
| 3 | A stored mode path can inline any local file | Fixed. Entries store only the skill name, restore resolves names among loaded skills, a stored path is never read, and the entry data is validated | mode e2e with a crafted `{skill, path}` entry; `test/mode.test.ts`; mutation-checked |
| 4 | Directory attachments pass, and `~` is not expanded | Fixed. Attachments must be files, and `~` expands as in Pi read paths | task-runner "rejects a directory attachment and expands ~" |
| s | Stale-lock takeover race | Recorded. The wording now says "narrow window"; Node has no portable `flock` | `src/task/records.ts`; README Limits |
| s | `release()` can throw | Fixed. Release is best effort for filesystem errors, and a leftover lock with a dead pid is taken over | records "release never throws" |
| s | The watchdog can be fooled by pid reuse | Fixed. It checks `process.ppid` (observed: it reads 1 once the parent exits) | parent-killed e2e; mutation-checked |
| s | Depth bypass through `bash` | Recorded as an unenforceable boundary | README Limits |
| s | Children run without project trust | Fixed. `--approve` or `--no-approve` from `ctx.isProjectTrusted()` | TASK-018; task e2e trust test; mutation-checked |
| s | `worktree-audit.sh` trusts project settings; a newline in `sessionDir`; `~` in `PI_CODING_AGENT_DIR` | `~` fixed. The project-settings read is refuted as a defect: Pi itself reads project `sessionDir` before trust (`docs/security.md`). A newline is accepted as low impact (a read-only scan) | scripts "PI_CODING_AGENT_DIR is tilde-expanded" |
| s | `live-e2e.mjs` exposes the real `auth.json` to the model | Recorded. Stated in the script header and README | `scripts/live-e2e.mjs` |
| s | The e2e harness forwards `PI_CODING_AGENT_SESSION_DIR` | Fixed. It is deleted from the sandbox environment | `test/e2e/harness.ts` |
| s | Resume silently starts fresh when the transcript is missing | Fixed. Resume refuses with a clear message | task e2e "refuses an agent whose transcript is missing"; mutation-checked |
| s | Rule guard gap when `~/.cursor` is a symlink and `rules/` is missing | Fixed. The path is canonicalized through its nearest existing ancestor | rule "blocks the real target behind a symlinked ~/.cursor" |

## Round 2: architecture

| # | Finding | Disposition | Evidence |
|---|---|---|---|
| 1 | "Usage is in the notification details" was false | Fixed. The details now carry `usage`, and the docs match | task e2e "notification records the child usage" |
| 2 | Foreground usage omits nested usage | Fixed. Usage now sums assistant, `toolResult`, and `compaction_end` usage, as `getSessionStats` does | task-runner "nested"; task e2e "includes what the child spent on its own subagent", "enters the session totals" (`get_session_stats`); mutation-checked |
| 3 | stdin EPIPE | Fixed (security 1) | |
| 4 | Skill discovery split two ways | Fixed. `pi.getCommands()` is the one source: aliases cover every loaded skill, the host list is the package's loaded skills, and `/mode` uses loaded skills. `getCommands()` lists skills even with `enableSkillCommands: false` (observed) | aliases tests; `src/mode.ts` |
| 5 | Old records with a retired type, and corrupt records | Fixed with clear errors | task e2e "explains a recorded type"; records "corrupt or partial record" |
| 6 | The native-gap table is incomplete, and copies of Pi-private logic are undeclared; `bounded` ignores Pi's truncation | Fixed. The table gains smallest-adapter and verification axes, and a copies table names each private-logic copy and when to delete it. `bounded` uses Pi's `truncateHead` and keeps a byte cut only for an oversized first line, which `truncateHead` drops (observed) | `decisions.md`; `test/task-format.test.ts` |
| s | A `tool_result` usage channel exists for TASK-017 | Recorded and rejected with reasons in D4 and the ledger gap: it misattributes usage and loses it when no tool call follows | `decisions.md` D4 |
| s | Readonly children lose `TodoWrite` | Fixed. `TodoWrite` joins the readonly allowlist (it is annotated `readOnlyHint`) | task e2e readonly tools |
| s | The main chat can resume a grandchild at depth 1 | Fixed. Depth is stored in the record and kept on resume | task e2e "keeps its depth on resume"; mutation-checked |
| s | The settle hold ignores the outcome | Fixed for `aborted`. Pi already refuses a continuation the context cannot honor | `test/registry.test.ts` |
| s | Per-keystroke `realpath` calls | Fixed. Realpaths are cached per runtime | `src/aliases.ts` |
| s | `loop.lastCtx` keeps a context | Accepted. It is read only while a loop is active, and the runtime is rebuilt on reload and session replacement | |

## Round 2: parity

| # | Finding | Disposition | Evidence |
|---|---|---|---|
| 1 | `/name` covers only pstack's own skills | Fixed. Every loaded skill is aliased. Built-ins are handled before `input` | aliases e2e "a skill of the user's own"; D2; mutation-checked |
| 2 | A `wake_in` call is dropped while a wake is pending | Fixed. A new wake replaces the pending timer | loop "a new wake_in replaces a wake"; mutation-checked |
| 3 | Effort levels Cursor would reject are accepted | Fixed. Levels are validated against pi-ai `getSupportedThinkingLevels` and listed per model. This also showed that an earlier LIVE-003 run's `:xhigh` values were invalid; the run was redone (`evidence/live-summary.md`) | task-model level tests; LIVE-003 runs 5 and 6 |
| 4 | The host map names AskQuestion in one-shot runs | Fixed. The line depends on the mode | host e2e "names AskQuestion only where a user can answer" |
| 5 | Tests check less than their rows claim | Fixed. RES-007 now checks all 70 relative file links; tests added for TASK-014 session totals, the TASK-015 background error, and the first `/mode` turn | resources, task, and mode e2e |
| s | The TASK-017 reason ignores `tool_result` | Recorded with reasons (as architecture above) | D4 |
| s | The cloud refusal stalls runs and offers no isolation | Fixed. The refusal says to repeat the call locally with per-writer git worktrees, and the host map says to keep going. Task has no working-directory parameter (README) | task-schema; host e2e |
| s | Readonly allows no read-only shell | Recorded as TASK-019, NOT VERIFIED: Pi has no read-only shell, and an allowlist would claim isolation Pi lacks | ledger; spec; README |
| s | The `paths` field is unexplained | Refuted as a gap. In S4, `paths` only scopes automatic surfacing, and the one skill that uses it is explicit-only | spec RES-004 |
| s | No subagent liveness signal | Fixed. The host map names the lock file | host e2e |
| s | `recall`'s full Cursor path and `reflect`'s first-line read | Fixed. The host map maps both | host e2e |
| s | Symlinked install with children | No defect observed (the reviewer agrees) | |

## Recheck of these fixes (`recheck-r2.md`)

One fresh reviewer (same model and settings) rechecked every row above on a frozen tree. Its checksum matched before and after the review.

| Finding | Disposition | Evidence |
|---|---|---|
| 1. Storing depth let a subagent resume a depth-1 agent at depth 1, so nesting was no longer capped (a regression from this round) | Fixed. A resume runs at `max(recorded depth, caller depth + 1)` | task e2e "a subagent that resumes a depth-1 agent … nesting stays capped", which failed before the fix and fails again when it is reverted |
| 2. The domain-model table in `decisions.md` described the old aliases and record | Fixed | `decisions.md` |
| 3. `modeFromBranch` still returned the stored path | Fixed. It returns a validated skill name only | `test/mode.test.ts` |
| 4. Evidence counts disagreed | Fixed. The LIVE-003 ledger row now uses `live-summary.md`'s run numbers (6/6). The test totals are below | ledger; this file |
| s. An unknown mode name goes into the system prompt as stored | Fixed. Stored names must look like skill names (no whitespace, at most 64 characters) | `test/mode.test.ts` "not a skill name"; mutation-checked |
| s. Trust comes from the current folder while the child runs in the record's folder | Fixed. Resume refuses a record whose working directory differs, which can happen only on a workspace-name collision | task e2e "record names another working directory"; mutation-checked |
| s. The watchdog misfires behind a launcher that does not `exec` | Fixed. The watchdog also checks the parent pid when the initial parent is not the Pi parent. Not reproduced: the CLI path never uses such a launcher | `src/index.ts` |
| s. An old rule with an unsupported level now fails Task | Recorded. It matches Cursor's rejection; the README says to rerun `/setup-pstack` | README Limits |
| s. Usage `usage` entries and branch summaries in a child | Accepted. A JSON child emits no event for them and has no idle time or tree navigation in which to incur them | `decisions.md` D3 |
| s. Lock-takeover error wording; the module-wide realpath cache | Accepted. Pi itself discovers new skills only on reload, which also resets the cache | |

## Verification on the final revision

- `npx vitest run`: 24 files, 253 tests passed. With `PSTACK_TWO_E2E_PI=~/.pi/agent/bin/pi`, the 8 e2e files (68 tests) also passed.
- `tsc --noEmit`; `bun run ci` (biome, 1189 files); `bun run typecheck` (root and every package); `check:agents` (0 violations); `check:tests` (0 violations); `check-pi-mechanisms`; `check:toolchain`; `check:types-policy`: all exit 0.
- `sync-upstream.mjs --check`: 166 files match `1b6d44f`.
- Mutation checks run this round: each one removed a single fix and confirmed that its test fails. The fixes covered were the EPIPE handler, readonly on resume, depth on resume, the transcript check, the wake reschedule, nested usage, trust passing, stored-path reads, all-skill aliases (after correcting a first mutation that did not take effect), and level validation.
