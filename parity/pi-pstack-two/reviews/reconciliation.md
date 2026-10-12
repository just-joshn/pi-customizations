# Review reconciliation

Three fresh `pi -p --no-session` reviewers (claude-opus-5-5, thinking medium) read the same context (`context.md`) with one focus each (`brief-*.md`). Their raw output is in `parity.md`, `security.md`, and `architecture.md`. All three noted that the tree changed during their review. While they ran, I was also fixing findings of my own: an unguarded `JSON.parse` that crashed the parent on a non-JSON child line, an O(n²) truncation, resume running in the wrong working directory, and aliases shadowing a user's own prompt template. Every finding below was checked against the code before acting.

## Dispositions

| Finding | Source | Disposition | Evidence |
|---|---|---|---|
| The agent cannot arm `/loop`, though pstack playbooks tell it to | parity 1 (high) | Fixed. `Loop` takes `prompt` with `interval` or `wake_in`, and an agent-paced loop waits while background subagents run | `test/loop.test.ts` "the agent can arm a loop itself", "waits for background subagents" |
| A failed `TodoWrite` empties the list on restore | parity 2, architecture 1 | Fixed. Restore skips error results | `test/todo.test.ts` "skips a failed TodoWrite" |
| No path for "the current agent's store" | parity 3 | Fixed. The host map names `<workspace>/store/<session id>` (HOST-007) | `test/e2e/host.e2e.test.ts` |
| `worktree-audit.sh` misses subagent transcripts and custom session folders | parity 4, architecture (suspicion) | Fixed. Subagent state is per workspace, and the patch searches it plus `PI_CODING_AGENT_SESSION_DIR` and settings `sessionDir` | `test/scripts.test.ts` (2 new cases) |
| A child outlives a crashed or killed parent | parity 5, security, architecture | Fixed. Children watch their parent pid and exit. A mutation check confirmed the test fails without the watchdog | `test/e2e/task.e2e.test.ts` "exits when its parent is killed outright" |
| NA-008 (image generation) reason was convenient | parity 6 | Accepted. Now HOST-006 with a host-map line, INCONCLUSIVE because no image model is configured here | ledger HOST-006 |
| LIVE-003 never exercised a real model choice | parity (suspicion) | Addressed. A run with Claude models available wrote `claude-subscription/claude-opus-5-5:xhigh`, and every value resolved | `evidence/live-setup-flash-claude-available.json` |
| MODE-004 might be observable in the CLI | parity (suspicion) | Attempted. Alt+Enter on `/poteto-mode` in `cursor-agent` under tmux entered no mode. Still INCONCLUSIVE | ledger MODE-004 |
| A resumed poteto-agent defaults to foreground | parity (suspicion) | Recorded as unknown U7. Cursor's default is unobserved | `spec.md` |
| No way to stop or message a running child | parity (suspicion) | Refuted as a port gap. Cursor's Task also rejects `resume` while an agent runs (F1) and has no stop parameter | F1 |
| Subagent transcripts were global across workspaces | parity, security (suspicions) | Fixed. They are now per workspace, and another workspace gets "Unknown agent ID" | `test/e2e/task.e2e.test.ts` "another workspace cannot resume it" |
| AskQuestion maps by label (duplicates, a `Done` option) | parity, security 6, architecture 4 | Fixed. Labels and ids must be unique, and the end label is reserved | `test/ask.test.ts` |
| Mode stored an absolute skill path | parity (suspicion) | Fixed. Restore looks the skill up by name first | `src/mode.ts` restore |
| `-fast` stripped before lookup | parity (suspicion) | Fixed. A model id that itself ends in `-fast` wins | `test/task-model.test.ts` |
| The rule guard missed `@`, `file://`, symlink, and case variants | security 1 | Fixed. It mirrors Pi's `resolveToCwd`, then realpath, with case folding on macOS and Windows | `test/rule.test.ts` "spellings" |
| Loop delays past 24.8 days fire at once | security 2 | Fixed. Intervals cap at 24d with a clear error | `test/loop.test.ts` |
| One writer per agent ID only held for background runs | security 3, architecture 2 | Fixed. The registry tracks foreground runs too, and a run lock covers other processes | `test/records.test.ts`, task e2e "two calls in one message" |
| The record was written before attachments were checked | security 4, architecture 8 | Fixed | task e2e "a bad attachment leaves no agent record" |
| Model ids containing `:` could not be selected | security 5 | Fixed. The whole reference is tried first | `test/task-model.test.ts` |
| `live-e2e.mjs` claimed nothing is written to the user's agent directory | security 7 | Fixed. The header now states the symlink write-through and the lock caveat | `scripts/live-e2e.mjs` |
| The SIGKILL timer could throw on EPERM | security (suspicion) | Fixed. `signalGroup` ignores ESRCH and EPERM | `src/task/runner.ts` |
| Background agents stopped silently on reload or a session switch | security (suspicion) | Fixed. A warning names the count and how to resume | lifecycle e2e "a new session resets…" |
| The print-mode settle hold has no timeout | security (suspicion) | Recorded. This matches the observed Cursor print run, which waited for the notification (F2). Documented in the README | README Limits |
| A call could lift a readonly agent type | security (suspicion) | Fixed. `effectiveReadonly` | `test/task-schema.test.ts` |
| `piCommand` guesses the Pi binary | security, architecture (suspicions) | Recorded in the README. Pi exposes no public way to find its own binary | README Limits |
| `decisions.md` D3 described a temp file the code no longer uses | security, architecture 5 | Fixed | `decisions.md` D3 |
| `Loop` is always active | architecture 3 | Refuted. The agent must be able to arm loops (parity 1). Related fixes: Task is inactive at depth 2, and AskQuestion is withdrawn without a UI | task e2e "subagent of a subagent", ask e2e |
| README and decisions contradicted the `/` menu work | architecture 5 | Fixed | README, `decisions.md` D2 |
| Duplicated skill discovery, filtered skills still aliased, duplicate model mapping and types | architecture 6 | Fixed. One `aliasTable` from `pi.getCommands()` feeds input and autocomplete, `availableModels` lives once, and `AvailableModel` is shared | `test/aliases.test.ts` |
| `mode.ts` copies Pi's skill-block shape | architecture 7 | Recorded with a code comment. Pi exports no formatter | `src/mode.ts` |
| `PI_PSTACK_TWO_*` leaked to commands children run | architecture (suspicion) | Fixed. The variables are read once and removed | task e2e "do not inherit the port's variables" |
| Session-folder naming looked undocumented | architecture (suspicion) | Refuted. `docs/session-format.md` "File Location" documents it | Pi docs |
| No tool annotations | architecture (suspicion) | Fixed for TodoWrite, AskQuestion, and Loop. Task keeps the conservative defaults | `src/*.ts` |
| Background results lacked a transcript path | architecture (suspicion) | Fixed. Results name the file or its glob | task e2e |
| An interval loop kept running after Escape | architecture (suspicion) | Fixed. An aborted run stops the loop | `test/loop.test.ts` "aborting a loop run stops the loop" |

## Found while re-verifying

The process-cleanup tests used `ps` to look for the agent ID in command lines. Pi sets `process.title` to `pi`, so those checks passed vacuously. They now track the child pid from Task details. A mutation check confirmed that the abort, reload, new-session, and parent-killed tests each fail when the behavior is removed.
