# u-journey-setup-benny-creation-boundary report

## Status

**blocker** for the capture brief. Real PTY both sides. Host probe and both attempts show the Automations editor / `/automate` handoff cannot be exercised in this harness. No fabricated editor save. Ledgers not edited. No commit. No real secrets.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `d6992fb0-3759-474f-b1da-dafa9e13fde8` |
| pi | `cd378e36-ef2e-4810-ae5d-74a5169f204c` |

Blocker. `parity/evidence/setup-benny/blocker-setup-benny-creation-boundary-1.json`

Evidence pair (verdict blocker, not a verified pass). `parity/evidence/setup-benny/pair-setup-benny-creation-boundary-1.json`

Probe. `parity/evidence/setup-benny/creation-boundary/host-env-probe.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (locked models.mdc; both sides `ruleUnchanged: true`)

## Creation-boundary evidenced or blocked?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **env-blocked** | `STATUS=env-blocked reason=no /automate or Automations editor on this host`. Screens under `creation-boundary/cursor/`. `liveAutomationCreated=[]`. Product digest unchanged. |
| pi | **env-blocked** (manual) | Done marker same class. Session tools `bash` only. Automated scorer said `boundary_violated` from RoutinePrepare registry text in PTY dump; `creation-boundary/pi/manual-rescore.json` corrects to `env_blocked`. |

Worker playbook. `parity/evidence/setup-benny/PLAYBOOK-creation-boundary.md`

Capture lever. `parity/scripts/capture-setup-benny-creation-boundary.mjs` (self-test green before live runs)

Path choice. Honest harness blocker. Fabricating editor handoff would violate standing prefs.

## Commands run

1. Confirmed models.mdc at locked digest `sha256:2b6b4668…6004`.
2. Seeded `parity/evidence/setup-benny/creation-boundary/fixture-app`.
3. Wrote PLAYBOOK, probe, and capture script. Probe exit 2 (blocker). Self-test green.
4. `node parity/scripts/capture-setup-benny-creation-boundary.mjs --cursor-only` → `d6992fb0…`.
5. `node parity/scripts/capture-setup-benny-creation-boundary.mjs --pi-only` → `cd378e36…`.
6. Wrote blocker + evidence pair + this report. Did not edit ledgers. Did not commit.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`.
2. Prompt names the STATUS vocabulary and the creation-boundary rules. Hosts still had to refuse inventing the editor.
3. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
4. Did not claim sibling SETUP-BENNY-* ids.
5. Pi automated scorer false-positive documented with manual rescore.

## Honest product gaps

1. First-time create through built-in `/automate` → Automations editor save remains unpaid on both hosts.
2. Thread-safety-before-enable remains unpaid (depends on editor save).
3. Pi `RoutinePrepare` exists as a tool but is not the required Cursor Automations editor handoff path; this journey correctly did not use it.

## Suggested follow-ups for the coordinator

1. Keep `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` active as blocker until an Automations editor host path exists.
2. Optional later pass on Desktop Agents Window / cursor.com/automations with operator-owned save, then recapture.
3. Keep sibling SETUP-BENNY scenarios on their own pairs.
