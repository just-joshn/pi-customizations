# Report: prin-encode-structure pair

## Status

**pass** for `PSTACK-PRIN-ENCODE-STRUCTURE-001` on both hosts. Pair `prin-encode-structure-1`. Adjacent principle ids not claimed.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `28d00da4-064a-466a-ae71-2d1f249fb6cd` | Leaf Read + lasting check + product fix + `ENCODE-OK` (`contractHeld`) |
| Pi | `fa41db21-da46-4503-b8dc-35d69586e835` | Leaf Read + lasting check + product fix + `ENCODE-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/encode-structure/pair-prin-encode-structure-1.json`
- Capture script: `parity/scripts/capture-prin-encode-structure.mjs`
- Fixture: `parity/evidence/principles/encode-structure/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/encode-structure/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/encode-structure/fixture-out/pi/evidence/verify-out.txt`
- Capture log: `parity/evidence/principles/encode-structure/capture-both.log`
- Decision log: `parity/evidence/principles/encode-structure/.audit/u-journey-prin-encode-structure.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/9d7f4ff3-1a2e-401c-9690-1690796f8904/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T01-06-06-015Z_01a11e32-283e-7056-904f-6f638dbcdd9d.jsonl`

## On-disk oracle (re-read)

Both hosts turned debug off in `src/config.js`, added a lasting check (`scripts/check-allow-debug.mjs` on Cursor; `scripts/check-debug.mjs` on Pi), left `ENCODE-OK` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`), and wrote `verified=yes`. Neither pasted a second prose copy of the ALLOW_DEBUG reminder into `CONTRIBUTING.md`. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false. Leaf Reads evidenced on both hosts.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on other principle pairs.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Mechanism script filenames differ; both are lasting checks.
- Model chrome differs (Cursor unobserved on screen dumps vs claude-sonnet-5-5 medium).

## Not claimed

- Adjacent principle requirement closure beyond ENCODE-STRUCTURE.
