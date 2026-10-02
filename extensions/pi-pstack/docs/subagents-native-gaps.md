# pi-subagents native gaps

`extensions/AGENTS.md` ranks mechanisms: a native Pi mechanism first, the Extension API second, the SDK third, and custom infrastructure only where those cannot represent the need. This page records every place `src/subagents` keeps custom infrastructure, against the eight questions of the native-gap gate. `bun run check:native-first` fails when a banned pattern appears in a file this page does not name, and when a tool declares `outputSchema` without returning `structuredContent`.

The audit that produced this page is in [subagents-native-audit.md](subagents-native-audit.md).

## Adapters that fill a gap

Pi version checked: 1.0.0. Each row says what the public API lacks, the smallest adapter, which state stays Pi's, and when the adapter can go.

| Adapter | Required behavior | Pi mechanism evaluated | Why it cannot express the need | Smallest adapter | Pi state that stays authoritative | Verified by | Delete when |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/subagents/rpc-child.ts` | Drive a child `pi --mode rpc` for remote and teammate tasks, answer its permission dialogs, and launch whichever `pi` the parent runs | `RpcClient` | It has no method that writes an `extension_ui_response` (`send` is private), it always starts `node <cliPath>`, and it forwards the child's stderr to the parent's | The documented JSONL protocol only: LF framing and id correlation | The child's own session and its transcript | `test/child-rpc.test.ts`, `test/subagents-child-task.test.ts`, `test/permission-relay.test.ts` | `RpcClient` answers UI requests and accepts a command |
| `src/subagents/tracked-bash.ts` | Kill the process group of a child's shell commands when the child does not stop | `createBashToolDefinition` with `spawnHook`, `createLocalBashOperations` | Neither reports the spawned pid, which Pi tracks internally | `BashOperations.exec` that spawns as Pi's local shell does and reports the pid | Pi's bash tool definition, truncation and session environment | `test/subagents-process-groups.test.ts` | Pi's bash operations report the pid |
| `src/subagents/shell-command.ts` | Run a `subagentStart`, `subagentStop` or status line command with a JSON document on stdin, extra environment, a timeout and a group kill | `pi.exec` | `ExecOptions` has `signal`, `timeout` and `cwd` only: no stdin, no environment, no process group | `runShellCommand` | None. The command is the hook | `test/subagents-shell-command.test.ts`, `test/subagents-hooks.test.ts` | `pi.exec` accepts input and environment |
| `src/subagents/rem-launcher.ts` | At shutdown, start one detached `pi -p` that consolidates the context board and outlives the session | `pi.exec` | It waits for completion and is bound to the session; it cannot detach | `spawn` with `detached` and `unref` | The consolidation is an ordinary root session | `test/subagents-rem-launcher.test.ts` | Pi can start a detached session |
| `src/deferred-wakes.ts` | A completion wake reaches the parent after the run settles, survives a user abort in between, and is withdrawn when a blocking read already returned its result | `pi.sendMessage` with `deliverAs: "followUp"`, the `agent_before_settle` continuation | The follow-up queue is cleared when the user aborts (`clearQueue` calls `agent.clearAllQueues`) and a queued message cannot be retracted | A map of held wakes flushed on `agent_settled`, never on `agent_end` | Delivery is `pi.sendMessage`; the map only holds undelivered wakes | `test/worker-review.test.ts`, `test/subagents-scheduler.test.ts` | Pi keeps queued messages across an abort and can remove one |
| `src/subagents/agent-storage.ts` (`createChildTranscript`) | Child transcripts at `<session dir>/<parent id>/subagents/agent-<id>.jsonl`, the layout the host contract and the recall skills read | `SessionManager.create`, `.open`, `.newSession` | Pi names a created session `<timestamp>_<id>.jsonl` and offers no way to choose the file | Write the header that `SessionManager.create(...).getHeader()` returns under the chosen name, then `SessionManager.open` | Pi's `SessionManager` owns the file from the first entry | `test/subagents-skill-loading.test.ts`, `test/subagents-pi-native.test.ts` | The transcript layout accepts Pi's file names |
| `src/subagents/close-session.ts` | Surface a failing `session_shutdown` handler of a child as a failure of its shutdown | `AgentSessionRuntime.dispose()` | The runtime reports handler errors to `onError` listeners and does not throw them | Collect `onError` around `runtime.dispose()` and share one shutdown per runtime | The runtime emits `session_shutdown` and disposes the session | `test/worker-errors.test.ts` | `AgentSessionRuntime.dispose()` rejects on handler failure |

## Placements the hierarchy allows

These are not gaps. Data that spans sessions, or settings Pi has no typed key for, lives outside the session by the state table in `extensions/AGENTS.md`.

| File | Placement |
| --- | --- |
| `src/subagents/child-settings.ts` | Pi's own `SettingsManager`, built with the parent's project trust. A child that used the default would load every project's settings and extensions |
| `src/subagents/context-board.ts` | The context board is shared by sessions, so it is a file under the agent directory. Each read-modify-write runs under `withFileMutationQueue` |
| `src/subagents/subagent-preferences.ts` | `/subagents` writes the `subagents` and `builtInAgents` keys of the global `settings.json`, because `SettingsManager` has no setter for them. Reads go through `pi.getSettings()`, and the saved values overlay it for the running session |
| `src/subagents.ts` | `COPILOT_EVENTS_LOG_DIRECTORY` names a directory for external readers. The same envelopes persist as `copilot-event` session entries |
