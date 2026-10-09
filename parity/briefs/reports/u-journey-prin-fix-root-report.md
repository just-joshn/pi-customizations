# Report: prin-fix-root pair

## Status

**pass** for `PSTACK-PRIN-FIX-ROOT-001` on both hosts. Pair `prin-fix-root-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `5d36f6ca-23fd-462c-8e35-7666ddf387de` | Leaf Read + reproduce-first + `displayName` root fix + `GREET-OK` (`contractHeld`) |
| Pi | `dffb963b-d1b4-42a4-bca0-e36b02bef0f3` | Leaf Read + reproduce-first + `displayName` root fix + `GREET-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/fix-root/pair-prin-fix-root-1.json`
- Capture script: `parity/scripts/capture-prin-fix-root.mjs`
- Fixture: `parity/evidence/principles/fix-root/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/fix-root/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/fix-root/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/fix-root/.audit/u-journey-prin-fix-root.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/b7069fda-f127-4d2b-b528-f0f4be72c3ef/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-44-35-315Z_01a11e1e-7672-7492-9dc8-a1a2bb50efae.jsonl`

## On-disk oracle (re-read)

Both hosts changed `src/config.js` from `cfg.displayNam` to `cfg.displayName`, left `src/greet.js` without a nil guard, ran `node scripts/verify.mjs`, and left `GREET-OK value="hello, WORLD"` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Both wrote `verified=yes` to the side-specific done marker.

Cursor transcript includes `Read` of `~/.claude/skills/principle-fix-root-causes/SKILL.md` and `Shell(verify.mjs)` before the product edit (poll timestamps confirm verify before product). Pi session includes `read` of `extensions/pi-pstack/skills/principle-fix-root-causes/SKILL.md` and bash verify before `edit` on `config.js`. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on prove-it and never-block. Not a pure organic trigger of fix-root alone.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`). The `~/.claude` copy lacks `disable-model-invocation` in frontmatter; package copies used for the frontmatter gate have it.
- Model chrome differs (Claude Haiku 5.5 300K High vs claude-sonnet-5-5 medium).
- Cursor transcript tool timestamps share second resolution for first verify and first product write. Reproduce-first also rests on poll order (`firstVerifyAt` before `firstProductAt`) and fail text in PTY.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
