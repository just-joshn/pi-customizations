---
name: verify-oauth-refresh-lock
description: "Formally verify that concurrent Pi processes never send the same Claude OAuth refresh token twice during 401 recovery. Use after editing refresh-claim.ts or auth-recovery.ts, or when changing OAuth refresh concurrency."
---

# Verify OAuth refresh claims

Formally verify the protocol that makes one Pi process, across parallel processes, subagents, and sessions, send a given OAuth refresh token to Anthropic.

## Why this property matters

Claude subscription OAuth rotates the refresh token on every successful exchange. If two processes send the same refresh token `R1`, the authorization server sees a reused token, revokes the whole token family, and ends the user's subscription session.

`pi-anthropic-oauth` prevents this with a claim keyed by the refresh token. A process that must refresh `R1` creates the file `<sha256(R1)>.<gen>` in `claude-subscription-refresh.claims` with `open(path, 'wx')`. Exactly one process creates each name. The winner checks the log again, calls `oauth.refresh()` only if no successor is recorded, and writes the new credential into its own claim file. That file is the log entry that maps `R1` to its successor. The other processes wait and follow the log to the newest credential.

Every refresh goes through this path. The `subscriptionAuth` refresh hook calls `rotateRefreshToken`, and both Pi core's expiry refresh and the 401 recovery call that hook. Pi core persists what the hook returns, so a stale refresh token in `auth.json` resolves to the newest credential instead of being sent.

A claimant that crashes before it sends leaves its claim. After `staleMs` a waiter creates the next generation, `gen + 1`. No process ever removes another process's claim, so a claim name is never reused while its token is current. A claimant whose refresh fails deletes only its own claim.

## Coverage record and sync commit

- **Last sync commit:** `c347afa9ce08716271a69aa1a314fcb019509a7e`
- **Covered files and functions:**
  - `extensions/pi-anthropic-oauth/src/refresh-claim.ts`: `rotateRefreshToken` (follow the log, claim, follow again, refresh with its own timeout, release on failure, record the successor, retry and `ELOCKED`), `rotationChain` and `followChain` (recorded successors and the legacy share file), `tryClaim` (latest generation, `ENOENT`, mtime staleness, exclusive create), `writeSuccessor`.
  - `extensions/pi-anthropic-oauth/src/auth.ts`: the `subscriptionAuth` refresh hook, the only caller of the raw OAuth refresh when a rotation directory is bound.
  - `extensions/pi-anthropic-oauth/src/auth-recovery.ts`: `refreshRemembered`, which calls the hook.

The spec cites each code step by function name, not by line number. When a covered file changes after the sync commit, recheck the spec against the code. Advance the sync commit only after the spec matches the code.

## How to run

From the repository root:

```bash
./.pi/skills/verify-oauth-refresh-lock/bin/verify-oauth-refresh-lock
```

The script runs TLC on `specs/OAuthRefreshClaim.tla` with `specs/OAuthRefreshClaim.cfg`. It exits `0` when every property holds and `1` with the counterexample trace when one fails.

To render the state graph or read a counterexample as steps, use the pstack `/statechart` skill with the view module `specs/OAuthRefreshClaimView.ts`.

## Formal properties verified

1. **`NoRefreshTokenReuse`.** No process sends a refresh token that the server has already rotated. This is the property the protocol exists for.
2. **`SingleClaimant`.** At most one process is between creating a claim and finishing with it (`reuse_after_claim`, `calling_refresh`, `publish`, `releasing`).
3. **`UpdatedTokenOnSuccess`.** A process that finishes recovery holds a token newer than the one that failed.
4. **Deadlock freedom.** Every behavior reaches an end state, including when a claimant crashes and waiters take over.

## Bounds and assumptions

- **Bound:** 3 processes (`Processes = {p1, p2, p3}`), `MaxRetries = 2`, `MaxGen = 4`. TLC explores 92966 states, 42062 distinct. A run with 4 processes also passes (11076022 states, 4144539 distinct). Keep at least 3 processes, because a takeover race needs a crashed claimant and two contenders.
- **Exclusive create:** `open(path, 'wx')` fails with `EEXIST` when the name exists, on every process that shares the directory.
- **Timing:** a live claimant finishes within `staleMs` (30s), which is above `REFRESH_TIMEOUT_MS` (15s). A process paused longer than `staleMs`, such as a suspended laptop, breaks this assumption.
- **Crash point:** a claimant crashes before it sends the refresh request. A crash after the server rotates the token and before `writeSuccessor` loses the new token. No client protocol can recover it, so the model leaves it out.
- **Failure point:** a failed refresh never reached the server. A request that rotated the token and then lost its response is out of scope for the same reason.
- **Successor chains:** the model has one token. A successor that is about to expire starts a new rotation keyed by the successor's token, which is the same protocol on a different key, so the model covers it by symmetry.
- **Log retention:** the sweep keeps every entry on the chain from the credential in `auth.json` and deletes other entries after 24 hours. A process whose remembered token left the chain more than 24 hours ago is not modeled.

## Break tests

These edits to the spec must each fail a property. Run them after a change to the protocol to confirm the check can still fail:

- `Create` ignores `exists` (a non-exclusive create): `SingleClaimant` fails.
- The claimant skips the reuse after it claims (`reuse_after_claim`): `NoRefreshTokenReuse` fails, because a finished claim looks stale after `staleMs`.
- `Stat` lets a waiter take over a live claimant: `SingleClaimant` fails.

## Distinguishing real bugs from modeling drift

- **If `NoRefreshTokenReuse` breaks:** check that `rotateRefreshToken` follows the log again after it creates the claim and before it refreshes, and that no code calls the raw OAuth refresh except through `rotateRefreshToken` when a rotation directory is bound.
- **If `SingleClaimant` breaks:** check that `tryClaim` creates with `'wx'`, never removes a claim it did not create, and judges staleness from the latest generation only.
- **If deadlock appears:** check that a failed refresh deletes its own claim and that an `ENOENT` latest claim lets a waiter reuse that generation.
