# Subscription ownership design

## Decision

Use `candidate-inbox.md` as the base. The independent Claude reviewer scored it 14 of 15 and the IPC candidate 13 of 15. Both cover the required behavior. The inbox design uses existing storage and Pi messaging without a second socket protocol.

## Caller contract

Public tool schemas stay unchanged. Owner-directed timer, GitHub, and webhook events reach the active owning session through native `pi.sendMessage`. Offline owner events wait for that same session. Explicit `new_session` timers use the live owner's Task callback when available and the detached runner when absent. Cross-session list and unsubscribe use authoritative workspace state.

## Data shape and ownership

The durable registry owns subscription lifecycle and pending events, including their payloads. A short cross-process transaction protects mutations. The supervisor owns scheduling and readiness. Each session owns its native message delivery. Session snapshots are historical receipts and never recreate desired subscriptions. A once occurrence completes when its event is durably accepted, not after an unrelated process acknowledges it. Explicit cancellation also removes pending undelivered events.

Identify the owner by Pi session ID. Keep its session file for diagnostics and resume, not as a wildcard delivery selector. A session without a saved file may receive live wakes by ID, but cannot promise offline resumption without a saved session.

## Grafts and simplifications

- From IPC, roll back a newly created subscription when arming fails. Failed creation must not later wake the owner.
- From IPC, keep lifecycle transitions testable without Pi or a network.
- Readiness must name the specific subscription and the live supervisor incarnation. Webhooks return the actual bound URL.
- Reject names that normalize to an existing webhook slug.
- Keep new-session execution claims on pending events with claimant PID and dead-process recovery.
- Store payloads in the same registry transaction rather than separate inbox files. This avoids orphan publication and makes acceptance and once completion one atomic replacement.
- Reject a registry whose canonical workspace path differs, even when Pi's folder-name encoding collides.
- Do not add socket protocols, filesystem watchers, power-loss fsync guarantees, operation receipts, or a general job framework.
- Do not add durable GitHub baselines for this fix. Restart re-baselines remain a disclosed downtime limitation.
- Do not promise detached fresh-run result notifications. Record outcome/status instead.

## Verification

The real Pi RPC owner-wake regression already fails against the old implementation. Add cross-session cancellation and stale restore, completed once restore, identical POSTs, storage failure, occupied-port readiness, exact-owner delivery, and fallback tests. Keep security rejections and credentials tests. Run narrow tests, the package suite, typecheck, then real Pi drives.

## Limits

Pi's synchronous `sendMessage` and filesystem acknowledgement cannot commit atomically. A crash between them can repeat a wake. The guarantee is at-least-once delivery, not exactly-once external side effects. In-process fallback stops with its Pi process. Local worktrees do not supply remote machine isolation.
