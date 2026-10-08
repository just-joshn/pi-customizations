# u-journey-family-05-why report

## Status

**pass** (linked Cursor+Pi `/why` pair captured; fixture digests match; Method A–style observations recorded). Does not edit ledgers or family-05 stub.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `97771f92-7d64-4ad8-9821-48701fe13881` |
| pi | `ceff7d79-2c2a-479b-b2a8-a7e529d9e8ce` |

Pair. `parity/evidence/why/pair-why-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical on both identities and both `rule-after.mdc`; both `ruleUnchanged: true`)

## Method A–style observations

Both sides attached the why skill and finished a structured why answer (Sources Consulted + Confidence Summary). No fabricated subagent IDs.

### Cursor (`97771f92`)

- Slash `/why what forces led...` submitted (screen-01).
- Decoded PTY shows investigator spawn chrome (`Spawning source`, `Running subagent`) before the final answer.
- Final screen includes Sources Consulted gaps for unavailable MCP categories and Confidence Summary.
- `Used why` chrome string was not present on this run (unlike attempt-1). Skill follow-through is evidenced by spawn chrome and answer shape.

### Pi (`ceff7d79`)

- Screen-01 shows `[skill] why` and residual prompt `what forces led pstack to use inherit-parent on role model lines in models.mdc` (slash name stripped).
- Session transcript confirms skill embed. Tools used were `bash` only (3 calls). No `task`/`Task` call. No `subagents/` directory for session `01a11cd1`.
- Final answer includes Sources Consulted and Confidence Summary. Non-source-control categories skipped with an explicit "judgment call" note, not MCP-absent. That is a playbook deviation vs default parallel investigators.

### Attempt-1 (discarded for the linked pair)

| Side | Attempt ID |
| --- | --- |
| cursor | `90041dbb-c06d-4595-a4c4-3fd83674de22` |
| pi | `5c9a69d5-fa5e-4cbc-9fbc-71198406592b` |

Archive. `parity/evidence/why/attempt-1-residual-yesno/`

Pi residual after `/why` strip was `does pstack models.mdc use inherit-parent...`. Model answered yes/no from in-context rule text and skipped the why playbook. Cursor on that run did full investigation (`Used why`, `Running subagent`). Driver question was changed so the residual stays motivation-shaped.

## Commands run

1. Confirmed locked fixture digest on `~/.cursor/rules/pstack-models.mdc` and `/tmp/pi-ref-agent/pstack/models.mdc`.
2. Added `parity/scripts/capture-why.mjs` (adapted from `capture-investigate.mjs`).
3. `node parity/scripts/capture-why.mjs --both` (attempt-1, then attempt-2 after residual fix). ~473s each.
4. Re-read screens, identities, Pi session jsonl, and re-hashed `rule-after.mdc`.

## Deviations

1. Sequential same-scenario captures, not one `recordPair()` call (same pattern as how/setup pairs).
2. Pi did not spawn investigator Tasks on the linked pair. Observation only. No product repair in this unit.
3. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or the family-05 stub.
4. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge `pair-why-1.json` into family-05 evidencePaths when ready.
2. Decide whether Pi inline-bash why (no Task investigators) is a mismatch vs Cursor `Running subagent`.
3. Prefer residual-safe `/why` prompt wording in future drivers (avoid yes/no `does` after slash strip).
4. Optional. Extend Method A scorer for why spawn signals if a why gate is productized later.
