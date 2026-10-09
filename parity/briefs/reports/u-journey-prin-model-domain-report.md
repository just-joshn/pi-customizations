# Report: prin-model-domain pair

## Status

**pass** for `PSTACK-PRIN-MODEL-DOMAIN-001` on both hosts. Pair `prin-model-domain-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `5b46963a-1d66-4053-a9c8-4f4e8037ae9d` | Leaf Read + status discriminant + `DOMAIN-OK` (`contractHeld`) |
| Pi | `3ac75dad-b288-4b1e-b104-2b234865575b` | Leaf Read + `TRANSITIONS` registry + `DOMAIN-OK` (`contractHeld` after const-export rescore) |

## Artifacts

- Pair: `parity/evidence/principles/model-domain/pair-prin-model-domain-1.json`
- Capture script: `parity/scripts/capture-prin-model-domain.mjs`
- Fixture: `parity/evidence/principles/model-domain/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/model-domain/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/model-domain/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/model-domain/.audit/u-journey-prin-model-domain.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/a8bc32f6-6f14-48ee-82d6-d91f1e9e0d79/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-55-00-562Z_01a11e28-00d2-77fc-bfe4-1723e521fc3e.jsonl`

## On-disk oracle (re-read)

Both hosts removed the `isDraft`/`isOpen` boolean pair, added `hold`/`release`, left `DOMAIN-OK hold=held-label close-held=rejected release=open` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`), and wrote `verified=yes` to the side-specific done marker.

Cursor wrote a single `status` field with draft/open/held/closed and per-transition guards in `function hold` / `function release`. Transcript includes `Read` of `~/.claude/skills/principle-model-the-domain/SKILL.md`.

Pi wrote a `TRANSITIONS` table and `export const hold` / `release` wrappers over a shared `transition` helper. Session includes `read` of `extensions/pi-pstack/skills/principle-model-the-domain/SKILL.md`. Live capture first scored `structuredDomain=false` because the oracle only matched `function hold`. Re-scored from `pi/fixture-after/src/ticket.js` after widening detection to `export const hold`. PTY attempt id and product bytes were not re-run.

Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on prove-it and fix-root. Not a pure organic trigger of model-domain alone.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Model chrome differs (Auto vs claude-sonnet-5-5 medium).
- Pi `contractHeld` in the first live `observations.json` was false until the const-export oracle fix. Pair records the re-scored verdict against the same on-disk product.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
