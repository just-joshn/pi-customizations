# pi-pstack-two round 2 review: security and state integrity

## Confirmed defects

**1. An abort or shutdown just after a Task starts can crash the parent Pi process with an unhandled `EPIPE` (high).**
- **Where:** `src/task/runner.ts:191-194`. `startChild` attaches no `'error'` listener to `child.stdin`. If the signal is already aborted, `kill()` runs before `child.stdin.end(options.prompt)` (`:192`). Otherwise, an abort or a `session_shutdown` kill (`registry.ts:60`) can land before the child has read stdin.
- **What happens:** the write fails with `EPIPE`. Node raises that as an unhandled `'error'` event on the socket, so it becomes an `uncaughtException`.
- **Effect in the TUI:** interactive Pi treats an `uncaughtException` as fatal: it prints "exiting due to uncaughtException" and calls `process.exit(1)` (`dist/modes/interactive/interactive-mode.js:3553-3561`).
- **Repro:** I called `startChild` directly against the installed `~/.pi/agent/bin/pi` with a throwaway `PI_CODING_AGENT_DIR` under `/tmp`.

  | Prompt size | Abort timing | Result |
  |---|---|---|
  | 10 KB | already aborted | parent dies with `Error: write EPIPE … Unhandled 'error' event` |
  | 70 KB, 200 KB | aborted at 50 ms | parent dies |
  | any tested size | aborted at 300 ms | parent survives |

  A plain `sh -c 'exit 3'` child with a 1 MB prompt also kills the parent.
- **Why the window may be wider than measured:** my probe child loaded no extensions or MCP. A real child loads the user's extensions first, so the time before it drains stdin is probably longer than in the probe.
- **Fix:** add `child.stdin.on('error', …)` and ignore `EPIPE`. Optionally, skip the write when the child was already killed.

**2. `readonly: true` is silently ignored on `resume` (medium).**
- **Where:** `src/task/tool.ts:86-95`. `planResume` takes `readonly: record.readonly` and never looks at `params.readonly`.
- **Effect:** a writable agent resumed with `readonly: true` gets full `bash`/`edit`/`write` tools and MCP. Nothing in the result says the request was dropped.
- **Why it contradicts the spec:** TASK-008 (`spec.md:180-182`) says `readonly: true` withholds write and shell tools. The `model` parameter is also ignored on resume, but that case gets an explicit note (`tool.ts:92`); `readonly` gets neither enforcement nor a note.
- **Fix:** OR the two values with `effectiveReadonly(record.readonly, params.readonly)`.
- **Tests:** none cover this. `task-schema.test.ts:43` checks only the agent-type floor for fresh agents.

**3. A Custom Mode stored in a session can inject any local file into the system prompt (low).**
- **Where:** `src/mode.ts:75`. `restore` falls back to the stored `{skill, path}` when the skill name no longer resolves. `modeSection` then reads that path with `readFileSync` (`:46`) and inlines the body into every request (`:52-56`).
- **Effect:** a session file the user did not write (shared, copied, or forked from elsewhere) could carry a `pstack-two/mode` entry naming `~/.pi/agent/auth.json` or an SSH key. That file's contents would then go to the model provider every turn.
- **Why it is only low:** it needs an attacker-supplied session file.
- **Fix:** only accept a stored path that is a `SKILL.md` Pi actually loaded. Otherwise show the existing "no longer exists" message.

**4. Attachments that are directories pass validation, and the child then crashes (low).**
- **Where:** `src/task/runner.ts:44-50` (`resolveAttachments`) checks only `existsSync`.
- **What I saw:** with `@/tmp/…/adir`, the child exits 1 and the Task reports `pi exited with code 1: Node.js v24.21.0`, which is a stack-trace tail, not a usable error.
- **Also:** `~/x` and `@x` are resolved against cwd literally. Pi's `resolveReadPath` would expand `~`, so `~/x` fails here with a misleading "does not exist" error.

## Suspicions and questions

- **Stale-lock takeover race (`records.ts:105-107`).** The "re-read then `rmSync`" step is still check-then-act. If process A removes and re-creates the lock between B's re-read and B's `rmSync`, B deletes A's fresh lock and both proceed. The README (`:69`) documents this. It is acceptable as stated, but the "microseconds" wording undersells it on a loaded machine.
- **`release()` can throw.** It calls `holderOf`, which rethrows any error other than `ENOENT` (`records.ts:101`), and it runs inside `handle.done.then(...)` (`registry.ts:39-40`). An `EACCES` or `EIO` there would reject `settled`. That would produce an unhandled rejection and could reject the print-mode settle hold (`registry.ts:52`). I did not reproduce this.
- **The parent watchdog can be fooled by pid reuse.** It uses `process.kill(parentPid, 0)` (`index.ts:54-60`). If the parent's pid is reused, the orphan never exits. Checking `process.ppid !== parentPid` would be immune, because a detached child is reparented to pid 1. The same pid-reuse caveat applies to `alive()` in `records.ts:36`, but the lock error now names the file, so that case has a manual way out.
- **Depth control can be bypassed through bash.** `child-env.ts` deliberately strips the depth variables, so a depth-1 writable subagent can run `pi -p …` through `bash` and start an unbounded chain. The parent watchdog does not reach those processes. The README does not state this boundary.
- **Children run without project trust.** They use `--mode json`, and with the default `defaultProjectTrust: "ask"` they skip project extensions, skills, and settings (`docs/security.md:77-80`), even when the parent TUI session trusted the project. It is not a security hole, but it is an undocumented gap between parent and child capabilities.
- **`worktree-audit.sh` trusts project settings.** The patch reads the project's `.pi/settings.json` `sessionDir` without considering trust, as Pi itself does (`docs/security.md:31`). A hostile repository with `"sessionDir": "/"` would make `rg` scan the whole filesystem: a slow scan and broad reads, nothing written. A `sessionDir` containing a newline becomes two search roots. `PI_CODING_AGENT_DIR` values starting with `~` are not expanded, unlike Pi's `getAgentDir`. All of these are low impact; quoting and `jq` usage are otherwise sound.
- **`scripts/live-e2e.mjs:52` gives the model the user's real credentials.** It symlinks the real `auth.json` into the sandbox, and the model under test has `bash`/`write` with the full `process.env`. It can read, or overwrite through the symlink, the user's real credentials. The script header documents only the OAuth-refresh side effect, not that the model can read or overwrite the credentials. Evidence files store tool arguments and final text verbatim (`:216-218`). I found no tokens in `parity/pi-pstack-two` (regex sweep for `sk-`, JWT, `ghp_`, `AKIA`, Slack, Google, and token/secret/password key-value patterns).
- **The e2e harness forwards the whole parent environment** (`test/e2e/harness.ts:43`). If `PI_CODING_AGENT_SESSION_DIR` is set in the user's environment, e2e sessions are written to the user's real session folder instead of the temp sandbox.
- **Resume can silently start a fresh session.** If a record exists but its transcript is missing (for example, the child died before Pi wrote the first entry), `--session-id` creates a new session. The Task result still implies the context was preserved.
- **Possible rule-guard gap.** When `~/.cursor` is a symlink and `~/.cursor/rules/` does not exist yet, `canonical()` falls back to the raw path on one side and a differently spelled path on the other (`rule.ts:20-23`). A write through the real target path could then go unblocked. The README already concedes the bash route (`:66`).

## Overall assessment

The round-1 fixes are real. The lock now names the child pid, fails closed on unreadable contents, and releases only a lock it still owns. Records are written atomically with 0600/0700 permissions and only after the child starts. Agent IDs are strictly validated before they reach file paths or `--session-id`. Model strings come only from the registry list. The prompt travels on stdin. The readonly floor is enforced through `--tools` and `--no-mcp`. The one serious new finding is the missing `stdin` error handler: an Esc or `/reload` early in a Task with a moderately large prompt can take down the user's interactive Pi process, and I reproduced it against the installed Pi. That should be fixed before shipping. The second fix to make is honoring `readonly: true` on resume, since TASK-008 promises it and nothing tells the caller it was dropped. The remaining items are hardening or documentation: the stored mode path, directory attachments, bash-launched nested Pi, the credential exposure in the live harness, and project trust in children.
