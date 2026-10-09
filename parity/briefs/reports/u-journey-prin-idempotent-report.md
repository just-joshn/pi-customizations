# Report: prin-idempotent pair

## Status

**pass** for `PSTACK-PRIN-IDEMPOTENT-001` on both hosts. Pair `prin-idempotent-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `fef5e774-50d6-4214-9d76-6228f155b229` | Leaf Read + mid-crash re-run converge + `APPLY-OK converge=yes` (`contractHeld`) |
| Pi | `4e21a4e0-18c1-42e8-b286-6779858d9fe1` | Leaf Read + mid-crash re-run converge + `APPLY-OK converge=yes` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/idempotent/pair-prin-idempotent-1.json`
- Capture script: `parity/scripts/capture-prin-idempotent.mjs`
- Fixture: `parity/evidence/principles/idempotent/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/idempotent/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/idempotent/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/idempotent/.audit/u-journey-prin-idempotent.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/281d4a7e-0759-477c-b2b8-cea56b81dafc/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T01-05-41-464Z_01a11e31-c857-74af-9e53-c39401b6383f.jsonl`

## On-disk oracle (re-read)

Both hosts removed the `prev.run + 1` bump in `src/apply.js`, kept `CRASH_AFTER_STEP_1`, and left a constant desired final `{ status: 'ready', run: 1, payload: 'DEPLOYED' }`. `node scripts/verify.mjs` cleans, runs once, crashes after step-1, re-runs, and compares final digests. Both left `APPLY-OK converge=yes digest=4937429a2af37562d35881f93fb984223786dde868d71f2aab621b5980487659` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Both wrote `verified=yes` to the side-specific done marker.

Independent re-prove on each `fixture-after/src/apply.js` reproduced matching clean vs mid-crash-then-re-run digests.

Cursor transcript includes `Read` of `~/.claude/skills/principle-make-operations-idempotent/SKILL.md`. Pi session includes `read` of `extensions/pi-pstack/skills/principle-make-operations-idempotent/SKILL.md` after an initial verify. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on prove-it and fix-root. Not a pure organic trigger of idempotent alone.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Model chrome differs (Cursor Auto vs claude-sonnet-5-5 medium).
- Concurrent peer captures shared `~/.cursor/rules/pstack-models.mdc`. Digest stayed on the locked fixture; scenario-specific backups were used.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
