GOAL
Attempt to close `npm:typescript@7.0.2` deep compiler-behavior semantics with a pinned compiler-test oracle: obtain TypeScript 7.0.2 sources or published tests, run a bounded internal-module suite, record path+hash evidence covering the 136 internal_module_surface contracts (or prove that is impossible and keep still_open with measured blocker).

SCOPE
May write under `parity/research/dep-typescript-oracle-suite-001/`, `parity/briefs/reports/u-dep-typescript-oracle-suite-001-report.md`.
Must not edit ledgers. Must not claim closure from consumer typecheck alone.

CONTEXT
Disposition: `parity/research/dep-typescript-deep-001/disposition.json` (still_open; npm package ships no tests). Standing: orch preferences.md.

ACCEPTANCE
- closed-with-oracle + merge payload removing the unresolvedReference, OR still-open with fetch/run evidence of why the suite cannot be obtained/run.
- Reproduce commands in the report.

VERIFY
Re-run oracle commands; match reported hashes.

TIMEBOX
120 minutes.

FORBIDDEN
No ledger edits. No fake suite. No commit. Do not spawn further subagents.

REPORT
parity/briefs/reports/u-dep-typescript-oracle-suite-001-report.md

STANDING
Obey orch preferences.md.
