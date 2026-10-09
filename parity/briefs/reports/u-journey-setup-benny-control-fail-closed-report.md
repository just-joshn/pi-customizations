# u-journey-setup-benny-control-fail-closed report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both sides verified setup-benny step 6 against a named control skill stub with every required capability marked not implemented, wrote `STATUS=fail-closed`, left the repro automation disabled, and left `src/app.js` unchanged. Ledgers not edited by this worker. No commit. No real secrets.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `370c1adb-5e53-4c1d-9d9c-34f21299d18d` |
| pi | `e6185d9b-6960-4680-ae75-5349f6b148a2` |

Pair. `parity/evidence/setup-benny/pair-setup-benny-control-fail-closed-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (locked models.mdc; both sides `ruleUnchanged: true`)

## Fail-closed control contract held on both hosts?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | `STATUS=fail-closed reason=control-target-app implements no required control capabilities`. `contractHeld: true`. Settled screen shows the STATUS line. Stub and feature-map markers intact. `liveAutomationExtras=[]`. Product digest unchanged. |
| pi | **yes** | `STATUS=fail-closed reason=control adapter stub implements no required capabilities`. `contractHeld: true`. Session tools read setup-benny and feature-map; stub/control reads true. Settled screen quotes stub gaps and STATUS. Same zero live-automation extras. Product digest unchanged. |

Worker playbook. `parity/evidence/setup-benny/PLAYBOOK-control-fail-closed.md`

Capture lever. `parity/scripts/capture-setup-benny-control-fail-closed.mjs` (self-test green before live runs)

## Commands run

1. Confirmed models.mdc at locked digest `sha256:2b6b4668…6004`.
2. Scaffolded dedicated fixture under `parity/evidence/setup-benny/control-fail-closed/` with incomplete `control-target-app` stub, completed feature map, and config pointing at both.
3. Wrote playbook and capture script. Self-test green.
4. `node parity/scripts/capture-setup-benny-control-fail-closed.mjs --cursor-only` → `370c1adb…`.
5. `node parity/scripts/capture-setup-benny-control-fail-closed.mjs --pi-only` → `e6185d9b…`.
6. Confirmed both `identity.json` + `events.jsonl`, both done markers, no live automation extras. Wrote pair JSON + this report.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`. Evidence under `parity/evidence/setup-benny/control-fail-closed/` so sibling setup-benny roots stay untouched.
2. Prompt names step 6 and the capability checklist. Matches setup-benny skill text. Contract is still scored from done marker, screens/PTY, product digest, and automation FS side effects.
3. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`. Those files may show dirty from other writers; this worker did not touch them.
4. Did not commit.
5. Did not claim sibling SETUP-BENNY-* ids.
6. Skipped show-me-your-work cross-model trail review subagent. Brief forbids further subagents.

## Honest product gaps

1. This pair proves fail-closed on a deliberately incomplete control skill stub during setup step 6 only. It does not prove a full capability-pass path that would enable repro.
2. It does not prove pack merge, settings enable, secrets boundary, project-skills resolve, user-config-outside completeness, required-explicit fill, existing-no-automate, creation boundary, or thread safety.
3. Host reason strings differ slightly. Behavior matches.
4. Acceptance STATUS reason strings remain DRAFT / host-dependent.
5. Pi tool-order labels show `bash` for some reads. Control/stub engagement is also visible on settled screen and session flags.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-11 / `setup-benny-control-fail-closed` when ready. Close `PSTACK-SETUP-BENNY-CONTROL-FAIL-CLOSED-001` when oracle freeze allows.
2. Keep sibling SETUP-BENNY scenarios on their own pairs.
3. Optional later pass. Pair the control-ok path with a skill that actually implements the adapter contract (needs a real UI control surface).
