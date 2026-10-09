# Report: prin-prove-it pair

## Status

**pass** for `PSTACK-PRIN-PROVE-IT-001` on both hosts. Pair `prin-prove-it-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `9f605907-9633-4897-8357-c174bf170c65` | Leaf Read + `ADD-OK` kept (`contractHeld`) |
| Pi | `4af22cca-9d26-4592-81e2-058a9d96f4fc` | Leaf Read + `ADD-OK` kept (`contractHeld`) |

Prior Pi attempts (not the linked pair): `2e3e230a-97bc-4d34-bc12-c595072734f9` verified the artifact without opening the leaf; `14b8c419-d700-4669-bb09-41fe04cc7876` looked like a leaf hit until the oracle required a path-shaped Read. Prior Cursor organic attempt `51e14eed-b3f1-41e6-a2f3-8e71a259f38c` also passed before the prompt rematch.

## Artifacts

- Pair: `parity/evidence/principles/pair-prin-prove-it-1.json`
- Capture script: `parity/scripts/capture-prin-prove-it.mjs`
- Cursor proof copy: `parity/evidence/principles/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/.audit/u-journey-prin-prove-it.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/6231a104-00c2-49b8-ae30-77b058f5fff5/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-14-08-811Z_01a11e02-97ab-721f-8f91-013f7f2cfe53.jsonl`

## On-disk oracle (re-read)

Both hosts fixed `src/add.js` to `a + b`, ran `node scripts/verify.mjs`, and left `ADD-OK value=5` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Both wrote `verified=yes` to the side-specific done marker.

Cursor transcript includes `Read` of `principle-prove-it-works/SKILL.md` and `Shell(verify.mjs)`. Pi session includes `read` of `extensions/pi-pstack/skills/principle-prove-it-works/SKILL.md` and the same verify script. Leaf frontmatter has `disable-model-invocation: true` on both package copies. `modelAutoInvoke` stayed false.

## Honest gaps

- Pi did not open the leaf on two organic runs. The linked Pi attempt used a prompt line that restates poteto-mode's own rule (read the leaf SKILL.md for principles you apply). Cursor rematched that prompt for pair parity. An earlier Cursor organic run had already passed without it.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Model chrome differs (Auto vs claude-sonnet-5-5 medium).
- Adjacent citations (fix-root, laziness, sequence) appeared in prose. Not claimed without their own leaf Reads.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
