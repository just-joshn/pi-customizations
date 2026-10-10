# E6 core integration

## Tested contract

The first E6 milestone uses a real in-process Pi SDK session. `test/core/exchange.pi.test.ts` drives `AgentSession.prompt()` through a scripted registered provider and waits for `agent_settled`. It checks provider-visible file contents, actual edited disk bytes, zero tools, operation receipts, and malformed-response feedback in the next request.

`src/core/install.ts` is the only registration boundary. `installMaintainer(pi, features, options)` accepts the symmetric feature list. Until E7 prompt formatting is integrated, callers must supply `options.promptSource`. The default factory aborts at request projection without that source. A source failure aborts through native `ctx.abort()` rather than relying on an exception from a transform hook. Pi otherwise reports that exception and continues with the incoming context. Literal test prompts establish lifecycle behavior, not prompt parity.

`test/core/lifecycle.pi.test.ts` verifies the three-reflection budget, a fresh canonical user reset, suppressed continuation reconciliation, native cancellation, tool refusal, reload, persistent reopen, branch navigation, and refusal of an unresolved operation. It also checks formatter cancellation and unavailable formats. `test/core/context.pi.test.ts` compares actual provider order with pinned Aider `format_chat_chunks` output. It covers prior boundary entries, prior context transformations, fresh reads, images, injected prompt policy, and native compaction. `test/core/branch.test.ts` rejects duplicate receipt identities, orphan observations, and unknown schema versions.

`test/core/mentions.pi.test.ts` proves that assistant file mentions request another reply before applying an edit. Its tracked-name provider is a test-only port, not a Git implementation. `test/core/host.pi.test.ts` runs native subprocesses with literal environment values and cancellation. `test/core/retry.pi.test.ts` verifies Pi-owned retry and accounting. `test/core/root-path.oracle.test.ts` checks symlink resolution against Python. The SDK tests verify the resulting physical write.

## Format integration

`EditFormat<E extends PathEdit>` requires `name`, `prompts`, `editIntent(edit)`, `getEdits(content, context)`, `applyEditsDryRun(edits, context)`, and `applyEdits(edits, context)`.

`getEdits` parses reply text without mutation. `editIntent` declares the authorization unit, including both MOVE endpoints. The registry also locks all editable files so fallback matching can read them safely. `RegisteredEditFormat.withPlan(content, context, prepare, use)` holds those native locks across preflight, permission preparation, and `use(plan)`. `PrepareToEdit` keeps or drops whole candidates. Application is limited to the authorized endpoint set. `EditPlan` has `targets` and `apply()`. The plan is valid only during its callback.

`PrepareToEdit` receives the edits and the locked `EditContext`. Its second argument is required. Using a captured queued tree instead can deadlock. `WorkingTree.mutate(paths, operation, signal)` supplies an unqueued tree inside the native queue. Nested mutation transactions are rejected. Undeclared writes are rejected. Standalone mutations use the same canonical native queue identity. Resolution follows symlinks before collapsing `..`. It also resolves existing prefixes of new paths. Symlink loops cannot fall back to a different lexical target.

`EditContext` has `fence`, `root`, `inchatRelativeFiles`, `absRootPath`, `tree`, `notices`, and optional `signal`. Formats must pass the context through and let cancellation propagate.

## Prompt integration

`PromptSource.get(format, variables)` returns a `PromptSet` or a promise. `format` is the format's prompt identifier. Variables have `fence`, `root`, `model` with `provider` and `id`, and `suggestShellCommands`, plus an optional native `signal`. The source returns already-formatted prompt strings. An asynchronous source must honor that signal. E6 does not import E7's private formatting implementation.

`PromptSet` requires `mainSystem`, `systemReminder`, `exampleMessages`, `filesContentPrefix`, `filesContentAssistantReply`, `filesNoFullFiles`, `filesNoFullFilesWithRepoMap`, `filesNoFullFilesWithRepoMapReply`, `readOnlyFilesPrefix`, and `filesContentGptEditsNoRepo`. Each example has `role` and `content`.

`PromptPolicy` requires `useSystemPrompt`, `examplesAsSystemMessage`, `systemPromptPrefix`, and `reminder` with `sys`, `user`, or null. Model-specific policy selection remains deferred. Unknown token counts use Aider's zero-count reminder fallback.

`RequestView` has `messages` as readonly `ContextMessage[]`, `projection` as readonly `ProjectedSessionEntry[]`, `supportsImages`, and optional `signal`. `ContextMessage` is Pi's `ContextWithSystemEvent['messages'][number]`. `projectRequest` returns formatted `prompts`, the chosen `fence`, refreshed `files`, `messages`, and a `partition` of `position-preserving` or `unpartitioned`.

## Settings integration

`loadSettings(inputs: SettingsInputs): Promise<LoadedSettings>` requires `specs`, `getFlag(name)`, `processEnvironment`, `cwd`, and `home`. `getFlag` returns a boolean, string, or undefined. `LoadedSettings` has `settings`, `problems`, `environment`, `gitRoot`, `dotenvFiles`, and `secrets` (credential material from `--set-env` / `--api-key` for diagnostics scrubbing). `ResolvedSettings.value<T>(option: OptionSpec<T>): T` returns the typed value. `source(option: AnyOptionSpec): string` returns its origin.

The runtime consumes this one inherited resolver. CLI wins over the effective prefixed environment, later config files, and defaults. Local dotenv values affect maintainer commands without replacing Pi's process environment or provider credentials. `createPorts(features, env)` instantiates the supplied SAR factories and fills absent Git, map, and lint ports with their explicit disabled implementations. Only edit is supplied by the production factory.

## Feature contract

The inherited symmetric interface remains the common entry point for every SAR:

```ts
interface Feature<P> {
  readonly name: SarName;
  readonly options: readonly AnyOptionSpec[];
  readonly commands: readonly CommandSpec[];
  readonly create: (env: FeatureEnv) => P;
}
```

`FeatureEnv` contains `cwd`, `settings`, and `host`. `installMaintainer(pi: ExtensionAPI, features: readonly SarFeature[], options: MaintainerOptions = {}): void` registers options, command wrappers, the virtual coder, and lifecycle hooks. `MaintainerOptions` has optional `promptSource`, `promptPolicy`, `home`, and `processEnvironment`.

## Controller contract

`ExchangeController(snapshot: Snapshot, env: ExchangeEnv)` accepts the four ports, Host, PromptSource, append callback, shell-suggestion policy and optional prompt policy. The reflection limit is Aider's fixed value of three. Its integration methods are:

- `snapshot`, `replace(snapshot)`, and `save(snapshot)` read, restore, and persist domain state.
- `bindUser(userEntries, model, reason)` binds canonical Pi user IDs. The reason is `user`, `continuation`, or `retry`. A native retry resumes an interrupted frame without spending a reflection.
- `projectRequest(view)` assembles the provider request. It calls the repository port with current conversation text from `getCurMessageText(messages: readonly ContextMessage[]): string`. The helper preserves Aider's trailing newline for each message. The disabled port returns no repository content.
- `completeReply(reply, signal?): Promise<ReplyDecision>` processes a committed reply ID and complete text, or an incomplete outcome and its reason. It returns dialogue facts and the guarded continuation decision.
- `checkForFileMentions(content, signal?): Promise<string | null>` confirms admissions and records denied mentions on the branch.
- `prepareToEdit<E extends PathEdit>(candidates, context): Promise<EditCandidate<E>[]>` authorizes every intent endpoint before keeping a candidate. `allowedToEdit`, `applyPlan`, and the edited-path tracking methods implement those steps. ADD consent does not pre-create the file.
- `interrupt(reason)` and `reconcile(aborted)` record interruption or final settlement. Neither parses or reapplies reply text.

## State and safety

`restore(branch)` is pure. It reads only the selected Pi branch and returns the latest validated snapshot, handled reply IDs, pending operation intents, and invalid record IDs. No transcript array is stored or assigned.

Each destructive file operation stores its intent before the operation and its observation afterward. The key uses the committed assistant entry ID and action ordinal. Startup creation uses the current committed session entry as its owner, or the reserved startup owner for an empty session. Unresolved receipts forbid startup creation as well as provider requests. A pending intent blocks automatic replay. Native queues serialize in-process file operations, not external editors. Multi-file edits remain non-atomic.

`turn_end` processes eligible finalized reply text once. Error, aborted, length, deferred, pending, and tool-use replies never enter edit parsing. `agent_before_settle` reconciles exchange completion without another reply processor. Reflection continuation is bounded to three additional responses.

## Deliberate limits

Git, map, and lint ports are disabled. No parity is claimed for them. Ask, context, and architect or editor chat modes are wired through the format registry and `ExchangeController` phase. Map-budget context refresh, architect editor commit or cost return, model-specific defaults, shell suggestions, slash commands, file watching, and Pi binary journeys remain deferred. The `apply` option is registered but standalone application is not implemented yet.

Context hooks lack source-entry provenance. The supported cooperation contract keeps the number, order, and roles of canonical projected conversation messages. Content can change. If that shape changes or a history cut is compacted out, E6 preserves incoming history without strict done/current partitioning. Arbitrary prior filtering, insertion, or reordering cannot preserve exact Aider partitioning through Pi 1.1.0.

Branch navigation restores metadata but does not undo disk edits. A branch predating maintainer metadata refuses requests. Selecting a physical model and reloading initializes that branch. Manually overriding the selected virtual coder is not a supported way to change maintainer models yet.

A crash between disk mutation and receipt append leaves an ambiguous result. Recovery stops for manual reconciliation. A failed filesystem observation does not prove that no bytes changed. The retained partial-write test proves that an earlier successful write survives a later failure.

PDF context, arbitrary reordered context projections, Aider's exact token-count reminder limit, prompt-cache transitions, shell execution from replies, and byte-identical Python exception text for every filesystem failure remain unsupported. Retargeting symlinks between operations is outside the serialization guarantee. Aider's `abs_root_path` cache is not reproduced. User reminders in mixed image/text user blocks are not implemented. UI and RPC journeys are not claimed by the SDK print-mode tests.

## Source quirks retained or exposed

- `base_coder.py:637-657` does not add a newline before the closing file fence. Its `fnames` argument does not select the files it reads. The core oracle protects the emitted bytes.
- `base_coder.py:2228-2241` adds an admitted existing file to the editable set without removing it from the read-only set. The SDK test retains both memberships and both context blocks.
- `base_coder.py:2302-2328` reports the prepared target set even when application raises. E6 preserves this distinction between prepared targets and successful operation receipts. It does not claim atomic edits.
- `base_coder.py:1714-1732` strips underscores and other quote characters from mention tokens. `_file.py` can therefore name `file.py`. The mention oracle retains that result.
- `io.py:435-448` catches `OSError` before narrower image-read failures. E6 retains the broad diagnostic branch.
- `io.py:884-889` treats EOF as the default confirmation answer. The pure confirmation oracle retains it. The native UI adapter treats dialog cancellation and unavailable UI as no. Cancellation is never consent.
- `base_coder.py:1299-1306` adds current-message tokens to a chunk count that already includes them. E6 does not claim that exact limit. It uses the unknown-count fallback and leaves model token policy for later integration.

## Verification receipt

The final runtime check passed 23 files and 427 tests. V8 coverage includes untested source files. It measured 92.17% statements, 81.66% branches, 92.95% functions, and 94.41% lines. Oracle freshness passed all seven retained groups and their 323 capture cases. Core has 54 cases. Fresh captures are not a claim that an unimplemented SAR is complete.

Run from the package directory:

```sh
bun x tsc -p .
bun x vitest run
bun run test:coverage
node scripts/capture-oracle.mjs --check
```

Run from the worktree root:

```sh
bun x biome check extensions/pi-maintainer
node scripts/check-agents-compliance.mjs
node extensions/scripts/check-vitest-conventions.mjs
git diff --check
```

Biome passes. Neither repository-wide policy script reports a pi-maintainer finding. This receipt makes no repository-wide pass claim. Whitespace checking passes.

The file-content oracle was challenged by inserting a newline before the closing fence. Six cases failed. The implementation was restored and the final suite passed. The path oracle initially failed because its fixture lacked Aider's cache field and did not canonicalize the temporary root. After correcting those fixture defects, three symlink traversal cases failed against the old TypeScript implementation. The fix passed those cases and an SDK physical-write regression. A final source check found a missing newline in repository-port current text. The SDK regression failed before the fix. Empty and multi-message oracle cases now verify that helper against Aider.

## Changed files

This inventory covers the recovered E6 commits relative to inherited `cb188d64`. Settings and format work already in that base was preserved.

```text
bun.lock
extensions/pi-maintainer/docs/CORE.md
extensions/pi-maintainer/docs/NATIVE-GAPS.md
extensions/pi-maintainer/package.json
extensions/pi-maintainer/parity/oracle/ops/core.py
extensions/pi-maintainer/src/branding.ts
extensions/pi-maintainer/src/core/branch.ts
extensions/pi-maintainer/src/core/chat-files.ts
extensions/pi-maintainer/src/core/context.ts
extensions/pi-maintainer/src/core/exchange.ts
extensions/pi-maintainer/src/core/install.ts
extensions/pi-maintainer/src/core/mentions.ts
extensions/pi-maintainer/src/core/mutations.ts
extensions/pi-maintainer/src/core/pi-host.ts
extensions/pi-maintainer/src/core/prompts.ts
extensions/pi-maintainer/src/edit/feature.ts
extensions/pi-maintainer/src/edit/working-tree.ts
extensions/pi-maintainer/src/feature.ts
extensions/pi-maintainer/src/index.ts
extensions/pi-maintainer/src/settings/config-files.ts
extensions/pi-maintainer/src/support/python-sort.ts
extensions/pi-maintainer/test/branding.test.ts
extensions/pi-maintainer/test/core/branch.test.ts
extensions/pi-maintainer/test/core/context.pi.test.ts
extensions/pi-maintainer/test/core/core.oracle.test.ts
extensions/pi-maintainer/test/core/exchange.pi.test.ts
extensions/pi-maintainer/test/core/host.pi.test.ts
extensions/pi-maintainer/test/core/lifecycle.pi.test.ts
extensions/pi-maintainer/test/core/mentions.pi.test.ts
extensions/pi-maintainer/test/core/mutation-queue.test.ts
extensions/pi-maintainer/test/core/retry.pi.test.ts
extensions/pi-maintainer/test/core/root-path.oracle.test.ts
extensions/pi-maintainer/test/feature.test.ts
extensions/pi-maintainer/test/oracle/core.cases.json
extensions/pi-maintainer/test/oracle/core.golden.json
extensions/pi-maintainer/test/support/maintainer.ts
extensions/pi-maintainer/test/support/pi-session.ts
```

## Recovery and review

The worktree and inherited commits were preserved. No reset, repeated merge, push, plan edit, architecture edit, decision edit, or ledger edit occurred. Foreground critique and comment review inherited the parent model. No background delegate fanout occurred. The comment reviewer could not generate the baseline diff with its restricted tools. That review is not a baseline-certified audit. Its verified path-resolution finding was corrected. Its narration-only oracle docstring was deleted. Public-contract and source-defect comments remain.

Model the Domain shaped the validated snapshot and operation-record fold. Prove It Works required actual provider requests, disk bytes, and session navigation. Sequence Work into Verifiable Units kept the SDK exchange milestone, recovery guards, and remaining parity checks in separately verified commits.
