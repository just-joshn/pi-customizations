---
name: verify-oauth-refresh-lock
description: "Formally verify that concurrent Pi processes never send the same Claude OAuth refresh token twice during 401 recovery. Use after editing refresh-claim.ts or auth-recovery.ts, or when changing OAuth refresh concurrency."
---

# Verify OAuth refresh claims

Formally verify the protocol that makes one Pi process, across parallel processes, subagents, and sessions, send a given OAuth refresh token to Anthropic.

## Why this property matters

Claude subscription OAuth rotates the refresh token on every successful exchange. If two processes send the same refresh token `R1`, the authorization server sees a reused token, revokes the whole token family, and ends the user's subscription session.

`pi-anthropic-oauth` prevents this with a claim keyed by the refresh token. A process that must refresh `R1` creates the file `<sha256(R1)>.<gen>` in `claude-subscription-refresh.claims` with `open(path, 'wx')`. Exactly one process creates each name. The winner re-reads `claude-subscription-refresh.json`, calls `oauth.refresh()` only if no other process published a newer credential, and publishes the result there. The other processes wait and reuse the published credential.

A claimant that crashes before it sends leaves its claim. After `staleMs` a waiter creates the next generation, `gen + 1`. No process ever removes another process's claim, so a claim name is never reused while its token is current. A claimant whose refresh fails deletes only its own claim.

## Coverage record and sync commit

- **Last sync commit:** `fd3c544862f13c257dc51ea2daaa02a1a54c31a0`
- **Covered files and functions:**
  - `extensions/pi-anthropic-oauth/src/refresh-claim.ts`: `withRefreshTokenClaim` (reuse, claim, reuse again, refresh, release on failure, retry and `ELOCKED`), `tryClaim` (latest generation, `ENOENT`, mtime staleness, exclusive create), `refreshClaimDirectoryFor`.
  - `extensions/pi-anthropic-oauth/src/auth-recovery.ts`: `refreshRemembered` (shared credential reuse, remembered credential check, the `steps` passed to `withRefreshTokenClaim`), `readSharedCredential`, `writeSharedCredential`.

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
- **Crash point:** a claimant crashes before it sends the refresh request. A crash after the server rotates the token and before `writeSharedCredential` loses the new token. No client protocol can recover it, so the model leaves it out.
- **Failure point:** a failed refresh never reached the server. A request that rotated the token and then lost its response is out of scope for the same reason.
- **Reuse:** the model reuses any published credential newer than the failed one. The code also rejects an expired one (`shared.expires <= Date.now()`). A waiter whose remembered token was already rotated, and whose shared credential has expired, would refresh a rotated token. The model does not cover that case.
- **Out of scope:** Pi core's own refresh of expiring credentials, which runs under `auth.json.lock` in `AuthStorage` and does not take a claim.

## Break tests

These edits to the spec must each fail a property. Run them after a change to the protocol to confirm the check can still fail:

- `Create` ignores `exists` (a non-exclusive create): `SingleClaimant` fails.
- The claimant skips the reuse after it claims (`reuse_after_claim`): `NoRefreshTokenReuse` fails, because a finished claim looks stale after `staleMs`.
- `Stat` lets a waiter take over a live claimant: `SingleClaimant` fails.

## Distinguishing real bugs from modeling drift

- **If `NoRefreshTokenReuse` breaks:** check that `withRefreshTokenClaim` calls `steps.reuse` after it creates the claim and before `steps.refresh`, and that `fromShared` rejects a credential whose access token equals the failed one.
- **If `SingleClaimant` breaks:** check that `tryClaim` creates with `'wx'`, never removes a claim it did not create, and judges staleness from the latest generation only.
- **If deadlock appears:** check that a failed refresh deletes its own claim and that an `ENOENT` latest claim lets a waiter reuse that generation.
