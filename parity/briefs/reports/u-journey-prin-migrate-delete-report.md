# Report: prin-migrate-delete pair

## Status

**pass** for `PSTACK-PRIN-MIGRATE-DELETE-001` on both hosts. Pair `prin-migrate-delete-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `358649f2-255f-4700-9f7f-443f53f771eb` | Leaf Read + `formatName` + callers migrated + `legacyFormat.js` deleted + `MIGRATE-OK` (`contractHeld`) |
| Pi | `00a3375f-c96c-4f68-bb47-8cd357376365` | Leaf Read + same-wave bash migrate/delete + `MIGRATE-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/migrate-delete/pair-prin-migrate-delete-1.json`
- Capture script: `parity/scripts/capture-prin-migrate-delete.mjs`
- Fixture: `parity/evidence/principles/migrate-delete/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/migrate-delete/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/migrate-delete/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/migrate-delete/.audit/u-journey-prin-migrate-delete.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/28d67651-4c58-450c-993d-347dde8c645b/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-56-16-067Z_01a11e29-27c2-72f2-96b6-6ac013638b79.jsonl`

## On-disk oracle (re-read)

Both hosts added `src/format.js` exporting `formatName`, rewired `greet.js` and `banner.js` off `formatNameLegacy`, deleted `src/legacyFormat.js`, and left `MIGRATE-OK greet="hello, WORLD" banner="BANNER:TEAM" files=banner.js,format.js,greet.js` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Both wrote `verified=yes` to the side-specific done marker. No compat/shim file or dual export remained.

Cursor transcript includes `Read` of `~/.claude/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md`. Poll timestamps show format write, caller edits, then legacy delete in one attempt. Pi session includes `read` of `extensions/pi-pstack/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md` and one bash that writes `format.js`, sed-migrates callers, `rm legacyFormat.js`, and runs verify. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on fix-root and never-block. Not a pure organic trigger of migrate-delete alone.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Model chrome differs (Cursor screen shows Auto vs claude-sonnet-5-5 medium).
- Tool-order scorer missed Pi's `rm` inside a compound bash line (`firstLegacyDeleteAt` null in session score). Same-wave still held via poll/disk oracle and the full bash command in the session.
- Sequential same-scenario captures, not one `recordPair()` call.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
