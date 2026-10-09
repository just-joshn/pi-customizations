# Report: create-verify live prove pair

## Status

VERIFIED for the live prove gate on both hosts. Pair `create-verify-prove-1`. Maintain offer was not observed and is not claimed.

Pi's capture log first printed `liveProvePassed=false` because the oracle missed `hello-stdout.txt` under the skill `evidence/` directory. The proof files and settled screen already existed from that same PTY attempt. The oracle was widened and observations patched. No second Pi PTY was run.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `e5599015-5bb9-4aac-b1cd-ee11fe31bf05` | Generate + live prove passed (`PROOF-OK`) |
| Pi | `20d8304d-3d04-4913-b6b1-a67cf292c6e4` | Generate + live prove passed (`PROOF-OK`); first oracle pass was a false negative |

## Artifacts

- Pair: `parity/evidence/create-verify/pair-create-verify-prove-1.json`
- Cursor proof copy: `parity/evidence/create-verify/fixture-out/cursor/proof/`
- Pi proof copy: `parity/evidence/create-verify/fixture-out/pi/proof/`
- Capture script: `parity/scripts/capture-create-verify-reuse.mjs --prove`
- Decision log: `parity/evidence/create-verify/.audit/u-create-verify-prove.tsv`
- Prior GENERATE pair (not prove proof): `parity/evidence/create-verify/pair-create-verify-helpers-1.json`

## On-disk oracle (re-read)

Both hosts wrote `verify-hello-cli` with Launch through Helpers. Both drove `./hello.sh` and left proof files after cleanup.

Cursor durable copy has `stdout.txt` = `HELLO-FAMILY-13`, `exit-code.txt` = `0`, empty `stderr.txt`. Settled screen showed `PROOF-OK` and `SURVIVED-OK`.

Pi live and durable copy have `hello-stdout.txt` = `HELLO-FAMILY-13`, `hello-exit-code.txt` = `0`, empty `hello-stderr.txt`. Settled screen listed those absolute paths and said prove passed.

## What changed in the lever

1. `--prove` mode generates, runs live prove, skips maintain, skips the reuse second turn.
2. `readProofArtifacts` accepts both `stdout.txt` layouts and `hello-stdout.txt` under the skill `evidence/` directory (Pi's layout).
3. Proof trees are copied to `fixture-out/<side>/proof/` before the next host cleans shared paths.

## Honest deltas (unreconciled)

- Skill root `.cursor/skills` vs `.pi/skills`.
- Evidence path and filenames differ (`.cursor/evidence/verify-hello-cli/{stdout,stderr,exit-code}.txt` vs `.pi/skills/verify-hello-cli/evidence/hello-*.txt`).
- Model chrome differs (Auto vs claude-sonnet-5-5 medium).

## Not claimed

- Does not mark maintain / offer-maintain requirements.
- Does not edit ledgers.
- Does not treat helpers or reuse pairs as prove proof.
