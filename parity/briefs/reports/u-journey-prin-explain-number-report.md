# Report: prin-explain-number pair

## Status

**pass** for `PSTACK-PRIN-EXPLAIN-NUMBER-001` on both hosts. Pair `prin-explain-number-1`. Adjacent principle ids not claimed.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `0adb3d89-a142-4c2a-9487-4209954140ef` | Leaf Read + named limiter + n=5 + spread + `EXPLAIN-OK` (`contractHeld`) |
| Pi | `029fedbc-568d-499e-ba31-1da197a2d866` | Leaf Read + named limiter + n=5 + spread + `EXPLAIN-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/explain-number/pair-prin-explain-number-1.json`
- Capture script: `parity/scripts/capture-prin-explain-number.mjs`
- Fixture: `parity/evidence/principles/explain-number/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/explain-number/fixture-out/cursor/evidence/verify-out.txt`
- Cursor report copy: `parity/evidence/principles/explain-number/fixture-out/cursor/evidence/explain-report.md`
- Pi proof copy: `parity/evidence/principles/explain-number/fixture-out/pi/evidence/verify-out.txt`
- Pi report copy: `parity/evidence/principles/explain-number/fixture-out/pi/evidence/explain-report.md`
- Capture log: `parity/evidence/principles/explain-number/capture-both.log`
- Decision log: `parity/evidence/principles/explain-number/.audit/u-journey-prin-explain-number.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/0015e749-445a-4faf-beae-1c7f8086ad89/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T01-22-25-596Z_01a11e41-1abc-72ef-b20b-abb36494fbae.jsonl`

## On-disk oracle (re-read)

Both hosts Read `principle-explain-the-number/SKILL.md` (path `extensions/pi-pstack/skills/...`), wrote `evidence/explain-report.md` with a named limiter (single-threaded parse loop / one CPU core in `src/parse.js`), run count `n=5`, and min/max spread (or link to `data/trials.json`), left `EXPLAIN-OK` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`), and wrote `verified=yes`. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false. Shared rule digest unchanged through capture (`sha256:2b6b4668...`).

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on other principle pairs.
- Cursor and Pi both resolved the leaf under `extensions/pi-pstack/skills/` rather than the Cursor plugin cache path.
- Model chrome differs (Cursor unobserved on screen dumps vs claude-sonnet-5-5 medium).

## Not claimed

- Adjacent principle requirement closure beyond EXPLAIN-NUMBER.
- Coordinator ledger merge (`requirements.json` / `scenarios` / `progress.md`).
