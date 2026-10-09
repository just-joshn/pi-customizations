# Report: create-verify GENERATE Helpers recapture

## Status

VERIFIED for the GENERATE Helpers gate on both hosts. Pair `create-verify-helpers-1`. Live prove and maintain remain intentionally skipped.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `66b7eaf6-e605-4446-8b68-cb18f6d64d8d` | SKILL.md has `## Helpers` / None |
| Pi (abandoned) | `55aa1e66-2cba-4f6d-a46a-14cc87858a25` | Trust dialog ate create prompt; killed |
| Pi | `530af8b2-6322-44f6-848f-d9b62d85323b` | SKILL.md has `## Helpers` / None |

## Artifacts

- Pair: `parity/evidence/create-verify/pair-create-verify-helpers-1.json`
- Cursor skill: `parity/evidence/create-verify/fixture-app/.cursor/skills/verify-hello-cli/SKILL.md`
- Pi skill: `parity/evidence/create-verify/fixture-app/.pi/skills/verify-hello-cli/SKILL.md`
- Capture script: `parity/scripts/capture-create-verify-reuse.mjs`
- Decision log: `parity/evidence/create-verify/.audit/u-create-verify-generate-helpers.tsv`

## On-disk oracle (re-read)

Both files have YAML `name: verify-hello-cli` and a real `description`. Both have `## Launch`, `## Doctor`, `## Drive`, `## Evidence`, `## Cleanup`, `## Helpers`. Helpers body is `None` on both. No TODO/TBD/placeholder wording. Cleanup text forbids kill-by-process-name and forbids deleting named proof dirs. Feature map seeded (`features/README.md` + `hello-print.md`). Second-turn `REUSED=` markers match each skill abs path.

## What changed in the lever

1. Create prompt now requires Helpers as a `##` heading (body may be `None`).
2. `readSkillMeta` asserts all six sections and rejects TODO/placeholder text.
3. Pi ready path seeds `trust.json` and waits for chat chrome without a Trust dialog (bare `pi` path match was a false ready).

## Honest deltas (unreconciled)

- Skill root `.cursor/skills` vs `.pi/skills`.
- Evidence paths differ (`artifacts/hello/` vs `.pi/evidence/verify-hello-cli/`).
- Reuse chrome and model chrome differ.

## Not claimed

- Does not mark prove/maintain requirements.
- Does not edit ledgers.
- Does not treat `create-verify-reuse-1` as GENERATE proof.
