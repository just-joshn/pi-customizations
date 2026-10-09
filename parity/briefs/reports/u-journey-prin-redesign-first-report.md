# Report: prin-redesign-first pair

## Status

**pass** for `PSTACK-PRIN-REDESIGN-FIRST-001` on both hosts. Pair `prin-redesign-first-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `dcb80bb4-cf3a-4a78-a9b1-df6f0a0aa370` | Leaf Read + foundational Price redesign + `REDESIGN-OK` (`contractHeld`) |
| Pi | `e297cc00-bdd7-4b7b-a489-e7a267dc328a` | Leaf Read + foundational Price redesign + `REDESIGN-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/redesign-first/pair-prin-redesign-first-1.json`
- Capture script: `parity/scripts/capture-prin-redesign-first.mjs`
- Fixture: `parity/evidence/principles/redesign-first/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/redesign-first/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/redesign-first/fixture-out/pi/evidence/verify-out.txt`
- Capture log: `parity/evidence/principles/redesign-first/capture-both.log`
- Decision log: `parity/evidence/principles/redesign-first/.audit/u-journey-prin-redesign-first.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/222d0e43-2d28-40f1-9221-6baa43bafcae/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T01-40-35-082Z_01a11e51-ba89-723b-850c-9b0d266abf4c.jsonl`

## On-disk oracle (re-read)

Both hosts replaced bare-number `price` with a core `{ amount, currency }` Price shape in `src/product.js`, rejected bare numbers, and updated `docs/price.md` plus `README.md` so currency is part of the design rather than an optional side field. Both left `REDESIGN-OK` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`) and wrote `verified=yes`.

Independent re-prove on each `fixture-after` product+docs against the baseline `scripts/verify.mjs` reproduced `REDESIGN-OK`.

Cursor transcript includes `Read` of `~/.claude/skills/principle-redesign-from-first-principles/SKILL.md`. Pi session includes `read` of `extensions/pi-pstack/skills/principle-redesign-from-first-principles/SKILL.md` after an initial verify. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false. Shared rule digest stayed on the locked fixture through flock serialization.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on other principle pairs.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Helper naming differs (`parsePrice` vs exported `createPrice`); both reject bare numbers and require amount+currency.
- Model chrome differs (Cursor Auto vs claude-sonnet-5-5 medium).
- Capture waited on `/tmp/pstack-parity-pstack-models.lock` behind peer principle journeys.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
