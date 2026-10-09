# Report: prin-minimize-reader pair

## Status

**pass** for `PSTACK-PRIN-MINIMIZE-READER-001` on both hosts. Pair `prin-minimize-reader-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `a0563963-92bc-4f7d-b63d-37051663e79b` | Leaf Read + collapsed one-caller wrappers + `TRACE-OK` (`contractHeld`) |
| Pi | `f698e8a7-1dbd-46cb-96d2-7ecaabbebaeb` | Leaf Read + collapsed one-caller wrappers + `TRACE-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/minimize-reader/pair-prin-minimize-reader-1.json`
- Capture script: `parity/scripts/capture-prin-minimize-reader.mjs`
- Fixture: `parity/evidence/principles/minimize-reader/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/minimize-reader/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/minimize-reader/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/minimize-reader/.audit/u-journey-prin-minimize-reader.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/809cc0f3-c53d-4b4c-a293-b4b101571ab2/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-53-56-101Z_01a11e27-0505-7310-938a-ba52c22bcfba.jsonl`

## On-disk oracle (re-read)

Both hosts deleted `greeting-loader.js`, `greeting-fetch.js`, and `greeting-resolve.js`, rewired `greet.js` to call `core.message()` directly, ran `node scripts/verify.mjs`, and left `TRACE-OK path=collapse files=core.js,greet.js` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Both wrote `verified=yes` to the side-specific done marker. Neither added a `facade/` layer.

Cursor transcript includes `Read` of `~/.claude/skills/principle-minimize-reader-load/SKILL.md`. Pi session includes `read` of `extensions/pi-pstack/skills/principle-minimize-reader-load/SKILL.md`. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on prove-it and never-block. Not a pure organic trigger of minimize-reader alone.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Model chrome differs (Cursor unobserved on screen dumps vs claude-sonnet-5-5 medium).
- Fixture greets correctly before the edit. Failure is layer count (`TRACE-FAIL`), not a broken return value.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
