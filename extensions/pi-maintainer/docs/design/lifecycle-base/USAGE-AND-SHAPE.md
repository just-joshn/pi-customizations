# Candidate 2. An exchange controller with nested coder frames

Exploratory design for installed Pi 1.1.0. No executable implementation exists. This package is conditional on the feasibility limits in [PI-WIRING.md](PI-WIRING.md). It is not a claim that every fixed constraint is simultaneously implementable.

## Usage written before the types

A user keeps Pi's ordinary conversation and sends Aider-style requests. The assistant writes edits in its reply. Pi-maintainer interprets that finalized reply, asks for file permissions, applies permitted edits, and requests a bounded repair response when needed. Pi still streams every assistant response and decides when the run settles.

Proposed command interactions are:

```text
/add src/parser.ts
/read-only docs/grammar.md
/architect Add escaped identifiers to the parser.
```

The last command runs one architect exchange. If approved, its answer becomes the editor's user input. The editor uses its configured model and format, fresh copies of the architect's file sets, no earlier conversation, and no repository map. The persistent mode returns to its previous value after the one-shot command. `/architect` without text changes the persistent mode. `/chat-mode diff-fenced`, `/code`, `/ask`, and `/context` follow the same command family. `/ls` displays both file sets. `/drop` removes selected paths.

The following call sites describe proposed package interfaces, not existing Pi exports. Only the installer is exported outside the lifecycle package.

### Call site 1. Extension composition

```typescript
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { installMaintainer } from './lifecycle/index.js';

export default function (pi: ExtensionAPI): void {
	installMaintainer(pi);
}
```

The installer loads validated settings, creates the file boundary, registers commands and hooks, and owns disposal. Callers do not construct phases or schedule model requests.

### Call site 2. Complete a reply inside the private Pi adapter

```typescript
const reply = decodeCompletedReply(event, ctx.sessionManager);
const decision = await controller.completeReply(reply, ctx.signal);
return composeBoundary(event, decision);
```

`completeReply` owns file mentions, mode-specific completion, permissions, editing, commit ordering, lint, shell suggestions, tests, and reflection limits. `composeBoundary` appends only this extension's drafts to `event.entries`. It does not replace another extension's proposals or set `continue: false` to stop unrelated work.

### Call site 3. Route and project the next request

```typescript
const request = controller.describeRequest();
return resolvePhysicalRoute(request.model, routingContext);
```

```typescript
const view = decodeRequestView(event.messages, ctx.sessionManager);
const request = await controller.projectRequest(view);
return encodeFullTranscript(request, view);
```

The router and projector consult the same branch-derived coder frame. They do not maintain separate phase flags. The router chooses a physical model through Pi's registry. The projector creates request-local Aider chunks. Neither sends a model request.

## The organizing data shape

One `ExchangeController` owns one active user exchange and a bounded nesting of coder frames. An architect frame can suspend after `reply_completed` while one editor frame runs. The editor has its own reflection budget and file-set value. This is a domain controller, not `reduce(Event) -> Effect[]`, a plugin bus, a workflow engine, or a second agent loop.

The authoritative record is Pi's active branch. Controller objects are disposable readers and coordinators. They never own a second transcript. Domain snapshots store settings and lifecycle facts, not copies of user or assistant history. A request view joins these facts to Pi's compaction-aware projection.

All types below are proposed domain types. Opaque IDs and paths are validated by the adapter. They are not assertions that Pi exposes branded types. Markdown signatures have no implementation bodies.

```typescript
type EntryId = string & { readonly entryId: unique symbol };
type ExchangeId = string & { readonly exchangeId: unique symbol };
type FrameId = string & { readonly frameId: unique symbol };
type AbsolutePath = string & { readonly absolutePath: unique symbol };
type CommitHash = string & { readonly commitHash: unique symbol };
type NonNegativeInt = number & { readonly nonNegativeInt: unique symbol };

type EditFormat =
	| 'diff' | 'diff-fenced' | 'whole' | 'udiff' | 'udiff-simple' | 'patch'
	| 'editor-diff' | 'editor-diff-fenced' | 'editor-whole';
type ChatMode =
	| { readonly kind: 'code'; readonly format: EditFormat }
	| { readonly kind: 'ask' }
	| { readonly kind: 'architect'; readonly editor: EditorPolicy }
	| { readonly kind: 'context' };
type PhysicalModelRef = {
	readonly provider: string;
	readonly id: string;
	readonly thinkingLevel: string;
};
type EditorPolicy = {
	readonly model: PhysicalModelRef;
	readonly format: EditFormat;
	readonly autoAccept: boolean;
};

type ChatFiles = {
	readonly editable: ReadonlySet<AbsolutePath>;
	readonly readOnly: ReadonlySet<AbsolutePath>;
};
type CheckOutcome =
	| { readonly kind: 'not-run' }
	| { readonly kind: 'passed' }
	| { readonly kind: 'failed'; readonly report: string }
	| { readonly kind: 'unavailable'; readonly reason: string };
type Reflection = {
	readonly reason: 'mentions' | 'edit' | 'lint' | 'test' | 'context';
	readonly text: string;
};
type FrameProgress = {
	readonly reflectionsSent: NonNegativeInt;
	readonly maxReflections: NonNegativeInt;
	readonly authorizedTargets: ReadonlySet<AbsolutePath>;
	readonly writtenPaths: ReadonlySet<AbsolutePath>;
	readonly lint: CheckOutcome;
	readonly test: CheckOutcome;
	readonly initialHead: CommitHash | null;
};
type Frame = {
	readonly id: FrameId;
	readonly input: EntryId;
	readonly files: ChatFiles;
	readonly model: PhysicalModelRef;
	readonly progress: FrameProgress;
};
type RunningCoder =
	| { readonly kind: 'ordinary'; readonly frame: Frame; readonly mode: Exclude<ChatMode, { kind: 'architect' }> }
	| { readonly kind: 'architect'; readonly frame: Frame; readonly editor: EditorPolicy }
	| {
		readonly kind: 'editor';
		readonly frame: Frame;
		readonly format: EditFormat;
		readonly parent: {
			readonly frame: Frame;
			readonly architectReply: EntryId;
			readonly resumeAt: 'after-reply-completed';
		};
	};
type Exchange = {
	readonly id: ExchangeId;
	readonly userEntries: readonly [EntryId, ...EntryId[]];
	readonly returnMode: ChatMode;
	readonly coder: RunningCoder;
	readonly assistantCommits: ReadonlySet<CommitHash>;
};
type Lifecycle =
	| { readonly kind: 'idle' }
	| { readonly kind: 'active'; readonly exchange: Exchange }
	| { readonly kind: 'interrupted'; readonly exchange: Exchange; readonly reason: string };
```

`userEntries` permits a Pi steering batch without creating a private queue. A single Aider invocation ordinarily has one entry. Handling a batch as one newly consumed exchange is a proposed Pi integration policy, not an Aider equivalence claim. See the queue limitation in PI-WIRING.md.

The editor's file-set value starts as a copy. Editor-only additions do not silently update the suspended architect file set. Aider copies the sets on `Coder.create` but explicitly returns only cost and commit hashes from the editor. One-shot mode restoration is different. It clones back from the one-shot coder, which carries its resulting file sets. Sources are `A/aider/coders/base_coder.py:153-189`, `architect_coder.py:22-48`, and `commands.py:1210-1232`.

### Canonical domain records

Private wire storage uses `customType` names derived from the branding module. The existing module does not yet define those names. Adding one canonical name there is proposed, not an existing API.

```typescript
type DomainSnapshot = {
	readonly schema: 1;
	readonly mode: ChatMode;
	readonly files: SerializedChatFiles;
	readonly lifecycle: SerializedLifecycle;
	readonly ignoredMentions: readonly AbsolutePath[];
	readonly neverAsk: readonly QuestionKey[];
	readonly assistantCommits: readonly CommitHash[];
};
type HistoryBoundary = {
	readonly kind: 'history-boundary';
	readonly frame: FrameId;
	readonly through: EntryId;
};
type ReplyReceipt =
	| { readonly kind: 'reply-intent'; readonly response: EntryId; readonly frame: FrameId }
	| { readonly kind: 'reply-finished'; readonly response: EntryId; readonly outcome: ApplyReport }
	| { readonly kind: 'reply-interrupted'; readonly response: EntryId; readonly reason: string };
type DialogueFact = {
	readonly kind: 'dialogue';
	readonly frame: FrameId;
	readonly purpose: 'reflection' | 'editor-input' | 'saved-edit' | 'architect-return' | 'shell-output' | 'test-output';
	readonly userText: string;
	readonly assistantAck: string | null;
};
```

`SerializedChatFiles` and `SerializedLifecycle` are private JSON forms of the domain values. Sets become arrays. They never include full transcript arrays. `QuestionKey` is the exact question plus subject pair. Group answers have batch-local scope, unlike `neverAsk`.

A `DialogueFact` is stored on a `custom_message`. Its content is the literal user message. Its details identify the owner, frame, and optional assistant acknowledgment. Request projection expands it to the required user/assistant pair. Real assistant replies stay in Pi message entries with actual model identity and usage. Synthetic acknowledgments have zero usage, no provider signatures, and never enter persisted billing totals as generated replies.

The latest valid snapshot on `getBranch()` supplies current domain state. Branch records after it supply receipts and history boundaries. Reconstructing it costs one branch scan. Use a local `Map<EntryId, ReplyReceipt>` and frame-indexed history cuts for that read, then discard them. This is a defined access pattern, not an eventual cache.

### Reply and application contracts

```typescript
type CompletedReply =
	| { readonly kind: 'complete'; readonly id: EntryId; readonly text: string }
	| { readonly kind: 'incomplete'; readonly id: EntryId; readonly reason: 'length' | 'error' | 'aborted' | 'deferred' | 'tool-use' };
type ApplyReport = {
	readonly preparedTargets: ReadonlySet<AbsolutePath>;
	readonly writtenPaths: ReadonlySet<AbsolutePath>;
	readonly reflection: Reflection | null;
	readonly notices: readonly Notice[];
};
type ReplyDecision =
	| { readonly kind: 'finished'; readonly dialogue: readonly DialogueFact[] }
	| { readonly kind: 'next-response'; readonly input: DialogueFact }
	| { readonly kind: 'interrupted'; readonly reason: string };
type Notice = { readonly level: 'output' | 'warning' | 'error'; readonly text: string };

interface ExchangeController {
	describeRequest(): RequestIdentity;
	projectRequest(view: RequestView): Promise<ChatChunks>;
	completeReply(reply: CompletedReply, signal?: AbortSignal): Promise<ReplyDecision>;
	changeChat(change: ChatChange): Promise<ChatListing>;
}
```

`RequestView`, `ChatChange`, and `ChatListing` contain domain messages, validated paths, and mode choices, not Pi events. Framework and storage values stay private to the Pi adapter. `completeReply` contains direct named calls. It does not return generic effects for another interpreter to execute.

### Named extension points for later features

```typescript
interface GitPolicy {
	initialHead(): Promise<CommitHash | null>;
	checkPermissionPath(path: AbsolutePath, alreadyEditable: boolean): Promise<PathGitStatus>;
	dirtyCommit(targets: ReadonlySet<AbsolutePath>, signal?: AbortSignal): Promise<CheckpointResult>;
	autoCommit(targets: ReadonlySet<AbsolutePath>, context: CommitContext, signal?: AbortSignal): Promise<CommitResult>;
}
interface RepositoryContext {
	messages(request: MapRequest, signal?: AbortSignal): Promise<readonly Dialogue[]>;
}
interface Validation {
	lint(targets: ReadonlySet<AbsolutePath>, signal?: AbortSignal): Promise<CheckOutcome>;
	test(signal?: AbortSignal): Promise<CheckOutcome>;
}
interface PermissionPolicy {
	decide(question: PermissionQuestion, signal?: AbortSignal): Promise<PermissionAnswer>;
}
```

These names represent domain decisions, not an arbitrary callback list. `CommitResult` must distinguish committed, unchanged, disabled, and failed. `CheckpointResult` must distinguish protected, unnecessary, and failed. A failed dirty checkpoint must not masquerade as permission to write. `CommitContext` distinguishes current frame conversation and the literal `Ran the linter`. Disabled Git, map, lint, and test implementations are explicit during the editing milestone. They do not claim parity with features not yet built.

`ApplyReport.preparedTargets` retains the Aider-selected target set even on partial application. `writtenPaths` adds reliable reporting rather than redefining that set. Later lint and commit selection use prepared targets unless a ledger row intentionally changes that behavior.

### Request chunks

```typescript
type RequestIdentity = {
	readonly exchange: ExchangeId;
	readonly frame: FrameId;
	readonly model: PhysicalModelRef;
	readonly mode: ChatMode;
};
type ChatChunks = {
	readonly identity: RequestIdentity;
	readonly system: PromptText;
	readonly examples: readonly Dialogue[];
	readonly readOnlyFiles: readonly Dialogue[];
	readonly repository: readonly Dialogue[];
	readonly done: readonly Dialogue[];
	readonly chatFiles: readonly Dialogue[];
	readonly current: readonly Dialogue[];
	readonly reminder: readonly Dialogue[];
};
```

`Dialogue` is a request-only role/content value. It distinguishes system, user, assistant text, images, and a retained opaque Pi contribution at the adapter boundary. Provider-specific messages are not the domain API. The adapter preserves original provider metadata on real assistant contributions.

## Module ownership

Proposed filenames are not created by this sketch.

| Module | Sole knowledge owned | What it does not own |
| --- | --- | --- |
| `lifecycle/index.ts` | Installation, Pi event decoding, boundary composition, route registration, UI adaptation, settings input | Edit algorithms or a model loop |
| `lifecycle/exchange.ts` | Exchange/frame state, response order, nested architect completion, direct calls to later Git/map/check policies | Provider transport, message persistence format, TUI rendering |
| `lifecycle/branch.ts` | Versioned domain records, branch reconstruction, receipt deduplication, source-entry/frame relationships | An external journal or a copy of transcript contents |
| `lifecycle/prompt.ts` | Aider ChatChunks, fresh file-content formatting, synthetic dialogue expansion, phase-specific request selection | Canonical history mutation or compaction scheduling |
| `lifecycle/permissions.ts` | Aider confirmation semantics and per-batch preferences | Terminal rendering or general filesystem sandboxing |
| `edit/*` | Existing and future pure format ports over `WorkingTree` | Model calls, user-exchange state |
| `branding.ts` | Pi names replacing Aider identifiers | Runtime branching |

`index.ts -> exchange.ts -> edit/*` answers how a response becomes writes. `index.ts -> prompt.ts` answers what reaches the model. `branch.ts` holds the private storage conversion, not another business-logic tier. Do not create phase-named modules such as `prepare`, `run`, and `finish`.

## Structural review

- Model the Domain puts nested editor ownership in `RunningCoder`, not in flags shared by hooks.
- Boundary Discipline confines unknown Pi records, CLI values, and format text to their adapters. Pure format and prompt functions do not depend on Pi.
- Separate Before Serializing Shared State gives editor and parent separate file sets and reflection counters. Pi owns their common transcript. User commands that change settings or file sets refuse while work is active rather than entering another write queue.
- Make Operations Idempotent adds response-entry receipts and an explicit interrupted state. A crash cannot safely replay arbitrary shell commands or append edits, so recovery stops for reconciliation instead of claiming exactly-once execution.
- Encode Lessons in Structure uses distinct `preparedTargets`, `writtenPaths`, and `CheckOutcome` values. They prevent the known false-success interpretations.
- Laziness Protocol and Minimize Reader Load reject an event/effect interpreter and phase plugin registry. A new format changes one format registry, not every Pi handler.

The installer has a small public interface with substantial hidden behavior. Private event adapters are necessary framework conversions, not independent lifecycle APIs. Imports outside `lifecycle/index.ts` must be disallowed by package exports and an import-boundary check when implementation begins.
