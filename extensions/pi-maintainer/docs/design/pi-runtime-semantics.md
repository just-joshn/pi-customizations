# Pi 1.1.0: `turn_end` entries, persistence, and continuation

## Overview

A `turn_end` handler returning `custom_message` entries and `continue: true` performs **two separate operations**:

1. **Commit the entries to the active session branch**, then rebuild finalized model context from that branch.
2. **Request one next model call in the current agent loop**. Existing tool-result, steering, or follow-up scheduling can satisfy that request; Pi does not necessarily add an extra call beyond those.

The continuation decision is **not a persisted job**. The entries survive according to the session’s storage policy; the scheduling decision exists only in the running loop.

**Evidence scope:** This is a read-only trace of the installed 1.1.0 documentation, declarations, and readable distributed JavaScript. No new execution or disk-persistence experiment was performed. The earlier prototype ran with `--no-session`: its observations support context inclusion and continuation, **not disk persistence**.

### Source-path notation

All citations below resolve under these exact installed directories:

- **`CA/`** = `/Users/josh-desktop/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/`
- **`CORE/`** = `/Users/josh-desktop/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-agent-core/`

Both packages identify themselves as 1.1.0 in `package.json:1–3`. Implementation citations refer to installed `dist/*.js`, not an upstream checkout.

## Key Concepts

### Public contract versus implementation

The public extension documentation names `turn_end` and `agent_before_settle` as actionable boundaries: handlers can propose `custom`, `custom_message`, `context_edit`, or `compaction` entries and request one next model call. It explicitly warns that unconditional continuation can loop.  
**Contract:** `CA/docs/extensions.md:117`.

The exact exported draft/result types are:

```ts
interface CustomEntryDraft {
  type: "custom";
  customType: string;
  data?: unknown;
}

interface CustomMessageEntryDraft {
  type: "custom_message";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: unknown;
}

interface ContextEditEntryDraft {
  type: "context_edit";
  targetId: string;
  replacement: ContextEditEntry["replacement"];
}

interface CompactionEntryDraft {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string | null;
  details?: unknown;
  usage?: Usage;
}

type SessionBoundaryDraft =
  | CustomEntryDraft
  | CustomMessageEntryDraft
  | ContextEditEntryDraft
  | CompactionEntryDraft;

interface BoundaryResult {
  entries?: SessionBoundaryDraft[];
  continue?: boolean;
}
```

`replacement` is `null` to omit the target, or `{ content: ContextEditableContent }`. Its content union covers user, assistant, tool-result, and custom-message content.  
**Declarations:** `CA/dist/core/extensions/types.d.ts:730–771`; `CA/dist/core/session-manager.d.ts:116–126`.

These are drafts—not arbitrary session entries. Handlers do not supply the new entry’s `id`, `parentId`, or timestamp.

### Three representations of a custom message

| Layer | Representation |
|---|---|
| Session history | `type: "custom_message"` entry |
| Runtime context | `role: "custom"` message |
| Provider context | `role: "user"` message |

`display: false` hides terminal rendering; it does **not** exclude content from the model. `details` and `customType` remain runtime/session metadata and are not included in the converted user message.  
**Implementation:** `CA/dist/core/session-manager.js:165–191`; `CA/dist/core/messages.js:57–66,89–96`.

### Boundary state is a proposal chain

Each handler sees:

- Proposed `entries` and `continue` from previous handlers.
- A context preview containing `contextEntries`, `contextMessages`, `llmMessages`, `pendingMessages`, and `canContinue`.
- `outcome: "completed" | "aborted" | "error"`.
- For `turn_end`, the response, tool results, turn index, and their persisted entry IDs.

**Declarations:** `CA/dist/core/extensions/types.d.ts:755–771,804–811`.

Importantly, returning `entries` **replaces the proposed array**, rather than automatically concatenating it. A composing handler should return something like:

```ts
return {
  entries: [...event.entries, myDraft],
  continue: true,
};
```

A later handler can replace those entries or explicitly return `continue: false`. Omitting either property preserves its previous value.  
**Implementation:** `CA/dist/core/extensions/runner.js:759–781`.

## How It Works

### 1. Pi finishes and stores the response and tool results

Agent-core awaits event listeners. Coding-agent persists finalized assistant/tool messages on `message_end`, recording their session-entry IDs.

The installed `AgentSession` wraps agent-core’s `finishTurn` hook. That hook dispatches the extension’s actionable `turn_end` **after response/tool-result persistence but before the ordinary public `turn_end` event**.

A marker prevents the subsequent public event from dispatching the extension boundary a second time.  
**Implementation:** `CORE/dist/agent.js:389–436`; `CA/dist/core/agent-session.js:750–768,488–533,895–900`.

Thus, this boundary is not merely an observer of an event already emitted to RPC clients.

### 2. Handlers run against an in-memory preview

The extension runner starts with `entries = []` and `continue = false`, then awaits handlers in registration order.

After every handler, it rebuilds the preview using an **in-memory `SessionManager` initialized from the current header and active branch**, and applies the proposed drafts to that manager.

If preview construction fails, Pi reports an extension error. A later handler can repair the proposal; if the final proposal is invalid, the runner returns no entries and no continuation. Handler exceptions are reported, rather than automatically aborting all dispatch.  
**Implementation:** `CA/dist/core/extensions/runner.js:759–806`; `CA/dist/core/agent-session.js:579–611`.

This is validation by applying/projecting drafts—not a comprehensive runtime schema validator for arbitrary JavaScript values.

### 3. Pi commits the final drafts

`_commitBoundaryDrafts()` applies the drafts to the real session manager, refreshes finalized context, and emits `entry_appended` for each resulting entry.

For `custom_message`, `appendCustomMessageEntry()`:

1. Generates an ID.
2. Uses the current leaf as `parentId`.
3. Adds an ISO timestamp.
4. Stores content, display, and details.
5. Appends the entry and advances the leaf.

Multiple returned entries therefore form an ordered parent/child chain.  
**Implementation:** `CA/dist/core/agent-session.js:579–601,636–640`; `CA/dist/core/session-manager.js:947–960,815–819`.

**Disk behavior:** `_persist()` returns immediately for an in-memory manager. For a persistent manager, it creates/flushed the initial JSONL file once a user or assistant message exists; later entries use synchronous `appendFileSync()`.

A normal `turn_end` already follows an assistant message, so the conversation prerequisite has been met. This is an actual file-write path, not merely an update to agent memory. However, the code does not perform an explicit `fsync`, and the multi-entry operation is not a transactional batch.  
**Implementation:** `CA/dist/core/session-manager.js:786–819`.

### 4. Pi checks whether continuation has runnable context

For `turn_end`, the installed implementation accepts continuation when any of these holds:

- Converted projected context contains a non-system message and its last role is not `assistant`.
- There is a pending context-only custom message.
- Agent-core has queued messages.

A newly appended `custom_message` ordinarily satisfies the first condition because it converts to a user message. A plain `custom` entry does not.

The check runs **after committing the drafts**. If it fails, Pi reports:

> `turn_end requested continuation without runnable model context`

and declines the explicit continuation. **The committed entries are not rolled back.**  
**Implementation:** `CA/dist/core/agent-session.js:515–520,613–647`.

`canContinue` is structural eligibility, not a guarantee that the eventual provider request will succeed or that later context transforms will preserve the preview unchanged.

### 5. Agent-core selects the next request

The wrapper returns `{ action: "continue" }` to agent-core. An existing host `finishTurn` hook returning `{ action: "end" }` takes precedence.

On a normal response, agent-core:

1. Emits public `turn_end`.
2. Uses natural tool-result or steering continuation if present.
3. Otherwise checks follow-up messages.
4. Otherwise fulfills explicit continuation with one context-only turn.

Natural scheduling consumes the continuation decision; it does not leave an extra request waiting behind it.  
**Implementation:** `CA/dist/core/agent-session.js:522–533`; `CORE/dist/agent-loop.js:179–215`.

Before the next response, coding-agent rebuilds context from the canonical session projection, with possible compaction and tool/prompt refresh. Immediately before each provider request, it installs canonical projected context again. The message then passes through context transformation and LLM conversion.

This is why the returned custom message reaches the next request without another user `prompt()` call. It also means `before_agent_start` is **not rerun for each `turn_end` continuation**.  
**Implementation:** `CA/dist/core/agent-session.js:424–454,535–567,1588–1591,1631`; `CORE/dist/agent-loop.js:91–141,260–275`.

## What Changes Across Lifecycle Boundaries

### Abort and error responses

**Entries and continuation have different fates.**

Agent-core calls `finishTurn` even for responses with `stopReason: "error"` or `"aborted"`, so the boundary can still commit entries. It then emits `turn_end` and `agent_end` and returns, **ignoring the continuation decision** on that response.  
**Implementation:** `CORE/dist/agent-loop.js:143–153`.

A session-level `abort()`:

- Marks the active session run aborted.
- Cancels retry, compaction, and branch-summary work.
- Aborts the agent’s signal.
- Waits for session idle.

The session’s outer loop checks that abort flag before automatic post-run continuation and before-settle processing. Already committed entries remain.  
**Implementation:** `CA/dist/core/agent-session.js:1909–1926,1380–1413`.

Two qualifications matter:

- Cancellation is cooperative. An awaited handler that ignores its signal can delay `abort()` completion.
- If abort arrives during a normal-response boundary, the boundary wrapper itself has no abort short-circuit. Agent-core can proceed toward another request with the already-aborted signal. The source does **not** justify a stronger claim that no provider function can be entered after cancellation.  
  **Implementation:** `CA/dist/core/agent-session.js:522–533`; `CORE/dist/agent-loop.js:179–210,260–275`.

Error retries are separate session-level machinery; an error turn’s `continue: true` is not what schedules them.  
**Implementation:** `CA/dist/core/agent-session.js:1415–1450`.

### Branch switch within the same session

`navigateTree()` refuses navigation while streaming or compacting. It changes the active leaf and rebuilds context; it does not delete the abandoned branch’s entries.

Consequently, a custom message remains in raw history but only contributes to model context when the selected branch/projection includes it. Switching back can restore that contribution.

A useful special case: selecting a `custom_message` in tree navigation moves the leaf to its **parent** and puts its content into the editor, like selecting a user message. It does not continue after that selected custom message.  
**Implementation:** `CA/dist/core/agent-session.js:3199–3205,3302–3364`; `CA/dist/core/session-manager.js:1155–1174`.

Ordinary leaf movement alone is not persisted as a navigation record. On reopening a file, indexing chooses the last appended entry as the leaf. A later append or branch summary records the new ancestry.  
**Implementation:** `CA/dist/core/session-manager.js:732–742,1161–1195`.

Switching to a **different session** is a runtime replacement: Pi first aborts and settles outgoing work, emits shutdown, disposes the old session, opens/builds the replacement, and rebinds consumers. The old loop’s continuation is not transferred.  
**Implementation:** `CA/dist/core/agent-session-runtime.js:102–145`.

### Reload

Extension reload retains the existing `AgentSession` and `SessionManager`, but:

1. Emits `session_shutdown` with reason `"reload"`.
2. Invalidates the old extension runner.
3. Reloads resources and rebuilds the runner.
4. Emits `session_start` with reason `"reload"` when bindings exist.

Committed entries remain; extension closure state must be reconstructed from session history. Use the active branch for branch-sensitive state, not every entry in the file.  
**Contract:** `CA/docs/extensions.md:50,214–215,222–237`.  
**Implementation:** `CA/dist/core/agent-session.js:2936–2977`.

The interactive `/reload` command refuses to run while streaming or compacting. The lower-level `session.reload()` itself does not provide that guard or await idle; print/RPC command contexts delegate directly to it. Do not assume arbitrary concurrent SDK/extension reload calls are serialized safely.  
**Implementation:** `CA/dist/modes/interactive/interactive-mode.js:5357–5365`; `CA/dist/modes/print-mode.js:74–76`; `CA/dist/modes/rpc/rpc-mode.js:252–254`.

### Print versus RPC

The persistence and continuation mechanism is shared; mode does not change it. `--no-session`, not print/RPC selection, disables disk persistence.

| Aspect | Print / JSON one-shot | RPC |
|---|---|---|
| Prompt lifetime | Awaits `session.prompt()`, including automatic continuation | Acknowledges prompt acceptance; work continues asynchronously |
| Completion | Exits after supplied prompts finish | Client should wait for `agent_settled`, not merely `agent_end` |
| Boundary entries | JSON emits `entry_appended`; text mode does not expose intermediate events | Emits `entry_appended` over stdout |
| Handler errors | stderr | `extension_error` protocol records |
| UI | No interactive UI | Supported UI requests can be forwarded to client |

**Implementation:** `CA/dist/modes/print-mode.js:52–94,104–141`; `CA/dist/modes/rpc/rpc-mode.js:258–273,298–330`.  
**Contract:** `CA/docs/cli-integration.md`; `CA/docs/rpc.md`.

A text-print edge case is worth noting: the implementation prints text only if the **last projected message** is an assistant message. If a handler appends a custom message but no successful continuation follows, print mode does not search backward for an earlier assistant response.  
**Implementation:** `CA/dist/modes/print-mode.js:110–127`.

## Where Things Live

| Responsibility | Installed implementation |
|---|---|
| Public boundary types | `CA/dist/core/extensions/types.d.ts:730–811` |
| Handler chaining and preview error handling | `CA/dist/core/extensions/runner.js:759–806` |
| Boundary dispatch, commit, continuation eligibility | `CA/dist/core/agent-session.js:488–647` |
| JSONL persistence | `CA/dist/core/session-manager.js:786–819,947–960` |
| Branch/context projection | `CA/dist/core/session-manager.js:165–281` |
| Custom-to-user conversion | `CA/dist/core/messages.js:89–96` |
| One-next-request scheduling | `CORE/dist/agent-loop.js:143–215` |
| Session-level recovery and settlement | `CA/dist/core/agent-session.js:1380–1477` |

## Gotchas and Remaining Limits

- **`continue: false` is not “stop the agent.”** It withdraws the boundary’s explicit request; normal tools and queues may still continue.
- **Boundary entries emit `entry_appended`, not synthetic `message_start`/`message_end` pairs.** Consumers reconstructing history only from message events will miss them. The implementation is broader than the `entry_appended` description in `docs/json.md`, which mentions `pi.appendEntry()`.
- **Preview IDs are not committed IDs.** The preview uses a separate in-memory manager and regenerates draft entry IDs during each rebuild and final commit. Do not treat a preview-only draft ID as a durable target.
- **No durable continuation ticket exists.** Reload/restart can recover committed content, not resume a persisted `continue` flag.
- **Abort queue wording is inconsistent across evidence.** `docs/rpc-commands.md` says abort continues remaining queued messages; the traced session loop suppresses automatic post-run continuation when its abort flag is set. The narrow supported conclusion is that abort does not itself clear queues, and an aborted response cannot honor this boundary’s continuation decision. Exact queued-abort interleavings were not exercised here.
- **Disk durability is source-traced, not experimentally verified in this task.** The prior `--no-session` prototype must not be cited as proof of JSONL persistence or restart recovery.