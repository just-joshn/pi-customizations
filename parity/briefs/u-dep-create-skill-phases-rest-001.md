GOAL
Capture Cursor+Pi pairs for the remaining open create-skill phases (Discovery, Design, Verification) so the create-skill journey unresolvedReference can be closed. Reuse fixtures/scripts from Phase 3 Implementation pair `create-skill-impl-1` where possible.

SCOPE
May write under `parity/evidence/create-skill/`, `parity/briefs/reports/u-dep-create-skill-phases-rest-001-report.md`, scripts under `parity/scripts/`.
Must not edit ledgers.

CONTEXT
Phase 3 closed: cursor `67eb4a01-244d-4d1a-a27d-5b09b30d426e`, pi `f4c14017-4188-461c-9fa0-076e7995059d`, pair `parity/evidence/create-skill/pair-create-skill-impl-1.json`. Wave-009 audit lists 4 phases. Standing: orch preferences.md.

ACCEPTANCE
- Pair(s) covering Discovery, Design, and Verification with attempt IDs both sides, or honest blockers per phase.
- Report states whether the create-skill unresolvedReference is ready to remove.

VERIFY
Real PTY both sides for each claimed closed phase.

TIMEBOX
150 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit. Do not spawn further subagents.

REPORT
parity/briefs/reports/u-dep-create-skill-phases-rest-001-report.md

STANDING
Obey orch preferences.md.
