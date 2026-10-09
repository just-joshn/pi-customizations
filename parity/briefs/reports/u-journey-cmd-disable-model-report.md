# u-journey-cmd-disable-model report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both hosts answered an architectural layering question without host-auto-attaching how. Frontmatter `disable-model-invocation: true` confirmed on both locked how skill paths. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `d5cca07e-5927-437f-863c-92d0471f95b7` |
| pi | `2b4fc338-046f-4572-8a7a-b6ce9a8b56ad` |

Pair. `parity/evidence/disable-model/pair-disable-model-invocation-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Contract held?

| Side | Frontmatter disable | Host how attach | Available-skills how | Answered | Verdict |
| --- | --- | --- | --- | --- | --- |
| cursor | true | no | n/a (no session catalog) | yes | **yes** |
| pi | true | no | no | yes | **yes** |

Oracle. Ordinary prompt with description-match language ("walk through how store.js and api.js connect", soft-delete ownership) and no leading `/how`. Scorer fails on `Used how`, `[skill] how`, `<skill name="how">`, or how listed under Pi `<available_skills>`. Voluntary `read` of `how/SKILL.md` would be noted and not fail; neither side did that.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Confirmed how frontmatter on `parity/reference/cursor-plugins/pstack/skills/how/SKILL.md` and `extensions/pi-pstack/skills/how/SKILL.md`.
3. Trusted fixture cwd in `/tmp/pi-ref-agent/trust.json`.
4. Planted `parity/evidence/disable-model/fixture-app` and wrote `parity/scripts/capture-disable-model-invocation.mjs`.
5. `node parity/scripts/capture-disable-model-invocation.mjs --self-test`.
6. `node parity/scripts/capture-disable-model-invocation.mjs --cursor-only` (~22s).
7. `node parity/scripts/capture-disable-model-invocation.mjs --pi-only` (~25s).
8. Re-read settled screens, Pi session (`bash`/`bash` only; no how inject), and both answer/done markers.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or scenario stubs.
3. Did not commit.

## Honest product gaps

1. This pair proves absence of host-attach chrome on one organic description-match turn. It does not prove that every description-match phrasing is blocked, or that an explicit `/how` still attaches (that is a different scenario).
2. Cursor has no Pi-style `<available_skills>` transcript field in this harness, so Cursor evidence is PTY chrome plus outcome. Pi adds session inject/catalog checks.
3. Pi's pstack host still names `how` in the host-contract skill list for slash/handoff entry. That is expected. The model-facing `<available_skills>` catalog omitted how on this turn.

## Suggested follow-ups for the coordinator

1. Merge `disable-model-invocation-1` into `cmd-disable-model-invocation` evidence and close PSTACK-CMD-DISABLE-MODEL-INVOCATION-001 when ready.
2. Optionally add a paired positive control (explicit `/how` attaches) in a separate brief so disable-model is not only an absence claim.
