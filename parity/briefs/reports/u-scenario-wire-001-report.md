# u-scenario-wire-001 report

## Status

complete. Proposal ready for coordinator merge. `parity/requirements.json` was not edited.

## Counts

| metric | value |
| --- | --- |
| proposed | 91 |
| written | 91 |
| reused | 0 |

Brief cited 94 empty rows. At generation time the ledger had 91 empty `scenarioIds` and 7 already wired (the original 4 plus `how-investigation-simple`, `setup-write-card`, `setup-escape-cancel`). Proposal covers every currently empty id.

## Artifacts

- Proposal: `parity/research/requirement-slices/scenario-wire-001/proposal.json`
- Lever: `parity/research/requirement-slices/scenario-wire-001/generate_scenarios.py`
- Verify: `parity/research/requirement-slices/scenario-wire-001/verify_coverage.py`
- Verify output: `parity/research/requirement-slices/scenario-wire-001/verify-output.json`
- Scenarios: `parity/scenarios/<derived-id>.json` (new only)

## Shape

Each new scenario mirrors the `setup-budget-labels` field set used as the brief's schema reference: `schemaVersion`, `id`, `status` (`draft-awaiting-pair`), `requirements`, `referenceRevision`, `source`, `configurationIds`, `fixture`, `actions` (≥1), `execution.pairId` null, `execution.verdict` `unverified`.

Scenario ids are derived from requirement ids by dropping the `PSTACK-` prefix and trailing `-<digits>`, lowercasing, and keeping kebab case. Example: `PSTACK-CMD-PLUGIN-SKILLS-REGISTER-001` → `cmd-plugin-skills-register`.

No reused ids. Journey-family stubs stay untouched (different schema, overwrite forbidden). Protected paired scenarios stay untouched. Zero new files claim `pass-paired` or set a non-null `pairId`.

## Verify

Ran `verify_coverage.py` and the brief's coverage assert. Result: ok. Spot-check of 5 files: `pairId` null, `verdict` unverified, `status` draft-awaiting-pair.

## Coordinator merge

For each `proposal.json` mapping, append `scenarioId` to that requirement's `scenarioIds` if absent. Do not invent pair verdicts.
