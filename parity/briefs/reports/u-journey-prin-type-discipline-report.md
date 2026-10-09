# Report: prin-type-discipline pair

## Status

**pass** for `PSTACK-PRIN-TYPE-DISCIPLINE-001` on both hosts. Pair `prin-type-discipline-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `33d927a2-8d1d-471f-8d0b-f6284c67b21b` | Leaf Read + `status` sum type + `TYPE-OK` (`contractHeld`) |
| Pi | `9cae5688-2cb4-4719-8c5f-fa1c908a983e` | Leaf Read + `kind` sum type + `parseTicket` + `TYPE-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/type-discipline/pair-prin-type-discipline-1.json`
- Capture script: `parity/scripts/capture-prin-type-discipline.mjs`
- Fixture: `parity/evidence/principles/type-discipline/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/type-discipline/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/type-discipline/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/type-discipline/.audit/u-journey-prin-type-discipline.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/a1ec29cf-e7f3-4bab-a8bf-d9830b48a865/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-51-20-862Z_01a11e24-a69d-73a5-a11b-2d41a3864e32.jsonl`

## On-disk oracle (re-read)

Both hosts left `TYPE-OK value="open:a|done:b@2026-10-08"` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`) and wrote `verified=yes` to the side-specific done marker.

Cursor `fixture-after/src/ticket.ts` uses `{ status: 'open' } | { status: 'done'; completedAt: string }` with a switch and no `as string` cast. Transcript includes `Read` of `~/.claude/skills/principle-type-system-discipline/SKILL.md` and `Shell(verify.mjs)` before the product write.

Pi `fixture-after/src/ticket.ts` uses `{ kind: 'open' } | { kind: 'done'; completedAt: string }`, exhaustive `never` default, and `parseTicket` that drops the illegal raw `completed: true` without timestamp. Session includes `read` of `extensions/pi-pstack/skills/principle-type-system-discipline/SKILL.md` and bash verify before the product edit.

Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

First oracle pass scored Cursor `illegalUnrepresentable=false` because it only matched a `kind` discriminant. Capture artifacts were unchanged. The detector was widened to `status|kind`, then `fixture-after` was re-scored on disk. Both sides `contractHeld`.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on fix-root and never-block. Not a pure organic trigger of type-discipline alone.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Cursor model chrome was not visible on the settled PTY screen. Pi shows claude-sonnet-5-5 medium.
- Oracle re-score after widening the discriminant matcher. PTY runs themselves were not re-executed.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
