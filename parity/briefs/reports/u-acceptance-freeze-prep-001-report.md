# Acceptance freeze preparation report

## Status

`BLOCKED`. Do not set `acceptanceDefinitionsFrozen` to true.

The checkout contains historical hash records for a 43-definition, 92-configuration-cell DRAFT partition. It does not contain the definition or configuration bytes at the recorded paths. The live ledgers name no acceptance owner, and the coverage denominator remains incomplete.

## Candidate hash record

| Artifact | Recorded SHA-256 | Current result |
| --- | --- | --- |
| Setup definitions | `e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4` | The owner report, parent audit, and structural evidence agree. The bytes are absent from this checkout. |
| Setup configurations | `3755a29140cdbf700f01eadd5e268b3abc459152c619bd0037bfe70cc355a80f` | The owner report and parent audit agree. The bytes are absent from this checkout. |
| Repaired structural manifest | `bfad0bc07db47217dc543841a0d6d069673df6af761a3984a6b9f58a01f25ef2` | The structural evidence reports this digest with `authorization: "NONE"`. |

These hashes identify prior DRAFT bytes. They do not prove present-byte availability, owner identity, custody, or freeze authorization.

## Custody checklist

| Check | Result | Evidence |
| --- | --- | --- |
| Recorded definition hash is consistent | PASS | `acceptance-owner-report.md`, `acceptance-repair-parent-audit.md`, and `acceptance-repair-structural.json` agree. |
| Recorded configuration hash is consistent | PASS | `acceptance-owner-report.md` and `acceptance-repair-parent-audit.md` agree. |
| Exact candidate bytes are present | FAIL | `parity/acceptance/setup-pstack/definitions.json` and `configurations.json` are absent. |
| An independent owner is named | FAIL | Both live `acceptanceDefinitionOwner` fields are null. |
| External custody is established | FAIL | The custody audit proves same-user write access. Structural evidence lists `NO_EXTERNAL_CUSTODY`. |
| Freeze authorization is granted | FAIL | Structural evidence reports `authorization: "NONE"`. |
| The coverage denominator is complete | FAIL | Both the live ledger and structural evidence report false. |
| The supporting verifier is safe for custody | FAIL | Independent triage records a symlink write escape, unpinned ledger bytes, invalid locator acceptance, and a missing-pin downgrade. |

Result: 2 checks pass and 6 checks fail.

## Refuse-to-forge result

`verify-freeze-prep.mjs` reads the live ledger and custody evidence. It accepts only the honest `BLOCKED` decision. `selftest.sh` changes a disposable copy of the package decision to `READY` and requires the verifier to reject it for the custody failures.

Observed output:

```text
PASS: freeze decision remains BLOCKED; 6 custody checks fail.
PASS: forged READY decision was rejected.
```

## Reproduce

Run these commands from the repository root:

```sh
shasum -a 256 \
  parity/reviews/acceptance-owner-report.md \
  parity/reviews/acceptance-repair-parent-audit.md \
  parity/evidence/acceptance-repair-structural.json
node parity/research/acceptance-freeze-prep-001/verify-freeze-prep.mjs
sh parity/research/acceptance-freeze-prep-001/selftest.sh
```

Expected evidence hashes:

```text
122b3b85309642289a1bd8696f395bffb1489206ed347c270402d37dd4cbb1ca  parity/reviews/acceptance-owner-report.md
e388ebf74245234228cb2fa52872c746ceb806449ab9c34a8992613a504934e0  parity/reviews/acceptance-repair-parent-audit.md
f4116350c970c66055c30b154ba72d93654c376434b4312c4feffcb731405d18  parity/evidence/acceptance-repair-structural.json
```

The report cannot reproduce the candidate definition and configuration hashes from exact bytes because this checkout does not contain those bytes. Treat that absence as a failed freeze prerequisite.

## Gate proposal

Park the acceptance freeze gate. `parity/research/acceptance-freeze-prep-001/gate-proposal.md` gives the operator an external-custody option and keeps DRAFT as the default.

## Ledger safety

This task did not edit `parity/requirements.json`, `parity/configurations.json`, `parity/progress.md`, or `parity/mismatches.json`. At verification time, `acceptanceDefinitionsFrozen` remained false.
