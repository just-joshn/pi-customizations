# u-journey-cmd-tech-writing report

## Status

**pass** for the capture brief (linked Cursor+Pi pair on real PTY, honest host deltas). Both hosts activated `/technical-writing` and wrote layered how-to + reference docs under the fixture. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `5b48533b-5d65-48de-ab6d-08c089583c46` |
| pi | `60f6b4f6-d503-4b64-9909-853243f70563` |

Pair. `parity/evidence/technical-writing/pair-technical-writing-docs-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Structured docs on both hosts?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | FS poll wrote `README.md` then `docs/reference.md` at `2026-10-08T19:42:34.948Z`. Snapshot README is numbered how-to procedures. `docs/reference.md` is dry argv reference tables. `done.txt` line `README.md (how-to), docs/reference.md (reference)`. |
| pi | **yes** | FS poll at `2026-10-08T19:43:59.247Z`. Session `01a11d0b…` injected package `technical-writing` SKILL.md, then bash wrote how-to README (`# How to greet someone with greet`) and `docs/reference.md`. `done.txt` under prompted `fixture-out/pi/`. |

Worker capture playbook. `parity/evidence/technical-writing/PLAYBOOK.md` was written before the capture script run.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Wrote worker `PLAYBOOK.md`, fixture-app (messy `README.md`, `src/greet.js`), then `parity/scripts/capture-technical-writing-docs.mjs`.
3. `node parity/scripts/capture-technical-writing-docs.mjs --cursor-only` (~48s).
4. `node parity/scripts/capture-technical-writing-docs.mjs --pi-only` (~30s).
5. Re-read screens, poll logs, fixture snapshots, Pi session skill block and tool order.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Capture-script token scorer marked Cursor README as `reference` only because the body lacks the literal `how-to` string. Manual read of the snapshot shows procedural how-to steps. Pair observations record that nuance.
3. Pi screen still shows an unrelated `tdd` skill-collision banner. `technical-writing` itself loaded from `extensions/pi-pstack/skills/technical-writing/SKILL.md`.
4. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or the family-05 stub.
5. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-05 / `cmd-technical-writing-docs` evidence when ready.
2. Optionally tighten the docs scorer to treat numbered procedure READMEs as how-to without requiring the literal token.
3. Optionally clear or document the Pi `tdd` collision chrome so family-05 screens stay on-topic.
