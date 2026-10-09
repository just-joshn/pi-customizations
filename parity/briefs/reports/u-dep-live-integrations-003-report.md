# Report: Live integrations disposition refresh (003)

## Status

Note refresh only. Inventory sha256 match. Counts unchanged **a=275 / b=115 / c=26**. `canCloseUnresolvedReference=false`. Make-bot Generate still unpaid (console locked). No fabricated Slack/Generate evidence. Ledgers merged by coordinator with narrowed unresolvedReference text.

## Why now (before post-unlock)

002 text still claimed “Pi Automations editor absent (f4c7eec5)” and creation-boundary unverified. That is stale after `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` verified-pass-paired (Pi `4d40a1d5` + Cursor `e11d7225`/`475ab346`). 003 corrects that without moving webhook Generate rows.

## Verify

| Check | Result |
| --- | --- |
| Inventory sha256 `63ef7f8f…13b867d4` | Match (`verify.json`) |
| Class counts vs 002 | Unchanged |
| `canCloseUnresolvedReference` | false (`b=115`) |
| Fabricated live evidence | false |

## Still unpaid (environment-bound)

- Make-bot Generate / 0600 key / probe 200 (G10 — `IOConsoleLocked`)
- Benny triage valid-config + Slack (G4–G8)
- Thread-safety seven live checks + editor Save witness
- Third-party live installs
- CU cloud attempt IDs (G1)
- Enterprise policy witness (G2; observe-002 still `pro_plus` / `no-team`)

## Artifacts

- `parity/research/dep-live-integrations-003/`
- Merge proposal: `merge-proposal.json`
