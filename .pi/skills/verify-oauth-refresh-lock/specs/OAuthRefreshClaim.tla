---- MODULE OAuthRefreshClaim ----
\* Cross-process single-flight OAuth refresh, keyed by the refresh token.
\*
\* Code: extensions/pi-anthropic-oauth/src/refresh-claim.ts (rotateRefreshToken, followChain, tryClaim, writeSuccessor)
\*       extensions/pi-anthropic-oauth/src/auth.ts (the subscriptionAuth refresh hook, which Pi core's expiry
\*       refresh and the 401 recovery in auth-recovery.ts both call)
\* Each action names the code step it models. Citations use symbols, not line numbers.
\*
\* One refresh token R1 is current. A claim on it is the file <sha256(R1)>.<gen>, created with
\* open(path, 'wx'). exists[g] is that file, owner[p] is the generation p created.
EXTENDS Naturals, FiniteSets

CONSTANTS Processes, MaxRetries, MaxGen

VARIABLES pc, attempts, view, target, localToken, exists, owner, sharedToken, serverToken, revoked

vars == <<pc, attempts, view, target, localToken, exists, owner, sharedToken, serverToken, revoked>>

Gens == 1..MaxGen
ClaimStates == {"reuse_after_claim", "calling_refresh", "publish", "releasing"}
MaxExisting == IF \E g \in Gens : exists[g] THEN CHOOSE g \in Gens : exists[g] /\ \A h \in Gens : exists[h] => h <= g ELSE 0
Holder(g) == IF \E p \in Processes : owner[p] = g THEN CHOOSE p \in Processes : owner[p] = g ELSE "none"

Init ==
  /\ pc = [p \in Processes |-> "reuse"]
  /\ attempts = [p \in Processes |-> 0]
  /\ view = [p \in Processes |-> 0]
  /\ target = [p \in Processes |-> 0]
  /\ localToken = [p \in Processes |-> 1]
  /\ exists = [g \in Gens |-> FALSE]
  /\ owner = [p \in Processes |-> 0]
  /\ sharedToken = 0
  /\ serverToken = 1
  /\ revoked = FALSE

\* rotateRefreshToken: followChain finds a successor recorded in a claim file for R1 (or the legacy share file).
Reuse(p) ==
  /\ pc[p] \in {"reuse", "reuse_after_claim"}
  /\ IF sharedToken > 1
     THEN /\ localToken' = [localToken EXCEPT ![p] = sharedToken]
          /\ pc' = [pc EXCEPT ![p] = "success"]
     ELSE /\ pc' = [pc EXCEPT ![p] = IF pc[p] = "reuse" THEN "list" ELSE "calling_refresh"]
          /\ UNCHANGED localToken
  /\ UNCHANGED <<attempts, view, target, exists, owner, sharedToken, serverToken, revoked>>

\* tryClaim: readdir finds the latest generation for the key.
List(p) ==
  /\ pc[p] = "list"
  /\ view' = [view EXCEPT ![p] = MaxExisting]
  /\ pc' = [pc EXCEPT ![p] = "stat"]
  /\ UNCHANGED <<attempts, target, localToken, exists, owner, sharedToken, serverToken, revoked>>

\* tryClaim: stat the latest claim. ENOENT reuses its generation. An mtime older than staleMs takes
\* the next generation. A live claimant is never judged stale (staleMs > REFRESH_TIMEOUT_MS).
\* A crashed or finished claimant may look fresh or stale.
Stat(p) ==
  /\ pc[p] = "stat"
  /\ LET g == view[p] IN
     \/ /\ g = 0
        /\ target' = [target EXCEPT ![p] = 1]
        /\ pc' = [pc EXCEPT ![p] = "create"]
     \/ /\ g > 0 /\ ~exists[g]
        /\ target' = [target EXCEPT ![p] = g]
        /\ pc' = [pc EXCEPT ![p] = "create"]
     \/ /\ g > 0 /\ exists[g]
        /\ LET h == Holder(g) IN
           \/ /\ pc' = [pc EXCEPT ![p] = "wait"]
              /\ UNCHANGED target
           \/ /\ h = "none" \/ pc[h] \in {"crashed", "success"}
              /\ g < MaxGen
              /\ target' = [target EXCEPT ![p] = g + 1]
              /\ pc' = [pc EXCEPT ![p] = "create"]
  /\ UNCHANGED <<attempts, view, localToken, exists, owner, sharedToken, serverToken, revoked>>

\* tryClaim: open(<key>.<gen>, 'wx'). EEXIST means another process won this generation.
Create(p) ==
  /\ pc[p] = "create"
  /\ IF exists[target[p]]
     THEN /\ pc' = [pc EXCEPT ![p] = "wait"]
          /\ UNCHANGED <<exists, owner>>
     ELSE /\ exists' = [exists EXCEPT ![target[p]] = TRUE]
          /\ owner' = [owner EXCEPT ![p] = target[p]]
          /\ pc' = [pc EXCEPT ![p] = "reuse_after_claim"]
  /\ UNCHANGED <<attempts, view, target, localToken, sharedToken, serverToken, revoked>>

\* rotateRefreshToken: retry after retryDelayMs, or throw ELOCKED after retries.
Wait(p) ==
  /\ pc[p] = "wait"
  /\ IF attempts[p] < MaxRetries
     THEN /\ attempts' = [attempts EXCEPT ![p] = attempts[p] + 1]
          /\ pc' = [pc EXCEPT ![p] = "reuse"]
     ELSE /\ pc' = [pc EXCEPT ![p] = "failed"]
          /\ UNCHANGED attempts
  /\ UNCHANGED <<view, target, localToken, exists, owner, sharedToken, serverToken, revoked>>

\* rotateRefreshToken: refresh(target) with its own REFRESH_TIMEOUT_MS. Sending a token the server already rotated revokes the family.
CallRefresh(p) ==
  /\ pc[p] = "calling_refresh"
  /\ revoked' = (revoked \/ localToken[p] < serverToken)
  /\ serverToken' = serverToken + 1
  /\ localToken' = [localToken EXCEPT ![p] = serverToken + 1]
  /\ pc' = [pc EXCEPT ![p] = "publish"]
  /\ UNCHANGED <<attempts, view, target, exists, owner, sharedToken>>

\* refresh(target) throws before the server sees the request.
RefreshFails(p) ==
  /\ pc[p] = "calling_refresh"
  /\ pc' = [pc EXCEPT ![p] = "releasing"]
  /\ UNCHANGED <<attempts, view, target, localToken, exists, owner, sharedToken, serverToken, revoked>>

\* rotateRefreshToken catch: rm(claimPath) deletes only this process's claim.
Release(p) ==
  /\ pc[p] = "releasing"
  /\ exists' = [exists EXCEPT ![owner[p]] = FALSE]
  /\ owner' = [owner EXCEPT ![p] = 0]
  /\ pc' = [pc EXCEPT ![p] = "failed"]
  /\ UNCHANGED <<attempts, view, target, localToken, sharedToken, serverToken, revoked>>

\* writeSuccessor: the new credential goes into this process's own claim file, temporary file then rename.
Publish(p) ==
  /\ pc[p] = "publish"
  /\ sharedToken' = localToken[p]
  /\ pc' = [pc EXCEPT ![p] = "success"]
  /\ UNCHANGED <<attempts, view, target, localToken, exists, owner, serverToken, revoked>>

\* Crash after the claim and before the refresh request. A crash after the request is out of scope.
Crash(p) ==
  /\ pc[p] \in {"reuse_after_claim", "calling_refresh"}
  /\ pc' = [pc EXCEPT ![p] = "crashed"]
  /\ UNCHANGED <<attempts, view, target, localToken, exists, owner, sharedToken, serverToken, revoked>>

Done ==
  /\ \A p \in Processes : pc[p] \in {"success", "failed", "crashed"}
  /\ UNCHANGED vars

Next ==
  \/ \E p \in Processes :
       Reuse(p) \/ List(p) \/ Stat(p) \/ Create(p) \/ Wait(p) \/ CallRefresh(p)
       \/ RefreshFails(p) \/ Release(p) \/ Publish(p) \/ Crash(p)
  \/ Done

NoRefreshTokenReuse == ~revoked

SingleClaimant ==
  \A p, q \in Processes : (p /= q /\ pc[p] \in ClaimStates) => pc[q] \notin ClaimStates

UpdatedTokenOnSuccess == \A p \in Processes : pc[p] = "success" => localToken[p] > 1
====
