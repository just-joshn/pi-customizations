# Pi 1.1.0 wiring and feasibility

## Evidence roots

All implementation citations refer to the installed release, not current upstream main.

- `CA` is `/Users/josh-desktop/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent`.
- `CORE` is `/Users/josh-desktop/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-agent-core`.
- `AI` is `/Users/josh-desktop/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-ai`.
- `A` is `/Users/josh-desktop/src/experiments/aider`, inspected at `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`.
- `G` is `../../grounding` relative to this file.
- `P` is `/Users/josh-desktop/src/personal/pi-customizations/extensions/pi-maintainer`.

The three installed package manifests each say `1.1.0` at line 3. The Aider checkout SHA was read with `git rev-parse HEAD`. This candidate performed source inspection, not a new runtime experiment. `G/prototype/FINDINGS.md` establishes in-memory continuation and synthetic message projection only. Its `--no-session` command cannot establish restart or disk durability.

## Boundary mapping

| Aider unit | Pi boundary | Candidate action |
| --- | --- | --- |
| One user lifecycle, `init_before_message` through idle | First consumed user entry through domain completion, followed by `agent_settled` for host finality | Reset frame progress once per owned user entry, not once per provider retry or `agent_start`. |
| One model response | Actionable `turn_end` | Inspect the persisted response identified by `messageEntryId`, then run reply-text editing. |
| One reflection | `custom_message` draft plus guarded `continue: true` | Store literal reflection text, increment that frame's count, let Pi make the next request. |
| Architect's nested editor invocation | Parent frame suspended in a branch snapshot, then a boundary editor-input message | Route the next request to the editor, do not invoke `prompt()` recursively. |
| Return from nested editor | Editor's terminal `turn_end` | Complete the suspended parent pipeline locally after `reply_completed`, then settle without an invented extra architect response. |
| Provider retry or length recovery | Pi's existing recovery | Do not turn it into an Aider reflection or apply a partial response. |

`CA/dist/core/extensions/types.d.ts:730-811` defines the boundary draft and event types. `CA/dist/core/agent-session.js:488-533` persists the response before dispatch and commits returned drafts. `CORE/dist/agent-loop.js:143-215` controls error termination, tools, steering, follow-up work, and explicit continuation. The domain controller never reproduces that loop.

## Exact hook registration plan

This table names actual public hooks. Controller operations are proposed private calls.

| Public hook or API | Private work | Return or side effect |
| --- | --- | --- |
| Factory receives `ExtensionAPI` | Register commands, flags, renderers, and one virtual model. | No processes or timers. |
| `session_start` | Decode `ctx.sessionManager.getBranch()`, reconstruct domain state, mark an incomplete prior receipt interrupted. Validate model availability. | Use `pi.setActiveTools([])` for active Aider modes. No automatic replay of unfinished edits. |
| `session_tree` | Reconstruct from the new active branch. | Clear disposable caches and display the selected file sets and mode. |
| `session_shutdown` | Release references and dismiss owned interactions. | Idempotent cleanup, no persisted continuation ticket. |
| `registerCommand` | `/add`, `/read-only`, `/drop`, `/ls`, `/chat-mode`, `/code`, `/ask`, `/architect`, `/context`. Validate the command and check idle before changing domain state. | Idle state changes use `pi.appendEntry`. One-shot input uses `pi.sendUserMessage`. No command-only navigation API in a lifecycle handler. |
| `input` | Validate ordinary user input and optional command preprocessing. | `continue`, `transform`, or `handled` according to its actual result contract. Do not build a steering queue. |
| `before_agent_start` | Set the initial Aider preamble via `event.systemPromptOptions.customPrompt`. Prepare one-shot mode intent. Disable tools through native selection. | Mutate structured options. Do not return a made-up `systemPromptOptions` result. |
| `registerVirtualModel().route` | Inspect branch-derived active frame and select its physical model. Detect a newly consumed user entry before routing. | `{ model, thinkingLevel }`. No independent phase copy in virtual-model state. |
| `context` | Produce conversation chunks when no full-transcript change is required. | `{ messages }`. Cannot update system prompt here. |
| `context_with_system` | Own exact Aider chunk order and dynamic prompt for architect/editor transitions and system reminders. | `{ messages }`, with a leading system message. This is the required main path when phases or full Aider prompt policy are active. Do not register a second duplicate assembly path. |
| `turn_end` | Decode completed reply, check receipt, run ordered domain work. | Append own drafts after `event.entries`. Request continuation only for an editor input or permitted reflection. |
| `agent_before_settle` | Observe unresolved phase/continuation state. | Normally return nothing. Do not re-request every missing continuation and accidentally loop. |
| `agent_settled` | Record interrupted or finished status and restore a one-shot persistent mode. | Notification-only. This is not a place to schedule another request. |
| `session_compact` | Invalidate request-view data, reread canonical projection. | No reinsertion of compacted raw history. |
| `cache_warming_decision` | Disable idle warming in the editor frame. | `{ action: 'stop' }`. This is not a general per-request cache-retention setter. |
| `tool_call` | Reject unexpected model tool calls in Aider reply-text modes. | `{ block: true, reason, terminate: true }`. Treat any resulting tool-use response as not an edit-bearing reply. |

`session_start.reason` includes startup, reload, new, resume, and fork. There is no invented `session_fork` hook. See `CA/dist/core/extensions/types.d.ts:562-655`. Command context adds `waitForIdle`, but commands should not wait inside an interaction that prevents the run from becoming idle. See `types.d.ts:285-299` and `CA/docs/extensions.md`, Context and session changes.

A retry may start a fresh low-level run without a new human input. `before_agent_start` alone cannot identify an Aider lifecycle. The installer can record an input intent before the user message exists, but the controller binds it only when the canonical user entry is available before request dispatch. An orphan intent on restart is not an exchange to replay. This proposal needs the scripted-provider checks listed below.

## Change model and prompt within one run

### Model selection is feasible through native routing

The preferred mechanism is `pi.registerVirtualModel`.

Actual public signatures are:

```typescript
registerVirtualModel<TState = unknown>(model: ExtensionVirtualModel<TState>): void;
route(request: ModelRouteRequest<TState>, ctx: ExtensionContext):
	ModelRoute<TState> | Promise<ModelRoute<TState>>;
```

`ModelRoute` supplies a physical `Model<Api>` and a `ModelThinkingLevel`. `ModelRouteRequest.reason` is `user`, `continuation`, `retry`, or `direct`. Sources are `CA/dist/core/extensions/types.d.ts:1370-1387` and `CA/dist/core/virtual-models.d.ts:24-69`. Full semantics are in `CA/docs/virtual-models.md`. The checked example is `CA/examples/extensions/jev-router.ts`.

At architect completion, first persist the editor-frame choice. Then return the editor-input custom message and request continuation. The next route reads that frame. It must not blindly use `request.previous` for every continuation, because this particular continuation deliberately changes models. Retry remains on the same phase-selected physical model. `direct` summary requests use a defined summary-model policy and must not consume a phase or reflection.

`CA/dist/core/agent-session.js:437-486` reads canonical branch context, resolves a virtual model, checks the routed model's context window, and returns the physical route. `CORE/dist/agent-loop.js:123-141` prepares the request before calling the stream routine. `CORE/dist/agent-loop.js:260-280` transforms messages and calls Pi's stream function with the selected physical model. Therefore the route can change between architect and editor without new transport code or a nested model loop.

`ctx.model` continues to name the selected virtual model. It is not the dispatched editor. Prompt construction reads the same domain `PhysicalModelRef` as the router instead of assuming `ctx.model` describes the provider request. Catalog metadata is resolved through `ctx.modelRegistry`.

A second public mechanism exists, but is not the candidate's normal route:

```typescript
setModel(model: Model<any>): Promise<boolean>;
```

This exact public declaration uses `any`. The candidate's domain types do not. `CA/dist/core/extensions/types.d.ts:1270-1274` says it changes the current selection without changing defaults. The binding at `CA/dist/core/agent-session.js:2743-2748` checks auth and calls `AgentSession.setModel`. That method at `1946-1962` changes model state and appends `model_change`. The next request reads current model state at `437-454`. It can therefore switch the next in-run request, but it introduces restoration and selection bookkeeping that a virtual model avoids. Use `pi.setModel` once to select the registered virtual entry when enabling maintainer mode, not once per frame.

Virtual-to-virtual routing is forbidden. A selected external virtual router cannot be used directly as the editor physical route. That is a configuration error, not permission to flatten another router by guessing its provider.

### A mid-run structured prompt setter does not exist

`BeforeAgentStartEvent.systemPromptOptions` is mutable in its own event. Its result type contains `message` and `systemPrompt`, not returned options. Sources are `CA/dist/core/extensions/types.d.ts:708-718,1101-1106`. `BuildSystemPromptOptions.customPrompt` replaces the normal prefix, while `forceSystemPrompt` replaces the full prompt. See `CA/dist/core/system-prompt.d.ts:4-37`.

The installed implementation emits `before_agent_start` at `CA/dist/core/agent-session.js:1588-1591`, saves the options at `1626-1627`, and refreshes later requests using those saved options at `535-566`. It does not emit that event again for a `turn_end` continuation. Holding and mutating the old event object is not a documented setter and is rejected by this design. `ctx.getSystemPromptOptions()` exists only on command context and returns base options, not an authorized mutation handle.

The public request-local escape is real and sufficient to change the provider-visible prompt:

```typescript
pi.on('context_with_system', handler);
```

Its event holds the complete `AgentMessage[]`, and its result is `{ messages?: AgentMessage[] }`. The leading system message must remain. `CA/dist/core/extensions/types.d.ts:660-678,1058-1060` and `CA/dist/core/extensions/runner.js:1000-1064` show that ordinary `context` restores system messages, then full-transcript handlers run, and their output is used as returned.

At that boundary the adapter folds existing system state with public `getCurrentSystemMessage` from `@earendil-works/pi-ai`, replaces the owned Aider preamble for the active frame, and emits the ordered request. Preserve other prompt sections and the effective tool declarations from the folded system message. Tool disabling happens through `pi.setActiveTools([])`, never by manually deleting tool declarations. If another extension reactivates tools, detect the incompatible loadout rather than silently rewriting it.

`AI/dist/index.d.ts:32` exports transcript helpers. `AI/dist/utils/transcript.d.ts:15-41` declares `getCurrentSystemMessage`, `getCurrentTools`, and `collapseSystemMessages`. `AI/dist/types.d.ts:352-368` defines system content, sections, tool additions/removals, and timestamp.

This changes the actual next request, but does not write a new canonical Pi system-prompt entry. Persist the domain frame and prompt-policy version so the transformation is reconstructible. Do not claim that the raw transcript's last system message or `ctx.getSystemPrompt()` equals the projected editor prompt. If exact canonical prompt-transition recording is itself mandatory, that constraint is impossible through the exposed 1.1.0 boundary drafts. They cannot append a system message.

## Request assembly without a second transcript

The request consists of Aider chunks in this order:

1. System prompt, or the Aider user/assistant substitute for a model policy without system support.
2. Examples, including the codebase-reset acknowledgment when examples are separate.
3. Read-only file content and acknowledgments.
4. Repository map and its acknowledgment.
5. Done history, using Pi's existing summaries and retained messages.
6. Fresh editable file content and acknowledgment.
7. Current frame's messages.
8. Optional system reminder or a copied final user message with its reminder appended.

For a Pi full-transcript hook, a leading system message remains even when Aider's policy expresses its instructions as user/assistant messages. A zero-content leading system carrying Pi tool state can meet the Pi contract. Byte-for-byte wire identity with Aider's absence of that message is not promised. Providers own final wire encoding.

The fresh-file read happens on every request, including reflections and editor entry. Choose fences from the current content. Read-only and editable messages use the actual prompt-format resources, not generic tool descriptions. `A/aider/coders/base_coder.py:637-670,763-815,1226-1338` defines this behavior. Exact acknowledgment examples include:

- Read-only text uses `Ok, I will use these files as references.`.
- Read-only images use `Ok, I will use these images as references.`.
- Empty chat files ordinarily use `Ok.`.
- Saved-edit notices use a user notice followed by `Ok.`.
- Shared suggested-shell output uses `Ok` with no period.
- Architect return stores `I made those changes to the files.` followed by `Ok.`.

`HistoryBoundary` records move-back operations by source entry ID. A prompt read obtains `getBranch()` for metadata and `buildSessionProjection()` for visible conversation contributions. It never sends all raw branch messages again after compaction. `ProjectedSessionEntry` exposes `sourceEntry` and `messages`, including omissions/replacements. See `CA/dist/core/session-manager.d.ts:140-152,178,307-321`.

An editor request selects only the editor frame's own retained conversation contributions. It creates no repository map and does not replay architect examples or completed history. It receives the architect answer as the new user input. The parent's frame remains suspended. When the editor finishes, add the architect return acknowledgment and resume the parent's local completion path. Do not generate another architect answer merely to get back to the main model.

### Composition constraint

Boundary composition is exact and non-negotiable. If there are own drafts, return the equivalent of:

```typescript
{
	entries: [...event.entries, ...ownDrafts],
	...(needsOwnContinuation ? { continue: true } : {}),
}
```

If there is no own change, return nothing. Never erase another extension's `continue: true`. `CA/dist/core/extensions/runner.js:759-806`, traced in `G/pi-runtime-semantics.md`, replaces the proposed entries array when a handler returns one. Preview IDs are not committed IDs. Records use `messageEntryId` or a stable domain key, never a draft-preview ID.

Request composition has a separate limit. `context` and `context_with_system` receive messages without source entry IDs, and the runner clones them. Replacing them with `buildSessionProjection().messages` would erase earlier extensions' transforms. The candidate must preserve incoming unowned messages and earlier replacements. It may use a conservative, ordered, unambiguous correspondence with canonical projected messages to identify owned contributions. It must not assume object identity survives or match only on timestamps. Ambiguous correspondence is an integration conflict, not a reason to discard messages.

No public provenance-preserving context-transform result exists here. Strict phase filtering and preservation of arbitrary earlier message rewriting cannot both be guaranteed. This is a blocked composition edge, not a solved matching algorithm. A cooperating-extension ordering contract or a Pi provenance API is required before claiming that general combination works.

## Ordered completion inside the controller

For a complete text response, `completeReply` runs this sequence directly. Each policy call receives the active operation signal.

1. Check the response-entry receipt. Ignore a fully handled reply. An intent without a finish receipt requires reconciliation, not blind replay.
2. Exclude error, abort, length, deferred, and unexpected tool-use responses from editing. Pi owns their recovery. This intentionally fixes the documented partial-provider-error hazard.
3. Run assistant file-mention admission. A newly admitted mention requests reflection before `reply_completed` and edits. Context mode disables this hook.
4. Execute mode-specific `reply_completed`. Ask/help-like modes produce no edits. Context mode replaces its file selection and requests `try_again` only if the set changes and `reflectionsSent < maxReflections - 1`. Architect asks `Edit the files?` unless auto-accepted, then suspends for editor entry.
5. For an edit format, parse `get_edits`, resolve targets with format preflight, authorize each distinct path, and call `dirtyCommit` after all permissions but before applying edits. Permission admission must not precreate a patch ADD target. Authorize both MOVE endpoints.
6. Compute prepared targets before application. Apply through the existing `WorkingTree` boundary. Report successful writes separately. Partial writes remain partial, not an invented atomic transaction.
7. If prepared targets are nonempty, accumulate them, call `autoCommit`, and record move-back plus the saved-message acknowledgment. A pending edit reflection returns before lint, shell suggestions, or tests.
8. If edited targets and auto-lint are enabled, call lint and then `autoCommit` with `Ran the linter`. Ask whether to repair a diagnostic. Accepted repair returns before shell suggestions and tests.
9. Run explicitly approved suggested shell commands. The editor disables them. Shared output adds its user/assistant pair with `Ok`.
10. If edited targets and auto-test are enabled, run configured tests. Their failure feedback and acknowledgment follow the test command contract. Ask whether to repair and request reflection on acceptance.
11. If a reflection exists and the count is below the maximum, increment once and emit it as the next input. Otherwise emit the exact `Only N reflections allowed, stopping.` warning and finish. Do not append a runnable reflection and then claim it cannot continue.
12. If the editor finished, return its assistant commit hashes to the parent and resume the parent after `reply_completed`. The parent base pipeline still exists because Aider's architect hook returns `None`, not `True`. No editor cost counter is copied because Pi already accounts for the real assistant entries from both physical models.

The source ordering is `A/aider/coders/base_coder.py:924-944,1529-1623,2175-2336,2374-2423`, `architect_coder.py:11-48`, and `context_coder.py:21-53`. The Git reconstruction's lifecycle sections at lines 273-342 and lint/test reconstruction at lines 125-161 corroborate the extension points.

## Persistence, interruption, and non-atomic work

Persist a reply intent with `pi.appendEntry` before filesystem or shell side effects. Persist a finish receipt immediately after the observed operation result. Branch snapshots and receipts are plain `custom` entries. Model-visible input facts use boundary `custom_message` drafts. This separates the safety receipt from a later handler's ability to replace boundary proposals.

The two writes and filesystem work are not one transaction. A crash between application and the finish receipt leaves an unknown outcome. The extension must report that state and refuse automatic replay. It can compare expected file content in a later explicit reconciliation operation, but that is not proof that a shell command ran only once. `continue: true` is not durable work scheduling. No timer or restart job is introduced.

Reconstruct from the selected branch on startup, reload, fork, and tree navigation. Compaction removes context contributions, not raw branch custom state. A selected earlier branch does not undo files on disk. Read fresh content and never replay old edits to make the working tree resemble that branch.

Pi's fork code preserves retained entry IDs while rechaining around labels. See `CA/dist/core/session-manager.js:1205-1238`. Bare leaf movement may not survive reopening without another append. The candidate adopts Pi's semantics rather than writing a competing leaf pointer. See `G/pi-runtime-semantics.md`, Branch switch within the same session.

Later extensions can replace our drafts or suppress explicit continuation. Directly persisted safety receipts remain, but there is no atomic boundary ownership guarantee. On settlement without the expected next response, keep the frame interrupted and report it. `continue: false` is not a universal stop mechanism.

## Impossible or unresolved combinations

| Requirement | Exact limit | Candidate verdict |
| --- | --- | --- |
| Change the editor model within the same run | Native virtual routing resolves before every request. | Source-supported. A two-model runtime test remains necessary. |
| Change the actual editor prompt within that run | `context_with_system` can replace request-local system state. | Source-supported. Not a canonical system-prompt transition. |
| Also record the changed system prompt canonically through `turn_end` | Boundary drafts allow custom, custom_message, context_edit, compaction, not arbitrary system message entries. | Impossible with this public boundary API. Do not call private SessionManager mutators through a cast. |
| Preserve independent parent/editor histories through a default compaction that mixes their messages | Pi stores one prose summary. Frame labels in metadata cannot invert that summary. | Strict isolation is not proven and is generally unrecoverable from an unstructured mixed summary. Do not resurrect raw compacted history. A phase-aware `session_before_compact` customization may be viable, but is a separate design gate under the no-replacement constraint. |
| Keep a completely empty editor history and preserve arbitrary foreign extension messages | Foreign messages remain visible by composition policy. | Both literal requirements cannot hold together. Clear only owned Aider history or declare incompatible composition. |
| Preserve arbitrary earlier `context` rewrites while filtering by canonical entry IDs | The context hook has no source IDs. | General guarantee unavailable. Needs a provenance API or a tested cooperation contract. |
| Exact Aider repeatable CLI flags using Pi's native extension flag API | Flags support only string or boolean, and CLI unknown flags are stored in a map with last-value wins. | Repeated `--lint-cmd` values cannot be recovered through `getFlag`. Use an explicit list-valued settings/string encoding if approved, not a raw argv parser that replaces Pi CLI handling. |
| Prompt interactively in print or JSON mode | `ctx.hasUI` is false, and confirm returns false in the existing prototype. | Impossible without changing the host interface. Explicit noninteractive policy is required. No stdin prompt loop. |
| Exactly-once multi-file edits, shell commands, and branch receipts across a crash | Pi entries and external side effects are separate writes. | Impossible without a transaction facility the systems do not share. Reconcile or stop. |
| Make Aider's synchronous input lifecycle identical to arbitrary Pi steering/follow-up interleavings | Pi may consume queued messages instead of adding a distinct reflection turn. | Define the consumed-input boundary and test it. Do not promise a separate reflection-only request under competing queued work. |
| Disable editor prompt caching exactly like Aider's provider options | The inspected public lifecycle API supplies an idle warming decision, not a general request cache-options setter. | Idle warming suppression is feasible. Exact provider cache-header parity remains unsupported by this design. No transport replacement. |

The strongest remaining blocker is independent histories across compaction. A candidate that silently replays full raw branch history would appear to work until it defeats Pi's compaction. This design explicitly declines that shortcut.
