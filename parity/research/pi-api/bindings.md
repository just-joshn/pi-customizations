# Locked Pi API binding research

This is source inspection at Pi revision `abe508e1b89912adde45528136c3221eb69acdd7`, release v1.1.0. It is not a runtime test, source-closure certification, or parity verdict. `read-inventory.json` records exact file hashes and distinguishes full reads from excerpts.

## Tool and input boundaries

`src/core/extensions/types.ts` imports `Static` and `TSchema` from `typebox` at line 57. New production bindings must use this namespace and the locked ToolDefinition signature, not assume an older TypeBox package is interchangeable.

ToolDefinition declares exposure, output schema, execution mode, cancellation signal, partial updates, and ExtensionToolContext. The registered tool implementation receives toolCallId, parsed params, signal, onUpdate, and context. Nested `ctx.executeTool` calls go through validation, hooks, and permission checks. Their records use parentToolCallId and bounded nestedCalls rather than independent transcript tool messages. Accounting must include their recorded usage.

The tool_call contract explicitly says handlers can mutate arguments without subsequent revalidation at lines 1222-1226. This is a verification boundary to exercise, not evidence that a candidate tool safely handles every post-hook argument.

InputEventResult distinguishes continue, transform, and handled. None means that downstream model work has completed. Command handlers can run during streaming, so command completion and agent settlement are separate states.

## Lifecycle ownership

The complete declarations distinguish agent_end, agent_before_settle, and agent_settled. The latter is documented at lines 1003-1009 as occurring after automatic retry, compaction, and queued continuation no longer remain.

`src/core/agent-session.ts` lines 1815-1918 implement the post-run retry/compaction/queue loop and pre-settlement boundary. The read excerpt at lines 1038-1207 shows extension event dispatch before public event notification and the settled-event path. Deferred actions can follow settled dispatch, so runtime replacement and UI teardown also need their own checks.

`test/suite/regressions/6363-agent-settled-event.test.ts` was read in full. It asserts settlement after automatic retry, after follow-ups queued by agent_end handlers, and for command waitForIdle. These are upstream supporting tests read as source. They were not executed here and do not establish live candidate behavior.

`AgentSessionRuntime` owns cwd-bound services and replacement. Its source aborts active work, emits session_shutdown, invalidates/disposes the outgoing session, constructs the replacement, and rebinds it. Fresh child runtime construction must preserve that ownership and correct workspace/resource configuration. Runtime replacement cannot reuse a stale extension context.

## SDK resources and native MCP

`createAgentSession` accepts explicit cwd, agentDir, ModelRuntime, resources, tool selection, settings, and SessionManager. Its default loader is not proof of CLI-equivalent resources.

`DefaultResourceLoader` at lines 371-383 takes extension factories from caller options. `main.ts` line 575 supplies CLI built-ins. SDK hosts therefore need explicit resource decisions. The public index exports createCodemodeExtension, createMcpExtension, and createToolSearchExtension at lines 407-411, corroborated by source search. The public index was not read in full in this slice.

The baseline `extensions/pi-pstack/src/worker-support.ts` was read in full. Its local agent-mode worker loader explicitly supplies those three native factories. Its readonly loader deliberately selects read, grep, find, and ls without MCP. Thus a generic concern about implicit SDK MCP loading is not a demonstrated missing-factory defect in that path. Installed-artifact tests must still prove actual connection, permissions, cancellation, provider loading, and tool availability.

`createAgentSessionServices` constructs cwd-bound settings/resources and applies extension provider/virtual registrations. Its refresh at line 194 uses allowNetwork false. That is not a successful working-service check.

## Selection, dispatch, and physical identity

`model-registry.ts` line 69 obtains getAvailable from getAvailableSnapshot. A detected entry or configured credential is not proof of a successful model request.

`docs/virtual-models.md` was read in full, along with its linked jev-router example. The document separates selected virtual identity from each request's physical dispatch. PI_MODEL and PI_REASONING_LEVEL describe selection. Assistant messages record provider, api, model, and thinkingLevel for physical dispatch. Routers can choose different models/levels for user, continuation, retry, and direct requests, and preserve branch state across compaction.

The earlier reviewer metadata contains both model-change entries and assistant metadata. Under this locked SDK contract, the two are different evidence categories. Controlled runner evidence should retain both, including per-response thinkingLevel. Authentication and source integrity of the producer remain necessary. Runtime records alone do not separately authenticate a proprietary provider backend.

Explicit setup choices, parent aliases, virtual selections, and unavailable routed models need separate reference-grounded tests. Do not silently forbid virtual selections or treat a virtual catalog identity as a confirmed physical result.

## Remaining checks

- Read remaining implementation dependencies and applicable examples/tests before using their APIs.
- Probe SDK versus CLI resource loading in isolated environments without model calls or global settings writes.
- Verify runtime-replacement and settlement behavior against the installed candidate through user controls.
- Capture actual provider/model/reasoning records for every required live worker role.
- Define model availability and identity expectations through the independent acceptance owner.
- Continue Cursor host-contract discovery in the separately owned worktree.

No requirement has moved to passed or frozen because of this research.
