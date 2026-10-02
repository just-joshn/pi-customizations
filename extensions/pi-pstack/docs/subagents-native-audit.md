# pi-subagents native-first audit

Rule under audit: a native Pi mechanism first, the Extension API second, the SDK's public API third, and custom infrastructure only where those demonstrably cannot represent the need (`extensions/AGENTS.md`).

Scope: `src/subagents.ts`, every file under `src/subagents/`, and the shared modules they drive (`deferred-wakes.ts`, `worker-control.ts`, `worker-support.ts`, `worker-runtime.ts` where it shared a defect). Pi 1.0.0 docs, exported declarations and `dist` were read for every claim below. Each finding was reproduced against the real Pi API before it was fixed, and each fix has a test that fails without it.

## Violations found and fixed

| # | Where | Violation | Native mechanism | Evidence |
| --- | --- | --- | --- | --- |
| 1 | `settings-store.ts` | Read settings with `SettingsManager.create(cwd, agentDir)`, whose `projectTrusted` defaults to `true`. A `hooks.subagentStart` command in an untrusted project's `.pi/settings.json` ran. | `pi.getSettings()` returns the merged settings with trust applied | `test/subagents-project-trust.test.ts` |
| 2 | `child-session.ts`, `worker-support.ts` | Child sessions took the default `SettingsManager`, so a child loaded `.pi/extensions/*` of an untrusted project. | `SettingsManager.create(cwd, dir, { projectTrusted: ctx.isProjectTrusted() })` through `child-settings.ts` | `test/subagents-child-trust.test.ts` |
| 3 | `settings-layers.ts` | A second settings loader that read `~/.claude/settings.json` and `.pi/settings.json` by hand, ignoring trust. | `pi.getSettings()` | file deleted |
| 4 | `agent-tools.ts`, `specialized-tools.ts`, `context-board.ts`, `inbox.ts` | Eight tools declared `outputSchema` and never returned `structuredContent`, so codemode callers got text. | `structuredContent` matching `outputSchema` | `test/subagents-tool-contract.test.ts` |
| 5 | `agent-tools.ts`, `specialized-tools.ts` | A sync child made model calls and the tool result carried no `usage`, so session totals missed them. | `AgentToolResult.usage`, built from `getSessionStats()` | `test/subagents-tool-contract.test.ts` |
| 6 | `agent-tools.ts` | A child's reply reached the model unbounded. | `truncateHead` with a pointer to the transcript | `test/subagents-tool-contract.test.ts` |
| 7 | `agent-tools.ts`, `specialized-tools.ts` | The tools validated their arguments a second time. | Pi validates against the TypeBox schema before `execute` | schema checked through `validateToolArguments` |
| 8 | `child-session.ts` | A child never loaded pi's MCP extension, so `pi.registerMcpServer` only recorded an extension error and no inherited server connected. | `createMcpExtension()`, `createCodemodeExtension()`, `createToolSearchExtension()`, as the SDK example does | `test/subagents-child-mcp.test.ts`, with the extension removed the test fails |
| 9 | `child-session.ts` | A custom `deferTools` replaced tool search. With more than thirty tools it left the child with none. | MCP `exposure: "deferred"` and `tool_search` | `test/subagents-pi-native.test.ts` |
| 10 | `tool-policy.ts` (new) | Loading MCP in a child would have let tools that register late bypass an agent's named tool list. | `before_agent_start` plus `pi.setActiveTools`, and a `tool_call` block | `test/subagents-pi-native.test.ts` |
| 11 | `mcp-inheritance.ts` | A 25 ms settle loop with a temporary `mcp_servers_change` handler on every spawn. | `pi.getMcpServers()` | `test/subagents-pi-native.test.ts` |
| 12 | `workflows/store.ts` | A `workflows.json` beside the session, with staged renames, leases and write-only tables, one of which was written under the wrong key. It ignored branches. | `pi.appendEntry` entries folded from `getBranch()` | `test/subagents-workflows.test.ts` |
| 13 | `workflows/runtime.ts` | A 5 s lease heartbeat timer and a 200 ms poll for a free slot. The poll checked the running count and admitted in two steps, so with `maxConcurrentSubagents: 1` two parallel agents both started (observed on the old code: started, started, completed, completed). | A counting semaphore that wakes the next waiter | `test/subagents-workflows.test.ts` |
| 14 | `workflows/tools.ts` | The three workflow tools were never registered. | `pi.registerTool` when `COPILOT_DYNAMIC_WORKFLOWS` is on | `test/subagents-tool-contract.test.ts` |
| 15 | `factory.ts` | The write gate read `PI_PSTACK_PLAN_MODE` as "may write", so every `task` child was refused `edit` and `write`. | The parent's live `pi.getActiveTools()` | `test/subagents-tool-contract.test.ts` |
| 16 | `context-board.ts` | A read-modify-write on a shared file outside `withFileMutationQueue`. | `withFileMutationQueue` | `test/subagents-tool-contract.test.ts` |
| 17 | `deferred-wakes.ts` | Flushed held wakes on `agent_end`, which is not final. | `agent_settled` | `test/worker-review.test.ts` |
| 18 | `subagents.ts` | `session_before_tree` and `agent_before_settle` were registered twice, so the settle wait logged twice and a rewind check ran twice. | One registration, in `registerSettleWiring` | diff |
| 19 | `close-session.ts` | Emitted `session_shutdown` by hand through `extensionRunner.emit`. | `AgentSessionRuntime.dispose()` | all child lifecycle tests |
| 20 | `environment-facts.ts`, `agent-storage.ts`, `sidekicks/wiring.ts` | Three git probes through `child_process`. | `pi.exec` | `test/subagents-environment-facts.test.ts`, `test/subagents-sidekicks.test.ts` |
| 21 | `agent-records.ts` | Hand-counted tool calls and tokens. | `session.getSessionStats()` | `test/subagents-scheduler.test.ts` |
| 22 | `subagent-preferences.ts` | `/subagents` overwrote a `settings.json` it could not parse. | Refuse and surface the error, under `withFileMutationQueue` | `test/subagents-preferences.test.ts` |
| 23 | `task-registry.ts` | Every tool call appended the whole agent record, prompt and replies included, to the session. | Persist transitions only | `test/subagents-task-registry.test.ts` |
| 24 | `agent-tools.ts` | The related tools had no `namespace`. | `namespace` metadata | `test/subagents-tool-contract.test.ts` |
| 25 | `tracked-bash.ts` | `as unknown as ToolDefinition`. | `defineTool` | typecheck |
| 26 | `agent-locations.ts` | The literal `.pi` directory name. | `CONFIG_DIR_NAME` | typecheck |
| 27 | `subagents.ts` | A captured session context outlived the session. | Cleared in `session_shutdown` | `test/subagents-scheduler.test.ts` |
| 28 | Dead code | `subagent-context.ts`, `continuation.ts` and `continuationState`, the env-driven caps in `limits.ts`, the unused half of `types.ts` and `agent-sources.ts`, `findAgent`, `fileTrackingExtension`, `stopPendingFor`, `AgentTypeError`. Nothing called them, and the caps read `CLAUDE_CODE_*` variables that nothing set. | deleted | grep, typecheck |
| 29 | `inbox.ts`, `factory.ts` | `send_inbox` was active in the parent's tool list although only sidekicks can use it, and a sidekick got only the tools its parent had active, so `session-search` had no `grep` or `find`. | `defaultActive: false`, and a definition the host supplies grants the tools it names | `test/subagents-sidekicks.test.ts` |

## Reviewed and kept

These stay, with the gate answers in [subagents-native-gaps.md](subagents-native-gaps.md): `rpc-child.ts`, `tracked-bash.ts`, `shell-command.ts`, `rem-launcher.ts`, `deferred-wakes.ts`, `createChildTranscript`, the shutdown helper.

These were checked against the hierarchy and already comply: agent discovery (pi has no resource type for agents, and it uses `parseFrontmatter`, `getAgentDir` and `CONFIG_DIR_NAME`), the task registry (`appendEntry` plus `getBranch()` on `session_start` and `session_tree`), prompt changes (structured `systemPromptOptions` sections), model-request identity (`before_provider_headers`, `before_provider_request`), content exclusion and the write gate (`tool_call`), the event bus for the limiter link, the RPC surface and the inbox (`pi.events`), wakes and sidekick messages (`pi.sendMessage`), `/fleet` and `/rubber-duck` (`pi.sendUserMessage`), and parallel execution modes on the tools that share state.

## Not in scope

The Reference-style `Task` environment `cloud` engine (`cloud-tasks.ts`, `cloud-worker.ts`, `scripts/detached-rpc-*`) keeps its file protocol and 150 ms outcome poll. The detached root outlives the parent, so it cannot hold the pipe. Its design is recorded in `native-parity-design.md`. The `Task` tool of that engine and the `task` tool here differ only in case, so one provider-facing name hides the other.
