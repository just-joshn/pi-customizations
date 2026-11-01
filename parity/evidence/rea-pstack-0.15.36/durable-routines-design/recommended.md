# Recommended. Detached supervisor + durable registry (Approach A)

**User goal.** Routines and timers keep waking after the interactive chat exits, with Pi-only mechanisms.

**Pick.** Approach A from `how-report.md`. One package-owned supervisor process, one disk desired-state registry that reuses today's `Subscription` body. Optional launchd/systemd user unit only starts that bin (Approach B as packaging, not as the schedule engine). Reject Approach C as the primary design because two Pi processes must not share one session writer.

Principles that forced the pick. Foundational Thinking (contract the data shape first). Laziness Protocol (reuse `Config` / cron / `RoutineServer` / github poll; do not invent a second schedule DSL). Separate Before Serializing Shared State (chat writes desired state; supervisor alone writes runtime delivery state). Make Operations Idempotent (create, restore, fire, and supervisor start converge).

## Data shape first

### Desired state (chat and tools write; supervisor reads)

Directory (one workspace, matching `workspaceSlug(cwd)`):

`<pstack dir>/durable/<workspaceSlug>/`

Files:

- `subscriptions.json` — atomic rewrite (write temp + rename). Sole desired-state document for that workspace.

```ts
/** On-disk desired state. version bumps only on breaking field changes. */
type DurableRegistry = {
  version: 1;
  workspaceCwd: string;
  /** Same bodies as session SubscriptionSchema / wellFormed() today. */
  subscriptions: DurableSubscription[];
};

type DurableSubscription = {
  id: string;
  name: string;
  createdAt: number;
  expiresAt: number;
  config: Subscription["config"]; // github | timer | webhook, identical to src
  /**
   * Session file path of the chat that created the entry, when known.
   * Used only to park wake_self events for a later interactive resume.
   * Never required for new_session fires or webhook acknowledgement.
   */
  ownerSessionFile?: string;
  /**
   * When the owner process is not attached:
   * - "spawn" (default): run the prompt in a fresh headless Pi (same idea as timer new_session).
   * - "park": append a wake record under runtime/inbox/ for the next interactive drain.
   * wake_self while the owner IS attached may still use pi.sendMessage in-process (today's path).
   */
  detachedDelivery?: "spawn" | "park";
};
```

Keep the session custom entry `pstack/subscriptions` as today's in-session list for interactive restore and `list_subscriptions`. On every successful create/unsubscribe/expiry remove, also upsert or delete the matching id in `subscriptions.json`. Same `id` / `name` / `config` bytes in both places. Re-subscribe by name still returns `created: false` and must not rewrite either store.

Webhook credentials stay at `<pstack dir>/routines/<slug>/credentials.json`. Do not copy keys into the registry.

### Runtime state (supervisor alone writes)

`<pstack dir>/durable/<workspaceSlug>/runtime/`

- `supervisor.lock` — pid + startedAt; stale if pid is dead (same idea as agent run locks).
- `delivery/<subscriptionId>.json` — last fire bookkeeping for idempotency.

```ts
type DeliveryLedger = {
  subscriptionId: string;
  /** Last successfully claimed fire key (see below). */
  lastClaimKey: string;
  lastClaimAt: number;
  lastError?: { at: number; text: string };
};
```

**Fire claim key (idempotent).**

- Timer cron. `${subscriptionId}:${floor(now/60000)}` for the local minute that matched (matches today's `lastCronMinute` guard).
- Timer delay. `${subscriptionId}:${fireIndex}` where `fireIndex` is derived from `createdAt` and `delaySeconds` the same way `next()` already computes cadence.
- Timer once. `${subscriptionId}:once`. After success, remove from desired state (same as today's `remove` on once).
- Webhook. `${subscriptionId}:${bodyDigest}:${timestampMs}` is too unique; prefer `${subscriptionId}:${bodyDigest}` within a short dedupe window, or accept at-most-once via digest+minute. Document the chosen rule in the implementer's test. Default proposal. claim key `${subscriptionId}:sha256:${bodyDigest}` with ledger replace; duplicate POSTs with the same body digest while the prior claim exists return 200 without a second spawn (Make Operations Idempotent for sender retries).
- GitHub. keep in-memory baseline in the supervisor only; no durable "missed while down" replay (same gap as README today).

### Ownership rules (no shared live map)

| Actor | May write | Must not write |
|---|---|---|
| Interactive / RPC chat (tools) | Session entry; `subscriptions.json` (desired) | `runtime/delivery/*`; listen on routines port when supervisor.lock is held by a live pid |
| Supervisor | `runtime/*`; arm timers; bind routines port; spawn headless runs; park inbox files | Session branch append for subscription list (except optional park wake messages into owner session via a documented Pi API if available; otherwise inbox files only) |
| Headless fire process | Its own subagent transcript / run | Desired registry; routines port |

If interactive starts and sees a live supervisor lock, it restores GitHub/timer/webhook **into a passive view** for `list_subscriptions` / `/routines` but does not call `arm` for durable ids. If no supervisor is running, keep today's in-process arm (backward compatible) and surface a one-line notice that durability needs the supervisor for chat-exit survival.

## Supervisor process

- Package bin name proposal. `pstack-routines-supervisor` (Node entry under the extension package).
- Args. `--workspace <cwd>` or discover all `<pstack dir>/durable/*/subscriptions.json` and supervise every workspace (v1 can be single-cwd; multi-workspace is a follow-on flag).
- Loop. Load registry → drop expired → arm timers/polls → ensure `RoutineServer` with routes from webhook configs → watch registry mtime (or rescan on SIGHUP) → reconcile (idempotent re-arm).
- Reuse. Import `parseCron` / `cronMatches`, `fetchPrs` / `pollChanges`, `RoutineServer` / `ensureCredentials`, and `wellFormed`-equivalent checks from `src/subscriptions/`. Factor shared pure helpers if needed; do not fork a second HTTP stack.
- Spawn on fire (`detachedDelivery: "spawn"` or timer `strategy: "new_session"`). Use the same Pi script resolution as Task (`process.argv[1]` or `pi` on PATH) in a non-interactive mode that runs one prompt and exits. Do not call subscribe tools inside that run.

Optional packaging (not core logic). A user-level launchd plist / systemd user unit template that `ExecStart`s the bin and `KeepAlive`s it. Document install in README; do not require root.

## Exact files to add or change (follow-up coder)

Under `extensions/pi-pstack` only (this unit does not edit them):

| File | Change |
|---|---|
| `src/subscriptions/durable-types.ts` (new) | Export `DurableRegistry`, `DurableSubscription`, `DeliveryLedger`, paths helpers under `stateDir()/durable/...`. |
| `src/subscriptions/durable-store.ts` (new) | Atomic read/write registry; upsert/remove by id; expire filter; lockfile helpers. |
| `src/subscriptions/supervisor-main.ts` (new) | CLI entry. Reconcile loop, arming, delivery claims, spawn/park. |
| `src/subscriptions/index.ts` | On create/unsubscribe/expiry, dual-write durable registry. On restore, if supervisor live skip `arm` for durable-backed ids (or all ids when policy is "supervisor owns workspace"). Keep session entry shape unchanged. |
| `src/paths.ts` | `durableDir(cwd)`, `durableRegistryPath(cwd)`, `durableRuntimeDir(cwd)`. |
| `package.json` | `bin` entry for `pstack-routines-supervisor`; ensure the built/runtime path matches how the package is loaded today. |
| `README.md` | Limits. Replace "live in the Pi process" with supervisor outlives chat; document bin + optional launchd; port ownership; print/JSON still cannot *create* subscriptions. |
| `docs/guide/` (overnight / Benny page if present) | Point overnight packs at "start supervisor" instead of "keep tmux Pi open" as the durability path. |
| `test/durable-store.test.ts` (new) | Atomic write, upsert idempotency, expire drop, name collision `created: false` does not rewrite. |
| `test/supervisor-reconcile.test.ts` (new) | Reconcile from fixture registry; claim key prevents double spawn; once timer removes desired state. |
| `packaging/launchd/com.pstack.routines-supervisor.plist.example` (new, optional) | Example user agent. |
| `packaging/systemd/pstack-routines-supervisor.service.example` (new, optional) | Example user unit. |

Out of scope for the first coder PR unless needed for compile. Do not change skill text to mention Cursor Automations hosting. Do not depend on the Cursor pstack plugin.

## Verification experiment (must prove wake after chat death)

Name. `durable-timer-survives-chat-exit`

Steps.

1. Set `PI_CODING_AGENT_DIR` (or use a temp agent dir) so state is isolated.
2. Start `pstack-routines-supervisor --workspace <fixture-cwd>` in the background. Assert `supervisor.lock` pid is alive.
3. In an interactive or RPC Pi session in that cwd with pi-pstack loaded, call `subscribe_timer` with `name: "durable-smoke"`, `delaySeconds: 15`, `once: true`, `sessionStrategy: "new_session"`, short prompt that writes a marker file under the workspace (or appends one line to a known path). Confirm tool result `created: true` and registry contains the same `id`.
4. Exit the chat process completely (not `/reload` only). Confirm the supervisor pid is still alive and still holds the routines port if any webhook is also armed (timer-only is enough for this experiment).
5. Wait until `delaySeconds` elapses plus a small grace.
6. **Pass.** Marker file exists (or a subagent transcript under `<pstack dir>/workspaces/.../subagents/` shows the prompt ran) **and** `runtime/delivery/<id>.json` shows `lastClaimKey` for the once fire **and** the subscription is gone from `subscriptions.json` (once semantics).
7. **Fail.** No marker after grace, or two markers (double delivery), or only the session entry updated while the supervisor never claimed.

Webhook companion (same harness, second case).

1. `subscribe_webhook` name `durable-hook`, then kill chat.
2. POST JSON to `http://127.0.0.1:<port>/routines/<slug>` with the key from `credentials.json`.
3. Expect HTTP 200 and a spawn or park record without the interactive process.

Unit tests cover store and claim idempotency without a live model. The experiment above is the Prove It Works gate for the gap.

## Implementation order (verifiable units)

1. Types + atomic store + tests → verify store tests green.
2. Supervisor reconcile for timer once/delay only (no webhook) → verify experiment steps 1–7.
3. Wire dual-write from `create` / `unsubscribe` → verify registry matches session list in subscription tests.
4. Webhook route ownership in supervisor → verify POST companion.
5. Interactive restore skips arm when lock live → verify no `EADDRINUSE` with chat+supervisor.
6. README + optional packaging examples → verify docs name the bin and the experiment.

## Defaults the implementer should not reinvent

- Registry `version: 1` and `Subscription` config union stay aligned with `SubscriptionSchema` in `index.ts`.
- Default detached delivery. `spawn` (work continues without the TUI).
- Supervisor is sole routines-port listener when its lock is live.
- Print/JSON continue to reject subscribe *creation*; they are not the supervisor.
- No Cursor plugin, no `api2.cursor.sh`, no hosted automation id.
