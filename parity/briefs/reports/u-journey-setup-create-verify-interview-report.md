# Report: create-verify interview pair

## Status

VERIFIED for the interview gate on both hosts. Pair `create-verify-interview-1`. Live prove and maintain were skipped on purpose.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `ee9d86df-a0c3-4169-80e1-103a3d000bf9` | interview.json ok; skill+feature map at settle; askedUser false |
| Pi | `27b66016-7b03-4c3b-bc36-1e7fe17f27e3` | interview.json ok; skill+feature map on disk; screen says did not ask the user |

## Artifacts

- Pair: `parity/evidence/create-verify/pair-create-verify-interview-1.json`
- Cursor interview: `parity/evidence/create-verify/fixture-out/cursor/interview.json`
- Pi interview: `parity/evidence/create-verify/fixture-out/pi/interview.json`
- Pi skill (live): `parity/evidence/create-verify/fixture-app/.pi/skills/verify-hello-cli/`
- Capture script: `parity/scripts/capture-create-verify-reuse.mjs --interview`
- Decision log: `parity/evidence/create-verify/.audit/u-journey-setup-create-verify-interview.tsv`

## On-disk oracle (re-read)

Both hosts wrote `interview.json` with Surface, Run, Drive, Observe, Isolate from `README.md` and `hello.sh`. Both set `askedUser: false` and `baseBuildsOrReported: true`. Neither settled screen asked the user for those five answers.

Both generated `verify-hello-cli` with Launch through Helpers and seeded `features/README.md` plus `hello-print.md` at settle time.

Pi settled screen lists the interview, skill, and feature-map paths and shows a base `./hello.sh` check (`HELLO-FAMILY-13`, `rc=0`).

## What changed in the lever

1. `--interview` mode interviews from the repo, writes `fixture-out/<side>/interview.json`, generates skill + feature map, skips prove/maintain/reuse.
2. Oracle requires five interview keys, repo evidence paths, `baseBuildsOrReported`, and rejects asking the user about observable Surface/Run/Drive/Observe/Isolate facts.

## Honest gaps

- Cursor `ruleUnchanged=false`. A concurrent `capture-setup-budget-apply` rewrote `~/.cursor/rules/pstack-models.mdc` during the attempt. Capture finally restored locked digest `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004`. Pi side stayed locked.
- Cursor live `.cursor/skills/verify-hello-cli/` was removed when Pi `cleanGenerated` ran next. Durable Cursor proof is `fixture-out/cursor/interview.json`, `screen-04-interview-settled.txt`, and `observations.json` (skill sectionsOk at settle). Same wipe pattern as the prove pair's Cursor evidence dir.
- Prompt still names the interview.json schema. The forbidden behavior under test is asking the user for facts already in the repo, not whether the agent invents the JSON shape unaided.
- Does not claim prove or maintain requirements.
- Does not edit ledgers. No commit.

## ExpectedObservation match

Requirement wants Surface/Run/Drive/Observe/Isolate from the codebase first, user asked only for what cannot be observed, and a broken base fixed or reported before generating. Both hosts matched that on the durable interview artifacts and screens. Pass.
