# Report: prin-laziness pair

## Status

**pass** for `PSTACK-PRIN-LAZINESS-001` on both hosts. Pair `prin-laziness-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `f3a6669a-3e76-4ae3-9f8e-50ce94f2fc2a` | Leaf Read + deleted `src/pipeline.js` + `FLAT-OK` (`contractHeld`) |
| Pi | `7e4c208d-60c8-4529-9849-1e70eed051fa` | Leaf Read + deleted `src/pipeline.js` + `FLAT-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/laziness/pair-prin-laziness-1.json`
- Capture script: `parity/scripts/capture-prin-laziness.mjs`
- Fixture: `parity/evidence/principles/laziness/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/laziness/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/laziness/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/laziness/.audit/u-journey-prin-laziness.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/32e37b5c-967c-45b2-8442-8d2b9830d953/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-40-43-072Z_01a11e1a-eb40-7314-8313-7ca44d283e23.jsonl`

## On-disk oracle (re-read)

Both hosts deleted `src/pipeline.js`, left `greet()` calling `message()` from `src/core.js`, and wrote `FLAT-OK path=delete files=core.js,greet.js` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Neither created `src/strategies/`. Both wrote `verified=yes` to the side-specific done marker.

Cursor transcript includes `Read` of `~/.claude/skills/principle-laziness-protocol/SKILL.md` and `Shell(verify.mjs)`. Pi session includes `read` of `extensions/pi-pstack/skills/principle-laziness-protocol/SKILL.md` and bash that ran verify. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on sibling principle journeys. Not a pure organic first trigger of laziness alone.
- NOTES.md names both a registry approach and deletion. The verify oracle rejects the registry path, so the temptation is real but the scoring gate is not blind to it.
- Cursor Read the user skill at `~/.claude/skills/principle-laziness-protocol/SKILL.md`, which lacks `disable-model-invocation`. Package copies used for the frontmatter gate have it.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Model chrome differs (Cursor screen dumps had no model label; Pi showed claude-sonnet-5-5 medium).

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
