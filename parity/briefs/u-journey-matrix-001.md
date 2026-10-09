GOAL
Turn contract section 8 journey families into a concrete scenario checklist under `parity/scenarios/` with one stub JSON per family naming required requirement IDs, fixture needs, and current status (missing/partial/paired).

SCOPE
May write only under `parity/scenarios/` and `parity/briefs/reports/u-journey-matrix-001-report.md`.
Must not edit requirements.json or product code.

CONTEXT
Initiating contract section 8 lists 16 mandatory journey families. Existing evidence covers parts of setup, cancel, how investigate, mode-one-message (failing). Expand the checklist from inventory + requirements + mismatches.

ACCEPTANCE
At least 16 scenario stub files (one per family), each with id, family, status, linked evidence paths if any, and nextAction.
Report counts missing vs partial vs paired.

VERIFY
ls parity/scenarios | wc -l ; test >= 16

TIMEBOX
45 minutes.

FORBIDDEN
No fake paired status. No ledger edits.

REPORT
parity/briefs/reports/u-journey-matrix-001-report.md

STANDING
Obey orch preferences.md.
