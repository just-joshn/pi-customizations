# u-journey-setup-benny-pack-merge report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both sides merged the source pack into `.cursor/automations/benny/` with required files present, destination-only preserved, user-owned maps outside the destination unchanged, and the local README edit marker kept. Ledgers untouched. No commit. No real secrets.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `d9e476af-9b22-46f2-90fd-1d42cc2e068b` |
| pi | `fe70b3f6-7866-4469-bc4e-fa045d67f52d` |

Pair. `parity/evidence/setup-benny/pair-setup-benny-pack-merge-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (locked models.mdc; both sides `ruleUnchanged: true`)

Dedicated fixture. `parity/evidence/setup-benny/pack-merge/fixture-app` (isolated from no-secret / settings-enable)

## Pack merge held on both hosts?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | `STATUS=merge-ok reason=full pack merged with local README edit and dest-only file preserved`. After state: `missingRequired=[]`, `missingSourceCopies=[]`, dest-only + local-edit markers present, user-owned digests unchanged, `src/app.js` unchanged. Settled screen. Diff of upstream vs dest, no overwrite of existing dest/user-owned paths, no automation. |
| pi | **yes** | `STATUS=merge-ok reason=pack merged, local edit and dest-only file preserved`. Same FS contract. Session tools. FOR_AGENTS then pack-dest writes. Settled screen. Copied missing pack files without overwriting DESTINATION_ONLY / README / `.cursor/benny/`. |

Worker playbook. `parity/evidence/setup-benny/PLAYBOOK-pack-merge.md`

Capture lever. `parity/scripts/capture-setup-benny-pack-merge.mjs` (self-test green before live runs)

## Commands run

1. Confirmed models.mdc at locked digest `sha256:2b6b4668…6004`.
2. Scaffolded dedicated fixture under `pack-merge/` with seeded dest-only, local README edit, and user-owned markers.
3. Wrote `PLAYBOOK-pack-merge.md` and capture script. Self-test green.
4. `node parity/scripts/capture-setup-benny-pack-merge.mjs --cursor-only` → `d9e476af…`.
5. `node parity/scripts/capture-setup-benny-pack-merge.mjs --pi-only` → `fe70b3f6…`.
6. Independent `find` / digest / `rg` of markers. Wrote pair JSON + this report.

## Deviations

1. Sequential `--cursor-only` then `--pi-only` with fixture reset between sides. Evidence under `parity/evidence/setup-benny/pack-merge/` so no-secret / settings-enable paths stay untouched.
2. Prompt names merge markers and STATUS contract. Stronger cue than a bare `/setup-benny`. On-disk digests still prove the merge rules.
3. Destination started partial (DESTINATION_ONLY + edited README), not fully absent. Create-missing paths are proved. Create-from-empty-destination is not.
4. Seeded README already matched upstream body plus local marker. Conflict handling was "leave as-is", not a three-way textual merge of divergent upstream content.
5. Cursor `askedAboutConflict` may be inflated by prompt words in PTY. Pi session `askedConflict=true` is stronger. Local-edit preservation does not depend on that flag.
6. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
7. Did not commit.
8. Did not claim sibling SETUP-BENNY-* ids.

## Honest product gaps

1. This pair proves pack-merge rules on a seeded partial destination only. It does not prove settings enable, project-skills resolve, secrets boundary, not-slash entry, or live automation creation gates.
2. Source path in the fixture is `.upstream/automations/benny` while pack prose names `.cursor/...`. Agents reconcile. Chrome still differs by host.
3. Acceptance STATUS reason strings remain DRAFT / host-dependent.
4. Ambiguous-ownership "stop and ask" path was not forced. Both hosts chose preserve-and-copy-missing.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-11 / `setup-benny-pack-merge` when ready. Close `PSTACK-SETUP-BENNY-PACK-MERGE-001` when oracle freeze allows.
2. Keep sibling SETUP-BENNY scenarios on their own pairs and fixtures.
3. Optional later pass. Empty destination create-if-absent, and a divergent upstream README that requires a real content merge.
