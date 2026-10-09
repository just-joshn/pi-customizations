# Report: prin-boundary pair

## Status

**pass** for `PSTACK-PRIN-BOUNDARY-001` on both hosts. Pair `prin-boundary-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `f9bbb2d6-e5b4-47e2-b4f0-91b03291f4b9` | Leaf Read + boundary validate/map + pure core + `BOUNDARY-OK` (`contractHeld`) |
| Pi | `d8c69f86-0236-4851-a2c0-1a911175877e` | Leaf Read + boundary validate/map + pure core + `BOUNDARY-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/boundary/pair-prin-boundary-1.json`
- Capture script: `parity/scripts/capture-prin-boundary.mjs`
- Fixture: `parity/evidence/principles/boundary/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/boundary/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/boundary/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/boundary/.audit/u-journey-prin-boundary.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/0db379c5-2f10-4434-a31a-ee617d02927d/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-54-45-148Z_01a11e27-c49b-7422-ac96-8f46847becc6.jsonl`

## On-disk oracle (re-read)

Both hosts changed `src/load-config.js` to validate `displayName` and return `{ name }`, and stripped mid-chain typeof / missing-domain guards from `src/core.js` so `formatGreeting` only uppercases `cfg.name`. Both ran `node scripts/verify.mjs` and left `BOUNDARY-OK value="hello, WORLD"` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Both wrote `verified=yes` to the side-specific done marker.

Cursor transcript includes `Read` of `~/.claude/skills/principle-boundary-discipline/SKILL.md` and `Shell(verify.mjs)` before product writes. Pi session includes `read` of `extensions/pi-pstack/skills/principle-boundary-discipline/SKILL.md` after an initial verify, then product edits. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on prove-it and fix-root. Not a pure organic trigger of boundary-discipline alone.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`). The `~/.claude` copy lacks `disable-model-invocation` in frontmatter; package copies used for the frontmatter gate have it.
- Model chrome differs (Auto vs claude-sonnet-5-5 medium).
- Pi session `firstProductWriteAt` stayed null in the tool-order scorer (edits may have used a path shape the product-write detector missed); product digests and fixture-after still show both files changed.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
