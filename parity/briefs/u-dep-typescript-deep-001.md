GOAL
Produce a terminal honest disposition for `npm:typescript@7.0.2` deep compiler-behavior semantics: either close with a real compiler-test oracle + path+hash evidence, or publish a merge payload that keeps the reference open with a sharper blocker (do not close on typecheck/catalog alone).

SCOPE
May write under `parity/research/dep-typescript-deep-001/`, `parity/briefs/reports/u-dep-typescript-deep-001-report.md`.
Must not edit ledgers. Must not invent a full TypeScript conformance suite claim.

CONTEXT
Wave-009: `parity/research/dep-closure-wave-009/npm/typescript-deep-semantics-disposition.json` (still_open; catalogHashDriftCount=0; typecheck exit 0). Prior minimal emit under `parity/research/dep-typescript-oracle-001/` is not deep-semantics closure. Standing: orch preferences.md.

ACCEPTANCE
- Clear verdict: closed-with-oracle OR still-open-with-merge-note.
- If closed: oracle command, expected hashes, reproduce steps.
- If open: merge payload only refreshes evidence pointers; does not remove the unresolvedReference.

VERIFY
Reproduce oracle or re-read disposition hashes.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fake closure via typecheck. No commit. Do not spawn further subagents.

REPORT
parity/briefs/reports/u-dep-typescript-deep-001-report.md

STANDING
Obey orch preferences.md.
