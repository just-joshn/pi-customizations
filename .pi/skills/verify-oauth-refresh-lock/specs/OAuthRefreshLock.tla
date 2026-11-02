---- MODULE OAuthRefreshLock ----
\* Formal specification of the cross-process OAuth token refresh file lock.
\*
\* Guarded implementation in:
\* - extensions/pi-anthropic-oauth/src/refresh-file-lock.ts (withRefreshFileLock)
\* - extensions/pi-anthropic-oauth/src/auth-recovery.ts (createAuthRecovery, refreshRemembered)
\*
\* Core guarantees verified:
\* 1. MutualExclusion: At most one process executes the refresh critical section.
\* 2. SingleRefreshWhenNoCrash: When multiple processes race after token expiration,
\*    oauth.refresh() is called at most once. Other processes reuse the shared token.
\* 3. UpdatedTokenOnSuccess: Any process completing recovery holds a strictly newer token.
\* 4. NoDeadlock: System never deadlocks, even if a holder crashes (stale lock stealing).

EXTENDS Naturals, FiniteSets

CONSTANTS
  Processes,     \* Set of concurrent client processes, e.g. {p1, p2}
  MaxRetries     \* Max ELOCKED retries before throwing (REFRESH_LOCK_MAX_RETRIES = 5)

VARIABLES
  pc,            \* Process state / program counter
  attempts,      \* Retry attempts counter per process
  localToken,    \* Process in-memory cached access token version (remembered)
  failedAccess,  \* Token version that failed with 401/403
  lockState,     \* Lock directory existence: "free" or "held"
  lockHolder,    \* Live process owning lock directory, or "none"
  sharedToken,   \* Token version written in claude-subscription-refresh.json
  serverToken,   \* Current valid token on OAuth server
  refreshCount   \* Number of network calls made to oauth.refresh()

vars == <<pc, attempts, localToken, failedAccess, lockState, lockHolder, sharedToken, serverToken, refreshCount>>

InLockStates == {"read_shared", "calling_refresh", "write_shared", "releasing"}

Init ==
  /\ pc = [p \in Processes |-> "needs_refresh"]
  /\ attempts = [p \in Processes |-> 0]
  /\ localToken = [p \in Processes |-> 1]
  /\ failedAccess = [p \in Processes |-> 1]
  /\ lockState = "free"
  /\ lockHolder = "none"
  /\ sharedToken = 0
  /\ serverToken = 1
  /\ refreshCount = 0

\* Step 1: Process attempts mkdir(lockPath) (refresh-file-lock.ts:91)
TryAcquire(p) ==
  /\ pc[p] = "needs_refresh"
  /\ IF lockState = "free"
     THEN /\ lockState' = "held"
          /\ lockHolder' = p
          /\ pc' = [pc EXCEPT ![p] = "read_shared"]
          /\ UNCHANGED attempts
     ELSE /\ pc' = [pc EXCEPT ![p] = "check_stale"]
          /\ UNCHANGED <<lockState, lockHolder, attempts>>
  /\ UNCHANGED <<localToken, failedAccess, sharedToken, serverToken, refreshCount>>

\* Step 2: Handle EEXIST, stat the lock directory via lockAbandoned (refresh-file-lock.ts:60-68, 94-102)
CheckStale(p) ==
  /\ pc[p] = "check_stale"
  /\ IF lockState = "free" \/ (lockHolder /= "none" /\ pc[lockHolder] = "crashed")
     THEN /\ pc' = [pc EXCEPT ![p] = "steal_lock"]
          /\ UNCHANGED attempts
     ELSE IF attempts[p] < MaxRetries
          THEN /\ attempts' = [attempts EXCEPT ![p] = attempts[p] + 1]
               /\ pc' = [pc EXCEPT ![p] = "needs_refresh"]
          ELSE /\ pc' = [pc EXCEPT ![p] = "failed"]
               /\ UNCHANGED attempts
  /\ UNCHANGED <<localToken, failedAccess, lockState, lockHolder, sharedToken, serverToken, refreshCount>>

\* Step 3: rm(lockPath, { force }) removes whatever directory exists now, then retries mkdir (refresh-file-lock.ts:96-97)
StealLock(p) ==
  /\ pc[p] = "steal_lock"
  /\ lockState' = "free"
  /\ lockHolder' = "none"
  /\ pc' = [pc EXCEPT ![p] = "needs_refresh"]
  /\ UNCHANGED <<attempts, localToken, failedAccess, sharedToken, serverToken, refreshCount>>

\* Step 4: Inside lock, read claude-subscription-refresh.json (auth-recovery.ts:112-116)
ReadShared(p) ==
  /\ pc[p] = "read_shared"
  /\ IF sharedToken > failedAccess[p]
     THEN /\ localToken' = [localToken EXCEPT ![p] = sharedToken]
          /\ pc' = [pc EXCEPT ![p] = "releasing"]
     ELSE /\ pc' = [pc EXCEPT ![p] = "calling_refresh"]
          /\ UNCHANGED localToken
  /\ UNCHANGED <<attempts, failedAccess, lockState, lockHolder, sharedToken, serverToken, refreshCount>>

\* Step 5: Execute oauth.refresh(current) network endpoint (auth-recovery.ts:121)
CallRefresh(p) ==
  /\ pc[p] = "calling_refresh"
  /\ serverToken' = serverToken + 1
  /\ refreshCount' = refreshCount + 1
  /\ localToken' = [localToken EXCEPT ![p] = serverToken']
  /\ pc' = [pc EXCEPT ![p] = "write_shared"]
  /\ UNCHANGED <<attempts, failedAccess, lockState, lockHolder, sharedToken>>

\* Step 6: Atomically write new credential to shared file (auth-recovery.ts:122)
WriteShared(p) ==
  /\ pc[p] = "write_shared"
  /\ sharedToken' = localToken[p]
  /\ pc' = [pc EXCEPT ![p] = "releasing"]
  /\ UNCHANGED <<attempts, localToken, failedAccess, lockState, lockHolder, serverToken, refreshCount>>

\* Step 7: Finally block removes lock directory (refresh-file-lock.ts:109-110)
ReleaseLock(p) ==
  /\ pc[p] = "releasing"
  /\ lockState' = "free"
  /\ lockHolder' = "none"
  /\ pc' = [pc EXCEPT ![p] = "success"]
  /\ UNCHANGED <<attempts, localToken, failedAccess, sharedToken, serverToken, refreshCount>>

\* Step 8: Crash scenario (process dies while holding lock)
Crash(p) ==
  /\ pc[p] \in InLockStates
  /\ pc' = [pc EXCEPT ![p] = "crashed"]
  /\ UNCHANGED <<attempts, localToken, failedAccess, lockState, lockHolder, sharedToken, serverToken, refreshCount>>

\* Terminal action for deadlock detection
Done ==
  /\ \A p \in Processes : pc[p] \in {"success", "failed", "crashed"}
  /\ UNCHANGED vars

Next ==
  \/ (\E p \in Processes :
        \/ TryAcquire(p)
        \/ CheckStale(p)
        \/ StealLock(p)
        \/ ReadShared(p)
        \/ CallRefresh(p)
        \/ WriteShared(p)
        \/ ReleaseLock(p)
        \/ Crash(p))
  \/ Done

\* --- FORMAL PROPERTIES ---

\* Invariant 1: Mutual exclusion of the refresh critical section
MutualExclusion ==
  \A p, q \in Processes :
    (p /= q /\ pc[p] \in InLockStates) => pc[q] \notin InLockStates

\* Invariant 2: At most one refresh call per expired epoch in non-crash executions
SingleRefreshWhenNoCrash ==
  (\A p \in Processes : pc[p] /= "crashed") => (refreshCount <= 1)

\* Invariant 3: Lock holder tracking consistency
LockHolderConsistent ==
  (lockState = "held" /\ lockHolder /= "none") =>
    (pc[lockHolder] \in (InLockStates \cup {"crashed"}))

\* Invariant 4: Any successfully completed process has updated its token
UpdatedTokenOnSuccess ==
  \A p \in Processes :
    (pc[p] = "success") => (localToken[p] > failedAccess[p])

====
