# Chat-exit smoke: durable-timer-survives-chat-exit

**Verdict: VERIFIED** against the real package bin after the watch-timer keep-alive fix.

## Hypothesis

If `pstack-routines-supervisor` owns durable arms for a workspace, then after desired state is written the same way `subscribe_*` dual-writes, and with no interactive Pi process, a once timer with short `delaySeconds` should keep the supervisor alive past the delay, spawn a fire, leave `lastClaimKey` ending in `:once`, and remove the subscription from `subscriptions.json`.

## Root cause that blocked the first run

Every handle that could keep the process alive was `unref`'d (`at()` timers, reconcile watch, routines server). `supervisor-main.ts` returned after registering signals, so the event loop drained and the bin exited 0 within ~500ms. Fix in `supervisor.ts`. Leave the reconcile watch timer referenced so the daemon stays alive. `supervisor-main.ts` also awaits SIGINT/SIGTERM before returning so `stop()` runs on shutdown.

A first post-fix smoke still labeled NOT VERIFIED only because the harness sampled for 2s while requiring a sample at `delay+1s` (3s). The fire had already succeeded. The harness now samples through `delay+1s`.

## Commands

```bash
cd parity/evidence/rea-pstack-0.15.36/durable-routines-design/chat-exit-smoke
bun run-smoke.mjs
# exit 0 when path A VERIFIED
```

## Measured outputs (post-fix)

Path A (`out/path-a.json`). VERIFIED. Alive through 3s sampling, marker present, `:once` claim, empty `subscriptions.json`, spawn count 1.

Path B (`out/path-b.json`). VERIFIED. Once timer + webhook 200/200 with one spawn.

Package test. `test/ensure-supervisor.test.ts` SUP-BIN-001. Real bin stays alive past 1s until SIGTERM.

## Limitations

- Registry injection via `createDesired`, not an interactive `subscribe_timer` turn.
- Fire delivery uses a PATH-shadow `pi`, not a paid model turn.
