# E6 core integration

## Tested contract

The first E6 milestone uses a real in-process Pi SDK session. `test/core/exchange.pi.test.ts` drives `AgentSession.prompt()` through a scripted registered provider and waits for `agent_settled`. It checks provider-visible file contents, actual edited disk bytes, zero tools, operation receipts, and malformed-response feedback in the next request.

`src/core/install.ts` is the only registration boundary. `installMaintainer(pi, features, options)` accepts the symmetric feature list. Until E7 prompt formatting is integrated, callers must supply `options.promptSource`. The default factory aborts at request projection without that source. A source failure aborts through native `ctx.abort()` rather than relying on an exception from a transform hook. Pi otherwise reports that exception and continues with the incoming context. Literal test prompts establish lifecycle behavior, not prompt parity.

`test/core/lifecycle.pi.test.ts` verifies the three-reflection budget, a fresh canonical user reset, suppressed continuation reconciliation, native cancellation, tool refusal, reload, persistent reopen, branch navigation, and refusal of an unresolved operation. `test/core/context.pi.test.ts` verifies actual provider message order, prior boundary entries, prior context transformations, fresh reads, and native compaction. `test/core/branch.test.ts` rejects duplicate receipt identities, orphan observations, and unknown schema versions.

## Format integration

`EditFormat<E extends PathEdit>` requires `name`, `prompts`, `mutationPaths(edit)`, `getEdits(content, context)`, `applyEditsDryRun(edits, context)`, and `applyEdits(edits, context)`.

`getEdits` parses reply text without mutation. `mutationPaths` declares every potentially mutated endpoint, including move destinations. The registry also locks all editable files so fallback matching can read them safely. `RegisteredEditFormat.withPlan(content, context, prepare, use)` holds those native locks across preflight, permission preparation, and `use(plan)`. `EditPlan` has `targets` and `apply()`. The plan is valid only during its callback.

`PrepareToEdit` receives the edits and the locked `EditContext`. Its second argument is required. Using a captured queued tree instead can deadlock. `WorkingTree.mutate(paths, operation, signal)` supplies an unqueued tree inside the native queue. Nested mutation transactions are rejected. Undeclared writes are rejected.

`EditContext` has `fence`, `root`, `inchatRelativeFiles`, `absRootPath`, `tree`, `notices`, and optional `signal`. Formats must pass the context through and let cancellation propagate.

## Prompt integration

`PromptSource.get(format, variables)` returns a `PromptSet` or a promise. `format` is the format's prompt identifier. Variables have `fence`, `root`, `model` with `provider` and `id`, and `suggestShellCommands`. The source returns already-formatted prompt strings. E6 does not import E7's private formatting implementation.

`PromptSet` requires `mainSystem`, `systemReminder`, `exampleMessages`, `filesContentPrefix`, `filesContentAssistantReply`, `filesNoFullFiles`, `filesNoFullFilesWithRepoMap`, `filesNoFullFilesWithRepoMapReply`, `readOnlyFilesPrefix`, and `filesContentGptEditsNoRepo`. Each example has `role` and `content`.

`PromptPolicy` requires `useSystemPrompt`, `examplesAsSystemMessage`, `systemPromptPrefix`, and `reminder` with `sys`, `user`, or null. Model-specific policy selection remains deferred. Unknown token counts use Aider's zero-count reminder fallback.

## State and safety

`restore(branch)` is pure. It reads only the selected Pi branch and returns the latest validated snapshot, handled reply IDs, pending operation intents, and invalid record IDs. No transcript array is stored or assigned.

Each destructive file operation stores its intent before the operation and its observation afterward. The key uses the committed assistant entry ID and action ordinal. A pending intent blocks automatic replay. Native queues serialize in-process file operations, not external editors. Multi-file edits remain non-atomic.

`turn_end` processes eligible finalized reply text once. Error, aborted, length, deferred, pending, and tool-use replies never enter edit parsing. `agent_before_settle` reconciles exchange completion without another reply processor. Reflection continuation is bounded to three additional responses by default.

## Deliberate limits

Git, map, and lint ports are disabled. No parity is claimed for them. Architect and editor flow, ask and context execution, model-specific defaults, shell suggestions, slash commands, file watching, and Pi binary journeys remain deferred. The `apply` option is registered but standalone application is not implemented yet.

Context hooks lack source-entry provenance. The supported cooperation contract keeps the number, order, and roles of canonical projected conversation messages. Content can change. If that shape changes or a history cut is compacted out, E6 preserves incoming history without strict done/current partitioning. Arbitrary prior filtering, insertion, or reordering cannot preserve exact Aider partitioning through Pi 1.1.0.

Branch navigation restores metadata but does not undo disk edits. A crash between disk mutation and receipt append leaves an ambiguous result. Recovery stops for manual reconciliation.
