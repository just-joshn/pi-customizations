# u-journey-setup-benny-existing-no-automate report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both sides followed setup-benny section 7 existing path against seeded `benny-triage` / `benny-reproduce` stubs, wrote `STATUS=checklist-ok`, gave the editor checklist, did not use `/automate` to update, and created no replacement automations. Automations editor UI was not opened in CLI PTY (honest handoff, not fabricated). Ledgers not edited by this worker. No commit. No real secrets.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `7f533016-def9-48db-9e2b-9f53ce47c127` |
| pi | `0564c7c5-740d-48f0-b4ad-011d9422e558` |

Pair. `parity/evidence/setup-benny/pair-setup-benny-existing-no-automate-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (locked models.mdc; both sides `ruleUnchanged: true`)

## No-automate + checklist contract held on both hosts?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | `STATUS=checklist-ok reason=gave editor checklist without automate`. `contractHeld: true`. Settled screen shows Editor checklist for triage and repro and asks for real Automations editor edits. Transcript `automateUsed: false`. `duplicateCreated=[]`. Inventory stub IDs intact. Product digest unchanged. |
| pi | **yes** | `STATUS=checklist-ok reason=checklist given; editor not openable in CLI PTY, user edits both existing automations`. `contractHeld: true`. Session inventory read; `automateUsed: false`. Settled screen lists checklist fields and editor handoff. Same zero duplicates. Product digest unchanged. |

Worker playbook. `parity/evidence/setup-benny/PLAYBOOK-existing-no-automate.md`

Capture lever. `parity/scripts/capture-setup-benny-existing-no-automate.mjs` (self-test green before live runs)

## Commands run

1. Confirmed models.mdc at locked digest `sha256:2b6b4668…6004`.
2. Scaffolded dedicated fixture under `parity/evidence/setup-benny/existing-no-automate/` with pack, user config, and `.cursor/benny/existing-live-automations.json` stubs.
3. Wrote playbook and capture script. Self-test green.
4. `node parity/scripts/capture-setup-benny-existing-no-automate.mjs --cursor-only` → `7f533016…`.
5. `node parity/scripts/capture-setup-benny-existing-no-automate.mjs --pi-only` → `0564c7c5…`.
6. Confirmed both `identity.json` + `events.jsonl`, both done markers (durable copies under `fixture-out/`), no duplicates. Wrote pair JSON + this report.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`. Evidence under `parity/evidence/setup-benny/existing-no-automate/` so sibling setup-benny roots stay untouched.
2. Prompt names section 7 existing path and forbids fabricating Automations editor UI. Contract is still scored from done marker, screens/PTY, transcript/session automate signals, inventory integrity, and automation FS side effects.
3. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`. Those files may show dirty from other writers; this worker did not touch them.
4. Did not commit.
5. Did not claim sibling SETUP-BENNY-* ids.
6. Skipped show-me-your-work cross-model trail review subagent. Brief forbids further subagents.
7. After Pi settle, seed restore briefly cleared `fixture-out/*/done.txt`; restored from `done-copy.txt`. Capture script no longer deletes sibling done markers on restore.

## Honest product gaps

1. This pair proves no-automate + checklist handoff for existing automations. It does not prove a human actually saved fields inside the Automations editor UI (unavailable in cursor-agent/pi PTY).
2. It does not prove pack merge, settings enable, secrets boundary, project-skills resolve, user-config-outside completeness, required-explicit fill, control fail-closed, creation boundary, or thread safety.
3. Existing automations are fixture inventory stubs (`auto_fixture_*`), not live Cursor cloud automation records.
4. Host STATUS reason strings differ slightly. Behavior matches.
5. Pi tool-order labels show `bash` for some reads. Inventory and checklist engagement is also visible on settled screen and session flags.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-11 / `setup-benny-existing-no-automate` when ready. Close `PSTACK-SETUP-BENNY-EXISTING-NO-AUTOMATE-001` when oracle freeze allows.
2. Keep sibling SETUP-BENNY scenarios on their own pairs.
3. Optional later pass. Exercise Automations editor saves on a host that can open that UI (Agents Window / desktop), without fabricating editor chrome in PTY.
