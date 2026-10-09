# u-help-recommend-fix report

## Status

**cleared on evidence.** Product edit required. Real PTY help-only pair shows primary `/interrogate` on Cursor and Pi for `/poteto-help which skill should i use to review this branch?`. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `cc0e3b4c-3d78-416d-98d5-e71ed57d12d9` |
| pi | `91fa6578-cce4-4b5a-abc2-9fe1e90f2b42` |

Pair. `parity/evidence/commands/pair-commands-help-recommend-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004`

Capture. `parity/scripts/capture-commands-help-recommend.mjs --both`

## Root cause

Pi ships team-kit `/review-and-ship` beside pstack. The prior poteto-help table mapped only "Have different models review a diff…" to `/interrogate`. The natural-language ask "review this branch" matched `/review-and-ship` first on Pi (`pair-commands-help-cancel-1`, Pi `e6909603-…`).

## Product edit

Required. Encoded in the resource-row generator so a later `bun run generate` cannot drop the route.

Paths.

1. `extensions/pi-pstack/scripts/resource-rows/60-help.mjs` (branch-review → `/interrogate`; also re-encoded sticky-mode rows that had drifted from an earlier hand edit)
2. `extensions/pi-pstack/skills/poteto-help/SKILL.md` (generated)
3. `extensions/pi-pstack/prompts/poteto-help.md` (generated)
4. `extensions/pi-pstack/docs/resource-map.json` (generated)
5. `extensions/pi-pstack/test/latest-workflows.test.ts` (asserts the mapping)
6. `parity/scripts/capture-commands-help-recommend.mjs` (help-only capture + scorer)

`/review-and-ship` was not deleted. It remains a close-call for review then commit and open a PR.

## Screen oracle (measured)

Cursor settled screen leads with `/interrogate` and names `/review-and-ship` only under close calls.

Pi settled screen leads with `Use /interrogate.` and a copyable `/interrogate the whole branch…` recipe. `/review-and-ship` appears only as the ship path.

Screens.

- `parity/evidence/commands/cursor/cc0e3b4c-3d78-416d-98d5-e71ed57d12d9/screen-03-help-settled.txt`
- `parity/evidence/commands/pi/91fa6578-cce4-4b5a-abc2-9fe1e90f2b42/screen-03-help-settled.txt`

## Tests

`bun run test -- test/latest-workflows.test.ts` in `extensions/pi-pstack`. 15 passed, including `poteto-help maps branch-review questions to /interrogate ahead of /review-and-ship`.

`bun run check:resources` clean after generate.

## Coordinator notes

Mismatch `CMD-POTETO-HELP-RECOMMENDATION` is ready for ledger close from this pair. Worker did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
