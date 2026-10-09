# FIXTURE_CI_LOOP
PR: https://github.com/just-joshn/team-kit-gh-fixture/pull/10
- Initial gh pr checks: 2x test (ci) FAILURE. Log: npm test exits 1 because hello.js VALUE was 0 (expected 7).
- Fix: hello.js VALUE 0 -> 7, verified locally (npm test ok), committed and pushed (no force, no hooks bypass).
- Re-check via gh pr checks: both test (ci) checks pass (runs 37879874122, 37879877015).
