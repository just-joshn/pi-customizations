# u-journey-family-13 report

## Status

**pass** for the capture brief. First linked Cursor+Pi pair for journey family 13 captured on real PTY. Both hosts generated `verify-hello-cli` from the tiny fixture, then rediscovered and reused it on a second turn by writing `REUSED=<skill-abs>`. Fixture digests match. Honest host deltas recorded. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `9a4dae62-0072-494c-a6d5-7f013fbfb66e` |
| pi | `fba64ade-c697-4368-84ea-4281386b9e81` |

Pair. `parity/evidence/create-verify/pair-create-verify-reuse-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (both sides `ruleUnchanged: true`, afterDigest identical)

## Observed generate-then-reuse

Prompt turn 1 on both sides. Constrained `/create-verification-skill` against `parity/evidence/create-verify/fixture-app` (`hello.sh` prints `HELLO-FAMILY-13`). Skip live prove and maintain offer.

Prompt turn 2 on both sides. Discover the generated skill, do not regenerate, write one `REUSED=` line under `fixture-out/<side>/reuse.txt`.

### Cursor (reference)

Measured from `screen-04-create-settled.txt`, `screen-07-reuse-settled.txt`, on-disk skill tree, and `fixture-out/cursor/reuse.txt`.

1. Wrote `.cursor/skills/verify-hello-cli/SKILL.md` with `name: verify-hello-cli`, Launch/Doctor/Drive/Evidence/Cleanup, plus `features/README.md` and `features/hello-print.md`.
2. Listed absolute skill paths on the settled create screen.
3. Second turn showed `Used verify-hello-cli`, then wrote the exact `REUSED=` line.
4. Issues none for this constrained slice.

### Pi (adaptation)

Measured from `screen-04-create-settled.txt`, `screen-07-reuse-settled.txt`, on-disk skill tree, `fixture-out/pi/reuse.txt`, and session `2026-10-08T19-05-25-544Z_01a11ce7-f327-71cc-bfc6-46a98f230ae2.jsonl`.

1. Wrote `.pi/skills/verify-hello-cli/SKILL.md` with the same frontmatter name and section shape, plus the feature map pair.
2. Settled create screen listed absolute paths and said prove/maintain were skipped as asked.
3. Second turn showed `[skill] verify-hello-cli:1-30`, read Launch/Doctor, wrote the exact `REUSED=` line.
4. Screen-regex `createFinal.createVerifySkill` was false after settle. On-disk skill is the oracle and it passes.

## Generate and reuse checks

| Check | Cursor | Pi |
| --- | --- | --- |
| Skill file exists | yes (`.cursor/skills/...`) | yes (`.pi/skills/...`) |
| `name: verify-hello-cli` | yes | yes |
| Launch section present | yes | yes |
| Feature map seeded | yes | yes |
| Second-turn reuse file | yes | yes |
| `REUSED=` equals skill abs path | yes | yes |
| Regenerated on turn 2 | no (same skill body kept) | no |

## Commands run

1. Confirmed locked fixture digest on `~/.cursor/rules/pstack-models.mdc` and `/tmp/pi-ref-agent/pstack/models.mdc`.
2. Wrote `parity/evidence/create-verify/fixture-app/{hello.sh,README.md}`.
3. Wrote `parity/scripts/capture-create-verify-reuse.mjs`.
4. Ran `--cursor-only`, then `--pi-only`.
5. Re-read settled screens, identities, rule-after digests, skill files, and reuse markers.

## Deviations

1. Skill install root differs by host (`.cursor/skills` vs `.pi/skills`). Expected and recorded, not silently reconciled.
2. Live prove and maintain offer were skipped on purpose so the pair covers generate-then-reuse inside the timebox. Full prove remains open for later CREATE-VERIFY prove requirements.
3. Family stub also lists recall, reports, canvases, diagrams, automate-me. This pair only covers the minimal create-verify generate-then-reuse slice.
4. Did not edit `requirements.json`, `mismatches.json`, or `progress.md`.
5. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge this pair into `journey-family-13-generated-resources-reuse` evidencePaths and wire `cmd-create-verify-skill` / `setup-create-verify-generate` execution.
2. Capture a recall discovery-reuse pair next if that requirement still needs its own journey.
3. Decide whether a follow-on pair should run the generated skill's live prove step on both hosts.
