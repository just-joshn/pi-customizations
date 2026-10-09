# Acceptance freeze preparation report (002)

## Status

`BLOCKED`. Do not set `acceptanceDefinitionsFrozen` to true.

Live-98 DRAFT bytes are present under `parity/acceptance/setup-pstack/` and match the regen-001 digests. Independent owner, external custody, freeze authorization, and supporting-verifier safety still fail. Prep-001's "bytes absent" finding is obsolete for these paths.

## Candidate hash record

Measured with `shasum -a 256` from the repository root at checkout `10a5c630fe9de01123b3ef46920c24a61d0f6797`.

| Artifact | Path | SHA-256 |
| --- | --- | --- |
| Definitions | `parity/acceptance/setup-pstack/definitions.json` | `e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5` |
| Configurations | `parity/acceptance/setup-pstack/configurations.json` | `9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e` |

These digests match `u-acceptance-definitions-regen-001`. They are not the historical 43-definition digests from prep-001 (`e4e84566…05cb4` / `3755a291…a80f`).

Document fields on the candidate: `status=DRAFT`, `owner=null`, `frozen=false`, `denominatorComplete=true`, 98 definitions. Live requirement IDs match definition `requirementId` values 98/98.

## Custody checklist

| Check | Result | Evidence |
| --- | --- | --- |
| Measured definition digest matches candidate | PASS | `shasum -a 256` equals regen report and `freeze-prep.json`. |
| Measured configuration digest matches candidate | PASS | `shasum -a 256` equals regen report and `freeze-prep.json`. |
| Exact candidate bytes are present | PASS | Both JSON files exist under `parity/acceptance/setup-pstack/`. |
| An independent owner is named | FAIL | Live `acceptanceDefinitionOwner` is null on requirements and configurations. Candidate `owner` is null. This unit did not invent an owner. |
| External custody is established | FAIL | Custody triage: same-user checkout is not an external boundary. Structural evidence still lists `NO_EXTERNAL_CUSTODY`. |
| Freeze authorization is granted | FAIL | Structural evidence reports `authorization: "NONE"`. |
| The coverage denominator is complete | PASS | Live `coverageDenominatorComplete` is true; candidate `denominatorComplete` is true; ID sets match. |
| The supporting verifier is safe for custody | FAIL | Independent triage and symlink reproduction findings stand. This unit did not repair the verifier. |

Result: 4 checks pass and 4 checks fail.

## Refuse-to-forge result

`verify-freeze-prep.mjs` hashes the live candidate bytes, reads ledger and custody evidence, and accepts only an honest `BLOCKED` decision while custody fails. `selftest.sh` forges `decision: "READY"` on a disposable copy and requires rejection.

Observed output:

```text
PASS: freeze decision remains BLOCKED; 4 custody checks fail; 4 pass.
PASS: forged READY decision was rejected.
```

## Gate proposal

Park the acceptance freeze gate. `parity/research/acceptance-freeze-prep-002/gate-proposal.md` gives the operator an external-custody option and keeps DRAFT as the default. Bytes presence and denominator completeness do not authorize freeze.

## Merge recommendation

Coordinator must not set `acceptanceDefinitionsFrozen` true. Independent owner and custody checks do not pass. Keep `acceptanceDefinitionOwner` null until an external custodian is named by the operator. Do not name the implementation parent as owner.

## Ledger safety

This task did not edit `parity/requirements.json`, `parity/configurations.json`, `parity/progress.md`, `parity/mismatches.json`, `parity/dependencies.json`, `parity/source-lock.json`, or `parity/completion.json`. At verification time, `acceptanceDefinitionsFrozen` remained false and `acceptanceDefinitionOwner` remained null.

## Reproduce

From the repository root:

```sh
shasum -a 256 \
  parity/acceptance/setup-pstack/definitions.json \
  parity/acceptance/setup-pstack/configurations.json
node parity/research/acceptance-freeze-prep-002/verify-freeze-prep.mjs
sh parity/research/acceptance-freeze-prep-002/selftest.sh
```

Expected digests:

```text
e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5  parity/acceptance/setup-pstack/definitions.json
9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e  parity/acceptance/setup-pstack/configurations.json
```

Package manifest: `parity/research/acceptance-freeze-prep-002/freeze-prep.json`.
