---
name: verify-oauth-refresh-lock
description: "Formally verify cross-process OAuth token refresh locking and single-flight token reuse across concurrent processes. Use after editing refresh-file-lock.ts, auth-recovery.ts, or modifying OAuth concurrency and refresh logic."
---

# Verify OAuth refresh lock

Formally verify the concurrency protocol that coordinates OAuth subscription token refreshes across parallel processes, subagents, and sessions.

## Why this property matters

Anthropic Claude subscription OAuth tokens rotate their refresh token on every successful exchange. If two parallel subagents or processes experience a 401/403 token expiration at the same time and both attempt to refresh the old refresh token against Anthropic:

1. Process A exchanges refresh token `R1` for `(A2, R2)`.
2. Process B attempts to exchange `R1`.
3. Anthropic's authorization server flags `R1` as a reused token, revokes the entire token family, and terminates the user's subscription session.

To prevent this catastrophic revocation, `pi-anthropic-oauth` implements a cross-process mutual exclusion file lock (`withRefreshFileLock` in `refresh-file-lock.ts`) combined with an atomic shared credential cache (`refreshRemembered` in `auth-recovery.ts`). Exactly one process refreshes the token against the network; all other processes wait on the lock, read the newly written token from `claude-subscription-refresh.json`, and resume their requests without refreshing again.

## Coverage record and sync commit

- **Last sync commit:** `697586ab143d0c4a2287083d4b1f4d6f1682c361`
- **Covered files and functions:**
  - `extensions/pi-anthropic-oauth/src/refresh-file-lock.ts`:
    - `withRefreshFileLock` (cross-process directory lock, `EEXIST` backoff, and stale lock stealing)
    - `lockAbandoned` (`staleMs` mtime comparison, and `true` on `ENOENT`)
    - `refreshLockPathFor` (lock directory location)
    - `defaultRefreshLockRetryDelayMs` (Claude retry delay)
  - `extensions/pi-anthropic-oauth/src/auth-recovery.ts`:
    - `createAuthRecovery` (in-process latch and fetch wrapping)
    - `refreshRemembered` (single-flight coordination, reading `shared` before refresh, writing `shared` after refresh)
    - `readSharedCredential` (reading `claude-subscription-refresh.json`)
    - `writeSharedCredential` (atomic temporary file write + rename)
    - `sharePathFor` (shared credential location)

When any of the files listed above change after the sync commit, the verification must be rechecked. Advance the sync commit only after confirming the TLA+ specification accurately reflects the updated code.

## How to run

### 1. One-command verification

Run the verification script from the repository root:

```bash
./.pi/skills/verify-oauth-refresh-lock/bin/verify-oauth-refresh-lock
```

The script runs TLC model checking on `.pi/skills/verify-oauth-refresh-lock/specs/OAuthRefreshLock.tla` using `.pi/skills/verify-oauth-refresh-lock/specs/OAuthRefreshLock.cfg`. It exits `0` when all properties hold and `1` with a counterexample trace if any invariant fails.

### 2. Statechart and visual trace inspection

To inspect state transitions, render a state graph, or analyze counterexample traces, use the pstack `/statechart` skill by name. The `/statechart` skill checks the TLA+ model and:

- When an invariant fails: outputs the shortest path to the breaking state in plain words.
- When all invariants hold: draws a Mermaid statechart using the view module in `.pi/skills/verify-oauth-refresh-lock/specs/OAuthRefreshLockView.ts`.

Refer to `/statechart` by name.

## Formal properties verified

1. **`MutualExclusion`**:
   $$\forall p, q \in Processes : (p \neq q \wedge pc[p] \in InLockStates) \implies pc[q] \notin InLockStates$$
   At most one process can execute the refresh critical section (`read_shared`, `calling_refresh`, `write_shared`, `releasing`) at any moment.

2. **`SingleRefreshWhenNoCrash`**:
   $$(\forall p \in Processes : pc[p] \neq \text{"crashed"}) \implies refreshCount \le 1$$
   Across all racing processes that experienced token expiration, at most one network call to `oauth.refresh()` is made. The other waiting processes read the shared credential file and reuse the rotated token.

3. **`LockHolderConsistent`**:
   $$(lockState = \text{"held"} \wedge lockHolder \neq \text{"none"}) \implies pc[lockHolder] \in (InLockStates \cup \{\text{"crashed"}\})$$
   The lock directory exists only while held by a known live or crashed process.

4. **`UpdatedTokenOnSuccess`**:
   $$\forall p \in Processes : (pc[p] = \text{"success"}) \implies localToken[p] > failedAccess[p]$$
   Any process that completes recovery holds an access token strictly newer than the expired token that triggered recovery.

5. **`NoDeadlock`**:
   The entire state graph is free of deadlocks. If a process crashes while holding the lock, surviving processes detect that the lock is abandoned after `staleMs` and steal the lock to complete recovery.

## Bounds and assumptions

- **State space bound:** Model-checked for 2 concurrent processes (`Processes = {p1, p2}`) racing from token expiration up to 2 retries (`MaxRetries = 2`). Full reachable state space (488 generated states, 310 distinct states) is exhaustively searched.
- **Filesystem atomicity:** Assumes POSIX directory creation (`mkdir`) is atomic and returns `EEXIST` when already created.
- **Clock and timeout separation:** Assumes `staleMs` (30s) exceeds maximum refresh timeout (15s). A live process never holds the lock longer than `staleMs`.
- **Out of scope:** Raw TCP network drops, TLS socket resets, or Anthropic upstream service outages.

## Distinguishing real bugs from modeling drift

- **If `MutualExclusion` breaks:** Check whether lock stealing was triggered while the holder was still alive. In the code, `REFRESH_LOCK_STALE_MS` (30s) must strictly exceed `REFRESH_TIMEOUT_MS` (15s). If `staleMs` is reduced below 15s, a slow network call causes another process to steal the lock, causing concurrent refreshes.
- **If `SingleRefreshWhenNoCrash` breaks:** Check whether `readSharedCredential()` is being called before `oauth.refresh()`, and whether the returned token's expiry is verified. If the check is omitted or reordered, multiple processes will each call `oauth.refresh()`.
- **If `NoDeadlock` breaks:** Check whether `lockAbandoned()` correctly inspects `mtime` and whether `rm(lockPath)` succeeds during stale lock stealing.
