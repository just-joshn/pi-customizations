# Acceptance bytes now present (regen)

After `u-acceptance-definitions-regen-001`:

| Artifact | Path | SHA-256 |
| --- | --- | --- |
| definitions | `parity/acceptance/setup-pstack/definitions.json` | `e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5` |
| configurations | `parity/acceptance/setup-pstack/configurations.json` | `9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e` |

Custody checklist update vs freeze-prep report:
- Exact candidate bytes present: PASS (regen live-98; not the historical 43-def hash)
- Independent owner named: FAIL (null)
- External custody: FAIL
- Freeze authorization: FAIL / NONE
- Do not set `acceptanceDefinitionsFrozen`

Report: `parity/briefs/reports/u-acceptance-definitions-regen-001-report.md`
