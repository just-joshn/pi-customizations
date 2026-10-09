# Report: setup-verify-offer pair

## Status

PASS for offer-once plus the no branch on both hosts. Pair `setup-verify-offer-1`.

Yes branch was not paired in this run. Acceptance allows one branch when the other is noted.

## Attempts

| Host | Attempt ID | Offer once | Branch | Continued without push |
| --- | --- | --- | --- | --- |
| Cursor | `b12de787-9406-4de1-8993-bd3b818bb912` | yes | no | yes |
| Pi | `27567808-9734-4516-b6e2-629dfb650d68` | yes | no | yes |

## Artifacts

- Pair: `parity/evidence/setup-verify-offer/pair-setup-verify-offer-1.json`
- Cursor screens: `screen-04-offer.txt`, `screen-06-branch-timeout.txt`
- Pi screens: `screen-04-offer.txt`, `screen-06-branch-settled.txt`
- Capture script: `parity/scripts/capture-setup-verify-offer.mjs --both --no`
- Fixture app: `parity/evidence/setup-verify-offer/fixture-app` (README + hello.sh only)
- Decision log: `parity/evidence/setup-verify-offer/.audit/u-journey-setup-verify-offer.tsv`

## On-screen oracle (re-read)

Cursor after write offered `/create-verification-skill`. Follow-up `No` produced `Understood — skipping the verification skill. Setup is done.` No verify-* skill on disk. No `[skill] create-verification-skill` attach.

Pi after write offered `/create-verification-skill`. Follow-up `No` produced `Okay, I won't create one. Setup is finished.` No verify-* skill on disk. No create-verification skill attach.

Locked `pstack-models.mdc` digest restored to `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` after both sides.

## Oracle notes

Cursor's first capture log marked `createAttached=true` because the loose detector matched offer text plus a find command mentioning `SKILL.md`. Screen-06 already showed the skip. Observations were patched from that screen. No second Cursor PTY. The detector in the capture script was tightened for later runs.

## Honest deltas

- Cursor used chatform accept after a role-confirm wait timeout. Pi used AskQuestion Accept as-is.
- Skip wording differs across hosts.
- Model chrome differs (Auto vs claude-sonnet-5-5 medium).
- Yes branch not captured.

## Not claimed

- Does not edit ledgers.
- Does not claim the yes branch (invoke `/create-verification-skill` on yes).
- Does not claim identical confirm UX across hosts.
