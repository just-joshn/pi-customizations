# u-journey-setup-benny-settings-enable report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both sides set `plugins.pstack.enabled` to true in seeded JSONC `.cursor/settings.json` while keeping unrelated top-level settings, `other-plugin`, and the comment marker. File validates after edit. Ledgers not edited by this worker. No commit. No real secrets.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `57007345-8ea8-4ec2-8cc9-288b87c88fc2` |
| pi | `868b09be-5b1f-4ec9-957e-6ceaa1aa84c6` |

Pair. `parity/evidence/setup-benny/pair-setup-benny-settings-enable-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (locked models.mdc; both sides `ruleUnchanged: true`)

Settings digests. before `0cfed3ce…8704` → after `94c1129b…178f6` (identical on both hosts)

## Settings enable + preserve held on both hosts?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | `STATUS=settings-ok reason=pstack enabled with comments and other plugins preserved`. `analyzeSettings` all true. Screens + PTY show settings chrome. Product `src/app.js` unchanged. |
| pi | **yes** | `STATUS=settings-ok reason=pstack enabled and validated`. Same analysis flags. Session tools include `edit(settings.json)` and `setup-benny/SKILL.md`. Same after digest. |

Worker playbook. `parity/evidence/setup-benny/PLAYBOOK-settings-enable.md`

Capture lever. `parity/scripts/capture-setup-benny-settings-enable.mjs` (self-test green before live runs)

Dedicated fixture. `parity/evidence/setup-benny/settings-enable/` (held-out copy so no-secret / pack-merge workers do not share the tree)

## Commands run

1. Confirmed models.mdc at locked digest `sha256:2b6b4668…6004`.
2. Rsynced held-out fixture under `settings-enable/fixture-app`, seeded JSONC settings baseline with `pstack.enabled` false.
3. Wrote `PLAYBOOK-settings-enable.md` and capture script. Self-test green.
4. `node parity/scripts/capture-setup-benny-settings-enable.mjs --cursor-only` → `57007345…`.
5. Re-ran `analyzeSettings` on saved before/after. All preserve flags true.
6. `node parity/scripts/capture-setup-benny-settings-enable.mjs --pi-only` → `868b09be…`.
7. Re-ran independent analyze on Pi artifacts. Same after digest. Wrote pair JSON + this report.

## Deviations

1. Sequential `--cursor-only` then `--pi-only` on the dedicated fixture. Baseline restored before each side.
2. Prompt names the settings merge contract. Matches setup-benny skill text. Strong cue. Boundary is proved by before/after file analysis, not by self-report alone.
3. Pi tool order edited settings before reading `setup-benny/SKILL.md` (prompt already named the contract). Still scored `settings_ok` from disk.
4. Did not edit `mismatches.json`, `requirements.json`, or `progress.md` (those files show pre-existing dirty status from other work).
5. Did not commit.
6. Did not claim sibling SETUP-BENNY-* ids.
7. Cross-model show-me-your-work reviewer skipped. Brief forbids further subagents.

## Honest product gaps

1. This pair proves enable+preserve on an **existing** JSONC settings file with `plugins.pstack` already present (`enabled: false`). It does not prove create-from-absent when `.cursor/settings.json` is missing.
2. It does not prove pack merge, project-skills resolve, secrets boundary, user-config-outside completeness, required-explicit fill, control fail-closed, existing-no-automate, creation boundary, or thread safety.
3. Fresh project-scope skill resolve after reload is out of scope for this requirement's observe text and was not attempted.
4. Acceptance STATUS reason strings remain DRAFT / host-dependent.
5. Requirement is wired under `journey-family-09` while other Benny setup ids sit in family-11. Coordinator may want to re-home the family map.

## Suggested follow-ups for the coordinator

1. Merge the pair into the scenario / family ledger when ready. Close `PSTACK-SETUP-BENNY-SETTINGS-ENABLE-001` when oracle freeze allows.
2. Optional later pair for create-from-absent (no settings file) if the oracle wants that path covered separately.
3. Keep sibling SETUP-BENNY scenarios on their own pairs.
