# Report: prin-subtract-first pair

## Status

**pass** for `PSTACK-PRIN-SUBTRACT-FIRST-001` on both hosts. Pair `prin-subtract-first-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `8ff2e73a-52d1-4d2c-a601-bed33a6bec3d` | Leaf Read + delete dead then shout + `SUBTRACT-OK` (`contractHeld`) |
| Pi | `949c5a02-da60-4b0d-8838-d6ccf3b7914a` | Leaf Read + delete dead then shout + `SUBTRACT-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/subtract-first/pair-prin-subtract-first-1.json`
- Capture script: `parity/scripts/capture-prin-subtract-first.mjs`
- Fixture: `parity/evidence/principles/subtract-first/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/subtract-first/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/subtract-first/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/subtract-first/.audit/u-journey-prin-subtract-first.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/c0a1a29c-1d2d-4e5c-a873-e9f328b213fa/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-55-09-171Z_01a11e28-2273-738a-a464-2e0c0d26095c.jsonl`

## On-disk oracle (re-read)

Both hosts deleted `src/legacyValidate.js` and `src/stubRefs.js`, left `greet()` calling `message()` from `src/core.js` with shout uppercasing, and wrote `SUBTRACT-OK plain="hello, world" shout="HELLO, WORLD" files=core.js,greet.js` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Neither kept speculative validator or stub filenames. Both wrote `verified=yes` to the side-specific done marker.

Cursor poll log shows dead-file absence at `00:59:28.161Z` before the first `src/greet.js` capability write at `00:59:28.563Z`. Transcript includes `Read` of `principle-subtract-before-you-add/SKILL.md`. Pi session includes `read` of `extensions/pi-pstack/skills/principle-subtract-before-you-add/SKILL.md` at `00:55:14.650Z` and lands delete plus capability in the same poll sample at `00:55:24.503Z`. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on sibling principle journeys. Not a pure organic first trigger of subtract-first alone.
- First Cursor attempt `5d1c2b8e-2a0d-4232-83bb-e9fb208a9090` already had leaf Read, delete-before-add, and `SUBTRACT-OK`, but missed `done.txt`. Pair uses the retry attempt that wrote `verified=yes`.
- Pi delete and capability share one poll timestamp, so sequencing rests on end-state plus session leaf Read rather than a clear multi-sample delete-then-write gap.
- Cursor Read the user skill at `~/.claude/skills/principle-subtract-before-you-add/SKILL.md`, which lacks `disable-model-invocation`. Package copies used for the frontmatter gate have it.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Model chrome differs (Cursor settled screen unlabeled; Pi showed claude-sonnet-5-5 medium).

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
