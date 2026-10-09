# u-journey-family-07 report

## Status

**pass** for the capture brief's interrupt→redirect slice. First linked Cursor+Pi pair for journey family 07 captured on real PTY. Escape cancelled a mid-flight `/how` on both hosts. Neither side wrote `CANCELLED-HOW-COMPLETE`. Both wrote `REDIRECT-OK` and answered `REDIRECT-OK 56`. Honest host deltas recorded. Ledgers untouched. No commit.

Family stub also names compact context, branch session, and Pi restart resume. Those slices are out of this pair's scope.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `aa52982b-074e-4c64-954b-c7a968c1fc5f` |
| pi | `9138c152-0a7c-4e63-9ff5-c0250bb936d3` |

Pair. `parity/evidence/interrupt/pair-interrupt-redirect-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (both sides `ruleUnchanged: true`, afterDigest identical)

## Observed interrupt and redirect

Long prompt on both sides. `/how` over `parity/recorder/attempt.mjs` with a side-local `cancelled-how.txt` marker. Cancel key. Escape. Follow-up. Distinct redirect to write `redirect-ok.txt` and reply `REDIRECT-OK 56`.

### Cursor (reference)

Measured from `screen-03-midflight.txt`, `screen-05-after-cancel-settled.txt`, `screen-08-redirect-settled.txt`, plus on-disk markers.

1. Mid screen showed Working and `ctrl+c to stop`.
2. Escape cleared Working. The `/how` text returned to the composer (`→ /how...`).
3. Redirect typing therefore appended onto the restored how text. Settled user bubble shows how and redirect concatenated.
4. Agent said it was stopping the `/how` work, wrote only `REDIRECT-OK`, and replied `REDIRECT-OK 56`.
5. `cancelled-how.txt` absent. `redirect-ok.txt` is exactly `REDIRECT-OK`.

### Pi (adaptation)

Measured from `screen-03-midflight.txt`, `screen-05-after-cancel-settled.txt`, `screen-08-redirect-settled.txt`, plus on-disk markers and session `2026-10-08T19-03-58-422Z_01a11ce6-9ed6-7242-be8c-7ca593b368dc.jsonl`.

1. Mid screen showed `[skill] how` and Working.
2. Escape produced `Operation aborted`. Composer was clear for a new turn.
3. Redirect was a separate user turn.
4. Agent wrote `REDIRECT-OK` and replied `REDIRECT-OK 56` with no recorder walkthrough as the deliverable.
5. `cancelled-how.txt` absent. `redirect-ok.txt` is exactly `REDIRECT-OK`.

## Checks

| Check | Cursor | Pi |
| --- | --- | --- |
| Mid-flight Working before Escape | yes | yes |
| Cancel signal observed | Working cleared; composer restore | `Operation aborted` |
| Cancelled marker written | no | no |
| Redirect marker written | yes | yes |
| Final answer `REDIRECT-OK 56` | yes | yes |
| Silent continuation of cancelled how as final deliverable | no | no |

## Commands run

1. Confirmed locked fixture digest on `~/.cursor/rules/pstack-models.mdc` and `/tmp/pi-ref-agent/pstack/models.mdc`.
2. Wrote `parity/scripts/capture-interrupt-redirect.mjs`.
3. Ran `--cursor-only`, then `--pi-only`.
4. Re-read mid, after-cancel, and settled screens, identities, rule-after digests, marker files, event input bytes (Escape only, no Ctrl-C), and the Pi session above.

## Deviations

1. Cursor Escape restores the cancelled prompt into the composer. Redirect text appended to that prompt in this harness. Not silently reconciled.
2. Pi prints explicit `Operation aborted`. Cursor does not use that string.
3. Model identity chrome differs. Cursor Auto vs Pi `claude-sonnet-5-5 • medium`.
4. Family stub also lists compaction, branch, and restart resume. This pair only covers interrupt→redirect.
5. Did not edit `requirements.json`, `mismatches.json`, or `progress.md`.
6. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge this pair into `journey-family-07-interrupt-compact-branch-resume` evidencePaths for the interrupt→redirect slice.
2. Decide whether Cursor composer-restore-on-Escape needs a host binding note for cancel UX parity.
3. Capture separate pairs for compaction and branch/restart resume if those remain required by the stub.
