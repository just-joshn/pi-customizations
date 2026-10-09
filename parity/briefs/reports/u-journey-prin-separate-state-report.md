# Report: prin-separate-state pair

## Status

**pass** for `PSTACK-PRIN-SEPARATE-STATE-001` on both hosts. Pair `prin-separate-state-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `f8041da0-089d-4161-b775-e5fb91c488e3` | Leaf Read + owned write targets + `SEPARATE-OK separated=yes` (`contractHeld`) |
| Pi | `3b9d8593-e469-4816-a7e2-751bf90e51bf` | Leaf Read + owned write targets + `SEPARATE-OK separated=yes` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/separate-state/pair-prin-separate-state-1.json`
- Capture script: `parity/scripts/capture-prin-separate-state.mjs`
- Fixture: `parity/evidence/principles/separate-state/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/separate-state/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/separate-state/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/separate-state/.audit/u-journey-prin-separate-state.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/b817238e-d918-4650-a337-5c64f326f0c8/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T01-31-37-724Z_01a11e49-877b-751a-94f4-d993e3c1ee87.jsonl`

## On-disk oracle (re-read)

Both hosts stopped writing both workers into `state/state.json`. Cursor used `state/indexer.json` and `state/metrics.json`. Pi used `state/indexer-state.json` and `state/metrics-state.json`. Both merge in `report()`. `node scripts/verify.mjs` stress-runs concurrent `Promise.all` and requires owned paths plus both facts present.

Cursor left `SEPARATE-OK separated=yes indexer=state/indexer.json metrics=state/metrics.json lastIndexed=idx-5 lastMetrics=met-5`.
Pi left `SEPARATE-OK separated=yes indexer=state/indexer-state.json metrics=state/metrics-state.json lastIndexed=idx-5 lastMetrics=met-5`.
Both wrote `verified=yes` to the side-specific done marker.

Independent re-prove on each attempt `fixture-snapshot/src/workers.js` reproduced matching SEPARATE-OK lines.

Cursor transcript includes `Read` of `~/.claude/skills/principle-separate-before-serializing-shared-state/SKILL.md`. Pi session includes `read` of `extensions/pi-pstack/skills/principle-separate-before-serializing-shared-state/SKILL.md` after an initial verify. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on prove-it and idempotent. Not a pure organic trigger of separate-state alone.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Owned path names differ across hosts (reconciled as share-elimination, not byte-identical paths).
- Model chrome differs (Cursor Auto / unobserved vs claude-sonnet-5-5 medium).
- Shared rule `~/.cursor/rules/pstack-models.mdc` was serialized via `/tmp/pstack-parity-pstack-models.lock`. Digest stayed on the locked fixture.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
