GOAL
Advance `parity/dependencies.json` and `parity/source-lock.json` toward completeDependencyClosure by finishing source reads for the highest-leverage incomplete nodes and recording dispositions. Do not falsely mark closureAudited true.

SCOPE
May write under `parity/research/` (owned subdirs only: `parity/research/dep-closure-wave-001/`), evidence notes there, and `parity/briefs/reports/u-dep-closure-wave-001-report.md`.
Must not edit: `parity/dependencies.json`, `parity/source-lock.json`, `parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md` (coordinator merges from your proposal).

CONTEXT
Gate blockers: 34 DEPENDENCY_EDGE_UNRESOLVED, 27 SOURCE_READING_INCOMPLETE, 7 DEPENDENCY_REFERENCE_UNRESOLVED, SOURCE_LOCK_INCOMPLETE, SOURCE_CLOSURE_INCOMPLETE, REFERENCE_CONFIGURATION_MISSING, DEPENDENCY_AUDIT_MISSING. Locks: pstack 0.15.15 @ ccb5507, Pi 1.1.0, cursor-agent 2026.10.01-e373342. Publish a merge proposal JSON the coordinator can apply: nodes to mark readingComplete with evidence paths, edges to mark resolved with evidence, openWork removals that are actually done, and honest remaining gaps. Capture cursor CLI reference configuration if missing (working env snapshot under your owned research path). Standing orders at orch preferences path.

ACCEPTANCE
- Read inventory for ≥10 previously incomplete nodes with hashes/quotes.
- Proposal lists exact field mutations for dependencies.json and source-lock.json.
- referenceConfigurationCaptured proposal includes a real captured artifact path or documents the measured blocker.
- closureAudited remains false unless an independent audit artifact is produced in this unit (prefer leave false and queue audit).

VERIFY
Re-read each cited source path; confirm hashes in the inventory match `shasum` of those files.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated readingComplete. No commit.

REPORT
parity/briefs/reports/u-dep-closure-wave-001-report.md

STANDING
Obey orch preferences.md.
