GOAL
Advance dependency closure toward `completeDependencyClosure: true` by resolving the Bun version pin and any remaining npm/tree refs that evidence can close; document environment-bound computer-use/enterprise edges without fabricating closure.

SCOPE
May write under `parity/research/dep-closure-wave-004/`, `parity/briefs/reports/u-dep-closure-wave-004-report.md`.
Must not edit ledgers (`dependencies.json` merge is coordinator-only). Publish a merge payload in the report.

CONTEXT
Wave-003 left Bun official pin open (local 1.4.2 only), computer-use/enterprise edges environment-bound, and several npm transitive audits incomplete. Prior: `parity/research/dep-closure-wave-003/`, report `parity/briefs/reports/u-dep-closure-wave-003-report.md`. Standing orders at orch preferences path.

ACCEPTANCE
- Report lists each targeted edge/ref: resolved with path+hash evidence, or still-unresolved with concrete blocker.
- Merge payload JSON suitable for coordinator apply.
- No invented pins.

VERIFY
Re-read official sources / lockfiles / registry metadata.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated closure. No broad allowlist/authorization changes. No commit.

REPORT
parity/briefs/reports/u-dep-closure-wave-004-report.md

STANDING
Obey orch preferences.md.
