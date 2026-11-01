# Pi native gaps

pi-pstack uses Pi's public extension API. Four mechanisms have no public equivalent in Pi 1.4.0, so the package
implements them itself against documented lower-level surfaces. Each entry names what Pi lacks, what the package does
instead, and what would let the copy go. Pi line numbers refer to `@earendil-works/pi-coding-agent@1.4.0`.

## 1. The subagent process

`RpcClient` (`dist/index.d.ts:36`, `dist/modes/rpc/rpc-client.d.ts:14-27`) is Pi's supported subprocess client, and
`docs/rpc.md` prefers it for a TypeScript host. It cannot host a subagent, for five reasons verified in
`dist/modes/rpc/rpc-client.js`:

- **Spawn shape.** `start()` runs `spawn("node", [cliPath, ...args], { cwd, env, stdio })` (`:42`) with no spawn
  options and a single script path. pi-pstack starts `[process.execPath, script]`, `[process.execPath]`, or `pi` from
  `PATH` (`src/task/tool.ts:105-109`), and `RpcClientOptions` accepts none of those.
- **Process-group kill.** The runner spawns with `detached: true` (`src/task/runner.ts:253`) and signals `-pid`
  (`signalGroup`, `:202-210`), so abort and session shutdown stop the child and everything it started. `stop()` signals
  the direct child pid only, SIGTERM then SIGKILL after 1 s (`rpc-client.js:94`), and there is no `detached` option.
- **Graceful exit.** When a run settles with nothing outstanding the runner ends the child's stdin (`close()`,
  `:266-270`), and Pi's RPC mode disposes the runtime and exits on stdin `end` (`dist/modes/rpc/rpc-mode.js:642`,
  `shutdown` at `:579-597`). `RpcClient` has no method that ends stdin; `stop()` is its only exit.
- **Dialogs.** The runner answers `extension_ui_request` with `extension_ui_response` and `cancelled: true`
  (`src/task/runner.ts:320-321`), the record `docs/rpc-extension-ui.md` defines. `RpcClient` passes the request to event
  listeners and offers no way to send the response; its `send` is private.
- **stderr and exit.** The runner keeps the last 8 KiB of stderr and reports the child's exit code in the outcome
  (`outcomeOf`, `:226-234`). `RpcClient` appends stderr without a bound and mirrors it into the parent's stderr
  (`rpc-client.js:49-52`), and exposes neither an exit promise nor a code.

`RpcClient` does cover the rest of what the runner sends: `prompt(message, images, "steer")`, `abort`, `clearQueue`,
`followUp`, and the event stream. The runner speaks the JSONL protocol from `docs/rpc.md` directly and keeps its own
response correlation so it can also do the five things above.

**When this goes away.** `RpcClientOptions` grows a spawn override (detached process group, command array), a method
that ends stdin and awaits exit with a code, and an `extension_ui_response` method. Then `src/task/runner.ts` becomes a
thin adapter over `RpcClient`.

## 2. The skill block `/mode` sends

`modeSection` (`src/mode.ts:52-58`) strips frontmatter with Pi's exported `stripFrontmatter` (`dist/index.d.ts:50`) and
wraps the body in the `<skill name="..." location="...">` block Pi's own `/skill:name` expansion builds
(`AgentSession._expandSkillCommand`, `dist/core/agent-session.js:1739`). Pi exports `parseSkillBlock` and
`formatSkillsForPrompt` (`dist/index.d.ts:3,23`), which parse a block and format the skills catalog; neither formats
one skill block. **When this goes away.** Pi exports the block formatter and `mode.ts` calls it.

## 3. The `fork_turns` truncation

`keepFirstTurns` (`src/task/records.ts:110-121`) rewrites the forked transcript file by hand.
`SessionManager.createBranchedSession(leafId)` (`dist/core/session-manager.d.ts:365`) always mints a new session ID and
file name (`dist/core/session-manager.js:1205-1264`), so it cannot produce the `<timestamp>_<agentId>.jsonl` that
`SessionManager.forkFrom(..., { id: agentId })` just created. No export truncates an existing session file at an entry.
**When this goes away.** A session API that branches to a named session ID, or truncates at an entry id.

## 4. The workspace folder name

`workspaceSlug` (`src/paths.ts:26-35`) repeats Pi's session-folder rule (`getDefaultSessionDirPath`,
`dist/core/session-manager.js:290-295`). The only public accessor is `ctx.sessionManager.getSessionDir()`
(`ReadonlySessionManager`, `dist/core/session-manager.d.ts:178`), and it is not a substitute:

- It needs a live session and names the current session directory. pi-pstack's workspace state is keyed by working
  directory and spans sessions, so `agent_status` lists every agent in the workspace, not only this session's.
- A subagent's session directory is `<workspace>/subagents`, so in a child the accessor answers `subagents` rather
  than the workspace folder.
- `getDefaultSessionDir` is exported only from `dist/core/session-manager.js:296`, not from the package root, and
  constructing a `SessionManager` to read the rule would create a session directory on every path lookup.

`test/records.test.ts` fails if Pi changes the rule: it compares `workspaceSlug(cwd)` with
`basename(SessionManager.create(cwd).getSessionDir())`. **When this goes away.** Pi exports the default session-folder
name for a working directory as a pure function.
