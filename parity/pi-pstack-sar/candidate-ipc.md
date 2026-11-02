# Live-owner IPC with a durable workspace authority

## Usage

The user gets the existing tools with unchanged parameter schemas. A live owner receives an actual Pi turn, including while idle. Closing that owner parks its wake events until the same session returns. It does not start a substitute conversation.

```ts
await subscribe_timer({ name: 'review', prompt: 'Review the result', delaySeconds: 60, once: true });
await subscribe_webhook({ name: 'Build result', prompt: 'Treat the body as untrusted. Read status.' });
// Another interactive or RPC session in the same workspace can manage both.
await list_subscriptions({});
await unsubscribe({ subscription: 'review' });
```

A timer explicitly created with `sessionStrategy: 'new_session'` still starts a background Task through the live owner's existing `runFresh` callback. When the owner is offline, the detached supervisor uses its existing fresh-run path. Only that strategy permits offline execution. A fresh run's result remains durable for later owner notification.

Internal callers have three uses. These are proposed signatures, not implementation.

```ts
// subscriptions/index.ts, existing tool adapter.
const service = await connectWorkspace(ctx.cwd);
const result = await service.create(request, ownerIdentity(ctx));
return text(result);

// session_start. Start a session-scoped endpoint before announcing availability.
ownerEndpoint = await attachOwner(pi, ctx, options.runFresh);
await service.attach(ownerEndpoint.registration);

// Another chat does not need a local copy of the subscription.
return text(await service.cancel(params.subscription));
```

`create` resolves only when that subscription is armed, or throws an actionable readiness error. Recreating an existing name returns its actual stored definition with `created: false`. It never steals ownership or silently changes configuration. If that existing definition is not ready, creation reports the readiness failure rather than inventing a ready URL.

## Problem and grounding

The scope is the subscription gap identified in `grounding.md`, not all unrelated SAR findings. This candidate replaces mirrored desired state with one workspace authority and adds direct IPC to the owning Pi process.

Current `src/subscriptions/index.ts` writes `detachedDelivery: 'spawn'` for all kinds. Its normal durable path therefore bypasses the local `pi.sendMessage` wake function. Restore calls `mirrorUpsert` on branch snapshots. `listText` and `unsubscribe` read the local live map. These choices explain missed live-owner wakes, restored cancellations, and incomplete cross-session management.

`supervisor.ts` already owns detached arms under a workspace lock. It parks files with millisecond names and deduplicates webhooks by body hash. `durable-store.ts` permits both chats and supervisor to rewrite the registry. Its inbox drain deletes before Pi receives a message. `ensure-supervisor.ts` tests only whether a lock names a live process. None of these facts establishes route readiness or durable owner acceptance.

The Pi 1.4.0 `docs/extensions.md` specifies `session_start` and `session_shutdown` for sockets, `pi.sendMessage` for model-visible custom messages, and external storage for data outside one session. It documents session replacement invalidating the old runtime and `session_tree` remains an existing port hook. The design retains those integration points. It does not use cross-process transcript writing, a second RPC writer attached to the owner, or `pi.events` as a cross-process bus.

Existing `subscriptions.test.ts` establishes wake options `{ triggerTurn: true, deliverAs: 'followUp' }`, authenticated JSON-object POST handling, credential secrecy, and branch restoration behavior. `supervisor-reconcile.test.ts` currently asserts that identical POST bodies collapse. That assertion must change because two authenticated POSTs are two events.

## Shape

### Ownership and data

The detached supervisor is the only writer of authoritative subscription state and pending deliveries. Chats send commands over its local control endpoint. Each live Pi owner hosts a small local delivery endpoint. The supervisor sends event IDs there immediately after durable event creation and retries unacknowledged IDs. Reconnection also triggers delivery. No session hook must happen after the event to wake a live chat.

Keep one durable workspace snapshot containing subscriptions, occurrence cursors, pending events, and bounded operation receipts. Commit a transition by writing a unique temporary file, flushing it, renaming it, and flushing its directory. A malformed snapshot is an error, never an empty workspace. This one-writer snapshot is deliberately smaller than a database or generic job framework. It gives atomic once completion plus event creation without a multi-file transaction protocol.

Use the existing workspace identity/path resolver so the management scope matches current name deduplication. Canonicalize aliases before selecting an authority. Do not introduce a second definition based on Git worktrees.

```ts
// Private domain types. Existing validated Subscription config is reused.
type OwnerId = string & { readonly ownerId: unique symbol };
type EventId = string & { readonly eventId: unique symbol };
type OperationId = string & { readonly operationId: unique symbol };

type DeliveryTarget =
	| { kind: 'owner'; owner: OwnerId }
	| { kind: 'fresh'; owner: OwnerId };

type Lifecycle =
	| { state: 'active' }
	| { state: 'completed'; eventId: EventId }
	| { state: 'cancelled'; at: number }
	| { state: 'expired'; at: number };

type StoredSubscription = {
	subscription: Subscription;
	owner: OwnerId;
	delivery: DeliveryTarget;
	lifecycle: Lifecycle;
	cursor: OccurrenceCursor;
};

type PendingEvent = {
	id: EventId;
	subscriptionId: string;
	owner: OwnerId;
	content: string;
	createdAt: number;
	delivery: DeliveryTarget;
};

type WorkspaceState = {
	version: 2;
	revision: number;
	subscriptions: Record<string, StoredSubscription>;
	pending: Record<string, PendingEvent>;
	receipts: Record<string, CommandReceipt>;
};

type Readiness =
	| { state: 'ready'; revision: number; url?: string }
	| { state: 'error'; revision: number; message: string };
```

`OccurrenceCursor`, `CommandReceipt`, and storage decoding stay private to `durable-store.ts`. The cursor records schedule progress or the GitHub baseline. It is not merely the last delivered event ID. A completed once entry cannot become active because its delivery is still pending.

The authority derives an in-memory active-name index from the snapshot at load and updates it inside transitions. ID lookup, event acknowledgment, and cancellation use keyed records. An owner-to-pending index is derived at load for reconnect delivery. No secondary index persists independently.

`OwnerId` represents a persistent Pi session identity within the workspace, not a PID or current tree leaf. Bind it to the session ID and canonical session file identity available through the session manager. Fail creation if no resumable identity exists. Forked sessions have new identities. Branch navigation within the same session does not transfer ownership. Print and JSON runs retain the existing subscription rejection.

### Signatures and boundaries

```ts
// subscriptions/index.ts exposes this internally to the existing tool handlers.
interface WorkspaceSubscriptions {
	create(request: CreateRequest, owner: OwnerIdentity): Promise<CreateResult>;
	list(): Promise<SubscriptionView[]>;
	cancel(idOrName: string): Promise<CancelResult>;
	attach(registration: OwnerRegistration): Promise<void>;
}

async function connectWorkspace(cwd: string): Promise<WorkspaceSubscriptions> {
	throw new Error('not implemented');
}

// Owner endpoint remains private. No socket or wire fields enter tool schemas.
async function attachOwner(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	runFresh: SubscriptionOptions['runFresh'],
): Promise<{ registration: OwnerRegistration; close(): Promise<void> }> {
	throw new Error('not implemented');
}

// durable-store.ts, imported only by supervisor.ts.
function transition(
	state: WorkspaceState,
	command: WorkspaceCommand,
	now: number,
): { state: WorkspaceState; result: CommandResult; effects: Effect[] } {
	throw new Error('not implemented');
}
```

Use operation IDs for retryable control requests. A timeout after a committed create or cancellation can return the original receipt on retry. The internal client owns those IDs. Tool callers do not coordinate retry stages.

Both control and owner transports use local Unix sockets under a private short runtime directory, with mode 0700 on the directory and private discovery credentials. Bound frame size and request deadlines. Parse and authenticate IPC at the boundary, then dispatch domain commands. Discovery includes workspace identity, protocol version, and a random process incarnation. Do not treat a PID as a ready service or trust a stale socket path. Unix socket support matches this local macOS environment. Windows named-pipe support is outside this sketch's validated platform scope.

An owner registration includes an unpredictable endpoint capability and a runtime generation. The owner publishes it only after listening. The supervisor permits only one active registration per persistent owner. A new runtime must prove the old endpoint is unavailable or close it before replacing its registration. If two processes have opened the same Pi session, reject the second attachment instead of creating two delivery writers. Shutdown closes the endpoint and detaches only its own generation. Every handler checks that its captured generation is still current before invoking Pi.

### Event and delivery transitions

1. A timer, GitHub poll, or webhook produces an occurrence through the authority's serialized command queue. No asynchronous callback mutates snapshot state directly.
2. The authority rechecks active lifecycle and expiry. It adds a pending event and advances the cursor in one durable transition. A once occurrence also sets `completed` in that same transition. The scheduler never re-arms it.
3. After commit, the supervisor contacts the registered owner's endpoint. For `owner`, that endpoint calls the existing `pi.sendMessage` with the existing wake type and options. For `fresh`, it calls the existing `runFresh` callback.
4. The receiver acknowledges the event ID only after Pi accepts the wake call, or the fresh callback accepts the background Task. The authority removes that pending event in another durable transition.
5. Connection failure or timeout leaves the pending event intact. Retry while the owner is live. Reattach immediately retries that owner's pending events, including events of completed once subscriptions.

No protocol here can make Pi's in-memory follow-up queue and the authority snapshot one atomic commit. The promised delivery is at least once, not exactly once. An acknowledgment lost after `sendMessage` can cause a duplicate wake. Keep an in-flight/completed-ID map within the owner runtime to suppress ordinary IPC retransmissions. Include event ID in message details so resumed-session history can suppress events already recorded by Pi. Do not append a separate receipt before sending and then assume the wake happened. A process crash after queue acceptance but before Pi records the custom message remains an ambiguity. This limitation must be visible in documentation and failure tests.

Fresh-run dispatch has the same ambiguous acceptance boundary. Never fall back from a timed-out live-owner fresh dispatch to detached spawning immediately. Retry the same event against that runtime first. After proven runtime death, allow detached execution with the same event ID and record that an interrupted prior run may have started. Offline fresh results must be stored and later delivered to the owner through this same queue, not appended to its transcript by the supervisor.

### Offline behavior and cancellation

For `wake_self`, GitHub, and webhooks, owner absence means durable queueing. No headless Pi runs in the owner's place. The supervisor keeps collecting events while its process runs. A stopped machine cannot accept HTTP or observe GitHub changes. On restart, repeating timers resume cadence without replaying every missed tick, while an overdue, unexpired once timer produces its sole occurrence. Persist GitHub baselines with emitted events so supervisor restart does not silently redefine the baseline.

Expiration stops new occurrences. Already accepted events remain deliverable after expiry. Cancellation is different. It records a tombstone, disarms the source, and discards not-yet-dispatched pending events in the same transition. An IPC call already handed to Pi can finish after unsubscribe. Return that limitation rather than promising to retract queued model turns. Serialized dispatch admission defines the boundary between pending and already dispatched work.

Name reuse creates a new ID after cancellation, completion, or expiry. Old ID tombstones remain so old branch data cannot revive them. A completed once entry disappears from the default active list, but its pending wake remains visible as delivery status until accepted. List and `/routines` derive their views from authoritative workspace state and include owner-online, queued-delivery, readiness, and last-error information through the existing textual results. Public parameter schemas do not change.

If the supervisor cannot be reached, list may show a clearly marked committed disk snapshot. Cancellation must either reconnect to a ready authority and commit or throw. It cannot report success after mutating a chat-local cache.

### Restore and migration

`session_start` attaches the owner and requests its queued events. `session_tree` refreshes views without importing branch subscription definitions. `session_shutdown` idempotently detaches and closes sockets. The session's `pstack/subscriptions` entry becomes informational metadata, not desired state.

Upgrade the existing workspace registry once under exclusive authority ownership. Preserve stored IDs and valid owner associations. Reinterpret delivery according to actual config, never the legacy blanket `detachedDelivery: 'spawn'`. Missing owners remain visibly blocked and require explicit operator recreation rather than arbitrary adoption. Do not import entries solely from old branch snapshots. A legacy registry already lacking a cancelled entry must remain lacking that entry. Existing legacy state cannot prove whether a particular removed once event was previously delivered, so migration reports that uncertainty rather than synthesizing another occurrence.

### Readiness

Keep `ensure-supervisor.ts`, but replace PID-only readiness with an authenticated control handshake. Startup errors propagate to the requesting tool. The supervisor binds its control endpoint under its lifetime workspace lock, loads and validates committed state, and only then answers ready.

Per-subscription creation waits for source readiness. A timer needs a scheduled arm. A webhook needs credential creation, route installation, and successful listener bind with the actual port. A GitHub watcher reports initial baseline failure as an actionable error. A live lock with `EADDRINUSE`, missing credentials, a dead binary, an incompatible protocol, or an unarmed route cannot produce a successful creation response.

Reserve the name while arming. Commit the active subscription only after arming succeeds. If arming fails, remove provisional resources and return the error. On restart, existing subscriptions can be unready with a stored error and retry; they do not disappear. A duplicate name joins the existing arming result rather than creating another source. Validate webhook slug collisions across active routes before reservation, including distinct names that normalize to one slug.

### Webhook event identity

Keep authentication, the 64 KiB limit, JSON-object validation, header allowlist, and escaped `webhook_event` block. Change the internal route callback to return a promise for durable acceptance. After authentication and body validation, allocate a random UUID for this request. Use that UUID as event ID, never the digest or timestamp. The digest remains audit data.

Reply 200 only after the authority commits that event. Commit failure returns a server error without claiming acceptance. Equal authenticated bodies, including equal bodies received in the same millisecond, create two pending events. Transport retries for one accepted request reuse its event ID. A sender's second HTTP request is a new event, including when its first response was lost. Exactly one durable event per successfully accepted POST does not imply exactly one model execution after a crash.

## Ownership module map

- `src/subscriptions/index.ts` keeps tool schemas, rendering, and Pi lifecycle wiring. It no longer schedules sources, rewrites desired state, or drains files destructively.
- `src/subscriptions/supervisor.ts` owns command serialization, source arms, readiness, endpoint registrations, and dispatch decisions. Its existing timer and GitHub logic remains here.
- `src/subscriptions/durable-store.ts` owns the versioned snapshot, pure transitions, validation, migration, and crash-safe commits. Only the supervisor imports its mutating functions.
- A small new `src/subscriptions/owner-ipc.ts` owns local socket framing, authentication, the client connection, and the Pi-side delivery endpoint. It does not own subscription lifecycle policy.
- `src/subscriptions/ensure-supervisor.ts` keeps detached startup and adds a real control handshake. It does not add a second scheduler fallback.
- `src/subscriptions/webhook.ts` keeps HTTP security and parsing. It awaits durable event acceptance and does not choose a delivery strategy.
- `supervisor-main.ts` keeps the existing detached fresh-run adapter. Preserve existing raw RPC process cleanup and dialog cancellation behavior.

A tool command traverses the adapter, IPC, and authority. The authority owns its persistence directly. There is no repository-service-controller stack or reusable event-bus framework.

## Rationale

Workspace-wide deduplication and cancellation need a single ordered answer. Per-chat desired files cannot decide simultaneous name creation without coordination. Per-chat endpoint state is separable and remains session-owned. The canonical subscription state is genuinely shared, so the supervisor serializes its mutations. This follows separate-before-serializing-shared-state without making chats compete over a registry file.

Make-operations-idempotent changes once handling from claim-before-send to atomic event creation plus completion. Boundary-discipline keeps socket messages and disk versions private. The public caller sees create, list, and cancel, not stage, persist, arm, send, and acknowledge operations. This interface hides readiness and delivery retries rather than requiring each tool adapter to repeat them.

## Synthesis decision

This is the IPC candidate for the parent's comparison. It is not a synthesized winner. Its defining choice is direct supervisor-to-owner delivery with one authoritative writer. No sibling candidate was inspected or adapted.

## Tradeoffs accepted

- We accept a session-scoped socket and a supervisor control protocol in exchange for immediate live-owner wakes without periodic inbox polling.
- We accept supervisor availability as a prerequisite for successful mutation in exchange for authoritative workspace-wide management.
- We accept whole-snapshot writes at current subscription scale in exchange for atomic lifecycle and event transitions without a new database dependency.
- We accept at-least-once wake delivery and explicitly reported crash ambiguity in exchange for retaining Pi's existing queue APIs.
- We accept queued events consuming local disk while an owner remains offline. Disk exhaustion fails new acceptance and appears as an error. Accepted events are never silently evicted.
- We retain terminal tombstones instead of compacting them until a safe policy is justified. Ordinary tool calls do not need a tombstone management API.

## Alternatives considered

A durable inbox polled inside each owner hides delivery complexity behind fewer transport methods and avoids an owner socket. It adds a wake latency and requires an always-running poller in every owner. IPC is preferable for this candidate's immediate live-owner requirement.

Opening the owner's session file from a detached Pi process avoids a new delivery endpoint but violates single-writer session ownership. It also substitutes a new agent runtime for the actual live owner.

Letting every chat rewrite a locked registry keeps the client thin but spreads lifecycle and readiness rules across chat and supervisor. The caller must understand stale snapshots and claim ordering. The single authority hides more policy behind the same tool calls.

## Red-flag screen

- No shallow stage API. One create call owns reservation, readiness, and commit.
- No transport leakage. Public tool schemas remain unchanged and wire records stay private.
- No temporal module split. Store owns invariants and supervisor owns source lifecycle, rather than separate load, validate, and save services.
- No pass-through service chain. IPC is a necessary process boundary with authentication, deadlines, and retry identity.
- No split authoritative writers. Remove chat-side `upsertDesired`, branch restore writes, and supervisor registry races in the implementation wave.
- No second scheduler. Delete the in-process arming fallback instead of maintaining two implementations.
- No importable mutation internals. Add an import-boundary check limiting store mutation imports to the supervisor and its tests. Existing direct helper tests need migration.
- No hand-synced strategy tables. Derive `owner` versus `fresh` once from the validated config at creation and migration.

## Failure tests

These are proposed acceptance tests, not claims of executed verification.

1. Start a real interactive or RPC owner and detached supervisor. Let the owner settle. Fire a timer and authenticate a webhook POST. Assert a custom-message-triggered owner turn without resume, tree navigation, or another user prompt.
2. Keep the owner busy. Fire an event. Assert a follow-up turn in that owner, never a headless replacement.
3. Close the owner. Accept two identical authenticated POSTs in the same millisecond. Restart the supervisor and resume that exact owner. Assert two distinct event IDs and two deliveries. A different session receives neither.
4. Run an explicit fresh timer with a live owner. Assert the existing Task callback receives it. Repeat with the owner offline and assert detached fresh execution plus a durable later result notification.
5. Complete an offline once timer, then reopen an old branch containing its original definition. Assert no re-arm and one retained pending occurrence. Repeat for cancelled and expired entries.
6. Create in session A and list and unsubscribe in B. Assert identical IDs and committed cancellation. Race same-name creation across processes and assert exactly one active ID.
7. Crash after snapshot commit but before IPC. Assert retry. Lose the IPC acknowledgment and assert runtime duplicate suppression. Crash around Pi queue acceptance and assert the documented at-least-once behavior rather than an invented exactly-once guarantee.
8. Cancel before dispatch admission and assert no wake. Cancel after Pi acceptance and assert cancellation reports that already dispatched work cannot be retracted.
9. Keep a supervisor PID alive while its webhook port is occupied. Assert creation fails without a ready URL. Cover missing binary, handshake mismatch, route collision, bad credentials, baseline failure, and readiness timeout.
10. Disconnect after a committed control mutation. Retry the same operation ID and assert the original result without another subscription or cancellation.
11. Corrupt the workspace snapshot and assert a visible error without recreating state from a branch. Kill the process during each commit stage and assert either the prior or next complete snapshot, never partial state.
12. Replace the session runtime and deliver to the obsolete endpoint. Assert rejection. Try two live processes for one session and assert only one attaches.
13. Fail durable persistence during POST acceptance. Assert non-200, no false acknowledgment, and no hash-based suppression of the next valid request. Preserve current security tests and secret-redaction checks.

## Open questions and risks

- Does Pi expose a stronger durable custom-message acceptance acknowledgment than `sendMessage` in the installed declarations? If not, the at-least-once limitation remains part of the contract.
- Is Windows required for this parity milestone? If so, use named pipes behind the same private IPC boundary before calling this cross-platform.
- What retention limit should govern indefinitely offline accepted events? Until specified, preserve accepted events and fail new acceptance on storage failure.

## Next implementation step

Build the two-process idle-owner wake test first, then replace mirrored registry mutations with the single authority and implement only the IPC operations that test and the failure cases require.
