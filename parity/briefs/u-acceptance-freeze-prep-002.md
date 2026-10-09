GOAL
Re-run acceptance freeze preparation against the regenerated live 98-requirement DRAFT bytes under `parity/acceptance/setup-pstack/`. Prior freeze-prep (`u-acceptance-freeze-prep-001`) reported bytes absent; that is obsolete. Produce an honest freeze package and custody checklist for the current digests. Do not set `acceptanceDefinitionsFrozen` true. Do not name the implementation parent as owner.

SCOPE
May write under `parity/research/acceptance-freeze-prep-002/`, `parity/briefs/reports/u-acceptance-freeze-prep-002-report.md`, `parity/briefs/u-acceptance-freeze-prep-002.md`.
Must not edit ledgers (`parity/requirements.json`, mismatches, dependencies, progress, source-lock, completion).

CONTEXT
Current bytes: definitions sha256 `e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5`, configurations sha256 `9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e`. Regen report: `parity/briefs/reports/u-acceptance-definitions-regen-001-report.md`. Live ledger: `acceptanceDefinitionsFrozen=false`, `acceptanceDefinitionOwner=null`, `coverageDenominatorComplete=true`. Preferences: acceptance stays DRAFT until independent owner freezes; implementation owner cannot unilaterally change the oracle.

ACCEPTANCE
- Custody checklist with pass/fail against current checkout.
- Exact shasum commands and measured digests.
- If freeze still not honest: gate-proposal for operator external custody; refuse-to-forge selftest.
- Merge recommendation: whether coordinator may set frozen (must be no unless independent owner and custody truly pass).
- No ledger edits; no commit.

VERIFY
Reproduce hash commands; run selftest if written.

TIMEBOX
60 minutes.

FORBIDDEN
No ledger edits. No setting frozen true. No inventing an independent owner. No commit. Do not spawn further subagents.

REPORT
`parity/briefs/reports/u-acceptance-freeze-prep-002-report.md`

STANDING
Obey orch preferences.md.
