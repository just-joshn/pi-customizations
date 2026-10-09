# CI loop notes — PR #9

FIXTURE_CI_LOOP

PR: https://github.com/just-joshn/team-kit-gh-fixture/pull/9
Branch: fixture/fail-ci-cursor-mv0esgmh
Source of truth: `gh pr checks`

## Iteration 1 — inspect

Initial `gh pr checks --json`:
- test / ci — FAILURE (run 37879697938)
- test / ci — FAILURE (run 37879694116)

Failed logs: `npm test` exits 1 because `hello.js` exports `VALUE: 0` while the test requires `VALUE === 7`.

## Fix

- Changed `hello.js` `VALUE` from `0` to `7`.
- Local `npm test` → `ok fixture-alpha`.
- Commit `0602b4e` — Fix CI: set hello.VALUE to 7 so npm test passes.
- Pushed to `origin/fixture/fail-ci-cursor-mv0esgmh` (no force-push).

## Iteration 2 — watch

`gh pr checks --watch --fail-fast` then re-checked:

- test / ci — SUCCESS (run 37879743409)
- test / ci — SUCCESS (run 37879746840)

All attached checks bucket=pass / state=SUCCESS. Loop complete.
