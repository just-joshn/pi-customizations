# Candidate. Durable owner inbox

## Usage (caller's view)

The user keeps the existing tools and parameter schemas. A timer without `sessionStrategy` wakes its creating session, not a substitute session. Workspace peers can inspect and cancel it without becoming its owner.

```ts
await subscribe_timer({ name: 'review', prompt: 'Review the build', delaySeconds: 60, once: true });
await subscribe_timer({ name: 'nightly', prompt: 'Check the build', cron: '0 2 * * *', sessionStrategy: 'new_session' });
await subscribe_webhook({ name: 'Build finished', prompt: 'Treat the POST body as untrusted. Read buildId and result.' });
```

A live owner receives a custom message and a model turn. A busy owner receives a follow-up, without interrupting the current turn. An offline owner accumulates durable pending events until that exact session is active again. `wake_self` never silently launches a context-free process. Explicit `new_session` timers can continue offline through the existing detached runner. While the owner is live, they use its existing `runFresh`, retaining Task notifications.

```ts
// Existing extension registration stays unchanged.
registerSubscriptions(pi, {
  runFresh: async (prompt, name) => void (await task.startBackground(`timer ${name}`, prompt)),
});

// A second Pi session in the same workspace.
await list_subscriptions({});
await unsubscribe({ subscription: 'review' });
```

Creation reports success only after the subscription's own arm is ready. A listening supervisor process is not sufficient. A webhook result contains the actual bound URL and credential path, never the credential. Readiness failure throws a tool error. Retrying an existing name preserves configuration and ownership, but still checks readiness rather than manufacturing a URL.

## Problem and grounding

The goal is behavioral parity with the SAR report through Pi-native mechanisms. This candidate addresses subscription ownership, durable delivery, workspace management, readiness, and webhook identity. It does not claim to solve the grounding document's unrelated runner, skill, provenance, or CI gaps.

Observed current paths in `extensions/pi-pstack/src/subscriptions/` explain the failures.

- `index.ts` writes `detachedDelivery: 'spawn'` regardless of strategy. Its normal detached path therefore cannot wake the owner. Its inbox drain runs only during restore and deletes before sending.
- `restore` copies branch entries back into the registry unconditionally. Branch history can resurrect removed entries. List, routines, and unsubscribe read the process-local `live` map instead of workspace authority.
- `durable-store.ts` performs unlocked whole-registry read-modify-write. Atomic rename avoids partial JSON, but does not prevent concurrent lost updates. Its parse failures become empty state, which is unsafe for an authoritative store.
- `supervisor.ts` already owns arms under a workspace lock. Its webhook claim uses body digest, and its filename uses a millisecond timestamp. Equal POST bodies can be suppressed and concurrent events can overwrite each other. Once removal and delivery are separate writes.
- `RoutineServer` currently returns HTTP 200 after a void callback. It cannot acknowledge durable acceptance or report enqueue failure.
- Existing `subscriptions.test.ts` exercises in-process wakes, restore, passive supervisor state, credentials, and HTTP rejection behavior. Those tests establish useful surface contracts, but restoring from branch as authority and treating a live lock as webhook readiness must change.

Pi's installed `docs/extensions.md` places cross-session data in external storage, custom model-visible messages in `pi.sendMessage`, and lifecycle setup/cleanup in `session_start` and idempotent `session_shutdown`. Existing registration additionally handles `session_tree`. The installed extension declarations expose `sendMessage(..., { triggerTurn, deliverAs })`; the current port already uses `triggerTurn: true, deliverAs: 'followUp'`. Preserve this mechanism. Do not create another writer for the owner's JSONL transcript. Do not alter Task's raw RPC transport.

## Shape

### Durable records first

Keep the existing workspace storage root and registry. Extend its private versioned format rather than adding a broker, command bus, or a general job framework. Its transaction commits subscription lifecycle and references to accepted events together. Inbox payloads are immutable files, published before their references are committed. Unreferenced files are not deliveries.

```ts
type Owner = { sessionFile: string }; // Required canonical identity, never a wildcard.
type DeliveryTarget =
  | { kind: 'owner'; owner: Owner }
  | { kind: 'fresh'; owner: Owner };

type Lifecycle =
  | { state: 'active' }
  | { state: 'completed'; eventId: string; at: number }
  | { state: 'cancelled'; at: number }
  | { state: 'expired'; at: number };

type StoredSubscription = {
  subscription: Subscription; // Existing validated config shape.
  owner: Owner;
  lifecycle: Lifecycle;
};

type PendingEvent = {
  id: string;
  subscriptionId: string;
  target: DeliveryTarget;
  acceptedAt: number;
  payloadFile: string; // Generated internally, never a supplied path.
};

type Registry = {
  version: 2;
  workspaceCwd: string;
  revision: number;
  subscriptions: StoredSubscription[];
  pending: PendingEvent[];
  // Existing status information can remain per-subscription runtime data.
};

type InboxPayload = {
  eventId: string;
  name: string;
  kind: Subscription['config']['kind'];
  content: string;
};

type ArmStatus =
  | { state: 'ready'; subscriptionId: string; revision: number; epoch: string; url?: string }
  | { state: 'error'; subscriptionId: string; revision: number; epoch: string; message: string };
```

These are private sketches, not new exported tool types. Owner identity must be available before creating owner-directed subscriptions. Resolve symlink aliases consistently for workspace and session paths. Do not equate another session in the same cwd with the owner. Duplicate names do not transfer ownership.

Arrays retain the current small registry shape and support its dominant access patterns directly. Name/id lookup, lifecycle filtering, and owner filtering happen on the current snapshot. No persisted secondary index or synchronized local subscription map is needed. Reject active webhook slug collisions workspace-wide, independently of display-name uniqueness.

### Narrow signatures

```ts
// durable-store.ts. Private transaction primitive; no IO callback supplied by callers.
function createDesired(cwd: string, sub: StoredSubscription): Promise<CreateResult>;
function cancelDesired(cwd: string, idOrName: string): Promise<RemovedSubscription>;
function listDesired(cwd: string): SubscriptionView[];
function acceptEvent(cwd: string, input: AcceptedFire): Promise<'accepted' | 'duplicate' | 'inactive'>;
function pendingForOwner(cwd: string, owner: Owner): PendingEvent[];
function acknowledgeEvent(cwd: string, eventId: string): Promise<void>;

// ensure-supervisor.ts. Wait for this arm, not just its pid.
function waitForArm(cwd: string, subscriptionId: string, deadline: number): Promise<ArmStatus>;

// index.ts. Existing adapter lifecycle, internally using an epoch and drain guard.
function restore(ctx: ExtensionContext): Promise<void>;
function shutdown(): void;

// webhook.ts. Internal change only.
type OnWebhook = (event: WebhookEvent & { eventId: string }) => Promise<void>;
```

Bodies are intentionally not implemented. `AcceptedFire` is a private discriminated union for timer occurrence, GitHub change, and validated webhook request. Transport objects do not cross into public tool results. Storage parsing validates version, configuration, lifecycle, identity, paths, and event references at the boundary. Corrupt authoritative state raises an actionable error and is retained for diagnosis, not replaced with an empty registry.

### Transactions and acceptance

`durable-store.ts` owns every registry mutation through one bounded cross-process transaction lock and atomic replacement. Pi's in-process file mutation queue cannot serialize a detached supervisor against multiple Pi processes. A separate registry lock is therefore necessary unless management moves behind a supervisor command protocol. Do not reuse the supervisor lifetime lock as a mutation lock.

First separate the state that does not need sharing. The supervisor alone writes arm readiness. Producers publish immutable inbox files. The active owner alone submits Pi messages. Only workspace lifecycle and pending references remain shared. The registry lock covers those facts, not network calls, GitHub polling, model runs, or readiness waits. Use a tested lock implementation with token-checked release and dead-process recovery. Do not steal a lock merely because a time budget elapsed while its holder is still alive.

Acceptance proceeds as follows.

1. Prepare a payload file using an internally generated event identity, restrictive permissions, a unique temporary file, and atomic publication.
2. Under the registry transaction, reread authoritative lifecycle, expiry, and occurrence state. Reject inactive/cancelled entries. Add the pending reference only if this occurrence was not already accepted.
3. For any `once` timer, including cron, mark it completed in that same registry commit. A completed entry's already accepted event remains deliverable. It is not rearmed.
4. On a crash before the commit, the payload is an ignored orphan. On a crash after the commit, the pending reference is sufficient to retry delivery. Cleanup may remove unreferenced payloads only while respecting concurrent publication, never by blindly scanning file age during acceptance.

Timer identity is subscription id plus scheduled occurrence. Once timers have a stable single occurrence identity, including once cron. Repeating timers preserve the existing cadence and do not backfill every missed interval after supervisor downtime. GitHub changes need a durable baseline committed alongside event acceptance so a restart does not turn an already observed change into a new event. Poll failures preserve the previous baseline and record errors.

Authenticated, size-bounded, valid-object POSTs receive independent random event identities. Digest remains audit metadata only. Two equal bodies, even in the same millisecond, create two events. Retrying the persistence operation for one received request reuses its assigned identity. An HTTP retry is another POST and therefore another event under the present public contract. Return 200 only after registry acceptance. Enqueue failure returns 503; invalid/authentication failures retain the existing 400/401/404/405/413 behavior. A route cancelled during body upload must recheck authority at acceptance and return 404 rather than enqueueing.

For process-crash durability, atomic replacement suffices with normal local filesystem assumptions. If host-power-loss durability is a requirement, sync payload and registry files and their parent directories in publication order. Do not advertise that stronger guarantee without implementing and testing it.

### Live owner delivery

Start an owner-specific drain on `session_start`. Run it immediately, then on a short bounded poll, proposed at 250 ms. An optional filesystem watch may reduce latency but is not required for correctness. Poll while the session is idle as well as busy. Merely checking on the next user prompt does not satisfy owner wakes.

The session adapter captures plain owner/workspace identity and a lifecycle epoch, not a stale `ExtensionContext`. One drain runs at a time. Before each send it verifies the current epoch and pending authority. It invokes the existing native call.

```ts
pi.sendMessage(
  { customType: WAKE_TYPE, content: payload.content, display: true,
    details: { id: event.subscriptionId, eventId: event.id, kind: payload.kind, name: payload.name } },
  { triggerTurn: true, deliverAs: 'followUp' },
);
```

Acknowledge only after send acceptance, never before. Hold the short registry transaction through the final eligibility check and synchronous `sendMessage` invocation, so a completed unsubscribe cannot race a later enqueue. Never await a model turn under this lock. Messages accepted before unsubscribe cannot be retracted from Pi's queue; document that boundary.

A second process opening the same session file must not become a second consumer. Acquire an exclusive owner-consumer lock for that session identity and keep it until shutdown. A conflicting opener reports owner delivery unavailable instead of silently competing. Shutdown clears polling, invalidates the epoch, releases ownership, and does not cancel subscriptions. `session_tree` refreshes the lifecycle epoch and owner drain without importing old desired state. Session replacement must complete cleanup before the next session drains.

For `new_session`, use the same pending event. The live owner claims it and invokes the existing `runFresh`; the supervisor can claim it for offline execution only when no live owner-consumer lock exists. Event execution claims are exclusive, token-owned, and recoverable after claimant death. A live claimant is not displaced by an arbitrary timeout. The detached path uses the existing supervisor runner and never opens the owner transcript. Result notification to an offline owner is not guaranteed by the existing callback; list status must report the detached run outcome rather than promise a live Task notification.

Pi's message enqueue and a filesystem acknowledgement are not one transaction. A crash between them can replay a message. This candidate guarantees durable at-least-once delivery, not exactly-once execution. Include `eventId` in message details and check persisted owner messages when recovering, but this cannot prove that a message queued only in memory survived. Likewise, a crash after fresh-run launch but before acknowledgement can repeat a fresh run. Exactly-once external side effects require an idempotent consumer or a stronger Pi acceptance API, not a pre-delivery claim masquerading as completion.

### Offline and terminal behavior

Offline `wake_self` payloads remain pending with their exact owner identity. Resuming that session drains them. Another session can list or unsubscribe them, but cannot steal them. Already accepted events remain deliverable after natural expiry or once completion. Explicit unsubscribe cancels pending undelivered events as well as future fires, including a completed once timer whose delivery is still pending. Management resolves that terminal-but-pending id/name too.

Retain terminal identity records for legacy-history safety. A newly created subscription may reuse an inactive name with a new id. Management prefers the active record for a reused name and permits exact-id cancellation of older pending events. Do not allow an old event to attach to the new id.

## Authoritative management and migration

List and `/routines` read one workspace snapshot and join supervisor status and pending delivery status. They do not need local ownership. Unsubscribe resolves the same scope and commits cancellation before returning. Supervisors check current authority during event acceptance rather than trusting an old armed object until the next reconciliation.

Session entries become historical receipts, not desired state. Restore never upserts them. Existing workspace v1 records migrate once under the transaction lock. Preserve ids, names, schedules, owner identities, and credentials; derive delivery strategy from config rather than retaining the incorrect blanket `spawn` flag. Missing owner identity becomes a visible delivery error, not a wildcard drain or a new-session fallback.

A branch-only legacy entry absent from the authoritative registry is not automatically imported. Current absence cannot distinguish cancellation from never-migrated state. Conservatively leave it inactive and tell the user to recreate it through the unchanged subscribe tool. This avoids resurrecting previously cancelled or completed work. A malformed registry is not equivalent to an absent registry.

## Readiness

The supervisor publishes arm status only after actual arming succeeds. Status includes supervisor epoch, subscription id, and the relevant desired revision. Webhook readiness requires credentials, installed route, successful bind, and actual URL. Port zero therefore returns the selected port, not a guessed URL. Bind failures such as `EADDRINUSE` remain inspectable.

`waitForArm` ensures a supervisor, then waits for a matching current status within a bounded deadline. A stale ready file from an earlier supervisor cannot satisfy the wait. Timers require a scheduled arm; GitHub requires polling initialized, with first-poll failures reported instead of hidden. On timeout or arm error, the tool throws with subscription id and reason. The durable desired entry remains inspectable and cancellable, so retrying the same name can recover without duplication. Return no success-shaped ready URL on failure.

Retain the existing in-process supervisor fallback only by running the same supervisor engine with its exclusive workspace ownership. Remove the duplicate scheduler in `index.ts`. Its readiness has the same meaning, and any in-process-only durability warning remains explicit. Do not keep two timer, webhook, or GitHub implementations.

## Ownership module map

| Existing module | Sole responsibility after the change |
| --- | --- |
| `subscriptions/index.ts` | Public tools/rendering, Pi lifecycle, live owner drain, native sendMessage and live runFresh adaptation. No schedule or authoritative local live map. |
| `subscriptions/durable-store.ts` | Validated durable format, transactional lifecycle and pending references, occurrence deduplication, inbox publication/acknowledgement, consumer/execution ownership primitives. No Pi dependency. |
| `subscriptions/durable-types.ts` | Private persisted unions and validated domain shapes. Remove its reverse dependency on `index.ts` by locating shared config types inside the subscription module. |
| `subscriptions/supervisor.ts` | One scheduler/poller/listener engine, baseline progression, event acceptance, arm readiness, offline fresh delivery. Never writes an owner transcript. |
| `subscriptions/ensure-supervisor.ts` | Existing launch path plus bounded per-arm readiness wait. |
| `subscriptions/webhook.ts` | Authentication, body validation, credential safety, per-request identity, awaited durable callback and HTTP response. |
| `subscriptions/supervisor-main.ts` | Existing detached Pi runner/process boundary. No new RPC layer. |

Keep helpers internal to this module and avoid adding a public barrel for storage/transport types. Ordinary delivery traces through adapter, store, and supervisor knowledge, not a chain of pass-through services.

## Rationale and synthesis decision

This is an independent inbox-centered candidate for the parent's parallel architect comparison, not a claim that synthesis has already happened. It selects the existing workspace supervisor plus active owner inbox drain as its base. It adds only the durable facts needed to close demonstrated crash and management gaps. The unchanged public surface hides scheduling ownership, offline queuing, transaction order, and readiness.

The Make Operations Idempotent principle changes once completion from remove-after-delivery into one acceptance commit with a stable event identity. A replay finds an accepted event rather than rearming an old branch entry. This principle was read from the installed leaf skill for this candidate.

### Tradeoffs accepted

- We accept a bounded poll and small local latency in exchange for avoiding another IPC server or platform-specific watcher dependency.
- We accept a short registry transaction lock in exchange for workspace-wide mutations without a supervisor command protocol. Immutable inbox payloads and single-writer readiness avoid unnecessary sharing.
- We accept at-least-once replay at the Pi/filesystem boundary in exchange for no unsupported transcript writer or invented native acknowledgement API.
- We accept retained terminal identities and conservative legacy import in exchange for never reviving historical cancelled work.
- We accept that offline fresh runs cannot promise the live owner's Task notification path. They must expose durable status.

### Alternatives considered

A supervisor-owned command socket could serialize all management and deliver directly over an owner connection. It hides filesystem transactions but introduces connection lifecycle, request correlation, reconnection, and offline durable command handling. It has a larger private protocol than the current hooks plus inbox need.

A fresh headless Pi per event has a small implementation but fails the owner's context and notification semantics. It cannot implement `wake_self` by choosing a different transcript.

A Pi-process-only scheduler hides fewer persistence details but cannot preserve explicit offline new-session automation. It also leaves every workspace session coordinating duplicate schedules.

## Red-flag screen

- Shallow module. Tool callers still perform one operation. They do not coordinate acceptance, readiness, or acknowledgement stages.
- Information leakage. Tool parameters and result contracts remain intact. Storage revisions, inbox filenames, and claim tokens stay private.
- Temporal decomposition. Persistence, lifecycle, and acceptance live together in the store because they share one invariant. There are no separate load/validate/save services.
- Pass-through methods. No new facade or broker wrapper. The existing adapter performs Pi policy; the existing supervisor performs arming policy.
- Split ownership. One durable store owns desired/pending transitions, one supervisor owns arms, one active owner owns sends. Runtime views are derived, not mirrored authorities.
- Two ways. Delete duplicate in-process scheduling when migrating its callers to the supervisor engine. Do not retain blanket detached spawn alongside owner delivery.
- Importable internals. Do not export new storage types from the package surface. Existing internal callers remain inside subscriptions.
- Hand-synced lists. Derive listing, routines, readiness lookup, and cancellation from the same registry records rather than maintaining parallel subscription inventories.

## Failure tests and acceptance gates

Tests must assert externally visible wakes, fresh starts, list output, HTTP responses, and restart behavior. Keep the existing rejection and credential tests.

1. With a real detached supervisor and an idle live Pi RPC session, a timer produces a native custom-message model turn without another user prompt. No fresh child is started for `wake_self`.
2. A busy owner gets one follow-up after its current turn. A peer session receives nothing.
3. Owner shutdown leaves wake events pending. Restarting a different session does not drain them. Resuming the exact owner delivers them. Session replacement during a drain cannot send into the replacement session.
4. Live `new_session` invokes the existing Task-backed callback and reports its result. Offline `new_session` invokes the existing detached runner. Competing live/offline claims do not start two runs during normal operation.
5. Cancel in a second session, restore an older branch in the first, and advance time. No rearm or wake occurs. The same holds for completed delay-once and cron-once entries.
6. Cancel an already pending event, including completed-once pending delivery. No later drain sends it. A message already accepted by Pi is explicitly outside the cancellation guarantee.
7. Race creates of the same name and different names across processes. One same-name record wins; different records survive. Race cancel against acceptance and assert the documented commit ordering.
8. Kill producer before payload publication, after publication, and after acceptance commit. Orphans are ignored; committed events survive. Kill owner before send and after send/before ack. The former retries; the latter permits replay without claiming exactly-once.
9. Two authenticated equal-body POSTs at one frozen timestamp yield two durable events and two normal owner deliveries. Invalid requests yield none. Force storage failure and expect 503, not 200. Cancel during upload and expect no acceptance.
10. Occupy the routines port while supervisor pid remains live. Creation and same-name retry report the arm error, never a ready guessed URL. Stale readiness from a dead epoch is ignored. Port zero returns a usable bound URL.
11. Workspace list/unsubscribe work with no branch receipts in the caller. Reused names cannot redirect old events. Missing legacy owner and corrupt registry produce explicit errors without deletion or broad drain.
12. Start two consumers for one session identity and verify only one can deliver. Kill the consumer and verify dead-owner recovery. A slow but live process is never reclaimed solely by elapsed time.
13. Restart the supervisor after a GitHub change acceptance. Its durable baseline prevents an artificial second event; unchanged first polls remain silent. Poll errors preserve baseline and appear in status.

Run narrow subscription tests, package tests and typecheck, then the real Pi CLI/RPC verification skill. Unit fakes alone cannot prove a native owner turn occurred. This deliverable is a design only; none of these proposed gates has been executed here.

## Open questions and risks

- Does parity require power-loss durability as well as process-crash durability? The default here is process-crash durability; the stronger requirement adds ordered filesystem sync.
- Does parity require exactly-once fresh-run launch? Current Pi and `runFresh` contracts cannot provide it atomically with local storage; the chosen contract is explicit at-least-once.
- Should offline wake backlog be bounded or coalesced? This candidate retains accepted events without coalescing because every authenticated POST is a distinct event. Any retention limit must be an explicit future product contract rather than silent loss.

## Next implementation step

Add failing cross-process tests for workspace cancellation/restore and live-owner timer delivery, then implement the authoritative store transition and continuous native drain before changing webhook readiness.
