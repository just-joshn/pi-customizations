# u-journey-setup-benny-user-config-outside report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both sides created user-owned configuration, feature map, and routing map under `.cursor/benny/` (outside `.cursor/automations/benny/`). Copied example digests matched seed before and after. Product `src/app.js` unchanged. Ledgers untouched by this worker. No commit. No real secrets.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `4ee10a59-d826-4875-8667-515f596d7cb7` |
| pi | `5d95d377-27f7-4914-88f0-9ab4ab010516` |

Pair. `parity/evidence/setup-benny/pair-setup-benny-user-config-outside-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (locked models.mdc; both sides `ruleUnchanged: true`)

Dedicated fixture. `parity/evidence/setup-benny/user-config-outside/fixture-app` (isolated from pack-merge / settings-enable / control-fail-closed)

## Outside-pack placement + examples untouched?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** (FS) | Preferred `.cursor/benny/{configuration.yaml,feature-map.md,routing.md}` present. Example digests identical to baseline. No same-named non-example files inside pack. `STATUS=adapt-mismatch` is narrative about empty feature sections, not a placement failure. |
| pi | **yes** | `STATUS=adapt-ok reason=user-owned copies created in .cursor/benny`. Same FS contract. Session tools read setup-benny then wrote user-owned. `exampleEdit=false`. |

Worker playbook. `parity/evidence/setup-benny/PLAYBOOK-user-config-outside.md`

Capture lever. `parity/scripts/capture-setup-benny-user-config-outside.mjs` (self-test green before live runs)

## Commands run

1. Confirmed models.mdc at locked digest `sha256:2b6b4668…6004`.
2. Scaffolded dedicated fixture under `user-config-outside/` with marked examples and no pre-existing user-owned files.
3. Wrote playbook + capture script. Self-test green.
4. `node parity/scripts/capture-setup-benny-user-config-outside.mjs --cursor-only` → `4ee10a59…`.
5. `node parity/scripts/capture-setup-benny-user-config-outside.mjs --pi-only` → `5d95d377…`.
6. Independent digest / `identity.json` / `events.jsonl` checks. Wrote pair JSON + this report.

## Deviations

1. Sequential `--cursor-only` then `--pi-only` with fixture reset between sides.
2. Prompt names adapt markers and STATUS contract. Stronger cue than a bare `/setup-benny`. On-disk digests still prove placement and example immutability.
3. Cursor STATUS line said `adapt-mismatch` while FS contract passed. Scorer keys off digests and paths, not the STATUS reason string alone.
4. User-owned file bodies differ by host. Placement contract is shared. Content digests are not required to match.
5. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
6. Did not commit.
7. Did not claim sibling SETUP-BENNY-* ids.

## Honest product gaps

1. This pair proves adapt placement after pack already exists. It does not prove pack-merge, settings enable, secrets boundary, not-slash entry, or live automation creation.
2. Pack-refresh "never touch user-owned" is evidenced by outside-pack placement (refresh of pack paths cannot rewrite `.cursor/benny/` by construction). A live refresh-merge journey was not run in this pair.
3. Skill prose examples use `.upstream/benny/` paths. Both hosts chose `.cursor/benny/` as preferred by the prompt and FOR_AGENTS-style target layout.
4. Fixture `src/app.js` has no user-facing UI. Cursor left an empty feature-map section set and marked STATUS mismatch for that reason. Acceptance for this requirement is outside placement + untouched examples, not a complete feature-map inventory.
5. Acceptance STATUS reason strings remain DRAFT / host-dependent.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-11 / `setup-benny-user-config-outside` when ready. Close `PSTACK-SETUP-BENNY-USER-CONFIG-OUTSIDE-001` when oracle freeze allows.
2. Keep sibling SETUP-BENNY scenarios on their own pairs and fixtures.
3. Optional later pass. Drive a pack refresh after adapt and assert user-owned digests still match.
