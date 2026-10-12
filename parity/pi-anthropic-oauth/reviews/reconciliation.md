# Review reconciliation

Independent reviews: `reviews/parity.md`, `reviews/security.md`, `reviews/architecture.md`. Each was a fresh `pi -p --no-session` process with read-only tools. The first two security and architecture launches timed out with empty files; the retained files are the successful retries.

## Fixed

- Parity review: OAUTH-001 now asserts bearer plus no `x-api-key`. OAUTH-004, 009, and 013 were narrowed to the cited tests. OAUTH-011 was downgraded to INCONCLUSIVE. `prove-native.ts` now asserts billing, user-agent, and no `x-api-key` after reload. The parity matrix no longer calls the `eb7` pin or session header a Claude observation.
- Architecture review: Pi cancels `/login` with the exact error `Login cancelled` and does not abort the signal. `src/auth.ts` now rethrows that error. `test/auth-boundaries.test.ts` covers it.

## Refuted or already recorded

- Extra `ANTHROPIC_OAUTH_TOKEN` alias: recorded in OAUTH-010. It cannot outrank the two variables Claude consults. Removing it would drop a Pi-documented token. Not a silent API-key fallback.
- Non-`oat` `ANTHROPIC_AUTH_TOKEN` fails closed instead of skipping to the setup token. That matches the package rule against silent account or API-key fallback.
- Billing salt and indexes remain OAUTH-003. They were not newly copied in this audit.
- Once-per-session compaction failure reporting is the documented latch, not an accidental swallow.
- Authorize-URL delegation remains the selected design. OAUTH-007 stays NOT VERIFIED.

## Recorded residuals

- Guard `session_start` can reset `inFlight` while a compaction promise is outstanding. No probe showed that interleaving, so no generation counter was added.
- `isSummarizationRequest` matches the substring `summarization assistant`. A normal system prompt containing that phrase would be fitted as a summary. Session history is not mutated.
- Compaction and fit errors are stored as session entries. Current messages do not include tokens; a future Pi error could.
