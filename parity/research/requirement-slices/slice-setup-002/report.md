# Setup requirement slice (`slice-setup-002`)

## Outcome

Promoted **21** atomic setup requirement proposals under this owned path. Disposed **3** leftover inventory paths as non-requirement example assets. None of the proposals are marked verified. File and span hashes were recomputed by `verify_proposals.py` (`verify-output.json`).

## Scope held

Wrote only under `parity/research/requirement-slices/slice-setup-002/`. Did not edit `parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, product code, or `slice-setup-001`.

## Sources

Locked reads (see `read-receipts.json`):

- `pstack/automations/benny/skills/setup-benny/SKILL.md` @ `5a3cbe63360c9f6373b6cb6c79a1eaf7e0eba181bfaa1577e2e6431af3407282`
- `pstack/skills/create-verification-skill/SKILL.md` @ `644f2551403c1bca01a2855b34611b6e7be0ce0dc5b204514c376c0f6a6e6ac4`
- `pstack/skills/maintain-verification-skill/SKILL.md` @ `515c0eaa054b3f6be1b1fb06f2c2f173c80fddb58bbcac57576f89c479bc68e8`
- Feature-map-example tree hashed for disposition only (see `dispositions.json`)

## Overview

These leftovers are three separate setup surfaces that `setup-pstack` does not own. Benny setup installs an automation pack and enables project-scoped pstack skills. Create-verification-skill generates a project-local drive harness and feature map. Maintain-verification-skill is the upkeep loop for that map.

## Key concepts

- Pack merge versus user-owned config outside `.cursor/automations/benny/`
- Project-scoped skill resolve as the Benny enable gate
- Generated verify skill sections Launch, Doctor, Drive, Evidence, Cleanup, Helpers
- Feature-map shape required by the create skill; example tree is not the product contract
- Maintain outcomes `clean`, `changed`, `blocked` with verification-directory-only edit scope

## How it works

Benny bootstrap copies the pack, merges `plugins.pstack.enabled` into project settings, proves shared skills resolve from project scope, then collects explicit Slack, tracker, control, and feature-map choices before any automation is created through `/automate` or updated by hand in the editor. Create-verification-skill interviews the repo, writes `verify-<app>`, seeds a feature map, proves one feature live, then points at maintain. Maintain runs a source wave and a mandatory live pass, then ships at most one proven PR or reports clean or blocked.

## Where things live

| path | role |
| --- | --- |
| `setup-benny/SKILL.md` | Benny install and automation prep |
| `create-verification-skill/SKILL.md` | Generator for project-local verify skills |
| `maintain-verification-skill/SKILL.md` | Upkeep loop |
| `create-verification-skill/references/feature-map-example/` | Example asset only |

## Gotchas

- Benny operational files are not slash skills and must be read from the committed pack path.
- Feature-map-example describes a fictional Notes app; do not ledger it as product behavior.
- All proposals in this slice are `proposal-unverified` with no paired journeys yet.

## Proposals (21)

| id | branch | evidence |
| --- | --- | --- |
| `PSTACK-SETUP-BENNY-NO-SECRET-001` | secrets | unverified |
| `PSTACK-SETUP-BENNY-PACK-MERGE-001` | pack merge | unverified |
| `PSTACK-SETUP-BENNY-SETTINGS-ENABLE-001` | settings.json | unverified |
| `PSTACK-SETUP-BENNY-PROJECT-SKILLS-001` | project skill resolve | unverified |
| `PSTACK-SETUP-BENNY-USER-CONFIG-OUTSIDE-001` | user-owned config | unverified |
| `PSTACK-SETUP-BENNY-REQUIRED-EXPLICIT-001` | required choices | unverified |
| `PSTACK-SETUP-BENNY-CONTROL-FAIL-CLOSED-001` | control adapter | unverified |
| `PSTACK-SETUP-BENNY-EXISTING-NO-AUTOMATE-001` | existing automations | unverified |
| `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` | creation boundary | unverified |
| `PSTACK-SETUP-BENNY-THREAD-SAFETY-001` | thread safety | unverified |
| `PSTACK-SETUP-CREATE-VERIFY-INTERVIEW-001` | interview | unverified |
| `PSTACK-SETUP-CREATE-VERIFY-GENERATE-001` | generate skill | unverified |
| `PSTACK-SETUP-CREATE-VERIFY-FEATURE-MAP-001` | feature map seed | unverified |
| `PSTACK-SETUP-CREATE-VERIFY-PROVE-001` | prove before handoff | unverified |
| `PSTACK-SETUP-CREATE-VERIFY-OFFER-MAINTAIN-001` | offer maintain | unverified |
| `PSTACK-SETUP-MAINTAIN-VERIFY-OUTCOMES-001` | outcomes | unverified |
| `PSTACK-SETUP-MAINTAIN-VERIFY-EDIT-SCOPE-001` | edit scope | unverified |
| `PSTACK-SETUP-MAINTAIN-VERIFY-LOCATE-001` | locate target | unverified |
| `PSTACK-SETUP-MAINTAIN-VERIFY-SOURCE-WAVE-001` | source wave | unverified |
| `PSTACK-SETUP-MAINTAIN-VERIFY-LIVE-PASS-001` | live pass | unverified |
| `PSTACK-SETUP-MAINTAIN-VERIFY-SHIP-001` | ship or stop | unverified |

Full records with locators, line spans, `fileSha256`, `spanSha256`, triggers, and evidence pointers live in `proposals.json`.

## Leftover / disposition list

| path | disposition |
| --- | --- |
| `pstack/automations/benny/skills/setup-benny/SKILL.md` | covered by 10 proposals |
| `pstack/skills/create-verification-skill/SKILL.md` | covered by 5 proposals |
| `pstack/skills/maintain-verification-skill/SKILL.md` | covered by 6 proposals |
| `pstack/skills/create-verification-skill/references/feature-map-example/README.md` | `non-requirement-example-asset` |
| `pstack/skills/create-verification-skill/references/feature-map-example/create-note.md` | `non-requirement-example-asset` |
| `pstack/skills/create-verification-skill/references/feature-map-example/search.md` | `non-requirement-example-asset` |

## Verify

```bash
python3 parity/research/requirement-slices/slice-setup-002/verify_proposals.py
```

Predicate: `proposalCount >= 15`, every `spanSha256`/`fileSha256` recomputes clean, no proposal `status` is `verified`, all six leftovers covered by proposal source or disposition, `uncoveredLeftovers` empty.

## Artifacts

- `proposals.json`
- `dispositions.json`
- `read-receipts.json`
- `verify_proposals.py`
- `verify-output.json`
- `decisions.tsv` (local trail)
- `report.md` (this file)
