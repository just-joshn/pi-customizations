# Implement report. Durable routines supervisor (Approach A)

**User goal.** Routines and timers keep waking after the interactive chat exits, with Pi-only mechanisms and no Cursor pstack plugin.

**Pick.** Implemented Approach A from `recommended.md`. Chat dual-writes desired state; `pstack-routines-supervisor` alone arms timers, polls, and the routines port.

Principles applied (leaf skills read this session). Foundational Thinking (types and store before reconcile). Laziness Protocol (reuse cron / github / RoutineServer; no second DSL). Separate Before Serializing Shared State (desired registry vs `runtime/delivery`). Make Operations Idempotent (createDesired name rule, claim keys, once claim skips re-spawn, second supervisor start exits 0). Sequence Verifiable Units (store → supervisor → dual-write → docs). Prove It Works (unit claim/spawn proofs; chat-exit smoke later VERIFIED in `chat-exit-smoke.md`). Unslop (README / overnight / report prose).

## Files changed

| Path | Role |
|---|---|
| `extensions/pi-pstack/src/paths.ts` | `durableDir` / `durableRegistryPath` / `durableRuntimeDir` |
| `extensions/pi-pstack/src/subscriptions/durable-types.ts` | `DurableRegistry`, `DurableSubscription`, `DeliveryLedger`, `SupervisorLock` |
| `extensions/pi-pstack/src/subscriptions/durable-store.ts` | Atomic registry, createDesired / upsert / remove, lock, claimDelivery |
| `extensions/pi-pstack/src/subscriptions/supervisor.ts` | Reconcile, timer/github/webhook arming, injectable `runFresh` |
| `extensions/pi-pstack/src/subscriptions/supervisor-main.ts` | CLI entry |
| `extensions/pi-pstack/src/subscriptions/index.ts` | Dual-write on create/unsubscribe/expiry; passive restore when lock live |
| `extensions/pi-pstack/bin/pstack-routines-supervisor` | Bin launcher (bun or `node --experimental-strip-types`) |
| `extensions/pi-pstack/package.json` | `bin.pstack-routines-supervisor` |
| `extensions/pi-pstack/packaging/launchd/com.pstack.routines-supervisor.plist.example` | Optional user agent |
| `extensions/pi-pstack/packaging/systemd/pstack-routines-supervisor.service.example` | Optional user unit |
| `extensions/pi-pstack/README.md` | Limits + supervisor row |
| `extensions/pi-pstack/docs/guide/07-overnight.md` | Point overnight packs at supervisor |
| `extensions/pi-pstack/test/durable-store.test.ts` | Store / lock / claim |
| `extensions/pi-pstack/test/supervisor-reconcile.test.ts` | Once claim + registry removal; webhook digest; lock |
| `extensions/pi-pstack/test/subscriptions.test.ts` | Dual-write + passive restore; temp agent dir in setup |

## Claim key rule (documented for implementer tests)

- Timer cron. `${id}:${floor(now/60000)}`
- Timer delay. `${id}:${floor((now-createdAt)/(delaySeconds*1000))}`
- Timer once. `${id}:once` (claim then remove desired; existing once claim on reconcile drops desired without spawn)
- Webhook. `${id}:sha256:${bodyDigest}` (duplicate POST with same digest → 200, no second spawn)

## Commands and results

```sh
cd extensions/pi-pstack
bun run typecheck
# exit 0

bun run test test/durable-store.test.ts test/supervisor-reconcile.test.ts test/subscriptions.test.ts test/subscriptions-cron.test.ts
# 4 files, 61 tests, all passed

bun run test
# 37 files; 483 passed, 1 failed
# FAIL test/e2e/host.e2e.test.ts HOST-008: system prompt path contains
#   feat-cursor-cli-parity → matches /cursor/i
# Pre-existing path collision with this worktree name; not introduced by durable registry strings.
```

## VERIFIED (CI / unit, no live model)

1. Atomic registry write, createDesired name idempotency, expire drop, lock acquire/stale takeover.
2. Once timer. stub `runFresh` fires once; `runtime/delivery/<id>.json` has `lastClaimKey` `${id}:once`; subscription removed from `subscriptions.json`; re-injecting desired state with existing once claim does not spawn again.
3. Repeating delay uses fire-index claim keys (`:1`, `:2`).
4. Duplicate webhook POST same body digest does not spawn twice (HTTP 200 both times).
5. Second supervisor start returns already-running (no second lock / port bind attempt).
6. Interactive create dual-writes registry; re-subscribe `created: false` does not rewrite; unsubscribe removes desired.
7. Restore with live `supervisor.lock` lists subscriptions but does not arm in-process (`runFresh` stays empty past due).
8. Print/JSON subscribe rejection still covered by existing subscription tests.
9. Credential keys stay in `routines/<slug>/credentials.json` only (not in registry JSON).

## Chat-exit smoke (supersedes prior OPEN)

Real-bin smoke later closed this gap. See `chat-exit-smoke.md` (paths A/B VERIFIED after the supervisor keep-alive fix). Gap-list item 1 is CLOSED.

## Defaults kept

- Registry `version: 1`
- Default `detachedDelivery: "spawn"`
- Supervisor sole routines-port owner when lock live
- Print/JSON still cannot create subscriptions
- No Cursor plugin / hosted automation dependency

## Parent follow-up (HOST-008)
HOST-008 scrubbed `PACKAGE_ROOT` and agent dir before `/cursor/i`. Later package suite on this branch: **38 files, 491/491 passed**. Chat-exit smoke VERIFIED per `chat-exit-smoke.md`.
