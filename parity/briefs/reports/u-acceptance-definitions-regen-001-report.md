# Acceptance definitions regen report

## Status

`DONE` for byte regeneration. Freeze remains unauthorized.

Regenerated DRAFT `definitions.json` and `configurations.json` for the live 98-requirement inventory. Did not set `acceptanceDefinitionsFrozen`. Did not name an acceptance owner. Did not name the implementation parent as owner.

## Artifact digests

Measured with `shasum -a 256` after `node parity/research/acceptance-definitions-regen-001/regenerate.mjs`.

| Artifact | SHA-256 |
| --- | --- |
| `parity/acceptance/setup-pstack/definitions.json` | `e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5` |
| `parity/acceptance/setup-pstack/configurations.json` | `9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e` |

These digests are not the historical DRAFT digests from the 43-definition setup partition (`e4e84566…05cb4` / `3755a291…a80f`). That partition covered setup only and declared `denominatorComplete: false`. This regen projects the live ledger.

## Requirement ID coverage

| Measure | Count |
| --- | --- |
| Live `parity/requirements.json` requirement IDs | 98 |
| Regenerated definition `requirementId` values | 98 |
| Missing live IDs | 0 |
| Extra definition IDs | 0 |

`node parity/research/acceptance-definitions-regen-001/verify-regen.mjs` reports `countsMatchLive: true` against expected live count 98.

## Gaps (honest)

- Source excerpt resolution on the locked reference checkout: 39 definitions got a heading excerpt; 59 kept `excerptStatus: "locator-unresolved"` with locator and source sha256 retained. ID coverage is complete even when the excerpt is absent.
- Historical ACC-SETUP-* records (43) were not restored as the inventory oracle. They do not name the live 98 requirement IDs.
- `owner` is `null` on both regenerated files. Regeneration in this checkout does not create independent ownership.

## Custody checklist

Kept honest. Regeneration does not fake PASS on custody.

| Check | Result | Evidence |
| --- | --- | --- |
| Exact candidate bytes are present | PASS | Files exist under `parity/acceptance/setup-pstack/`. |
| An independent owner is named | FAIL | `owner` is null; live `acceptanceDefinitionOwner` remains null. |
| External custody is established | FAIL | Same-user checkout write path. No external custodian pin. |
| Freeze authorization is granted | FAIL | Structural/custody authority remains absent. |
| Coverage denominator complete (live ledger) | PASS | Live `coverageDenominatorComplete` is true. |
| Supporting verifier safe for custody | FAIL | Prior triage findings stand. This unit did not repair the verifier. |

## Refuse-to-forge note

Regeneration alone does not authorize freeze. Do not set `acceptanceDefinitionsFrozen` from these bytes. An external custodian must review, take custody, and grant freeze authority before any ledger freeze.

## Ledger safety

This unit did not edit freeze fields on `parity/requirements.json` or other ledgers. At verification time:

- `acceptanceDefinitionsFrozen` = `false`
- `acceptanceDefinitionOwner` = `null`

## Reproduce

From the repository root:

```sh
node parity/research/acceptance-definitions-regen-001/regenerate.mjs
node parity/research/acceptance-definitions-regen-001/verify-regen.mjs
shasum -a 256 \
  parity/acceptance/setup-pstack/definitions.json \
  parity/acceptance/setup-pstack/configurations.json
```

Expected digests match the table above when the live requirements inventory is unchanged.

## Decision trail

Local audit log: `parity/.audit/acceptance-definitions-regen-001.tsv`.
