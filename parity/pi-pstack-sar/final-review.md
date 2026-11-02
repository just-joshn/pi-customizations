# Final correctness and audit review

reviewed by claude-subscription/claude-opus-5-5:xhigh

The parent chat and the subscription worker ran on `openai/gpt-6.1-sol`. This review runs on a Claude model, so it satisfies the different-family requirement for the audit trail. It edits no source.

## Goal

The user wants pi-pstack to reproduce every pstack capability in `/Users/josh-desktop/Documents/pstack-sar-report.md` through Pi-native mechanisms. This review checks whether the working diff against `HEAD` (`1c47fae5`) is correct, whether its evidence supports its claims, and whether the parity mapping states its limits honestly.

## Verdict

Do not claim full parity or verified subscription parity yet. The redesign fixes the demonstrated owner-wake defect and its core contracts hold. Eight defects reproduce or follow directly from the current code. Two are High. The headline evidence (536 tests, five installed-Pi scenarios) was true when captured but predates the parent's 12:33 and 12:36 edits to `durable-store.ts` and its test.

| ID | Severity | Defect | Status |
| --- | --- | --- | --- |
| R1 | High | A running previous-release supervisor blocks every new subscription and silently leaves existing ones unarmed after upgrade | Reproduced |
| R2 | High | Failed fresh runs retry every reconcile tick with no backoff or bound, after expiry, concurrently for every failed occurrence | Reproduced |
| R3 | Medium | Creation fails and rolls back when the supervisor's reconcile spends more than 2 s on GitHub calls | Reproduced |
| R4 | Medium | Any arm failure re-arms every 250 ms, so a failing GitHub watch calls `gh` about 4 times per second | Reproduced |
| R5 | Medium | Offline backlogs are unbounded, the supervisor's per-tick cost grows quadratically with them, and resume floods the owner | Measured |
| R6 | Medium | The in-process fallback runs another session's `new_session` work as a Task of the host session | Reproduced |
| R7 | Low | A session that loses the owner-lease race at start never retries and stops receiving wakes | Reproduced with a simulated probe |
| R8 | Low | Detached `new_session` prompts are parsed as Pi CLI options | Reproduced against installed Pi |

## Scope and method

I read `design.md`, `requirements.md`, `grounding.md`, `plan.md`, `decisions.tsv`, every file under `extensions/pi-pstack/src/subscriptions/`, the subscription tests and fixtures, the e2e harness, `src/task/runner.ts`, the package, workflow, lockfile, and prose diffs, the `HEAD` versions of the subscription modules, the SAR report sections 8, 10 through 13, and the evidence in `parity/pi-pstack-sar/evidence/` and `/tmp/pstack-subscription-evidence/`.

The parent was still editing while I reviewed. My final reproductions ran at 20:37:51 UTC against `durable-store.ts` sha256 prefix `f9d8507c08b5`, `index.ts` `51fe2fc0a93d`, and `supervisor.ts` `9186ae6d5469`. The output is in `/tmp/pstack-final-review/rerun-current.log`.

I did not rerun the package suite, the statechart suite, or the installed-Pi e2e file, because the parent owns those runs. Each reproduction imports the real modules with an isolated `PI_CODING_AGENT_DIR`. Run any of them from `extensions/pi-pstack` with `node --experimental-strip-types --no-warnings /tmp/pstack-final-review/<script>.mts [args]`. Fakes stand in only for `gh`, `runFresh`, and the Pi `ExtensionAPI` object, at the same seams the package tests use.

## What holds

- **Owner delivery.** The normal supervisor path now wakes the owning session through `pi.sendMessage` with `deliverAs: 'followUp'`. `owner-wake-before.txt` shows the old code timing out. The recorded e2e runs cover idle, busy, offline-resume, live Task, and detached fresh cases.
- **No resurrection.** `restore` never imports branch receipts. `subscriptionsFromBranch` only drives an informational notice. Cancelled and completed entries keep their identity in the registry, so a receipt cannot re-arm them. Tests cover completed-once, cancelled, and branch-only legacy entries.
- **Exact ownership.** Owner leases are keyed by session ID. A second process on the same session gets an explicit error. Peers can list and cancel through the shared registry without receiving another owner's wakes.
- **Transactions.** Mutations run under a directory lease with dead-holder recovery. The crash fixture uses a real `SIGKILL` before and after the registry rename, and a send-before-acknowledge replay. That proves at-least-once at the store boundary.
- **Webhook security.** The key check still runs before the body is read. The 64 KiB cap, the `127.0.0.1` bind, and the `0600` and `0700` modes are unchanged. Each authenticated POST gets a random identity. A storage failure now returns 503 instead of a false 200. I found no security regression in the listener.
- **Readiness identity.** Arm status is keyed by subscription ID, revision, and supervisor epoch, and failed new creations are cancelled. R1 and R3 are about when readiness fails, not about what it identifies.
- **Other fixes.** The `StringDecoder` fix in `runner.ts` failed first at 19:27:45 UTC and passed at 19:28:01 UTC in the parent transcript. The `.npmignore` fix has a failing-first artifact. The statechart suite reports 367 passed and 0 skipped with the mise TLC 1.7.4 jar and `temurin-25`. Scoped Biome on the 21 changed or new code files reports no findings.

## Findings

### R1. A previous-release supervisor disables subscriptions after upgrade (High)

**Location.** `durable-store.ts:383-394` (`readLock`, `isSupervisorLive`), `index.ts:204` (`ensureEngine`), `index.ts:323` (`waitForArm`).

**What happens.** The detached supervisor never exits on its own. After a package upgrade, the old process keeps `supervisor.lock`, which has no `epoch`. `readLock` gives it a synthetic `legacy-` epoch, and `isSupervisorLive` reports it live, so the new code never starts its own supervisor. The old code reads the v2 registry as empty, because `HEAD`'s `parseRegistry` accepts only version 1. It disarms everything and never writes arm status. Every new subscription times out and is rolled back. Every existing subscription stops firing without any error. This lasts until the user reboots or kills the old process.

A second path follows from `HEAD`'s `createDesired`, read from source and not run. A Pi session still running the old code reads the v2 file as empty and overwrites it with a version 1 file holding only its new subscription. That erases all lifecycle and pending-event state.

**Reproduction.** `upgrade-skew.mts` runs `HEAD`'s `supervisor-main.ts`, extracted with `git archive`, then calls `subscribe_timer` through the new code.

**Observed.** The create fails with `readiness timed out. No matching live supervisor arm.` An existing 1-second timer has no `lastEvent` and no pending event after 3 s. The registry stays version 2.

**Smallest fix.** Treat a live lock without `epoch` as incompatible. Stop that PID after confirming it is a pstack supervisor, or fail with an error that names it. Write the v2 registry under a new file name so old writers cannot clobber it.

### R2. Failed fresh runs retry with no backoff or bound (High)

**Location.** `durable-store.ts:352-362` (`finishFresh` deletes the claim and keeps the event), `supervisor.ts:76-95` (`offlineFresh` on every reconcile), `supervisor.ts:228` (250 ms tick).

**What happens.** When a detached run fails, the event stays pending with no claim. The next reconcile, about 250 ms later, launches it again. Nothing limits attempts, nothing backs off, and `startFresh` checks only for `cancelled`, so retries continue after expiry. Each failed occurrence of a repeating timer becomes its own pending event, so concurrency grows with the number of failed fires. The live owner path behaves the same way when `task.startBackground` rejects. The new README says failed events are retried, but it does not mention the missing backoff and bound.

**Trigger.** Common failures produce this. I confirmed that installed Pi 1.4.0 `pi --mode json -p` exits 1 with `No API key found for the selected model.` An expired login, an offline provider, or the reboot unit's launchd `PATH` without `pi` (inferred, `supervisor-main.ts:33` falls back to `["pi"]`) would each fail every run.

**Reproduction.** `retry-storm.mts` creates a 1 s repeating `new_session` timer with a 3 s expiry for an offline owner. A fake run fails after 100 ms.

**Observed.** There were 42 launches in 7 s, at 8 per second after the second fire, with up to 2 concurrent runs. They continued after expiry with `lifecycle: expired` and two pending events. With real Pi each launch is a full process start, so the rate per event is lower, but concurrency still grows by one per failed fire. That growth is an inference from the code path.

**Smallest fix.** Store `attempts` and `retryAt` on the pending event, skip it until `retryAt`, and back off exponentially. Stop retrying after expiry or a fixed attempt limit and leave the error visible.

### R3. Readiness fails while reconcile waits on GitHub (Medium)

**Location.** `supervisor.ts:180` (`arm` awaits the first poll), `supervisor.ts:197-203` (subscriptions arm one at a time), `ensure-supervisor.ts:9` and `index.ts:323` (2 s deadline). `src/index.ts:102` sets no `supervisorReadyMs`.

**What happens.** Arm status is written only after `arm` resolves. For GitHub that means after `gh` answers, and reconcile arms each subscription in turn. A new subscription therefore waits for every slower arm ahead of it. If that takes longer than 2 s, creation throws and rolls back. Typical cases are a slow GitHub API, a supervisor restart with several PR watches, and R4's repeated failing arms. `HEAD` had no readiness wait, so this failure mode is new.

**Reproduction.** `readiness.mts` holds the supervisor lock in-process, so the code takes the same path as with a live detached supervisor, and uses a delayed fake `gh`.

**Observed.** With a 2.5 s `gh`, `subscribe_github_pr` failed in 2047 ms and the entry ended `cancelled`. With three existing PR watches at 1 s each, `subscribe_timer` failed in 2050 ms and was rolled back. Controls with a 0.5 s `gh` and a plain timer succeeded.

**Smallest fix.** Count a GitHub subscription as armed once it is scheduled, and take the baseline asynchronously. Do not await network calls inside the reconcile loop.

### R4. Arm failures re-arm on every tick (Medium)

**Location.** `supervisor.ts:157-183` (`arm` throws when the first poll fails), `supervisor.ts:207-214` (the catch disarms and records the error), `supervisor.ts:197` (the next tick re-arms anything not armed).

**What happens.** A failed arm is retried on the next 250 ms reconcile. For GitHub, the first poll's error propagates out of `arm`, so `pollIntervalMs` never applies. `HEAD` swallowed poll errors and retried after `pollMs`. Each failure also rewrites the registry through `recordError`. Migrated v1 entries with no owner ID take the same path through the `Owner session ID unavailable` throw. That case is read from code and not run separately. A webhook bind failure does too.

**Reproduction.** `github-rearm.mts` uses an active PR watch, a `gh` that always rejects, and `pollIntervalMs` set to 60000.

**Observed.** There were 12 `gh` calls and 12 registry revisions in 3 s. A logged-out `gh`, a revoked repository, or a deleted PR would therefore spend GitHub API quota and churn the disk until expiry, which can be up to 30 days.

**Smallest fix.** Keep a failed entry armed with a retry timer at `pollIntervalMs`, or at a capped backoff for non-GitHub kinds. Skip the registry write when the error text has not changed.

### R5. Offline backlog grows without bound and costs quadratic CPU (Medium)

**Location.** `supervisor.ts:76-95`. `offlineFresh` calls `startFresh` once per pending event on every reconcile. Each call is a full transaction that loads, validates, and serializes the registry twice. `durable-store.ts:303-314` (`deliverOwner`) sends every pending event as its own follow-up.

**What happens.** Wakes for an offline owner accumulate with no cap or coalescing. A minutely cron accumulates 480 events in an 8 h night and 1440 in a day. Even `wake_self` events, which `startFresh` immediately rejects, each pay for a whole-registry transaction on every tick. When the owner resumes, `deliverOwner` queues every event as a follow-up turn.

**Measurement.** `backlog-cost.mts` builds a registry with N pending `wake_self` events and times `supervisor.reconcile()`. I took 5 samples per N, and the min and median differ by under 2%.

| Pending | Registry bytes | Reconcile median |
| --- | --- | --- |
| 60 | 34388 | 36 ms |
| 480 | 268708 | 517 ms |
| 1440 | 804828 | 3285 ms |

At 480 the reconcile already takes longer than the 250 ms tick. At 1440 the supervisor's event loop blocks for about 3.3 s at a time, which delays webhook responses and timer callbacks. A CPU profile at N=480 (`/tmp/pstack-final-review/backlog-profile.log`) names the limiter. It spends 24.3% in `transaction`'s two `JSON.stringify` calls at `durable-store.ts:235`, 22.5% in `loadRegistry`, and most of the rest in lease syscalls (`lstat`, `rename`, `open`, `mkdir`, `rmdir`). One transaction per event, each costing O(registry size), explains the quadratic curve.

**Smallest fix.** In `offlineFresh`, select only unclaimed `new_session` timer events before opening a transaction. Cap or coalesce queued occurrences per subscription, and say in the docs that resume delivers the backlog as separate turns.

### R6. The fallback runs another owner's fresh work in the host session (Medium)

**Location.** `index.ts:213-221` passes `options.runFresh`, which is the host session's `task.startBackground` from `src/index.ts:102`, to the shared fallback engine. `supervisor.ts:76-95` runs other owners' events through it with `ownerSessionId` undefined.

**What happens.** When the detached supervisor cannot start within 2 s, one session hosts the engine for the whole workspace. A `new_session` event of offline session B then starts as a background Task of session A. Its notification lands in A's conversation and counts as A's pending work. The outcome is recorded as `detached run completed` when the Task has only started.

**Reproduction.** `fallback-foreign.mts` forces the fallback with a custom `routinesDir`, starts session A, and adds a 1 s once `new_session` timer owned by `session-b`.

**Observed.** A's `runFresh` received `SESSION-B PRIVATE TASK`, and `lastOutcome` was `detached run completed`.

**Smallest fix.** Give the fallback engine the detached `pi -p` runner, or have it skip events of other owners.

### R7. A lost owner-lease race is never retried (Low)

**Location.** `durable-store.ts:337`. `ownerIsLive` probes by acquiring and then releasing the owner lease. `index.ts:280-284`. On failure, `restore` notifies once and arms no retry.

**What happens.** When the supervisor's probe holds the lease at the moment a session starts, that session's `acquireLease` fails. The session shows `Another live process owns this exact session` and never drains until its next `create` or `session_tree`. The supervisor then sees the lease free, treats the owner as offline, and runs its `new_session` work detached even though the owner is live. The probe window is short, so this is rare. It is most likely during R2 retry loops, which probe on every tick.

**Reproduction.** `owner-probe.mts` holds the lease during `session_start`, then releases it.

**Observed.** There were no wakes after 2 s and the event stayed pending.

**Smallest fix.** Retry lease acquisition from `ownerPoll` while `owner` is undefined, or make `ownerIsLive` read the holder token without acquiring the lease.

### R8. Detached prompts are parsed as CLI options (Low)

**Location.** `supervisor-main.ts:43` spawns `pi ... -p <prompt>`, and `-p` is a flag.

**What happens.** A `new_session` prompt that starts with `-` is parsed as Pi options. A prompt starting with `@` is read as a file. Installed Pi with `-p "--version"` printed `1.4.0` and exited 0, which the supervisor would record as `detached run completed`. A prompt starting `-e <path>` would load an extension. `HEAD` used the same argv, but its detached runner launched the supervisor script instead of Pi, so this path was unreachable before this diff. The live Task path sends prompts over RPC and is not affected.

**Smallest fix.** Pass the prompt through stdin or a file, or after an end-of-options marker if Pi supports one. I have not checked whether it does.

## Evidence audit

| Claim | Artifact | Assessment |
| --- | --- | --- |
| 536 tests in 39 files | `package-final.log` (12:21) and `package-final-parent.txt` (12:24), local time UTC-8 | True when run. Stale, because `durable-store.ts` and its test changed at 12:33 and 12:36 and added two tests. |
| Five real installed-Pi scenarios | `installed-pi-e2e.log` (12:19) and `subscription-installed-parent.txt` (12:26) | The transcripts show `PSTACK_E2E_PI="$(command -v pi)"`, so the claim is genuine. The logs do not record the binary or version. Both predate the 12:33 workspace guard and the 12:36 `startFresh` restructure. The only later e2e run, `fresh-launch-boundary-after.txt`, used the dev-dependency CLI. |
| Crash tests | `transactions-crash.log` (21 tests, 12:17) | Real `SIGKILL` of a fixture writer around the registry rename, plus the replay case. No test kills a real Pi owner or a real supervisor during a detached run. The duplicate-run boundary is stated, not tested. |
| Owner wake failed before the fix | `owner-wake-before.txt` | Genuine timeout on the old code. |
| Statechart 367 passed, 0 skipped | `statechart.txt`, `statechart-final.txt` | Consistent with the transcript command, which used the mise TLC 1.7.4 jar and `temurin-25`. The artifact does not print the TLC or Java versions. |
| Repository gate | `root-verify.txt`, `root-verify-final.txt`, `test-conventions.txt`, `types-policy.txt` | Red for reasons outside this diff. The `check:tests` errors are all in `pi-anthropic-oauth`, and the type-policy failure is the `verify-oauth-refresh-lock` spec from `HEAD`. `requirements.md` discloses this honestly. |
| A fresh child read all ten hidden Benny dependencies | `requirements.md` verification record | Not independently verified here. No artifact path is given. |

## Mapping and limitations audit

- **Overclaim.** The verdict rules in `requirements.md` say readiness and crash recovery "now have passing checks". The asserted contracts do pass, but R1, R3, and R4 are readiness and restart failures with reproductions. Reword that sentence, or fix those defects first.
- **H19 is only partial.** The SAR row lists hosted trigger types (`webhook`, `slack_trigger`, `linear`, `sentry`, `ci_completed`). Pi provides timers, GitHub polling, and generic localhost webhooks. Slack and the others need a relay or a sweep. State that difference in the H19 row.
- **Benny.** `inventory-semantic-review.md` (12:36) finds that Benny timer sweeps can permanently miss reports, that the ledger does not guarantee no duplicate runs, and that readonly workers may still hold Slack credentials. The 5.7 row in `requirements.md` (12:30) does not reflect those findings yet.
- **Missing limits.** "Remaining environmental limits" omits R1 (mixed versions during upgrade), R2 (unbounded retry), R5 (unbounded backlog and resume flood), and R6 (fallback ownership). Each is a code behavior, not an environmental one.
- **F5 is partial.** The SAR also recommends wiring the docs check, which covers counts, slash names, links, agent names, and model IDs. RES-007 checks links only. The F5 row does not dispose of the rest.
- **CI coverage.** The workflow pins Node 26.13.0, while `engines` declares `>=22.19.0`, so CI no longer exercises the supported floor. The local statechart run resolved `fast-check` from a nested `node_modules` installed with `npm --no-package-lock`. CI resolves it through the workspace devDependency, which has not run. `requirements.md` already says CI is not executed.
- **Accurate as written.** The worktree-versus-VM limits, the GitHub downtime re-baseline, the at-least-once boundary, the unsaved-owner caveat, and the external-service exclusions are stated correctly.

## Audit trail review

- The `subscriptions` row at 20:34:28 cites `durable-store.ts`, a source file, as evidence for "Five installed Pi scenarios and transaction crash checks pass". It should cite the logs. Its scenario evidence predates the edits made two minutes later.
- No row records the 20:36 `startFresh` change, which moved the launch outside the registry lock, although `fresh-launch-boundary-before.txt` and `fresh-launch-boundary-after.txt` exist.
- The verification record in `requirements.md` cites `package-final-parent.txt` and `subscription-installed-parent.txt` as final. Both predate the last source changes.
- The rows that should hold do hold. The superseding row for manual timestamps follows the append-only rule. The UTF-8 and packaging rows have failing-first evidence. The root-gate row is candid.

## Unresolved gaps

- This review did not rerun the package suite, installed-Pi e2e, typecheck, or statechart suite on the final source. The parent was running them.
- I did not run the mixed-version Pi-session overwrite in R1. It is inferred from `HEAD`'s `createDesired`, which writes a version 1 file built from an empty read.
- I measured R2's real-Pi retry rate only through the exit code of one failing `pi -p`. The rate per event depends on Pi's startup time.
- PID reuse is untested. Leases and the supervisor lock check liveness by PID alone. A stale lock left by a crash before a reboot could look live if an unrelated process gets the same PID. That would leave the registry permanently "busy" until someone deletes the lock. This is inferred from `acquireLease` and is rare.
- No test covers the reboot unit. Under launchd, `PI_PSTACK_PI_COMMAND` is absent and `PATH` is minimal. That would make every detached run fail and feed R2. This is inferred, not run.
- These reproductions live in `/tmp/pstack-final-review/`, which is not durable. Each finding above records its observed numbers so the result does not depend on that directory.

## Attention

reviewed by claude-subscription/claude-opus-5-5:xhigh

- R1 and R2 block a subscription-parity claim. R1 affects anyone who upgrades while a supervisor is running. R2 starts on an ordinary auth or provider failure.
- Rerun the package suite and `PSTACK_E2E_PI="$(command -v pi)"` e2e on the final source, record the Pi path and version in the log, and update the `requirements.md` verification record and the 20:34:28 trail row.
- Reconcile `requirements.md` with `inventory-semantic-review.md`, and add R1, R2, R5, and R6 to the limits until they are fixed.
