# pi-pstack-two security and state-integrity review

The tree changed while I reviewed it. `src/task/runner.ts`, `tool.ts`, `format.ts`, `index.ts` and `autocomplete.ts` were rewritten at about 20:40–20:41, after I had first read them. The line numbers below are from the state after those edits. Running `bunx vitest run` on that state gives **21 files, 179 tests passed**, not the 19/175 the author reported. The newer runner no longer crashes on a non-JSON stdout line (`parseEvent`, runner.ts:127-136), and resume now uses the recorded `cwd`.

## Confirmed defects

**1. The Cursor-rule guard misses paths that Pi's `write` and `edit` tools resolve to the same file. Severity: medium.**
- **Where:** `src/rule.ts:15-31`, wired up in `src/index.ts:74-77`.
- **Why:** Pi's tools resolve paths with `resolveToCwd` (`dist/core/tools/write.js:31`, `edit.js:94`). That calls `normalizePath` with `stripAtPrefix: true` and also turns `file://` URLs into paths (`dist/utils/paths.js`). The guard does neither. It also never resolves the file itself through `realpath`, so it does not follow a symlinked file or catch case variants on a case-insensitive disk.
- **Evidence:** I ran `cursorRuleWriteReason('edit', …)` under node against a temporary HOME on APFS:

  | Path given to the tool | Guard result |
  |---|---|
  | `~/.cursor/rules/pstack-models.mdc` | blocked |
  | `@~/.cursor/rules/pstack-models.mdc` | allowed |
  | `file://<home>/.cursor/rules/pstack-models.mdc` | allowed |
  | `link.mdc` (a symlink to the rule) | allowed |
  | `~/.cursor/rules/Pstack-Models.mdc` (same file on APFS) | allowed |
  | `~/.CURSOR/rules/pstack-models.mdc` | allowed |

- **Impact:** README.md:47 says writes to the Cursor path "through `write` or `edit` are blocked". For these inputs that is false. The README only mentions the shell bypass.

**2. `/loop` and `Loop.wake_in` have no upper limit, and long delays fire almost at once. Severity: medium.**
- **Where:** `src/loop.ts:7-11` (`parseDuration`), the timer at `src/loop.ts:70`, and the tool at `:115-117`.
- **Why:** Any duration over 2³¹−1 ms (about 24.8 days) is passed straight to `setTimeout`. Node then logs `TimeoutOverflowWarning … set to 1` and fires after 1 ms. I checked this: `setTimeout(…, 25*86400000)` fired after 4 ms.
- **Impact:** `/loop 30d <prompt>`, or a model calling `Loop` with `wake_in: "25d"`, runs a new turn right after every settle. That is a runaway that spends tokens, and the warning text lands on stderr under the TUI.

**3. The "one process per agent ID" rule only holds for background runs. Severity: medium.**
- **Where:**
  - Only `background.track` adds entries to `running` (`src/task/background.ts:43,60`).
  - Foreground launches are never registered (`src/task/tool.ts:159-160`).
  - `planResume` checks only `isRunning` (`tool.ts:80-82`).
- **Impact:** Each of these starts a second `pi --session-id <same id>` writer on the same session file:
  - two `resume` calls for one ID in the same assistant message (Task has no `executionMode`, so calls run in parallel);
  - a foreground resume running next to a background resume of the same ID;
  - a resume from another Pi process, including a depth-1 child.
- **Why that corrupts state:** Pi's session manager appends with `appendFileSync` and takes no lock (`dist/core/session-manager.js:812`). The two writers interleave parent IDs, and whichever writes last becomes the branch leaf. The other conversation is left on a side branch without any warning.
- **Coverage:** This breaks the invariant stated in `decisions.md:122`. The e2e test (`task.e2e.test.ts:168-170`) only covers the background case.

**4. A Task record is written before attachments are checked. Severity: low.**
- **Where:** `recordFresh` runs at `tool.ts:154`. `resolveAttachments` runs later, inside `launchChild` (`tool.ts:102`), and can throw.
- **Impact:** A bad `file_attachments` entry leaves a record with no transcript. Resuming that ID later would start an empty session under it.

**5. Models whose ID contains `:` cannot be selected. Severity: low.**
- **Where:** `src/task/models.ts:48-55`.
- **Why:** `resolvePiSpec` splits on the last `:` and rejects anything after it that is not a thinking level.
- **Evidence:** `ollama/llama3:8b`, `llama3:8b` and `openrouter/qwen/qwen3:free` are all rejected as "Invalid model selection". `subagentsSection` lists those same values as available (`sections.ts:53`). Only `…:free:high` resolves.

**6. AskQuestion maps answers by label. Severity: low.**
- **Where:** `src/ask.ts:29,42-45`.
- **Impact:**
  - When two options share a label, picking either returns the last option's ID.
  - In multi-select, an option labelled `Done` is treated as the stop sentinel and can never be picked.

**7. `live-e2e.mjs` can write to the user's real `auth.json` without the user's lock. Severity: low.**
- **Where:** the header comment at `scripts/live-e2e.mjs:6` says "nothing is written to the user's own agent directory".
- **Why the comment is wrong:** Pi's auth storage uses `writeFileSync`, which follows the symlink, so a token refresh does write the user's real `auth.json`.
- **Why the lock does not help:** Pi takes its lock with `realpath: false` (`auth-storage.js:39,86`). The lock file therefore sits beside the sandbox symlink, not beside the real file. A live run and the user's own Pi session can refresh rotating OAuth tokens at the same time, and one refresh can overwrite the other.

## Suspicions and questions

- **Subagents can outlive Pi.** Children are spawned `detached` (`runner.ts:165`), so they sit outside the terminal's foreground process group.
  - Print/JSON mode has no SIGINT handler (`print-mode.js` only handles SIGTERM and SIGHUP), so Ctrl+C on `pi -p` ends the parent without `session_shutdown`.
  - In the TUI, a crash calls `uncaughtCrash`, which kills only Pi's internal tracked-detached set (`utils/shell.d.ts:25-27`, not public API) and then exits.
  - I expect the children to die on EPIPE at their next stdout write. Bash commands they started run in their own process group (`core/tools/bash.js:65`) and may survive. I did not reproduce this end to end, and the README does not mention it.
- **`killGroup` timer** (`runner.ts:138-151`): the SIGKILL is sent unconditionally 3 s after SIGTERM, even if the group has already exited. If that `kill` fails with EPERM, the exception is thrown inside a timer and goes uncaught. This is unlikely.
- **Background subagents are killed silently.** `session_shutdown` also fires on `/reload`, `/new`, resume and fork (`docs/extensions.md:262-263`), and it kills background children with no notice (`background.ts:53-58`). The README does not say so.
- **Print-mode settle hold has no timeout** (`background.ts:48`). A hung background child keeps `pi -p` open forever. Is that what Cursor does?
- **Records are global, not per project.** A model in project B can `resume` an agent ID from project A, and it then runs with write access in A's directory (`tool.ts:83-88`). The system prompt names the subagent directory. This is not a real escalation for a model that already has bash, but the README does not state it.
- **The model can override `readonly`.** `params.readonly ?? agent.readonly` (`tool.ts:77`) lets the model set `readonly: false` on a read-only agent type. Is that Cursor's behavior? Otherwise read-only looks enforced: `--tools` is an allowlist that also covers extension tools, `--no-mcp` is passed, and the allowlist leaves out codemode and Task. User extensions still run code inside read-only children.
- **`piCommand`** (`tool.ts:59-63`) assumes `process.argv[1]` is Pi's CLI. If Pi is embedded through the SDK, it would re-run the host's script.
- **Directory permissions:** `mkdirSync(..., mode: 0o700)` (`records.ts:17`) only applies to directories it creates. An existing `pstack-two/` keeps its current permissions.
- **Secrets:** I found no credentials in `parity/pi-pstack-two` or the test fixtures. The evidence files do contain absolute paths with the username (`/Users/josh-desktop/...`), and the fixtures contain Cursor session and request UUIDs.
- **Docs drift:** `decisions.md` D3 says agent bodies go through `--append-system-prompt <temp file>`. The code sends them through `PI_PSTACK_TWO_AGENT` and a system-prompt section instead (`index.ts:18-21`).

## Overall assessment

The core boundaries are mostly sound:
- prompts travel on stdin, not argv;
- argv is built without a shell;
- agent IDs are checked with a regex that blocks path traversal;
- record writes are atomic with 0600/0700 permissions;
- read-only mode uses Pi's tool allowlist with `--no-mcp`.

The weak spots are three state and safety issues: the rule guard does not match Pi's own path normalization (`@`, `file://`, case, symlinks), loop delays can overflow into an immediate runaway, and the "one process per agent ID" rule ignores foreground runs, which lets two processes write the same session file. Each is a small fix: resolve paths the way `resolveToCwd` does and then `realpath` them; cap durations at 2³¹−1 ms; register foreground children in the running map. Process cleanup when the parent crashes or gets Ctrl+C in print mode is best-effort and is not documented. The README should also mention that background agents are killed on reload or session switch.
