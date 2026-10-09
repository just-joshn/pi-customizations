# Report: prin-sequence-units pair

## Status

**pass** for `PSTACK-PRIN-SEQUENCE-UNITS-001` on both hosts. Pair `prin-sequence-units-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `a25ac05b-fb4c-4d6c-a195-2a2e13a0b2cf` | Leaf Read + progressive verify-log `[0,1,2,3]` + `SEQUENCE-OK` (`contractHeld`) |
| Pi | `1b0ebd6e-1254-4932-9f79-5765a701c913` | Leaf Read + progressive verify-log `[1,2,3]` + `SEQUENCE-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/sequence-units/pair-prin-sequence-units-1.json`
- Capture script: `parity/scripts/capture-prin-sequence-units.mjs`
- Fixture: `parity/evidence/principles/sequence-units/fixture-app/`
- Cursor proof: `parity/evidence/principles/sequence-units/fixture-out/cursor/evidence/verify-out.txt`, `.../verify-log.jsonl`, `.../units/*.txt`
- Pi proof: `parity/evidence/principles/sequence-units/fixture-out/pi/evidence/verify-out.txt`, `.../verify-log.jsonl`, `.../units/*.txt`
- Decision log: `parity/evidence/principles/sequence-units/.audit/u-journey-prin-sequence-units.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/00b58d68-3690-416b-a0c5-17de6ec977ac/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-41-41-092Z_01a11e1b-cde4-770e-86c4-f27c1fab4ac3.jsonl`

## On-disk oracle (re-read)

Both hosts left `src/{alpha,beta,gamma}.js` at `NEW_*`, wrote `SEQUENCE-OK units=3` under `evidence/verify-out.txt`, and left `UNIT-OK` markers for all three stems. Durable copies live under `fixture-out/<side>/`. Both wrote `verified=yes` to the side-specific done marker.

Cursor `verify-log.jsonl` greenCounts are `0,1,2,3` (baseline fail, then one unit at a time). Pi log is `1,2,3` (first captured row already has alpha green). Transcript tool order on both sides shows edit of a new stem followed by `verify.mjs` before the next stem (`interleavedOk`).

Cursor transcript includes `Read` of `~/.claude/skills/principle-sequence-verifiable-units/SKILL.md`. Pi session includes `read` of `extensions/pi-pstack/skills/principle-sequence-verifiable-units/SKILL.md`. Package leaves under `parity/reference/cursor-plugins/pstack` and `extensions/pi-pstack` have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on prove-it / never-block / build-lever. Not a bare organic first try of sequence-units alone.
- Prompt also tells the agent to change one module at a time and re-run verify after each. That steers the per-unit ordering without naming the principle.
- Cursor Read the user skill at `~/.claude/skills/principle-sequence-verifiable-units/SKILL.md`, which lacks `disable-model-invocation`. Package copies used for the frontmatter oracle keep the flag true.
- Cursor model chrome this run was Haiku 5.5 High, not Auto. Pi stayed on claude-sonnet-5-5 medium.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Stacked commits / failing-test-then-fix delivery order was not exercised. The proving sequence here is progressive verify-log + interleaved edit/verify on a multi-unit migration.
- Pi session scorer set `hostAttached: false` (no `Used principle-...` chrome). Leaf Read still scored true from the read tool path.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
