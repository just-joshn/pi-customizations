# Report: prin-experience-first pair

## Status

**pass** for `PSTACK-PRIN-EXPERIENCE-FIRST-001` on both hosts. Pair `prin-experience-first-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `c4dcc551-833e-46ee-bffc-651864b86bf7` | Leaf Read + human default over JSON dump + dual IMPACT.md + `EXPERIENCE-OK` (`contractHeld`) |
| Pi | `624b7baf-b01d-424d-9dac-3b9c39828a79` | Leaf Read + human default over JSON dump + dual IMPACT.md + `EXPERIENCE-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/experience-first/pair-prin-experience-first-1.json`
- Capture script: `parity/scripts/capture-prin-experience-first.mjs`
- Fixture: `parity/evidence/principles/experience-first/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/experience-first/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/experience-first/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/experience-first/.audit/u-journey-prin-experience-first.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/ead89d81-a64e-4062-ad2f-b8e8876147cd/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T01-19-30-101Z_01a11e3e-6d35-7677-a29e-9321a14d0f76.jsonl`

## On-disk oracle (re-read)

Both hosts rewrote `formatStatus` so the default is labeled `Status` / `Ready` / `Next` / `Queue` text, kept matching machine JSON behind `{ json: true }` / `--json`, wrote `IMPACT.md` with Consumer and Maintainer sections, ran `node scripts/verify.mjs`, and left `EXPERIENCE-OK default=human json=yes impact=dual files=status.js` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Both wrote `verified=yes` to the side-specific done marker. Neither added CSV/YAML/XML kitchen-sink exporters.

Cursor transcript includes `Read` of `~/.claude/skills/principle-experience-first/SKILL.md`. Pi session includes `read` / `cat` of `extensions/pi-pstack/skills/principle-experience-first/SKILL.md`. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on prove-it and never-block. Not a pure organic trigger of experience-first alone.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Model chrome differs (Cursor unobserved on screen dumps vs claude-sonnet-5-5 medium).
- Human status wording differs slightly between hosts (`ok` vs `healthy`) while still satisfying the label oracle.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
