GOAL
For every requirement in `parity/requirements.json` with empty `scenarioIds`, author a minimal scenario JSON under `parity/scenarios/` and publish a merge proposal that maps each requirement id to its scenario id(s). Do not invent pair verdicts.

SCOPE
May write: `parity/scenarios/*.json` (new only; do not overwrite mode-one-message, mode-sticky, setup-model-discovery, setup-budget-labels, or journey-family-*), `parity/research/requirement-slices/scenario-wire-001/`, `parity/briefs/reports/u-scenario-wire-001-report.md`.
Must not edit: `parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, product code.

CONTEXT
Completion gate reports REQUIREMENT_SCENARIOS_EMPTY for 94 rows. Scenario id must match `^[a-zA-Z0-9][a-zA-Z0-9._-]*$` and file `parity/scenarios/<id>.json`. Schema mirror `parity/scenarios/setup-budget-labels.json` fields: schemaVersion, id, status (`draft-awaiting-pair`), requirements, referenceRevision, source, configurationIds, fixture, actions (≥1), execution.pairId null, execution.verdict `unverified`. One scenario per requirement unless a natural shared journey already exists in evidence (then reuse id and list both requirement ids in the scenario's requirements array). Standing orders at orch preferences path.

ACCEPTANCE
- Every currently empty-scenario requirement appears in `scenario-wire-001/proposal.json` with a scenarioId.
- Corresponding scenario JSON files exist on disk.
- Zero scenario files claim pass-paired or set pairId without a real pair file.
- Report lists counts: proposed, written, reused.

VERIFY
`python3 -c` that loads requirements + proposal and asserts coverage of all empty-scenario ids; spot-check 5 scenario files parse as JSON with execution.pairId null.

TIMEBOX
60 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No product edits. No commit.

REPORT
parity/briefs/reports/u-scenario-wire-001-report.md

STANDING
Obey orch preferences.md.
