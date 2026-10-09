# Setup requirement slice (`slice-setup-001`)

## Outcome

Promoted **15** atomic setup requirement proposals under this owned path. None are marked verified. File and span hashes were recomputed by `verify_proposals.py` (`verify-output.json`, `hashOk: true`).

## Scope held

Wrote only under `parity/research/requirement-slices/slice-setup-001/`. Did not edit `parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, or product code. Did not touch `slice-commands-001`.

## Sources

Locked reads (see `read-receipts.json`):

- `pstack/skills/setup-pstack/SKILL.md` @ `d61b47256a18155a81c8e5ef95e3cc6569ce8c18317c35c4dd9c8015cf68cb59`
- `pstack/docs/guide/01-setup.md` @ `86d0330f245d16254a2069955f993c15d96cf29cd1a73690a0164074b7ac1190`

Already-ledgered and not restated as new proposals:

- `PSTACK-SETUP-MODEL-DISCOVERY-001` (verified-pass-paired)
- `PSTACK-SETUP-BUDGET-LABELS-001` (verified-pass-paired)

## Proposals (15)

| id | branch | evidence |
| --- | --- | --- |
| `PSTACK-SETUP-ALIAS-ALWAYS-VALID-001` | aliases | paired (`setup-prepair`) |
| `PSTACK-SETUP-LOAD-STATE-001` | load / retired drop | paired (`setup-prepair`, `setup-success`) |
| `PSTACK-SETUP-BUDGET-APPLY-001` | budget map | paired (`setup-prepair`, `setup-success`) |
| `PSTACK-SETUP-RERUN-PRESERVE-001` | rerun | paired (`setup-success` + verify-rerun) |
| `PSTACK-SETUP-GROK-XHIGH-CAP-001` | fallback | unverified |
| `PSTACK-SETUP-ROLE-CONFIRM-001` | confirmation | paired (`setup-prepair`) |
| `PSTACK-SETUP-PANEL-LIST-FANOUT-001` | panel counts | unverified |
| `PSTACK-SETUP-VALIDATE-001` | validation | paired happy path; negative unverified |
| `PSTACK-SETUP-WRITE-RULE-001` | write | paired |
| `PSTACK-SETUP-WRITE-CARD-001` | write card | paired (`setup-success`); mismatch still pending commit |
| `PSTACK-SETUP-CONFIRM-WRITTEN-001` | confirmation | paired |
| `PSTACK-SETUP-CANCEL-NO-WRITE-001` | cancel | paired (`setup-cancel`) |
| `PSTACK-SETUP-VERIFY-OFFER-001` | optional verify skill | unverified |
| `PSTACK-SETUP-NEW-SESSION-APPLIES-001` | guide | unverified |
| `PSTACK-SETUP-GUIDE-RERUN-KEEP-001` | guide rerun | paired (keep); delete-restore unverified |

Full records with locators, line spans, `fileSha256`, `spanSha256`, triggers, configuration cells, and evidence pointers live in `proposals.json`.

## Unresolved queue

See `proposals.json` `unresolvedQueue`. Highest merge blockers:

1. Operator commit hash for `SETUP-WRITE-CARD` (standing order 13).
2. Coordinator split of the `PSTACK-SETUP-FLOW-001` mismatch bucket into these atomic rows.
3. Paired captures for Grok unlimited, panel list fan-out, unavailable-slug stop, and step-7 offer yes/no.

## Setup inventory still without a proposal

From `parity/inventory.json` setup-topic scan (`verify-output.json`):

1. `pstack/automations/benny/skills/setup-benny/SKILL.md`
2. `pstack/skills/create-verification-skill/SKILL.md`
3. `pstack/skills/create-verification-skill/references/feature-map-example/README.md`
4. `pstack/skills/create-verification-skill/references/feature-map-example/create-note.md`
5. `pstack/skills/create-verification-skill/references/feature-map-example/search.md`
6. `pstack/skills/maintain-verification-skill/SKILL.md`

Covered by at least one proposal: `setup-pstack/SKILL.md`, `docs/guide/01-setup.md`.

## Verify

```bash
python3 parity/research/requirement-slices/slice-setup-001/verify_proposals.py
```

Predicate: `proposalCount >= 12`, every `spanSha256`/`fileSha256` recomputes clean, no proposal `status` is `verified`, uncovered list printed.

## Artifacts

- `proposals.json`
- `read-receipts.json`
- `verify_proposals.py`
- `verify-output.json`
- `decisions.tsv` (local trail)
- `report.md` (this file)
