# Report: create-verify maintain offer and outcomes pair

## Status

VERIFIED for maintain offer and maintain outcomes on both hosts. Pair `create-verify-maintain-1`.

Both hosts pointed at `/maintain-verification-skill` after prove. Both wrote a single `OUTCOME=` line among `clean`, `changed`, or `blocked`. Cursor reported `clean`. Pi reported `changed` after fixing feature-map Capture-step drift. That outcome delta is real and still satisfies the outcomes requirement.

## Attempts

| Host | Attempt ID | Offer | Outcome |
| --- | --- | --- | --- |
| Cursor | `24c341d9-3827-4f87-bd4d-9245b9eccb09` | yes | `OUTCOME=clean` |
| Pi | `951f8414-e0c0-465e-acb2-7b40ad6fd6b2` | yes | `OUTCOME=changed` |

## Artifacts

- Pair: `parity/evidence/create-verify/pair-create-verify-maintain-1.json`
- Cursor screens: `screen-04-prove-settled.txt`, `screen-07-maintain-settled.txt`
- Pi screens: `screen-04-prove-settled.txt`, `screen-07-maintain-settled.txt`
- Outcome files: `fixture-out/cursor/maintain-outcome.txt`, `fixture-out/pi/maintain-outcome.txt`
- Capture script: `parity/scripts/capture-create-verify-reuse.mjs --maintain`
- Decision log: `parity/evidence/create-verify/.audit/u-create-verify-maintain.tsv`
- Prior prove pair: `parity/evidence/create-verify/pair-create-verify-prove-1.json`

## On-disk oracle (re-read)

Cursor durable proof under `fixture-out/cursor/proof/` has `hello-stdout.txt` = `HELLO-FAMILY-13`, exit `0`, empty stderr. Settled prove screen offered `/maintain-verification-skill`. Maintain screen wrote `OUTCOME=clean` and said no skill edits.

Pi live and durable proof under `fixture-out/pi/proof/` (from `evidence/hello-print/`) has `stdout.txt` = `HELLO-FAMILY-13`, exit `0`, empty stderr. Settled prove screen offered `/maintain-verification-skill` and said it had not run it yet. Maintain screen wrote `OUTCOME=changed` after editing the feature map Capture step only.

## What changed in the lever

1. `--maintain` mode generates, proves, requires the maintain offer on settle, then runs a second-turn maintain pass that writes `fixture-out/<side>/maintain-outcome.txt`.
2. `cleanGenerated` clears both host skill trees so leftover proof cannot satisfy the other host.
3. `readProofArtifacts(side)` prefers host-scoped layouts, including Pi nested `evidence/hello-print/`.

## Honest deltas (unreconciled)

- Skill root `.cursor/skills` vs `.pi/skills`.
- Evidence path and filenames differ (flat `hello-*.txt` vs nested `hello-print/{stdout,stderr,exit-code}.txt`).
- Maintain outcome differs (`clean` vs `changed`) for the same hello-cli fixture on the same day.
- Model chrome differs (Auto vs claude-sonnet-5-5 medium).

## Oracle notes

Cursor's first capture log briefly preferred leftover `.pi` evidence until host-scoped lookup landed. Screen and on-disk Cursor evidence were under `.cursor/skills/verify-hello-cli/evidence/`. Observations patched. No second Cursor PTY.

Pi's first capture log printed `liveProvePassed=false` because the oracle missed nested `evidence/hello-print/`. Prove screen and files already existed from that same PTY attempt. Oracle widened and observations patched. No second Pi PTY.

## Not claimed

- Does not edit ledgers.
- Does not claim identical maintain outcomes across hosts.
- Does not close family-13 recall.
