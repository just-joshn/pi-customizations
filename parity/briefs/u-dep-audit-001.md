GOAL
Produce an independent recursive closure audit artifact that can set `closureAudited: true` honestly, or a gate proposal if custody/independence is insufficient.

SCOPE
May write under `parity/research/dep-audit-001/` and `parity/briefs/reports/u-dep-audit-001-report.md`.
Must not edit `parity/dependencies.json` or `parity/source-lock.json`.

CONTEXT
After waves 001–002, readingComplete is 34/34; 8 edges and 11 unresolved references remain. Gate still wants DEPENDENCY_AUDIT_MISSING cleared via `closureAudited`. Prefer a different model family from the implementation owner. Standing orders at orch preferences path.

ACCEPTANCE
- Audit report with sampled node/edge re-hash and disposition review.
- Merge proposal that either sets closureAudited true with evidence path, or parks a gate with default keep-parked.
- No fabricated complete closure.

VERIFY
Re-run listed shasum commands from the report.

TIMEBOX
60 minutes.

FORBIDDEN
No ledger edits. No commit. No false closureAudited.

REPORT
parity/briefs/reports/u-dep-audit-001-report.md

STANDING
Obey orch preferences.md.
