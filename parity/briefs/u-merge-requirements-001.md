GOAL
Merge the reviewed draft proposals from slice-commands-001/002 and slice-setup-001/002 into `parity/requirements.json` as `unverified` rows (never verified), expand the denominator, and leave a machine-readable merge report. Do not mark any new row verified.

SCOPE
May edit:
- parity/requirements.json
- parity/research/requirement-slices/merge-001-report.md (new)
Must not edit product code, mismatches.json, or progress.md.
Must not invent evidence or set status to verified.

CONTEXT
70 draft proposals across four slices. Existing four ledger rows stay. Do not duplicate poteto-mode enter / setup discovery-budget rows already present. Preserve schema fields used by existing rows. Set coverageDenominatorComplete false still (principles + inventory remain).

ACCEPTANCE
- requirements.json parses; proposalCount increases by the merged unique IDs.
- Every merged row has status unverified and empty evidence.
- Merge report lists added IDs, skipped duplicates, and leftover unmerged paths.
- Idempotent: re-running the merge script (if you write one) does not duplicate IDs.

VERIFY
python3 -c "import json; r=json.load(open('parity/requirements.json')); print(len(r['requirements']), r['status'])"

TIMEBOX
60 minutes.

FORBIDDEN
No freeze. No verified status. No product edits.

REPORT
parity/research/requirement-slices/merge-001-report.md

STANDING
Obey orch preferences.md. Exception: this unit may edit requirements.json as named in SCOPE.
