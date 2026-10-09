# u-journey-cmd-no-comments report

## Status

**partial** for the capture brief. Linked Cursor+Pi pair on real PTY with honest host deltas. Both hosts activated `/no-comments` and deleted all 7 AI-slop comments in `src/greet.js`. Cursor successfully spawned Comment Sicko (child first output was the mandated catchphrase). Pi attempted `task` with `agent_type: "Comment Sicko"` and the host rejected it (`Unknown agent_type`). Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `f4cd66ea-5fcd-49fc-aa35-9789e6fcfddc` |
| pi | `44860f00-0364-48b9-805d-0c4146cb9e9d` |

Pair. `parity/evidence/no-comments/pair-no-comments-sicko-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Comment cleanup / Sicko path held?

| Side | Skill activated | Sicko path held | Cleanup held | Catchphrase (FIRST-OUTPUT) |
| --- | --- | --- | --- | --- |
| cursor | **yes** | **yes** | **yes** (7→0 comments) | **yes** in child transcript `139f27a2…` (first assistant text). Not on parent PTY. |
| pi | **yes** | **no** | **yes** (7→0 via inline fallback) | **no** (no Sicko child) |

Pi spawn error (measured). `Unknown agent_type: Comment Sicko. Valid types are: code-review, explore, general-purpose, research, rubber-duck, security-review, task`

## Requirement mapping (evidence only; ledgers not edited)

| Requirement | Pair evidence |
| --- | --- |
| PSTACK-CMD-NO-COMMENTS-SICKO-001 | Cursor pass-shaped. Pi fail/mismatch on successful Sicko spawn. |
| PSTACK-CMD-COMMENT-SICKO-FIRST-OUTPUT-001 | Cursor observed in child. Pi not observed. |

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Trusted fixture cwd in `/tmp/pi-ref-agent/trust.json`.
3. Wrote worker `PLAYBOOK.md`, fixture-app (AI-commented `src/greet.js`), then `parity/scripts/capture-no-comments-sicko.mjs`.
4. `node parity/scripts/capture-no-comments-sicko.mjs --cursor-only` (~73s).
5. `node parity/scripts/capture-no-comments-sicko.mjs --pi-only` (~23s).
6. Re-read screens, Pi session tool order, Cursor child transcript for catchphrase.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Automated `sickoSpawned` on Pi initially true from error-text false positive. Corrected to `sickoSpawnSucceeded: false` after session inspection.
3. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or scenario stubs.
4. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-05 / `cmd-no-comments-sicko` evidence. Keep `PSTACK-CMD-NO-COMMENTS-SICKO-001` open until Pi registers Comment Sicko as a Task agent type (or a frozen exclusion).
2. Optionally recapture FIRST-OUTPUT with a Scorer that reads child transcripts on Cursor and Pi sessions once Pi spawn works.
3. Product fix candidate. Wire `Comment Sicko` / `comment-sicko` into Pi's Task `agent_type` allow-list (persona already referenced in package tests).
