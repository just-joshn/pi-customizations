# Recall: hello-cli verification (scope: this fixture, last 7 days; seed/ only)

## Capsule
- verify-hello-cli was generated for hello.sh (expected output HELLO-FAMILY-13); prove and maintain were deliberately skipped (a1b2c3d4-e5f6-7890-abcd-ef1234567890).
- evidence/hello-print is empty, so nothing is proven yet (a1b2c3d4-...).
- An earlier prove wrapper (PR #41) shipped and was reverted for flaky exit codes (b2c3d4e5-f6a7-8901-bcde-f12345678901; shared-record/pr-notes.md).
- Draft PR #42 re-adds Launch prove with a stdout assertion; branch feature/hello-cli is still open.
- Live git/gh state was not checked; this brief is from seed/ only.

## Threads
- [in flight feature/hello-cli] verify-hello-cli skill created, prove and maintain not run (a1b2c3d4-...).
- [reverted #41] Prove wrapper reverted after exit 0 with empty stdout (b2c3d4e5-...; pr-notes.md).
- [open PR #42] Draft re-adds Launch prove with HELLO-FAMILY-13 stdout assertion (pr-notes.md).
- [planned, not started] Maintain offer after generate-then-reuse (user-reports.md).

## Problems
1. Prove reported green while hello.sh never printed HELLO-FAMILY-13 in CI (user-reports.md).
2. Prove wrapper flaked: exit 0 with empty stdout, causing the #41 revert.
3. Maintain offer never ran after the generate-then-reuse pair (user-reports.md).
4. evidence/hello-print is empty, so there is no proof artifact.
5. Live PR/branch state unverified here.

## Next move
Run the skill's Launch prove against hello.sh on feature/hello-cli and assert that stdout contains HELLO-FAMILY-13 (not just exit code). Save the output to evidence/hello-print, then check that PR #42 does the same.
