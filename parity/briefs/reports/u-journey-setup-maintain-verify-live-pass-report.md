# Report: maintain-verify live-pass pair

## Status

**pass** for the clean-path live-pass invariants of `PSTACK-SETUP-MAINTAIN-VERIFY-LIVE-PASS-001`.

Pair `maintain-verify-live-pass-1`. Both hosts ran a real PTY maintain journey on dedicated `fixture-app-live-pass`, wrote `LIVE_PASS_RAN=yes` with doctor-before-drive / evidence-survives-cleanup / no leftover residue / final teardown / evidence remains, and recorded `OUTCOME=clean`. Capture also saw `HELLO-FAMILY-13` evidence at settle on both sides.

Failure-path branches (doctor-drift retry, verified-unreachable, harness redrive) were not exercised. Those stay unpaid.

## Attempts

| Host | Attempt ID | LIVE_PASS_RAN | OUTCOME |
| --- | --- | --- | --- |
| Cursor | `311766cd-245f-4bfb-8ade-d9235193c6a9` | yes | clean |
| Pi | `2f0c388b-c4fc-4763-9cab-0f0aa377ae69` | yes | clean |

## Artifacts

- Pair: `parity/evidence/maintain-verify/pair-maintain-verify-live-pass-1.json`
- Capture script: `parity/scripts/capture-maintain-verify-live-pass.mjs`
- Fixture: `parity/evidence/maintain-verify/fixture-app-live-pass/`
- Markers: `fixture-out/live-pass/{cursor,pi}/live-pass-marker.txt`
- Decision log: `parity/evidence/maintain-verify/.audit/u-journey-setup-maintain-verify-live-pass.tsv`

## On-disk oracle (re-read)

Both markers match this shape:

```
LIVE_PASS_RAN=yes
SOURCE_LOOKED_CLEAN=yes
COORDINATOR_OWNED_DRIVING=yes
FEATURES_EXERCISED=1
DOCTOR_BEFORE_DRIVE=yes
EVIDENCE_SURVIVES_CLEANUP=yes
NO_LEFTOVER_RESIDUE=yes
DOCTOR_DRIFT_RETRY=na
VERIFIED_UNREACHABLE=na
HARNESS_REDRIVE=na
FINAL_TEARDOWN=yes
EVIDENCE_REMAINS=yes
OUTCOME=clean
BLOCKER=none
```

Pi evidence still on disk under `.pi/evidence/verify-hello-cli/` (`HELLO-FAMILY-13`, empty stderr, exit `0`).

Cursor evidence was present at settle (`observations.json` records `helloOk: true` and the settled screen narrates doctor then drive). A later Pi `seedSkills` wiped `.cursor/evidence` on the shared dedicated fixture. The capture script now wipes only the active host's skills/evidence so a future `--both` run keeps sibling evidence.

## Honest gaps

- Doctor failure from skill drift + single retry before blocked was not forced.
- `verified-unreachable` with concrete prerequisite and attempted route was not forced.
- Harness fix re-driven live before ship was not forced.
- Cursor settled screen notes `/maintain-verification-skill` was not installed in that session; the agent followed the cached pstack plugin definition and drove live itself.
- Pi skipped concurrent source-wave children and read the feature file itself. Do not claim `PSTACK-SETUP-MAINTAIN-VERIFY-SOURCE-WAVE-001` from this pair.
- Cursor evidence path is missing after the Pi seed wipe; within-run survival for Cursor rests on settle observations and screens, not on a surviving directory today.

## Not claimed

- No ledger edits.
- No `pstack-models.mdc` writes.
- No commit.
- No SOURCE-WAVE close.
- No failure-path live-pass close.
