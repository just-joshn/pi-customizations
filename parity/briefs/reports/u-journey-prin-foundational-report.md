# Report: prin-foundational pair

## Status

**pass** for `PSTACK-PRIN-FOUNDATIONAL-001` on both hosts. Pair `prin-foundational-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `65219cb4-d58b-4567-b7bb-0300966d0a31` | Leaf Read + `src/types.js` before `src/board.js` + `BOARD-OK` (`contractHeld`) |
| Pi | `d553905a-8e0a-47c6-ab11-bdb96fe53f60` | Leaf Read + `types.js` before `board.js` in bash + `BOARD-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/foundational/pair-prin-foundational-1.json`
- Capture script: `parity/scripts/capture-prin-foundational.mjs`
- Fixture: `parity/evidence/principles/foundational/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/foundational/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/foundational/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/foundational/.audit/u-journey-prin-foundational.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/2268cdea-df05-4ac4-837e-321faba2ff58/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-51-28-064Z_01a11e24-c2c0-73e7-b014-8dc5ade77f67.jsonl`

## On-disk oracle (re-read)

Both hosts left a `Job` shape module at `src/types.js`, implemented exclusive claim in `src/board.js` importing that module, ran `node scripts/verify.mjs`, and left `BOARD-OK jobs=2` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Both wrote `verified=yes` to the side-specific done marker.

Cursor poll log shows `src/types.js` at `2026-10-09T00:50:48.464Z` and `src/board.js` at `2026-10-09T00:50:50.071Z`. Transcript includes `Read` of `~/.claude/skills/principle-foundational-thinking/SKILL.md`. Pi session reads the package leaf under `extensions/pi-pstack/skills/principle-foundational-thinking/SKILL.md` at `00:51:29`, then a bash that `cat`s `src/types.js` before `src/board.js`. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge and an example path `src/types.js`. Not a pure organic trigger of foundational alone.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`). The `~/.claude` copy lacks `disable-model-invocation` in frontmatter; package copies used for the frontmatter gate have it.
- Model chrome differs (Cursor screen shows `Auto` vs Pi `claude-sonnet-5-5` medium).
- Cursor parent transcript did not surface Write/StrReplace tool rows for the product files. Shape-before-board rests on poll timestamps plus the durable `fixture-after` tree.
- Pi wrote both files in one bash. In-script order is types then board. Poll timestamps for those two paths are equal.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
