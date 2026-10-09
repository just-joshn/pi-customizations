GOAL
Produce an independent-owner freeze package the coordinator can apply only after custody checks pass: owner identity, definition hashes, configuration hashes, and a refuse-to-forge selftest. Do not set acceptanceDefinitionsFrozen true in the live ledger.

SCOPE
May write under `parity/research/acceptance-freeze-prep-001/`, `parity/briefs/reports/u-acceptance-freeze-prep-001-report.md`.
Must not edit `parity/requirements.json` or any ledger.

CONTEXT
Gate requires acceptanceDefinitionOwner + acceptanceDefinitionsFrozen true. Prior custody triage found same-user checkout insufficient for external custody. Read `parity/reviews/acceptance-custody-triage.md` and `parity/reviews/acceptance-repair-parent-audit.md`. Design the minimal honest path: either (a) external custody steps the operator must run, parked as a gate, or (b) a verifiable independent-owner worktree with different model-family review and immutable definition bytes. Prefer publishing a gate proposal if external custody is still required. Standing orders at orch preferences path.

ACCEPTANCE
- Freeze package lists exact bytes/hashes for definitions to freeze (or proves none are ready).
- Custody checklist with pass/fail against current checkout.
- If freeze is not yet honest, publish `gate-proposal.md` with question/options/default for orch gate park.
- No live ledger mutation.

VERIFY
Reproduce hash commands from the report; confirm they match.

TIMEBOX
60 minutes.

FORBIDDEN
No ledger edits. No setting frozen true. No commit.

REPORT
parity/briefs/reports/u-acceptance-freeze-prep-001-report.md

STANDING
Obey orch preferences.md.
