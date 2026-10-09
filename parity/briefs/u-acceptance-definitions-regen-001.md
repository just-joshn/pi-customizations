GOAL
Regenerate exact acceptance definition and configuration bytes for the live 98-requirement inventory so an external custodian can review and freeze later. Do not set acceptanceDefinitionsFrozen. Do not name the implementation parent as owner.

SCOPE
May write under `parity/acceptance/setup-pstack/` (definitions.json, configurations.json), `parity/research/acceptance-definitions-regen-001/`, `parity/briefs/reports/u-acceptance-definitions-regen-001-report.md`.
Must not edit `parity/requirements.json` freeze fields or other ledgers.

CONTEXT
Freeze prep report: `parity/briefs/reports/u-acceptance-freeze-prep-001-report.md`. Historical hashes exist but bytes are absent. Live ledger: 98 requirements, coverageDenominatorComplete true, acceptanceDefinitionOwner null, acceptanceDefinitionsFrozen false. Orch gate `acceptance-definition-custody` open (default keep-parked). Standing: orch preferences.md.

ACCEPTANCE
- definitions.json and configurations.json present with stable SHA-256 recorded in the report.
- Bytes cover the live requirement IDs (or honestly document gaps).
- Custody checklist still shows external custody FAIL (do not fake PASS).
- Refuse-to-forge note: regeneration alone does not authorize freeze.

VERIFY
`shasum -a 256` on the new bytes; count requirement IDs vs live ledger.

TIMEBOX
60 minutes.

FORBIDDEN
No ledger freeze. No setting acceptanceDefinitionsFrozen. No commit. Do not spawn further subagents.

REPORT
parity/briefs/reports/u-acceptance-definitions-regen-001-report.md

STANDING
Obey orch preferences.md.
